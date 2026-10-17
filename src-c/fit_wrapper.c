/*
 * fit_wrapper.c — chunked Levenberg-Marquardt fit driver over cminpack's lmdif.
 *
 * Architecture: see docs/adrs/0004-fit-model-to-data.md (mxlweb, this feature spans
 * both repos). Summary:
 *   - lmdif's inner loop calls run_radau5/run_dop853/run_dopri5 (radau5_wrapper.c)
 *     as a plain C function call — no JS boundary crossing per trial parameter set.
 *   - Fitting runs in chunks: fit_chunk(maxfev) runs lmdif for at most maxfev
 *     function evaluations, then returns to JS so it can report progress and let the
 *     user cancel. A chunk that hits its budget (MINPACK info==5) is resumed by
 *     calling fit_chunk again — lmdif restarts fresh each time, seeded from the
 *     parameter vector the previous chunk left off at. This is not a true resume of
 *     internal trust-region state, but restarting LM from an improved x converges
 *     fine in practice and keeps the C API simple.
 *   - Fit parameters are optionally transformed to log-space before being handed to
 *     lmdif (x = log(param)), guaranteeing positivity for the kinetic-rate-constant
 *     parameters this project's models are made of, without needing a bounded solver.
 *   - Fit targets may be raw state variables or derived quantities (computed by a
 *     second WAT-compiled callback, registered via set_derived_fn — see
 *     wat-codegen.ts's buildDerivedWat). Both are evaluated at the data's own
 *     (possibly irregular) timestamps via linear interpolation of the integrator's
 *     dense output — interp_at() below, a C port of wasmWorker.ts's resampleUniform.
 *   - A trial parameter set that makes the integrator fail (IDID<0) gets a large
 *     finite penalty residual, not an abort — lmdif's own trust region rejects and
 *     shrinks away from it. iflag<0 (real MINPACK abort) is reserved for fatal
 *     internal errors (allocation failure), not solver hiccups.
 *   - The residual is a concatenation of independent experiments (ADR 0009):
 *     time courses under an optional piecewise-constant parameter protocol,
 *     and steady states under per-condition parameter overrides — see
 *     fit_init's own doc comment for the layout.
 */

#include "minpack/cminpack.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Exported from radau5_wrapper.c — called directly, in-process.      */
/* ------------------------------------------------------------------ */
extern void set_model_fn(int table_idx);
extern void init_output(int capacity, int dim);
extern void free_output(void);
extern int get_out_n(void);
extern double *get_out_t(void);
extern double *get_out_y(void);
extern int run_radau5(int n, double t_start, double t_end, double *y, double *rpar,
                       double rtol, double atol, double h_init, int nmax);
extern int run_dop853(int n, double t_start, double t_end, double *y, double *rpar,
                       double rtol, double atol, double h_init, int nmax);
extern int run_dopri5(int n, double t_start, double t_end, double *y, double *rpar,
                       double rtol, double atol, double h_init, int nmax);
extern void eval_rhs(int n, double t, double *y, double *dydt, double *pars);

/* Solver choice, matching wasmWorker.ts's method dispatch. */
enum { SOLVER_RADAU5 = 0, SOLVER_DOP853 = 1, SOLVER_DOPRI5 = 2 };

/* Same calling convention/signature shape as the RHS model_fn ("vidiii"):
 * void derived_fn(int n_y, double t, double* y, double* out, double* pars) */
typedef void (*DerivedFn)(int, double, double *, double *, double *);
static DerivedFn g_derived_fn = NULL;

void set_derived_fn(int table_idx) {
  g_derived_fn = (DerivedFn)(intptr_t)table_idx;
}

/* Fires every `progress_interval` real evaluations (FitSession's own field,
 * below) from inside fit_fcn — a genuine mid-chunk progress signal,
 * independent of fit_chunk's own (much coarser, correctness-mandated)
 * budget. See docs/adrs/0005-neural-network-corrections-and-adjoint-
 * fitting.md §2.5's own follow-up: chunkMaxfev has to stay large enough for
 * lmdif to make real progress, but the UI still wants to redraw at
 * whatever cadence the user actually asked for — this is how. Registered
 * once, globally, not per fit session (fitWorker.ts's own doc comment). */
typedef void (*ProgressFn)(int, double);
static ProgressFn g_progress_fn = NULL;
void fit_set_progress_fn(int table_idx) {
  g_progress_fn = (ProgressFn)(intptr_t)table_idx;
}

/* ------------------------------------------------------------------ */
/* Fit session state — persists across fit_chunk() calls.             */
/* ------------------------------------------------------------------ */
#define TARGET_STATE 0
#define TARGET_DERIVED 1

/* MINPACK info==5 is specifically "number of calls to fcn has reached maxfev";
 * every other value means lmdif considers itself done (converged, degenerate
 * step, or improper input) — see cminpack lmdif.c's info assignment sites. */
#define LMDIF_INFO_MAXFEV_REACHED 5

/* Not a MINPACK code (those only ever assign 0-8): fit_fcn returns this via
 * iflag to short-circuit lmdif the moment the caller's target residual norm
 * is reached, rather than waiting for lmdif's own ftol/xtol tolerances to
 * declare convergence — those are *relative*-improvement tests and can
 * easily stay unsatisfied long after the *absolute* residual the caller
 * actually cares about has been crossed. Must be negative: lmdif.c only
 * ever inspects a callback's returned iflag via `if (iflag < 0)` to decide
 * whether to abort early (see lmdif.c's fcn_mn call sites) — a
 * non-negative return is simply ignored and iteration continues regardless
 * of its value. Distinct from -1 (used elsewhere in this file for genuine
 * allocation failures) so fitWorker.ts can special-case it as "done, not an
 * error" rather than reporting it as a fatal fit failure. */
#define FIT_TARGET_REACHED (-2)

/* Experiment kinds — see the "Experiments" block comment above fit_init. */
#define EXP_TIME_COURSE 0
#define EXP_STEADY_STATE 1

typedef struct {
  int n_y;
  double *y0; /* length n_y, fixed initial conditions (shared by every experiment) */

  int n_pars;
  double *pars; /* length n_pars, full vector (fixed values stay put) */

  int n_fit;
  int *fit_idx;   /* length n_fit, indices into pars[] */
  int *log_flags; /* length n_fit, 1 = fit in log-space */

  int n_targets;
  int *target_kind;  /* length n_targets, TARGET_STATE | TARGET_DERIVED */
  int *target_index; /* length n_targets, index into y[] or derived_out[] */
  double *target_scale; /* length n_targets, normalization divisor */

  /* Parameter overrides: one shared list of parameter indices; every
   * segment carries one value per entry (NaN = leave unchanged). */
  int n_ovr;
  int *ovr_idx; /* length n_ovr */

  int n_exp;
  int *exp_kind;    /* length n_exp, EXP_TIME_COURSE | EXP_STEADY_STATE */
  int *exp_n_seg;   /* length n_exp */
  int *exp_seg_off; /* length n_exp, derived: offset into seg_t_end */
  int *exp_n_points; /* length n_exp */
  int *exp_pt_off;   /* length n_exp, derived: offset into data_t */

  int n_seg_total;
  double *seg_t_end; /* length n_seg_total, ascending within an experiment */
  double *seg_ovr;   /* length n_seg_total * n_ovr */

  int n_points; /* total over all experiments */
  double *data_t; /* length n_points; ascending within a time-course experiment */
  /* length n_targets * n_points: experiment e's block starts at
   * n_targets * exp_pt_off[e] and is target-major within it. NaN = missing. */
  double *data_y;

  int n_derived; /* size of the derived_fn output buffer, 0 if unused */

  int solver_id;
  double rtol, atol;
  double ss_tol;   /* steady state: ||f(y)|| / max(||y||, 1) below this */
  double ss_t_max; /* steady state: give up (penalty) past this time */

  /* Absolute residual-norm early-stop, checked in fit_fcn; negative disables
   * the check (rely on lmdif's own convergence criteria only). */
  double target_residual_norm;

  double *x; /* length n_fit, current (possibly log-space) parameter estimate */

  int total_nfev;
  int last_info;
  double last_residual_norm;

  /* Mid-chunk progress reporting (see g_progress_fn's own doc comment). <=0
   * disables. chunk_nfev is evals-so-far in the *currently executing*
   * fit_chunk call, reset at that call's start — total_nfev (above) only
   * gets its own update *after* the chunk finishes, so total_nfev +
   * chunk_nfev is the true live count while a chunk is still running. */
  int progress_interval;
  int chunk_nfev;
} FitSession;

static FitSession *g_fit = NULL;

static void fit_session_free(FitSession *s) {
  if (!s) return;
  free(s->y0);
  free(s->pars);
  free(s->fit_idx);
  free(s->log_flags);
  free(s->target_kind);
  free(s->target_index);
  free(s->target_scale);
  free(s->ovr_idx);
  free(s->exp_kind);
  free(s->exp_n_seg);
  free(s->exp_seg_off);
  free(s->exp_n_points);
  free(s->exp_pt_off);
  free(s->seg_t_end);
  free(s->seg_ovr);
  free(s->data_t);
  free(s->data_y);
  free(s->x);
  free(s);
}

void fit_free(void) {
  fit_session_free(g_fit);
  g_fit = NULL;
}

/* ------------------------------------------------------------------ */
/* Linear interpolation of dense integrator output at an arbitrary    */
/* query time. C port of wasmWorker.ts's resampleUniform, generalized */
/* from uniform to arbitrary (still ascending) query times.           */
/* ------------------------------------------------------------------ */
static void interp_at(int n_y, int out_n, const double *out_t, const double *out_y,
                       double t_query, double *y_out) {
  if (out_n <= 0) {
    memset(y_out, 0, (size_t)n_y * sizeof(double));
    return;
  }
  if (out_n == 1 || t_query <= out_t[0]) {
    memcpy(y_out, out_y, (size_t)n_y * sizeof(double));
    return;
  }
  if (t_query >= out_t[out_n - 1]) {
    memcpy(y_out, out_y + (size_t)(out_n - 1) * n_y, (size_t)n_y * sizeof(double));
    return;
  }
  int lo = 0, hi = out_n - 1;
  while (hi - lo > 1) {
    int mid = (lo + hi) >> 1;
    if (out_t[mid] <= t_query)
      lo = mid;
    else
      hi = mid;
  }
  double t_lo = out_t[lo], t_hi = out_t[hi];
  double alpha = (t_hi > t_lo) ? (t_query - t_lo) / (t_hi - t_lo) : 0.0;
  const double *y_lo = out_y + (size_t)lo * n_y;
  const double *y_hi = out_y + (size_t)hi * n_y;
  for (int i = 0; i < n_y; i++) {
    y_out[i] = y_lo[i] + alpha * (y_hi[i] - y_lo[i]);
  }
}

/* ------------------------------------------------------------------ */
/* Residual evaluation, one experiment at a time.                      */
/* ------------------------------------------------------------------ */
static int integrate(const FitSession *s, double t0, double t1, double *y, double *pars) {
  switch (s->solver_id) {
    case SOLVER_DOP853:
      return run_dop853(s->n_y, t0, t1, y, pars, s->rtol, s->atol, 0.0, 500000);
    case SOLVER_DOPRI5:
      return run_dopri5(s->n_y, t0, t1, y, pars, s->rtol, s->atol, 0.0, 500000);
    default:
      return run_radau5(s->n_y, t0, t1, y, pars, s->rtol, s->atol, 0.0, 500000);
  }
}

static void apply_overrides(const FitSession *s, int seg, const double *pars_trial,
                            double *pars_seg) {
  memcpy(pars_seg, pars_trial, (size_t)s->n_pars * sizeof(double));
  const double *ovr = s->seg_ovr + (size_t)seg * s->n_ovr;
  for (int i = 0; i < s->n_ovr; i++) {
    if (!isnan(ovr[i])) pars_seg[s->ovr_idx[i]] = ovr[i];
  }
}

/* Per-evaluation work buffers, allocated once per compute_residuals call. */
typedef struct {
  double *pars_seg; /* trial parameters with the current segment's overrides */
  double *y_work;
  double *y_interp;
  double *derived_out;
  double *rhs_out;
} Scratch;

/* Writes every target's residual (and, if model_out, its raw model value)
 * for point j of experiment e from state y under w->pars_seg. */
static void write_point(const FitSession *s, int e, int j, double t, const double *y,
                        Scratch *w, double *fvec, double *model_out) {
  if (s->n_derived > 0) {
    g_derived_fn(s->n_y, t, (double *)y, w->derived_out, w->pars_seg);
  }
  const int n_e = s->exp_n_points[e];
  const size_t base = (size_t)s->n_targets * s->exp_pt_off[e];
  for (int k = 0; k < s->n_targets; k++) {
    double model_v = (s->target_kind[k] == TARGET_STATE) ? y[s->target_index[k]]
                                                           : w->derived_out[s->target_index[k]];
    size_t idx = base + (size_t)k * n_e + j;
    double data_v = s->data_y[idx];
    fvec[idx] = isnan(data_v) ? 0.0 : (model_v - data_v) / s->target_scale[k];
    if (model_out) model_out[idx] = model_v;
  }
}

/* Integration failed (or a steady state never converged) for this trial
 * parameter set — penalize, don't abort. lmdif's trust region will reject
 * and shrink away from here on its own. */
static void penalize_experiment(const FitSession *s, int e, double *fvec, double *model_out) {
  const double PENALTY = 1.0e3;
  const int n_e = s->exp_n_points[e];
  const size_t base = (size_t)s->n_targets * s->exp_pt_off[e];
  for (size_t idx = base; idx < base + (size_t)s->n_targets * n_e; idx++) {
    fvec[idx] = isnan(s->data_y[idx]) ? 0.0 : PENALTY;
    if (model_out) model_out[idx] = NAN;
  }
}

/* Piecewise-constant protocol: integrate segment by segment, carrying the
 * state across boundaries, and sample the data points with
 * t_prev < t <= t_end from that segment's own output under that segment's
 * own parameters (mirrors wasmWorker.ts's per-point allPars). A boundary
 * point therefore belongs to the earlier segment, the same as the
 * simulation workers (which drop each later segment's first sample). A
 * plain time course is the one-segment, no-override special case. Returns 0
 * on success, -1 if the integrator failed. */
static int run_time_course(const FitSession *s, int e, const double *pars_trial, Scratch *w,
                           double *fvec, double *model_out) {
  const int n_e = s->exp_n_points[e];
  const double *t_data = s->data_t + s->exp_pt_off[e];
  memcpy(w->y_work, s->y0, (size_t)s->n_y * sizeof(double));

  double t = 0.0;
  int j = 0;
  for (int g = 0; g < s->exp_n_seg[e] && j < n_e; g++) {
    const int seg = s->exp_seg_off[e] + g;
    const double t_end = s->seg_t_end[seg];
    apply_overrides(s, seg, pars_trial, w->pars_seg);

    init_output(2000, s->n_y);
    if (t_end > t && integrate(s, t, t_end, w->y_work, w->pars_seg) < 0) {
      free_output();
      return -1;
    }
    const int out_n = get_out_n();
    const double *out_t = get_out_t();
    const double *out_y = get_out_y();
    for (; j < n_e && t_data[j] <= t_end; j++) {
      if (out_n > 0) {
        interp_at(s->n_y, out_n, out_t, out_y, t_data[j], w->y_interp);
      } else {
        /* Zero-length segment (t_end == t): the state is just y_work. */
        memcpy(w->y_interp, w->y_work, (size_t)s->n_y * sizeof(double));
      }
      write_point(s, e, j, t_data[j], w->y_interp, w, fvec, model_out);
    }
    free_output();
    t = t_end;
  }
  return 0;
}

static int rhs_converged(const FitSession *s, double t, Scratch *w) {
  eval_rhs(s->n_y, t, w->y_work, w->rhs_out, w->pars_seg);
  double f2 = 0.0, y2 = 0.0;
  for (int i = 0; i < s->n_y; i++) {
    if (!isfinite(w->rhs_out[i])) return 0;
    f2 += w->rhs_out[i] * w->rhs_out[i];
    y2 += w->y_work[i] * w->y_work[i];
  }
  double ynorm = sqrt(y2);
  return sqrt(f2) / (ynorm > 1.0 ? ynorm : 1.0) < s->ss_tol;
}

/* Integrate to steady state: windows ending at t = 1, 10, 100, ... (capped
 * at ss_t_max), checking ||dy/dt|| after each — the browser analogue of
 * MxlPy's simulate_to_steady_state. Steps aren't recorded (init_output(0)):
 * only the final state matters. Returns 0 on success, -1 if the integrator
 * failed or the state never converged before ss_t_max. */
static int run_steady_state(const FitSession *s, int e, const double *pars_trial, Scratch *w,
                            double *fvec, double *model_out) {
  const int seg = s->exp_seg_off[e];
  apply_overrides(s, seg, pars_trial, w->pars_seg);
  memcpy(w->y_work, s->y0, (size_t)s->n_y * sizeof(double));

  double t = 0.0;
  int converged = rhs_converged(s, t, w);
  for (double t_next = 1.0; !converged && t < s->ss_t_max; t_next *= 10.0) {
    if (t_next > s->ss_t_max) t_next = s->ss_t_max;
    init_output(0, s->n_y);
    int idid = integrate(s, t, t_next, w->y_work, w->pars_seg);
    free_output();
    if (idid < 0) return -1;
    t = t_next;
    converged = rhs_converged(s, t, w);
  }
  if (!converged) return -1;

  for (int j = 0; j < s->exp_n_points[e]; j++) {
    write_point(s, e, j, t, w->y_work, w, fvec, model_out);
  }
  return 0;
}

/* Fills fvec (length n_targets * n_points) for the trial vector x, and
 * model_out with the raw model values (NaN for penalized experiments) when
 * non-NULL. Returns 0, or -1 on allocation failure. */
static int compute_residuals(const FitSession *s, const double *x, double *fvec,
                             double *model_out) {
  double *pars_trial = (double *)malloc((size_t)s->n_pars * sizeof(double));
  Scratch w;
  w.pars_seg = (double *)malloc((size_t)s->n_pars * sizeof(double));
  w.y_work = (double *)malloc((size_t)s->n_y * sizeof(double));
  w.y_interp = (double *)malloc((size_t)s->n_y * sizeof(double));
  w.rhs_out = (double *)malloc((size_t)s->n_y * sizeof(double));
  w.derived_out =
      s->n_derived > 0 ? (double *)malloc((size_t)s->n_derived * sizeof(double)) : NULL;
  int rc = 0;
  if (!pars_trial || !w.pars_seg || !w.y_work || !w.y_interp || !w.rhs_out ||
      (s->n_derived > 0 && !w.derived_out)) {
    rc = -1;
    goto done;
  }

  /* Fixed values from s->pars, fitted values from x (undoing the log-space
   * transform). */
  memcpy(pars_trial, s->pars, (size_t)s->n_pars * sizeof(double));
  for (int i = 0; i < s->n_fit; i++) {
    pars_trial[s->fit_idx[i]] = s->log_flags[i] ? exp(x[i]) : x[i];
  }

  for (int e = 0; e < s->n_exp; e++) {
    int ok = s->exp_kind[e] == EXP_STEADY_STATE
                 ? run_steady_state(s, e, pars_trial, &w, fvec, model_out)
                 : run_time_course(s, e, pars_trial, &w, fvec, model_out);
    if (ok < 0) penalize_experiment(s, e, fvec, model_out);
  }

done:
  free(pars_trial);
  free(w.pars_seg);
  free(w.y_work);
  free(w.y_interp);
  free(w.rhs_out);
  free(w.derived_out);
  return rc;
}

/* ------------------------------------------------------------------ */
/* fcn — the LM residual callback (cminpack_func_mn signature).       */
/* ------------------------------------------------------------------ */
static int fit_fcn(void *p, int m, int n, const double *x, double *fvec, int iflag) {
  (void)p;
  FitSession *s = g_fit;
  s->chunk_nfev++;

  /* fatal: allocation failure, not a numerical hiccup — abort. */
  if (compute_residuals(s, x, fvec, NULL) < 0) return -1;

  /* Mid-chunk progress — see g_progress_fn's own doc comment. Fires on
   * both iflag==1 and iflag==2, unlike the target-reached check below:
   * fvec is a genuine, meaningful residual either way (iflag==2's fdjac2
   * perturbation is a tiny epsilon step off the last real trial,
   * indistinguishable at display precision), and gating on iflag==1 only
   * would make the reporting cadence inconsistent with total_nfev's own
   * count (which includes both). */
  if (s->progress_interval > 0 && g_progress_fn &&
      s->chunk_nfev % s->progress_interval == 0) {
    double ss = 0.0;
    for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
    g_progress_fn(s->total_nfev + s->chunk_nfev, sqrt(ss));
  }

  /* iflag==1 is lmdif's "evaluate at this x" call — the actual trial point,
   * as opposed to fdjac2's iflag==2 perturbed calls used only to estimate
   * the Jacobian's columns. Checking the target on those would fire on a
   * neighbor of x rather than x itself, and possibly by pure chance.
   *
   * Note x/fvec here aren't necessarily s->x/fit_chunk's own fvec buffer:
   * after the first call, lmdif reuses this same iflag==1 evaluation to
   * *try* a candidate step, writing into its own scratch buffers (a trial x,
   * a trial fvec) before deciding whether to accept it — s->x and the
   * caller-visible fvec only get overwritten with that candidate later, once
   * accepted. Aborting here (via a negative iflag) skips that bookkeeping
   * entirely, so without capturing both explicitly here, fit_get_params()
   * and fit_get_residual_norm() would keep reporting whatever was current
   * *before* this candidate — silently discarding the very point whose
   * residual we just confirmed meets the target. */
  if (iflag == 1 && s->target_residual_norm >= 0.0) {
    double ss = 0.0;
    for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
    if (sqrt(ss) <= s->target_residual_norm) {
      memcpy(s->x, x, (size_t)n * sizeof(double));
      s->last_residual_norm = sqrt(ss);
      return FIT_TARGET_REACHED;
    }
  }
  return 1;
}

/* ------------------------------------------------------------------ */
/* Exported API                                                        */
/* ------------------------------------------------------------------ */

/*
 * fit_init — one-time setup for a fit session. Call set_model_fn() (and
 * set_derived_fn() if n_derived>0) before this.
 *
 * Experiments (ADR 0009): the residual vector is the concatenation of
 * n_exp independent experiments, all starting from y0:
 *   - EXP_TIME_COURSE: exp_n_seg[e] >= 1 protocol segments, each ending at
 *     seg_t_end and applying its row of seg_ovr. A plain time course is one
 *     segment ending at the last data time, with all-NaN overrides. Its
 *     exp_n_points[e] data times must be ascending and <= the last segment's
 *     t_end.
 *   - EXP_STEADY_STATE: exactly one segment (its t_end is ignored) whose
 *     overrides define the condition; integrated to convergence (ss_tol,
 *     ss_t_max). Its data_t entries are ignored.
 * data_t has n_points = sum(exp_n_points) entries, concatenated per
 * experiment; data_y has n_targets * n_points, experiment-major then
 * target-major (data_y[n_targets*pt_off(e) + k*exp_n_points[e] + j]).
 * seg_ovr has n_seg_total * n_ovr entries (NaN = keep the trial value);
 * ovr_idx maps each override column to an index into pars[]. An override
 * replaces a fitted parameter's trial value, the same as MxlPy.
 * NaN data_y entries are missing observations and contribute 0.
 *
 * target_residual_norm: fit_chunk stops as soon as the residual norm drops
 * to or below this (see FIT_TARGET_REACHED) — pass a negative value to
 * disable and rely on lmdif's own convergence criteria only.
 *
 * progress_interval: fires the registered progress callback (fit_set_
 * progress_fn) every this many evaluations *within* a chunk — independent
 * of fit_chunk's own maxfev budget, see g_progress_fn's own doc comment.
 * <=0 disables mid-chunk reporting entirely.
 *
 * Returns 0 on success, -1 on allocation failure, -2 if a log-space fit
 * parameter's initial value is <= 0 (log undefined), -3 if the experiment
 * layout is inconsistent (time-course data past its last segment, a
 * steady-state experiment without exactly one segment, or segment/point
 * counts that don't sum to n_seg_total/n_points).
 */
int fit_init(int n_y, double *y0, int n_pars, double *pars, int n_fit, int *fit_idx,
             int *log_flags, int n_targets, int *target_kind, int *target_index,
             double *target_scale, int n_ovr, int *ovr_idx, int n_exp, int *exp_kind,
             int *exp_n_seg, int *exp_n_points, int n_seg_total, double *seg_t_end,
             double *seg_ovr, int n_points, double *data_t, double *data_y, int n_derived,
             int solver_id, double rtol, double atol, double ss_tol, double ss_t_max,
             double target_residual_norm, int progress_interval) {
  fit_free();

  FitSession *s = (FitSession *)calloc(1, sizeof(FitSession));
  if (!s) return -1;

#define ALLOC_COPY(field, src, count, type)                          \
  do {                                                               \
    size_t bytes_ = (size_t)(count) * sizeof(type);                  \
    s->field = (type *)malloc(bytes_ > 0 ? bytes_ : 1);              \
    if (!s->field) {                                                 \
      fit_session_free(s);                                           \
      return -1;                                                     \
    }                                                                \
    if ((src) && bytes_ > 0) memcpy(s->field, (src), bytes_);         \
  } while (0)

  s->n_y = n_y;
  s->n_pars = n_pars;
  s->n_fit = n_fit;
  s->n_targets = n_targets;
  s->n_ovr = n_ovr;
  s->n_exp = n_exp;
  s->n_seg_total = n_seg_total;
  s->n_points = n_points;
  ALLOC_COPY(y0, y0, n_y, double);
  ALLOC_COPY(pars, pars, n_pars, double);
  ALLOC_COPY(fit_idx, fit_idx, n_fit, int);
  ALLOC_COPY(log_flags, log_flags, n_fit, int);
  ALLOC_COPY(target_kind, target_kind, n_targets, int);
  ALLOC_COPY(target_index, target_index, n_targets, int);
  ALLOC_COPY(target_scale, target_scale, n_targets, double);
  ALLOC_COPY(ovr_idx, ovr_idx, n_ovr, int);
  ALLOC_COPY(exp_kind, exp_kind, n_exp, int);
  ALLOC_COPY(exp_n_seg, exp_n_seg, n_exp, int);
  ALLOC_COPY(exp_n_points, exp_n_points, n_exp, int);
  ALLOC_COPY(exp_seg_off, NULL, n_exp, int);
  ALLOC_COPY(exp_pt_off, NULL, n_exp, int);
  ALLOC_COPY(seg_t_end, seg_t_end, n_seg_total, double);
  ALLOC_COPY(seg_ovr, seg_ovr, (size_t)n_seg_total * n_ovr, double);
  ALLOC_COPY(data_t, data_t, n_points, double);
  ALLOC_COPY(data_y, data_y, (size_t)n_targets * n_points, double);
  ALLOC_COPY(x, NULL, n_fit, double);
#undef ALLOC_COPY

  int seg_off = 0, pt_off = 0;
  for (int e = 0; e < n_exp; e++) {
    s->exp_seg_off[e] = seg_off;
    s->exp_pt_off[e] = pt_off;
    if (exp_n_seg[e] < 1 || (exp_kind[e] == EXP_STEADY_STATE && exp_n_seg[e] != 1)) {
      fit_session_free(s);
      return -3;
    }
    seg_off += exp_n_seg[e];
    pt_off += exp_n_points[e];
    if (seg_off > n_seg_total || pt_off > n_points) {
      fit_session_free(s);
      return -3;
    }
    if (exp_kind[e] == EXP_TIME_COURSE && exp_n_points[e] > 0 &&
        data_t[pt_off - 1] > seg_t_end[seg_off - 1]) {
      fit_session_free(s);
      return -3;
    }
  }
  if (seg_off != n_seg_total || pt_off != n_points) {
    fit_session_free(s);
    return -3;
  }

  s->n_derived = n_derived;
  s->solver_id = solver_id;
  s->rtol = rtol;
  s->atol = atol;
  s->ss_tol = ss_tol;
  s->ss_t_max = ss_t_max;
  s->target_residual_norm = target_residual_norm;
  s->total_nfev = 0;
  s->progress_interval = progress_interval;
  s->chunk_nfev = 0;
  s->last_info = 0;
  s->last_residual_norm = 0.0;

  for (int i = 0; i < n_fit; i++) {
    double v = pars[fit_idx[i]];
    if (log_flags[i]) {
      if (v <= 0.0) {
        fit_session_free(s);
        return -2;
      }
      s->x[i] = log(v);
    } else {
      s->x[i] = v;
    }
  }

  g_fit = s;

  /* Evaluate the residual at the starting point so the caller has a real
   * "before optimization" data point (fit_get_residual_norm()/fit_get_nfev()
   * are valid immediately after fit_init, reporting nfev=0 — this evaluation
   * is accounting-invisible, not counted against the optimizer's own budget,
   * since it exists purely for reporting the initial state). */
  {
    int m = n_targets * n_points;
    double *fvec0 = (double *)malloc((size_t)(m > 0 ? m : 1) * sizeof(double));
    if (fvec0) {
      fit_fcn(NULL, m, n_fit, s->x, fvec0, 1);
      double ss = 0.0;
      for (int k = 0; k < m; k++) ss += fvec0[k] * fvec0[k];
      s->last_residual_norm = sqrt(ss);
      free(fvec0);
    }
  }

  return 0;
}

/*
 * fit_chunk — run lmdif for at most maxfev more function evaluations,
 * seeded from the parameter vector the previous chunk left off at.
 *
 * A single lmdif call whose *first* trust-region step overshoots a long way
 * (e.g. a log-space parameter starting far from its optimum) can land on a
 * point where the auto-scaled trust region (mode=1) misjudges the local
 * curvature and declares xtol-convergence prematurely — a real point, just
 * not the minimum. Restarting lmdif from scratch (fresh auto-scaling) at
 * that same x reliably escapes it, so: whenever a call reports "converged"
 * (any info other than 5) after moving x by more than a few xtol, spend a
 * bit more of the same maxfev budget re-verifying via one fresh restart
 * before trusting the result. A call that barely moved x before declaring
 * convergence (the overwhelmingly common case) exits after one lmdif call,
 * same cost as before.
 *
 * Returns: 5 = budget exhausted, call fit_chunk again to continue;
 *          1-4 = lmdif converged (see MINPACK info codes);
 *          0,6,7,8 = lmdif stopped without full convergence (degenerate
 *            step / improper input) — treat as done, not an error;
 *          -2 = FIT_TARGET_REACHED — residual norm crossed the caller's
 *            target_residual_norm (see fit_init); done, not an error,
 *            despite being negative like a real MINPACK failure;
 *          -1 = allocation failure.
 */
int fit_chunk(int maxfev) {
  FitSession *s = g_fit;
  if (!s) return -1;

  /* Evals-so-far in *this* chunk (g_progress_fn's own doc comment) — reset
   * here, not per lmdif restart-attempt below, so the mid-chunk progress
   * counter increases monotonically across this whole external call. */
  s->chunk_nfev = 0;

  const int n = s->n_fit;
  const int m = s->n_targets * s->n_points;

  double *fvec = (double *)malloc((size_t)m * sizeof(double));
  double *fjac = (double *)malloc((size_t)m * (size_t)n * sizeof(double));
  double *diag = (double *)malloc((size_t)n * sizeof(double));
  double *qtf = (double *)malloc((size_t)n * sizeof(double));
  double *wa1 = (double *)malloc((size_t)n * sizeof(double));
  double *wa2 = (double *)malloc((size_t)n * sizeof(double));
  double *wa3 = (double *)malloc((size_t)n * sizeof(double));
  double *wa4 = (double *)malloc((size_t)m * sizeof(double));
  int *ipvt = (int *)malloc((size_t)n * sizeof(int));
  double *xPrev = (double *)malloc((size_t)n * sizeof(double));

  if (!fvec || !fjac || !diag || !qtf || !wa1 || !wa2 || !wa3 || !wa4 || !ipvt || !xPrev) {
    free(fvec);
    free(fjac);
    free(diag);
    free(qtf);
    free(wa1);
    free(wa2);
    free(wa3);
    free(wa4);
    free(ipvt);
    free(xPrev);
    return -1;
  }

  /* MINPACK lmdif1 defaults, except epsfcn: fdjac2's forward-difference step
   * is h = sqrt(epsfcn)*|x|. The default epsfcn=0 (-> machine epsilon) assumes
   * fcn is exact to machine precision, but ours is only accurate to s->rtol
   * (the ODE integrator's own tolerance) — a step smaller than that noise
   * floor produces a garbage Jacobian from floating-point cancellation, which
   * in turn corrupts lmdif's auto-scaling (mode=1) and causes premature,
   * wrong convergence. Scaling epsfcn to rtol keeps the finite-difference
   * step above the integrator's noise floor. */
  const double ftol = 1.49011612e-8;
  const double xtol = 1.49011612e-8;
  const double gtol = 0.0;
  const double epsfcn = s->rtol;
  const double factor = 100.0;
  const int mode = 1; /* auto variable scaling */

  int budgetLeft = maxfev;
  int info = 0;
  int totalNfev = 0;
  for (int attempt = 0; attempt < 5 && budgetLeft > n; attempt++) {
    memcpy(xPrev, s->x, (size_t)n * sizeof(double));
    int nfev = 0;
    info = lmdif(fit_fcn, NULL, m, n, s->x, fvec, ftol, xtol, gtol, budgetLeft, epsfcn, diag,
                 mode, factor, 0 /* nprint */, &nfev, fjac, m, ipvt, qtf, wa1, wa2, wa3, wa4);
    totalNfev += nfev;
    budgetLeft -= nfev;
    if (info == 5) break; /* out of budget — caller calls fit_chunk again */
    /* Target reached — stop immediately, skipping the movedLittle
     * re-verification below: that heuristic exists to double-check lmdif's
     * own (relative) convergence claims, but crossing the caller's absolute
     * target is a stronger, self-verifying signal that needs none of that. */
    if (info == FIT_TARGET_REACHED) break;

    double diff = 0.0, base = 0.0;
    for (int i = 0; i < n; i++) {
      double d = s->x[i] - xPrev[i];
      diff += d * d;
      base += xPrev[i] * xPrev[i];
    }
    diff = sqrt(diff);
    base = sqrt(base);
    int movedLittle = diff <= 10.0 * xtol * (base > 0.0 ? base : 1.0);
    if (movedLittle) break; /* genuinely converged */
    /* else: this call moved x a lot before declaring itself done — spend
     * more of the same budget re-verifying with a fresh restart. */
  }

  s->total_nfev += totalNfev;
  s->last_info = info;

  /* fit_fcn already set s->last_residual_norm itself when it triggered
   * FIT_TARGET_REACHED, from the *trial* fvec it was actually called with —
   * not this fvec, which lmdif only ever writes the *accepted* point into
   * (see fit_fcn's iflag==1 comment). Recomputing from fvec here would read
   * whatever the previous accepted point was, silently discarding however
   * much progress the un-accepted trial that triggered the stop made. */
  if (info != FIT_TARGET_REACHED) {
    double ss = 0.0;
    for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
    s->last_residual_norm = sqrt(ss);
  }
  free(xPrev);

  free(fvec);
  free(fjac);
  free(diag);
  free(qtf);
  free(wa1);
  free(wa2);
  free(wa3);
  free(wa4);
  free(ipvt);

  return info;
}

int fit_get_nfev(void) { return g_fit ? g_fit->total_nfev : 0; }

double fit_get_residual_norm(void) { return g_fit ? g_fit->last_residual_norm : 0.0; }

/* Writes the current full parameter vector (fixed values unchanged, fitted
 * values un-transformed back to linear space) into out (length n_pars). */
void fit_get_params(double *out) {
  if (!g_fit) return;
  FitSession *s = g_fit;
  memcpy(out, s->pars, (size_t)s->n_pars * sizeof(double));
  for (int i = 0; i < s->n_fit; i++) {
    out[s->fit_idx[i]] = s->log_flags[i] ? exp(s->x[i]) : s->x[i];
  }
}

/* Writes the raw model value behind every residual entry at the current
 * estimate into out (length n_targets * n_points, same layout as data_y;
 * NaN for an experiment whose integration failed or never reached steady
 * state). Lets the UI plot exactly what the optimizer compared against the
 * data — the steady-state chart has no trajectory to preview instead.
 * Returns 0, or -1 without a session / on allocation failure. */
int fit_get_predictions(double *out) {
  FitSession *s = g_fit;
  if (!s) return -1;
  size_t m = (size_t)s->n_targets * s->n_points;
  double *fvec = (double *)malloc((m > 0 ? m : 1) * sizeof(double));
  if (!fvec) return -1;
  int rc = compute_residuals(s, s->x, fvec, out);
  free(fvec);
  return rc;
}
