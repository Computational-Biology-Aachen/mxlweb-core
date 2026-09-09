/*
 * jacobian_wrapper.c — chunked Levenberg-Marquardt fit driver over cminpack's
 * lmder (user-supplied Jacobian), using forward sensitivity to compute that
 * Jacobian analytically.
 *
 * Why this exists alongside fit_wrapper.c (lmdif, finite-difference
 * Jacobian) and adjoint_wrapper.c (Adam over the continuous adjoint): a
 * small trained NN block (few dozen weights) makes fit_wrapper.c's
 * finite-difference Jacobian numerically unreliable — the block's own
 * `scale` factor damps its output enough that a forward-difference
 * perturbation's effect on the residual falls below the noise floor even
 * with fit_wrapper.c's own epsfcn/rtol scaling, so lmdif can decide it's
 * "converged" after zero real steps. adjoint_wrapper.c's Adam avoids that
 * numerically, but converges far slower per step than Gauss-Newton for a
 * problem this small (few parameters, tens of residuals) — exactly the
 * regime reverse-mode/adjoint is *not* cheap for and forward-mode is
 * (adjoint_wrapper.c's own doc comment).
 *
 *   - No new low-level solver code: the augmented state (original y plus one
 *     sensitivity vector `s_j = ∂y/∂θ_j` per fit parameter) is "just another
 *     y vector" to run_radau5/run_dop853/run_dopri5, exactly the trick
 *     adjoint_wrapper.c already uses for its own augmented state — except
 *     here the augmented RHS is a single WAT-compiled forward function
 *     (`modelIr.ts`'s `buildJacobianGraph`/`irToJacobianWat`), not a
 *     separately-signed backward one, so it needs no lambda_ptr-style
 *     special calling convention either: `set_model_fn_ptr` + the ordinary
 *     `ModelFn` shape is enough.
 *
 *   - Two forward RHS functions are registered, not one: `g_plain_fn`
 *     (rhsWat, n_y outputs — cheap) for lmder's iflag==1 residual-only
 *     calls, and `g_aug_fn` (jacobianWat, n_y*(1+n_theta) outputs) for
 *     iflag==2 Jacobian calls. This is the actual efficiency win over
 *     fit_wrapper.c's finite differences: one augmented solve per Jacobian
 *     evaluation, not n_theta+1 perturbed forward solves.
 *
 *   - Sensitivities start at zero (`s_j(0) = 0` for every j): none of this
 *     driver's fit parameters are ever an initial condition, so y(0) never
 *     depends on theta.
 *
 *   - v1 restricts fit targets to raw state variables, not derived
 *     quantities — same restriction and same reason as adjoint_wrapper.c's
 *     own doc comment: a derived target's sensitivity needs a *second*
 *     generated Jacobian graph (over the derived_fn's own expression tree,
 *     not dxdt's) that doesn't exist yet.
 *
 *   - lmder's own MINPACK `info` codes (0-8) mean exactly what lmdif's do
 *     (same underlying convergence tests) — fitWorker.ts's existing
 *     `infoToReason` mapping for the "lm" backend applies unchanged, no new
 *     stop-reason vocabulary needed. `FIT_TARGET_REACHED` reuses the same
 *     sentinel value fit_wrapper.c defines, for the same reason.
 */

#include "minpack/cminpack.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Exported from radau5_wrapper.c — called directly, in-process.      */
/* ------------------------------------------------------------------ */
typedef void (*ModelFn)(int, double, double *, double *, double *);
extern void set_model_fn_ptr(ModelFn fn);
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

enum { SOLVER_RADAU5 = 0, SOLVER_DOP853 = 1, SOLVER_DOPRI5 = 2 };

/* buildModelWat's ordinary "fcn" export, same shape for both — the
 * augmented function just has more state variables/outputs, no different
 * calling convention (this file's own doc comment). */
static ModelFn g_plain_fn = NULL; /* rhsWat: n_y outputs */
static ModelFn g_aug_fn = NULL;   /* jacobianWat: n_y*(1+n_theta) outputs */
void jacobian_set_plain_fn(int table_idx) { g_plain_fn = (ModelFn)(intptr_t)table_idx; }
void jacobian_set_augmented_fn(int table_idx) { g_aug_fn = (ModelFn)(intptr_t)table_idx; }

/* Fires every `progress_interval` real evaluations from inside
 * jacobian_fcn — see fit_wrapper.c's identical g_progress_fn doc comment
 * for the full rationale (mid-chunk progress independent of jacobian_
 * chunk's own correctness-mandated budget). Registered once, globally. */
typedef void (*ProgressFn)(int, double);
static ProgressFn g_progress_fn = NULL;
void jacobian_set_progress_fn(int table_idx) {
  g_progress_fn = (ProgressFn)(intptr_t)table_idx;
}

/* ------------------------------------------------------------------ */
/* Fit session state — persists across jacobian_chunk() calls.        */
/* ------------------------------------------------------------------ */

/* Not a MINPACK code (mirrors fit_wrapper.c's FIT_TARGET_REACHED exactly —
 * same value, same reasoning: negative so lmder's fcn_der call sites treat
 * it as an early-abort iflag, distinct from -1's genuine allocation
 * failure). */
#define FIT_TARGET_REACHED (-2)

typedef struct {
  int n_y;
  double *y0; /* length n_y, fixed initial conditions */

  int n_pars;
  double *pars; /* length n_pars, full vector (fixed values stay put) */

  int n_theta;
  int *theta_idx;   /* length n_theta, indices into pars[] */
  int *log_flags;   /* length n_theta, 1 = fit in log-space */

  int n_targets;
  int *target_index; /* length n_targets, index into y[] — state only (file doc comment) */
  double *target_scale;

  int n_points;
  double *data_t; /* length n_points, ascending */
  double *data_y; /* length n_targets * n_points, target-major */

  double t_end;
  int solver_id;
  double rtol, atol;

  double target_residual_norm; /* negative disables, same convention as fit_wrapper.c */

  double *x; /* length n_theta, current (possibly log-space) parameter estimate */

  int total_nfev;
  int last_info;
  double last_residual_norm;

  /* Mid-chunk progress reporting — see g_progress_fn's own doc comment and
   * fit_wrapper.c's identical fields for the full rationale. */
  int progress_interval;
  int chunk_nfev;
} JacobianSession;

static JacobianSession *g_jac = NULL;

static void jacobian_session_free(JacobianSession *s) {
  if (!s) return;
  free(s->y0);
  free(s->pars);
  free(s->theta_idx);
  free(s->log_flags);
  free(s->target_index);
  free(s->target_scale);
  free(s->data_t);
  free(s->data_y);
  free(s->x);
  free(s);
}

void jacobian_free(void) {
  jacobian_session_free(g_jac);
  g_jac = NULL;
}

/* ------------------------------------------------------------------ */
/* Linear interpolation of dense integrator output — verbatim copy of */
/* fit_wrapper.c's interp_at (file-scoped static there too).          */
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

/* Runs one forward solve of `n` state variables (n_y for the plain model,
 * n_y*(1+n_theta) for the augmented one) from y_work(0)=y0_full, writing the
 * dense trajectory into the shared out_t/out_y buffer (init_output/
 * get_out_*). Returns the solver's idid (>=0 success). */
static int run_forward(ModelFn fn, int n, double *y_work, double *pars_full,
                        int solver_id, double t_end, double rtol, double atol) {
  set_model_fn_ptr(fn);
  const int out_cap = 2000;
  init_output(out_cap, n);
  switch (solver_id) {
    case SOLVER_DOP853:
      return run_dop853(n, 0.0, t_end, y_work, pars_full, rtol, atol, 0.0, 500000);
    case SOLVER_DOPRI5:
      return run_dopri5(n, 0.0, t_end, y_work, pars_full, rtol, atol, 0.0, 500000);
    default:
      return run_radau5(n, 0.0, t_end, y_work, pars_full, rtol, atol, 0.0, 500000);
  }
}

/* Builds the full parameter vector for trial x: fixed values from s->pars,
 * fitted values from x (undoing the log-space transform) — same as
 * fit_wrapper.c's fit_fcn. */
static void build_pars_full(JacobianSession *s, const double *x, double *pars_full) {
  memcpy(pars_full, s->pars, (size_t)s->n_pars * sizeof(double));
  for (int i = 0; i < s->n_theta; i++) {
    double v = s->log_flags[i] ? exp(x[i]) : x[i];
    pars_full[s->theta_idx[i]] = v;
  }
}

/* ------------------------------------------------------------------ */
/* jacobian_fcn — the lmder residual+Jacobian callback (cminpack        */
/* cminpack_func_der signature). iflag==1: fill fvec, don't touch fjac. */
/* iflag==2: fill fjac (at the x set by the preceding iflag==1 call),    */
/* don't touch fvec.                                                     */
/* ------------------------------------------------------------------ */
/* Mid-chunk progress — see g_progress_fn's own doc comment and
 * fit_wrapper.c's identical helper for the full rationale. Called on both
 * iflag==1 and iflag==2's *successful* paths (skipped on idid<0 penalty/
 * zero-jacobian paths, whose fvec/residual isn't a meaningful trial point)
 * — fvec is valid either way: freshly computed for iflag==1, or still
 * holding the last iflag==1 call's value for iflag==2 (that branch never
 * touches fvec, this file's own doc comment). */
static void report_jacobian_progress(JacobianSession *s, int m, const double *fvec) {
  if (s->progress_interval <= 0 || !g_progress_fn) return;
  if (s->chunk_nfev % s->progress_interval != 0) return;
  double ss = 0.0;
  for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
  g_progress_fn(s->total_nfev + s->chunk_nfev, sqrt(ss));
}

static int jacobian_fcn(void *p, int m, int n, const double *x, double *fvec,
                         double *fjac, int ldfjac, int iflag) {
  (void)p;
  (void)n;
  JacobianSession *s = g_jac;
  s->chunk_nfev++;

  double *pars_full = (double *)malloc((size_t)s->n_pars * sizeof(double));
  if (!pars_full) return -1;
  build_pars_full(s, x, pars_full);

  if (iflag == 1) {
    double *y_work = (double *)malloc((size_t)s->n_y * sizeof(double));
    double *y_interp = (double *)malloc((size_t)s->n_y * sizeof(double));
    if (!y_work || !y_interp) {
      free(pars_full); free(y_work); free(y_interp);
      return -1;
    }
    memcpy(y_work, s->y0, (size_t)s->n_y * sizeof(double));
    int idid = run_forward(g_plain_fn, s->n_y, y_work, pars_full, s->solver_id,
                            s->t_end, s->rtol, s->atol);
    if (idid < 0) {
      /* Integration failed for this trial — penalize, don't abort (same
       * reasoning as fit_wrapper.c's fit_fcn). */
      const double PENALTY = 1.0e3;
      for (int k = 0; k < m; k++) fvec[k] = PENALTY;
      free_output();
      free(pars_full); free(y_work); free(y_interp);
      return 1;
    }
    const int out_n = get_out_n();
    const double *out_t = get_out_t();
    const double *out_y = get_out_y();
    for (int j = 0; j < s->n_points; j++) {
      interp_at(s->n_y, out_n, out_t, out_y, s->data_t[j], y_interp);
      for (int k = 0; k < s->n_targets; k++) {
        double model_v = y_interp[s->target_index[k]];
        double data_v = s->data_y[(size_t)k * s->n_points + j];
        fvec[(size_t)k * s->n_points + j] = (model_v - data_v) / s->target_scale[k];
      }
    }
    free_output();
    free(y_work);
    free(y_interp);

    report_jacobian_progress(s, m, fvec);

    /* Same target-reached short-circuit as fit_wrapper.c's fit_fcn, checked
     * only on the real trial-point evaluation (iflag==1), not perturbed/
     * secondary calls. */
    if (s->target_residual_norm >= 0.0) {
      double ss = 0.0;
      for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
      if (sqrt(ss) <= s->target_residual_norm) {
        memcpy(s->x, x, (size_t)s->n_theta * sizeof(double));
        s->last_residual_norm = sqrt(ss);
        free(pars_full);
        return FIT_TARGET_REACHED;
      }
    }
    free(pars_full);
    return 1;
  }

  /* iflag == 2: analytic Jacobian via one augmented (forward-sensitivity)
   * solve — see this file's own doc comment. */
  const int n_aug = s->n_y * (1 + s->n_theta);
  double *y_aug = (double *)calloc((size_t)n_aug, sizeof(double)); /* s_j(0) = 0 */
  double *y_interp_aug = (double *)malloc((size_t)n_aug * sizeof(double));
  if (!y_aug || !y_interp_aug) {
    free(pars_full); free(y_aug); free(y_interp_aug);
    return -1;
  }
  memcpy(y_aug, s->y0, (size_t)s->n_y * sizeof(double));
  int idid = run_forward(g_aug_fn, n_aug, y_aug, pars_full, s->solver_id,
                          s->t_end, s->rtol, s->atol);
  if (idid < 0) {
    /* A trial that made it past iflag==1 (else lmder wouldn't ask for a
     * Jacobian there) but fails on the larger augmented system — zero the
     * Jacobian rather than abort; lmder treats a singular/zero Jacobian as
     * "no useful direction here" and its trust region backs off. */
    memset(fjac, 0, (size_t)m * (size_t)ldfjac * sizeof(double));
    free_output();
    free(pars_full); free(y_aug); free(y_interp_aug);
    return 1;
  }
  const int out_n = get_out_n();
  const double *out_t = get_out_t();
  const double *out_y = get_out_y();
  for (int j = 0; j < s->n_points; j++) {
    interp_at(n_aug, out_n, out_t, out_y, s->data_t[j], y_interp_aug);
    for (int k = 0; k < s->n_targets; k++) {
      const int row = k * s->n_points + j;
      const int state_idx = s->target_index[k];
      for (int c = 0; c < s->n_theta; c++) {
        double raw = y_interp_aug[s->n_y + c * s->n_y + state_idx];
        double d = raw / s->target_scale[k];
        /* Chain rule for a log-space fit parameter: theta = exp(x), so
         * d(residual)/dx = d(residual)/dtheta * theta. */
        if (s->log_flags[c]) d *= pars_full[s->theta_idx[c]];
        /* Column-major, ldfjac = m — same layout lmdif/fdjac2 already use. */
        fjac[(size_t)row + (size_t)c * (size_t)ldfjac] = d;
      }
    }
  }
  free_output();
  free(pars_full);
  free(y_aug);
  free(y_interp_aug);

  report_jacobian_progress(s, m, fvec);
  return 1;
}

/* ------------------------------------------------------------------ */
/* Exported API                                                        */
/* ------------------------------------------------------------------ */

/*
 * jacobian_init — one-time setup for an analytic-Jacobian fit session. Call
 * jacobian_set_plain_fn()/jacobian_set_augmented_fn() before this. data_t
 * must be ascending; target_index is state-variable indices only (this
 * file's own doc comment).
 *
 * progress_interval: see fit_init's identical parameter — fires the
 * registered progress callback (jacobian_set_progress_fn) every this many
 * evaluations within a chunk. <=0 disables.
 *
 * Returns 0 on success, -1 on allocation failure, -2 if a log-space fit
 * parameter's initial value is <= 0.
 */
int jacobian_init(int n_y, double *y0, int n_pars, double *pars, int n_theta,
                   int *theta_idx, int *log_flags, int n_targets, int *target_index,
                   double *target_scale, int n_points, double *data_t, double *data_y,
                   double t_end, int solver_id, double rtol, double atol,
                   double target_residual_norm, int progress_interval) {
  jacobian_free();

  JacobianSession *s = (JacobianSession *)calloc(1, sizeof(JacobianSession));
  if (!s) return -1;

  s->n_y = n_y;
  s->y0 = (double *)malloc((size_t)n_y * sizeof(double));
  s->n_pars = n_pars;
  s->pars = (double *)malloc((size_t)n_pars * sizeof(double));
  s->n_theta = n_theta;
  s->theta_idx = (int *)malloc((size_t)n_theta * sizeof(int));
  s->log_flags = (int *)malloc((size_t)n_theta * sizeof(int));
  s->n_targets = n_targets;
  s->target_index = (int *)malloc((size_t)n_targets * sizeof(int));
  s->target_scale = (double *)malloc((size_t)n_targets * sizeof(double));
  s->n_points = n_points;
  s->data_t = (double *)malloc((size_t)n_points * sizeof(double));
  s->data_y = (double *)malloc((size_t)n_targets * (size_t)n_points * sizeof(double));
  s->x = (double *)malloc((size_t)n_theta * sizeof(double));

  if (!s->y0 || !s->pars || !s->theta_idx || !s->log_flags || !s->target_index ||
      !s->target_scale || !s->data_t || !s->data_y || !s->x) {
    jacobian_session_free(s);
    return -1;
  }

  memcpy(s->y0, y0, (size_t)n_y * sizeof(double));
  memcpy(s->pars, pars, (size_t)n_pars * sizeof(double));
  memcpy(s->theta_idx, theta_idx, (size_t)n_theta * sizeof(int));
  memcpy(s->log_flags, log_flags, (size_t)n_theta * sizeof(int));
  memcpy(s->target_index, target_index, (size_t)n_targets * sizeof(int));
  memcpy(s->target_scale, target_scale, (size_t)n_targets * sizeof(double));
  memcpy(s->data_t, data_t, (size_t)n_points * sizeof(double));
  memcpy(s->data_y, data_y, (size_t)n_targets * (size_t)n_points * sizeof(double));

  s->t_end = t_end;
  s->solver_id = solver_id;
  s->rtol = rtol;
  s->atol = atol;
  s->target_residual_norm = target_residual_norm;
  s->total_nfev = 0;
  s->progress_interval = progress_interval;
  s->chunk_nfev = 0;
  s->last_info = 0;
  s->last_residual_norm = 0.0;

  for (int i = 0; i < n_theta; i++) {
    double v = pars[theta_idx[i]];
    if (log_flags[i]) {
      if (v <= 0.0) {
        jacobian_session_free(s);
        return -2;
      }
      s->x[i] = log(v);
    } else {
      s->x[i] = v;
    }
  }

  g_jac = s;

  /* Evaluate the initial residual so the caller has a real "before
   * optimization" data point, nfev=0 like fit_wrapper.c's fit_init. */
  {
    int m = n_targets * n_points;
    double *fvec0 = (double *)malloc((size_t)m * sizeof(double));
    if (fvec0) {
      jacobian_fcn(NULL, m, n_theta, s->x, fvec0, NULL, m, 1);
      double ss = 0.0;
      for (int k = 0; k < m; k++) ss += fvec0[k] * fvec0[k];
      s->last_residual_norm = sqrt(ss);
      free(fvec0);
    }
  }

  return 0;
}

/*
 * jacobian_chunk — run lmder for at most maxfev more function evaluations
 * (each Jacobian evaluation, being one augmented solve rather than n_theta+1
 * perturbed forward solves, counts as one call towards this budget just like
 * every iflag==1 call does — see cminpack's own nfev bookkeeping).
 *
 * Same premature-xtol-convergence restart heuristic as fit_wrapper.c's
 * fit_chunk (that function's own doc comment) — an exact Jacobian doesn't
 * eliminate the mode=1 auto-scaling trust-region issue it guards against,
 * only the finite-difference noise issue.
 *
 * Return codes: identical meaning to fit_wrapper.c's fit_chunk (5 = budget
 * exhausted; 1-4 = converged; 0,6,7,8 = stopped without full convergence;
 * FIT_TARGET_REACHED = -2; -1 = allocation failure).
 */
int jacobian_chunk(int maxfev) {
  JacobianSession *s = g_jac;
  if (!s) return -1;

  /* See fit_chunk's identical reset — mid-chunk progress counter, not tied
   * to the attempt-retry loop below. */
  s->chunk_nfev = 0;

  const int n = s->n_theta;
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
    free(fvec); free(fjac); free(diag); free(qtf);
    free(wa1); free(wa2); free(wa3); free(wa4);
    free(ipvt); free(xPrev);
    return -1;
  }

  const double ftol = 1.49011612e-8;
  const double xtol = 1.49011612e-8;
  const double gtol = 0.0;
  const double factor = 10.0;
  const int mode = 2; /* fixed uniform scaling, see below */

  /* mode=1 (auto column-norm scaling) sets diag[j] from the Jacobian's j-th
   * column norm. A near-dead fit parameter (e.g. an NN weight whose current
   * value barely moves the residual) gets a tiny diag[j], and since the
   * trust-region bound on the raw step in dimension j is delta/diag[j], that
   * tiny diag amplifies a modest delta into a huge raw step there — observed
   * empirically as a weight jumping from O(0.1) to O(500) in one step,
   * diverging the ODE integration to NaN and wedging the fit. All of this
   * fit's parameters are NN weights of comparable scale, so fixed uniform
   * scaling (diag=1, i.e. delta bounds the raw step norm directly) avoids
   * that per-dimension amplification. factor=10 (rather than MINPACK's
   * usual factor=100) keeps each restart's first trust region modest too,
   * since attempt restarts recompute delta = factor*xnorm from scratch each
   * time (this loop's own comment below). Note this only fixes the
   * numerical blow-up — an ensemble of runs from independent random NN
   * inits still plateaus around the same residual regardless of factor
   * (tried both 1 and 10, same result), which is this specific fitting
   * problem's own long-horizon single-shooting difficulty, not something
   * this driver's scaling choice can fix. */
  for (int i = 0; i < n; i++) diag[i] = 1.0;

  int budgetLeft = maxfev;
  int info = 0;
  int totalNfev = 0;
  /* fit_wrapper.c's own retry loop requires budgetLeft > n: lmdif needs n
   * extra nfev just for fdjac2's finite-difference Jacobian, so a budget of
   * n or fewer can't complete even one outer iteration. That reasoning
   * doesn't transfer here — lmder's Jacobian call (iflag==2) doesn't consume
   * nfev at all (njev is separate), so one outer iteration needs only a
   * couple of nfev regardless of n. Requiring budgetLeft > n anyway meant
   * this loop silently never ran (info staying 0, "improper input" by
   * default) for any n_theta at or above the default chunk budget — exactly
   * the small-NN-block regime this driver exists for (e.g. 20+ weights vs.
   * chunkMaxfev's default of 5). budgetLeft > 0 is lmder's own actual
   * minimum (its own internal check rejects maxfev<=0). */
  for (int attempt = 0; attempt < 5 && budgetLeft > 0; attempt++) {
    memcpy(xPrev, s->x, (size_t)n * sizeof(double));
    int nfev = 0, njev = 0;
    info = lmder(jacobian_fcn, NULL, m, n, s->x, fvec, fjac, m, ftol, xtol, gtol,
                 budgetLeft, diag, mode, factor, 0 /* nprint */, &nfev, &njev,
                 ipvt, qtf, wa1, wa2, wa3, wa4);
    totalNfev += nfev;
    budgetLeft -= nfev;
    if (info == 5) break;
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
    if (movedLittle) break;
  }

  s->total_nfev += totalNfev;
  s->last_info = info;

  if (info != FIT_TARGET_REACHED) {
    double ss = 0.0;
    for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
    s->last_residual_norm = sqrt(ss);
  }

  free(xPrev);
  free(fvec); free(fjac); free(diag); free(qtf);
  free(wa1); free(wa2); free(wa3); free(wa4);
  free(ipvt);

  return info;
}

int jacobian_get_nfev(void) { return g_jac ? g_jac->total_nfev : 0; }

double jacobian_get_residual_norm(void) { return g_jac ? g_jac->last_residual_norm : 0.0; }

/* Writes the current full parameter vector (fixed values unchanged, theta
 * values as lmder has updated them, undoing the log-space transform) into
 * out (length n_pars). */
void jacobian_get_params(double *out) {
  if (!g_jac) return;
  build_pars_full(g_jac, g_jac->x, out);
}
