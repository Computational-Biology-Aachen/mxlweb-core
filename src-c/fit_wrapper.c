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

/* Solver choice, matching wasmWorker.ts's method dispatch. */
enum { SOLVER_RADAU5 = 0, SOLVER_DOP853 = 1, SOLVER_DOPRI5 = 2 };

/* Same calling convention/signature shape as the RHS model_fn ("vidiii"):
 * void derived_fn(int n_y, double t, double* y, double* out, double* pars) */
typedef void (*DerivedFn)(int, double, double *, double *, double *);
static DerivedFn g_derived_fn = NULL;

void set_derived_fn(int table_idx) {
  g_derived_fn = (DerivedFn)(intptr_t)table_idx;
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

typedef struct {
  int n_y;
  double *y0; /* length n_y, fixed initial conditions */

  int n_pars;
  double *pars; /* length n_pars, full vector (fixed values stay put) */

  int n_fit;
  int *fit_idx;   /* length n_fit, indices into pars[] */
  int *log_flags; /* length n_fit, 1 = fit in log-space */

  int n_targets;
  int *target_kind;  /* length n_targets, TARGET_STATE | TARGET_DERIVED */
  int *target_index; /* length n_targets, index into y[] or derived_out[] */
  double *target_scale; /* length n_targets, normalization divisor */

  int n_points;
  double *data_t; /* length n_points, ascending */
  double *data_y; /* length n_targets * n_points, target-major */

  int n_derived; /* size of the derived_fn output buffer, 0 if unused */

  double t_end;
  int solver_id;
  double rtol, atol;

  /* Absolute residual-norm early-stop, checked in fit_fcn; negative disables
   * the check (rely on lmdif's own convergence criteria only). */
  double target_residual_norm;

  double *x; /* length n_fit, current (possibly log-space) parameter estimate */

  int total_nfev;
  int last_info;
  double last_residual_norm;
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
/* fcn — the LM residual callback (cminpack_func_mn signature).       */
/* ------------------------------------------------------------------ */
static int fit_fcn(void *p, int m, int n, const double *x, double *fvec, int iflag) {
  (void)p;
  (void)m;
  FitSession *s = g_fit;

  /* Build the full parameter vector for this trial: fixed values from
   * s->pars, fitted values from x (undoing the log-space transform). */
  double *pars_full = (double *)malloc((size_t)s->n_pars * sizeof(double));
  double *y_work = (double *)malloc((size_t)s->n_y * sizeof(double));
  double *y_interp = (double *)malloc((size_t)s->n_y * sizeof(double));
  double *derived_out =
      s->n_derived > 0 ? (double *)malloc((size_t)s->n_derived * sizeof(double)) : NULL;
  if (!pars_full || !y_work || !y_interp || (s->n_derived > 0 && !derived_out)) {
    free(pars_full);
    free(y_work);
    free(y_interp);
    free(derived_out);
    return -1; /* fatal: allocation failure, not a numerical hiccup — abort. */
  }

  memcpy(pars_full, s->pars, (size_t)s->n_pars * sizeof(double));
  for (int i = 0; i < s->n_fit; i++) {
    double v = s->log_flags[i] ? exp(x[i]) : x[i];
    pars_full[s->fit_idx[i]] = v;
  }
  memcpy(y_work, s->y0, (size_t)s->n_y * sizeof(double));

  const int out_cap = 2000;
  init_output(out_cap, s->n_y);
  int idid;
  switch (s->solver_id) {
    case SOLVER_DOP853:
      idid = run_dop853(s->n_y, 0.0, s->t_end, y_work, pars_full, s->rtol, s->atol, 0.0, 500000);
      break;
    case SOLVER_DOPRI5:
      idid = run_dopri5(s->n_y, 0.0, s->t_end, y_work, pars_full, s->rtol, s->atol, 0.0, 500000);
      break;
    default:
      idid = run_radau5(s->n_y, 0.0, s->t_end, y_work, pars_full, s->rtol, s->atol, 0.0, 500000);
      break;
  }

  if (idid < 0) {
    /* Integration failed for this trial parameter set — penalize, don't abort.
     * lmdif's trust region will reject and shrink away from here on its own. */
    const double PENALTY = 1.0e3;
    for (int k = 0; k < m; k++) fvec[k] = PENALTY;
    free_output();
    free(pars_full);
    free(y_work);
    free(y_interp);
    free(derived_out);
    return 1;
  }

  const int out_n = get_out_n();
  const double *out_t = get_out_t();
  const double *out_y = get_out_y();

  for (int j = 0; j < s->n_points; j++) {
    interp_at(s->n_y, out_n, out_t, out_y, s->data_t[j], y_interp);
    if (s->n_derived > 0) {
      g_derived_fn(s->n_y, s->data_t[j], y_interp, derived_out, pars_full);
    }
    for (int k = 0; k < s->n_targets; k++) {
      double model_v = (s->target_kind[k] == TARGET_STATE) ? y_interp[s->target_index[k]]
                                                             : derived_out[s->target_index[k]];
      double data_v = s->data_y[(size_t)k * s->n_points + j];
      fvec[(size_t)k * s->n_points + j] = (model_v - data_v) / s->target_scale[k];
    }
  }

  free_output();
  free(pars_full);
  free(y_work);
  free(y_interp);
  free(derived_out);

  /* iflag==1 is lmdif's "evaluate at this x" call — the actual trial point,
   * as opposed to fdjac2's iflag==2 perturbed calls used only to estimate
   * the Jacobian's columns. Checking the target on those would fire on a
   * neighbor of x rather than x itself, and possibly by pure chance.
   *
   * Note x here isn't necessarily s->x: after the first call, lmdif reuses
   * this same iflag==1 evaluation to *try* a candidate step before deciding
   * whether to accept it — s->x only gets overwritten with that candidate
   * later, once accepted. Aborting here (via a negative iflag) skips that
   * bookkeeping entirely, so without the explicit copy below fit_get_params
   * would keep reporting whatever x was before this candidate — silently
   * discarding the very point whose residual we just confirmed meets the
   * target. */
  if (iflag == 1 && s->target_residual_norm >= 0.0) {
    double ss = 0.0;
    for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
    if (sqrt(ss) <= s->target_residual_norm) {
      memcpy(s->x, x, (size_t)n * sizeof(double));
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
 * set_derived_fn() if n_derived>0) before this. data_t must be ascending.
 * data_y is target-major: data_y[k*n_points + j].
 *
 * target_residual_norm: fit_chunk stops as soon as the residual norm drops
 * to or below this (see FIT_TARGET_REACHED) — pass a negative value to
 * disable and rely on lmdif's own convergence criteria only.
 *
 * Returns 0 on success, -1 on allocation failure, -2 if a log-space fit
 * parameter's initial value is <= 0 (log undefined).
 */
int fit_init(int n_y, double *y0, int n_pars, double *pars, int n_fit, int *fit_idx,
             int *log_flags, int n_targets, int *target_kind, int *target_index,
             double *target_scale, int n_points, double *data_t, double *data_y,
             double t_end, int n_derived, int solver_id, double rtol, double atol,
             double target_residual_norm) {
  fit_free();

  FitSession *s = (FitSession *)calloc(1, sizeof(FitSession));
  if (!s) return -1;

  s->n_y = n_y;
  s->y0 = (double *)malloc((size_t)n_y * sizeof(double));
  s->n_pars = n_pars;
  s->pars = (double *)malloc((size_t)n_pars * sizeof(double));
  s->n_fit = n_fit;
  s->fit_idx = (int *)malloc((size_t)n_fit * sizeof(int));
  s->log_flags = (int *)malloc((size_t)n_fit * sizeof(int));
  s->n_targets = n_targets;
  s->target_kind = (int *)malloc((size_t)n_targets * sizeof(int));
  s->target_index = (int *)malloc((size_t)n_targets * sizeof(int));
  s->target_scale = (double *)malloc((size_t)n_targets * sizeof(double));
  s->n_points = n_points;
  s->data_t = (double *)malloc((size_t)n_points * sizeof(double));
  s->data_y = (double *)malloc((size_t)n_targets * (size_t)n_points * sizeof(double));
  s->x = (double *)malloc((size_t)n_fit * sizeof(double));

  if (!s->y0 || !s->pars || !s->fit_idx || !s->log_flags || !s->target_kind ||
      !s->target_index || !s->target_scale || !s->data_t || !s->data_y || !s->x) {
    fit_session_free(s);
    return -1;
  }

  memcpy(s->y0, y0, (size_t)n_y * sizeof(double));
  memcpy(s->pars, pars, (size_t)n_pars * sizeof(double));
  memcpy(s->fit_idx, fit_idx, (size_t)n_fit * sizeof(int));
  memcpy(s->log_flags, log_flags, (size_t)n_fit * sizeof(int));
  memcpy(s->target_kind, target_kind, (size_t)n_targets * sizeof(int));
  memcpy(s->target_index, target_index, (size_t)n_targets * sizeof(int));
  memcpy(s->target_scale, target_scale, (size_t)n_targets * sizeof(double));
  memcpy(s->data_t, data_t, (size_t)n_points * sizeof(double));
  memcpy(s->data_y, data_y, (size_t)n_targets * (size_t)n_points * sizeof(double));

  s->t_end = t_end;
  s->n_derived = n_derived;
  s->solver_id = solver_id;
  s->rtol = rtol;
  s->atol = atol;
  s->target_residual_norm = target_residual_norm;
  s->total_nfev = 0;
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
    double *fvec0 = (double *)malloc((size_t)m * sizeof(double));
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

  double ss = 0.0;
  for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
  s->last_residual_norm = sqrt(ss);
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
