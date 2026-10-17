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
 *     dense output — exp_interp_at() (fit_experiments.c), a C port of wasmWorker.ts's resampleUniform.
 *   - A trial parameter set that makes the integrator fail (IDID<0) gets a large
 *     finite penalty residual, not an abort — lmdif's own trust region rejects and
 *     shrinks away from it. iflag<0 (real MINPACK abort) is reserved for fatal
 *     internal errors (allocation failure), not solver hiccups.
 *   - The residual is a concatenation of independent experiments (ADR 0009):
 *     time courses under an optional piecewise-constant parameter protocol,
 *     and steady states under per-condition parameter overrides — see
 *     fit_init's own doc comment for the layout.
 */

#include "fit_experiments.h"
#include "minpack/cminpack.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

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

typedef struct {
  ExpProblem P; /* y0, targets, experiments, solver settings */
  ModelFn model_fn; /* captured from set_model_fn at fit_init */

  int n_pars;
  double *pars; /* length n_pars, full vector (fixed values stay put) */

  int n_fit;
  int *fit_idx;   /* length n_fit, indices into pars[] */
  int *log_flags; /* length n_fit, 1 = fit in log-space */

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
  exp_problem_free(&s->P);
  free(s->pars);
  free(s->fit_idx);
  free(s->log_flags);
  free(s->x);
  free(s);
}

void fit_free(void) {
  fit_session_free(g_fit);
  g_fit = NULL;
}

/* Fills fvec (length n_targets * n_points) for the trial vector x, and
 * model_out with the raw model values (NaN for penalized experiments) when
 * non-NULL. Returns 0, or -1 on allocation failure. */
static int compute_residuals(const FitSession *s, const double *x, double *fvec,
                             double *model_out) {
  double *pars_trial = (double *)malloc((size_t)(s->n_pars > 0 ? s->n_pars : 1) * sizeof(double));
  if (!pars_trial) return -1;
  /* Fixed values from s->pars, fitted values from x (undoing the log-space
   * transform). */
  memcpy(pars_trial, s->pars, (size_t)s->n_pars * sizeof(double));
  for (int i = 0; i < s->n_fit; i++) {
    pars_trial[s->fit_idx[i]] = s->log_flags[i] ? exp(x[i]) : x[i];
  }
  int rc = exp_residuals(&s->P, s->model_fn, pars_trial, fvec, model_out);
  free(pars_trial);
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

  int rc = exp_problem_init(&s->P, n_y, y0, n_pars, n_targets, target_kind, target_index,
                            target_scale, n_derived, n_ovr, ovr_idx, n_exp, exp_kind,
                            exp_n_seg, exp_n_points, n_seg_total, seg_t_end, seg_ovr,
                            n_points, data_t, data_y, solver_id, rtol, atol, ss_tol,
                            ss_t_max);
  if (rc != 0) {
    free(s);
    return rc;
  }

  s->n_pars = n_pars;
  s->n_fit = n_fit;
  s->pars = (double *)malloc((size_t)(n_pars > 0 ? n_pars : 1) * sizeof(double));
  s->fit_idx = (int *)malloc((size_t)(n_fit > 0 ? n_fit : 1) * sizeof(int));
  s->log_flags = (int *)malloc((size_t)(n_fit > 0 ? n_fit : 1) * sizeof(int));
  s->x = (double *)malloc((size_t)(n_fit > 0 ? n_fit : 1) * sizeof(double));
  if (!s->pars || !s->fit_idx || !s->log_flags || !s->x) {
    fit_session_free(s);
    return -1;
  }
  memcpy(s->pars, pars, (size_t)n_pars * sizeof(double));
  memcpy(s->fit_idx, fit_idx, (size_t)n_fit * sizeof(int));
  memcpy(s->log_flags, log_flags, (size_t)n_fit * sizeof(int));

  s->model_fn = get_model_fn();
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
    int m = exp_m(&s->P);
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
  const int m = exp_m(&s->P);

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
  const double epsfcn = s->P.rtol;
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
  size_t m = (size_t)exp_m(&s->P);
  double *fvec = (double *)malloc((m > 0 ? m : 1) * sizeof(double));
  if (!fvec) return -1;
  int rc = compute_residuals(s, s->x, fvec, out);
  free(fvec);
  return rc;
}
