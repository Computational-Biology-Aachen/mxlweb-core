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
 *     special calling convention either.
 *
 *   - Two forward RHS functions are registered, not one: `g_plain_fn`
 *     (rhsWat, n_y outputs — cheap) for lmder's iflag==1 residual-only
 *     calls, and `g_aug_fn` (jacobianWat, n_y*(1+n_theta) outputs) for
 *     iflag==2 Jacobian calls. This is the actual efficiency win over
 *     fit_wrapper.c's finite differences: one augmented solve per Jacobian
 *     evaluation, not n_theta+1 perturbed forward solves.
 *
 *   - Experiments (ADR 0009) work exactly as in fit_wrapper.c — the
 *     residual is fit_experiments.c's exp_residuals — and the augmented
 *     system walks the same experiments (exp_walk):
 *       - sensitivities start at zero (`s_j(0) = 0`): no fit parameter is
 *         ever an initial condition;
 *       - across a protocol boundary the augmented state simply carries
 *         over (fixed boundary times, continuous state);
 *       - a steady state integrates the augmented system to convergence,
 *         where s_j is the steady-state sensitivity — conserved moieties
 *         stay consistent since s_j(0) = 0;
 *       - a fitted parameter must not also be overridden (init returns -4):
 *         the augmented RHS would still differentiate the overridden value.
 *
 *   - Derived targets use `g_derived_grad_fn` (fit_experiments.h): their
 *     Jacobian row is ∂d/∂y · s + ∂d/∂θ.
 *
 *   - lmder's own MINPACK `info` codes (0-8) mean exactly what lmdif's do
 *     (same underlying convergence tests) — fitWorker.ts's existing
 *     `infoToReason` mapping for the "lm" backend applies unchanged, no new
 *     stop-reason vocabulary needed. `FIT_TARGET_REACHED` reuses the same
 *     sentinel value fit_wrapper.c defines, for the same reason.
 */

#include "fit_experiments.h"
#include "minpack/cminpack.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

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
  ExpProblem P; /* y0, targets, experiments, solver settings */

  int n_pars;
  double *pars; /* length n_pars, full vector (fixed values stay put) */

  int n_theta;
  int *theta_idx;   /* length n_theta, indices into pars[] */
  int *log_flags;   /* length n_theta, 1 = fit in log-space */

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
  exp_problem_free(&s->P);
  free(s->pars);
  free(s->theta_idx);
  free(s->log_flags);
  free(s->x);
  free(s);
}

void jacobian_free(void) {
  jacobian_session_free(g_jac);
  g_jac = NULL;
}

/* Builds the full parameter vector for trial x: fixed values from s->pars,
 * fitted values from x (undoing the log-space transform) — same as
 * fit_wrapper.c's compute_residuals. */
static void build_pars_full(JacobianSession *s, const double *x, double *pars_full) {
  memcpy(pars_full, s->pars, (size_t)s->n_pars * sizeof(double));
  for (int i = 0; i < s->n_theta; i++) {
    double v = s->log_flags[i] ? exp(x[i]) : x[i];
    pars_full[s->theta_idx[i]] = v;
  }
}

/* ------------------------------------------------------------------ */
/* Jacobian rows from one augmented walk over an experiment.           */
/* ------------------------------------------------------------------ */
typedef struct {
  const JacobianSession *s;
  const double *pars_full;
  double *fjac;
  int ldfjac;
  double *grad_out; /* n_derived * (n_y + n_theta), derived targets only */
} JacRowCtx;

static void jacobian_point(void *vctx, int e, int seg, int j, double t, const double *y_aug,
                           const double *pars_seg) {
  (void)seg;
  JacRowCtx *c = (JacRowCtx *)vctx;
  const JacobianSession *s = c->s;
  const ExpProblem *P = &s->P;
  const int n_y = P->n_y, n_theta = s->n_theta;
  const double *sens = y_aug + n_y; /* sens[col * n_y + state] = ∂y_state/∂θ_col */
  if (P->n_derived > 0) {
    g_derived_grad_fn(n_y, t, (double *)y_aug, c->grad_out, (double *)pars_seg);
  }
  for (int k = 0; k < P->n_targets; k++) {
    const size_t row = exp_index(P, e, k, j);
    if (isnan(P->data_y[row])) continue; /* missing: residual 0, row stays 0 */
    const int derived = P->target_kind[k] == TARGET_DERIVED;
    const double *grad =
        derived ? c->grad_out + (size_t)P->target_index[k] * (size_t)(n_y + n_theta) : NULL;
    for (int col = 0; col < n_theta; col++) {
      double d;
      if (!derived) {
        d = sens[(size_t)col * n_y + P->target_index[k]];
      } else {
        d = grad[n_y + col];
        for (int m = 0; m < n_y; m++) d += grad[m] * sens[(size_t)col * n_y + m];
      }
      d /= P->target_scale[k];
      /* Chain rule for a log-space fit parameter: theta = exp(x), so
       * d(residual)/dx = d(residual)/dtheta * theta. */
      if (s->log_flags[col]) d *= c->pars_full[s->theta_idx[col]];
      /* Column-major, ldfjac = m — same layout lmdif/fdjac2 already use. */
      c->fjac[row + (size_t)col * (size_t)c->ldfjac] = d;
    }
  }
}

/* Fills fjac (m x n_theta, column-major) at pars_full. Returns 0, or -1 on
 * allocation failure. */
static int compute_jacobian(const JacobianSession *s, const double *pars_full, double *fjac,
                            int ldfjac) {
  const ExpProblem *P = &s->P;
  const int n_aug = P->n_y * (1 + s->n_theta);
  memset(fjac, 0, (size_t)ldfjac * (size_t)s->n_theta * sizeof(double));

  JacRowCtx c = {s, pars_full, fjac, ldfjac, NULL};
  double *y_aug = (double *)malloc((size_t)n_aug * sizeof(double));
  if (P->n_derived > 0) {
    c.grad_out = (double *)malloc((size_t)P->n_derived * (size_t)(P->n_y + s->n_theta) *
                                  sizeof(double));
  }
  if (!y_aug || (P->n_derived > 0 && !c.grad_out)) {
    free(y_aug);
    free(c.grad_out);
    return -1;
  }
  int rc = 0;
  for (int e = 0; e < P->n_exp; e++) {
    memset(y_aug, 0, (size_t)n_aug * sizeof(double)); /* s_j(0) = 0 */
    memcpy(y_aug, P->y0, (size_t)P->n_y * sizeof(double));
    int ok = exp_walk(P, e, g_aug_fn, n_aug, y_aug, pars_full, jacobian_point, NULL, &c, NULL);
    if (ok == EXP_NO_MEMORY) {
      rc = -1;
      break;
    }
    if (ok < 0) {
      /* A trial that made it past iflag==1 but fails (or never settles) on
       * the larger augmented system — zero this experiment's rows rather
       * than abort; lmder treats a zero Jacobian as "no useful direction
       * here" and its trust region backs off. */
      for (int k = 0; k < P->n_targets; k++) {
        for (int j = 0; j < P->exp_n_points[e]; j++) {
          size_t row = exp_index(P, e, k, j);
          for (int col = 0; col < s->n_theta; col++) fjac[row + (size_t)col * ldfjac] = 0.0;
        }
      }
    }
  }
  free(y_aug);
  free(c.grad_out);
  return rc;
}

/* ------------------------------------------------------------------ */
/* jacobian_fcn — the lmder residual+Jacobian callback (cminpack        */
/* cminpack_func_der signature). iflag==1: fill fvec, don't touch fjac. */
/* iflag==2: fill fjac (at the x set by the preceding iflag==1 call),    */
/* don't touch fvec.                                                     */
/* ------------------------------------------------------------------ */
/* Mid-chunk progress — see g_progress_fn's own doc comment and
 * fit_wrapper.c's identical helper for the full rationale. fvec is valid on
 * both iflags: freshly computed for iflag==1, or still holding the last
 * iflag==1 call's value for iflag==2 (that branch never touches fvec). */
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

  double *pars_full = (double *)malloc((size_t)(s->n_pars > 0 ? s->n_pars : 1) * sizeof(double));
  if (!pars_full) return -1;
  build_pars_full(s, x, pars_full);

  if (iflag == 1) {
    if (exp_residuals(&s->P, g_plain_fn, pars_full, fvec, NULL) < 0) {
      free(pars_full);
      return -1;
    }
    free(pars_full);
    report_jacobian_progress(s, m, fvec);

    /* Same target-reached short-circuit as fit_wrapper.c's fit_fcn, checked
     * only on the real trial-point evaluation (iflag==1). */
    if (s->target_residual_norm >= 0.0) {
      double ss = 0.0;
      for (int k = 0; k < m; k++) ss += fvec[k] * fvec[k];
      if (sqrt(ss) <= s->target_residual_norm) {
        memcpy(s->x, x, (size_t)s->n_theta * sizeof(double));
        s->last_residual_norm = sqrt(ss);
        return FIT_TARGET_REACHED;
      }
    }
    return 1;
  }

  /* iflag == 2: analytic Jacobian via one augmented (forward-sensitivity)
   * walk per experiment — see this file's own doc comment. */
  int rc = compute_jacobian(s, pars_full, fjac, ldfjac);
  free(pars_full);
  if (rc < 0) return -1;
  report_jacobian_progress(s, m, fvec);
  return 1;
}

/* ------------------------------------------------------------------ */
/* Exported API                                                        */
/* ------------------------------------------------------------------ */

/*
 * jacobian_init — one-time setup for an analytic-Jacobian fit session. Call
 * jacobian_set_plain_fn()/jacobian_set_augmented_fn() (and, with derived
 * targets, set_derived_fn()/set_derived_grad_fn()) before this. Takes
 * exactly fit_init's arguments — see its doc comment for the experiment
 * layout — with theta_idx in place of fit_idx.
 *
 * Returns 0 on success, -1 on allocation failure, -2 if a log-space fit
 * parameter's initial value is <= 0, -3 if the experiment layout is
 * inconsistent, -4 if a fitted parameter is also a protocol/condition
 * override, -5 if derived targets lack set_derived_fn/set_derived_grad_fn.
 */
int jacobian_init(int n_y, double *y0, int n_pars, double *pars, int n_theta,
                  int *theta_idx, int *log_flags, int n_targets, int *target_kind,
                  int *target_index, double *target_scale, int n_ovr, int *ovr_idx,
                  int n_exp, int *exp_kind, int *exp_n_seg, int *exp_n_points,
                  int n_seg_total, double *seg_t_end, double *seg_ovr, int n_points,
                  double *data_t, double *data_y, int n_derived, int solver_id, double rtol,
                  double atol, double ss_tol, double ss_t_max, double target_residual_norm,
                  int progress_interval) {
  jacobian_free();

  if (n_derived > 0 && (!g_derived_fn || !g_derived_grad_fn)) return -5;

  JacobianSession *s = (JacobianSession *)calloc(1, sizeof(JacobianSession));
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
  if (exp_overrides_fitted(&s->P, n_theta, theta_idx)) {
    jacobian_session_free(s);
    return -4;
  }

  s->n_pars = n_pars;
  s->n_theta = n_theta;
  s->pars = (double *)malloc((size_t)(n_pars > 0 ? n_pars : 1) * sizeof(double));
  s->theta_idx = (int *)malloc((size_t)(n_theta > 0 ? n_theta : 1) * sizeof(int));
  s->log_flags = (int *)malloc((size_t)(n_theta > 0 ? n_theta : 1) * sizeof(int));
  s->x = (double *)malloc((size_t)(n_theta > 0 ? n_theta : 1) * sizeof(double));
  if (!s->pars || !s->theta_idx || !s->log_flags || !s->x) {
    jacobian_session_free(s);
    return -1;
  }
  memcpy(s->pars, pars, (size_t)n_pars * sizeof(double));
  memcpy(s->theta_idx, theta_idx, (size_t)n_theta * sizeof(int));
  memcpy(s->log_flags, log_flags, (size_t)n_theta * sizeof(int));

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
    int m = exp_m(&s->P);
    double *fvec0 = (double *)malloc((size_t)(m > 0 ? m : 1) * sizeof(double));
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

/* Writes the analytic Jacobian of the residual at the current estimate
 * (m x n_theta, column-major, in x's possibly-log space) into out — mainly
 * for tests/debugging, like adjoint_get_grad. Returns 0, or -1 without a
 * session / on allocation failure. */
int jacobian_get_jacobian(double *out) {
  JacobianSession *s = g_jac;
  if (!s) return -1;
  double *pars_full = (double *)malloc((size_t)(s->n_pars > 0 ? s->n_pars : 1) * sizeof(double));
  if (!pars_full) return -1;
  build_pars_full(s, s->x, pars_full);
  int rc = compute_jacobian(s, pars_full, out, exp_m(&s->P));
  free(pars_full);
  return rc;
}

/* Same as fit_wrapper.c's fit_get_predictions: the raw model value behind
 * every residual entry at the current estimate (NaN for a failed
 * experiment). Returns 0, or -1 without a session / on allocation failure. */
int jacobian_get_predictions(double *out) {
  JacobianSession *s = g_jac;
  if (!s) return -1;
  size_t m = (size_t)exp_m(&s->P);
  double *fvec = (double *)malloc((m > 0 ? m : 1) * sizeof(double));
  double *pars_full = (double *)malloc((size_t)(s->n_pars > 0 ? s->n_pars : 1) * sizeof(double));
  int rc = -1;
  if (fvec && pars_full) {
    build_pars_full(s, s->x, pars_full);
    rc = exp_residuals(&s->P, g_plain_fn, pars_full, fvec, out);
  }
  free(fvec);
  free(pars_full);
  return rc;
}
