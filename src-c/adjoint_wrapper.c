/*
 * adjoint_wrapper.c — chunked Adam-over-continuous-adjoint fit driver.
 *
 * Architecture: ADR 0005 (mxlweb repo), §2.3/§2.3.1-2.3.4/§2.4/§2.5. Summary
 * of what's different from fit_wrapper.c's lmdif driver, and why:
 *
 *   - No new low-level solver code: the backward pass reuses run_radau5/
 *     run_dop853/run_dopri5 (radau5_wrapper.c) completely unchanged, just
 *     with a different RHS registered via set_model_fn_ptr (a new
 *     C-internal counterpart of the existing set_model_fn, added in
 *     radau5_wrapper.c) — that entry point's ModelFn signature (n, t, y,
 *     dydt, pars) is generic enough that the augmented adjoint state
 *     [lambda; theta-gradient] is just another "y" vector as far as the
 *     integrator is concerned. Hairer's solvers already support
 *     xend < xstart (integrating in decreasing time — the step-size sign
 *     follows sign(xend-xstart)), so "backward" needs no special solver
 *     support either.
 *
 *   - y(t) during the backward pass comes from Hermite-interpolating the
 *     forward solve's own accepted-step checkpoints (hermite_interp below),
 *     never by re-integrating the forward vector field backward
 *     (BacksolveAdjoint) — see ADR 0005 §2.3/§2.3.1 for why: that's the
 *     specific thing SciMLSensitivity/diffrax document as unstable on
 *     stiff problems, which is exactly what these models are.
 *
 *   - With more than one data point, the adjoint variable lambda needs a
 *     "jump" (additive kick) at each observation time, not just a single
 *     seed at t_end — see adam_step's own comment for the derivation.
 *     Segments between consecutive data points are integrated one
 *     run_radau5/etc call at a time, backward, with each data point's jump
 *     applied the instant the backward integration arrives at it.
 *
 *   - v1 restricts fit targets to raw state variables, not derived
 *     quantities: a derived target's jump would need d(derived)/dy, which
 *     needs a *second* generated adjoint graph (over the derived_fn's own
 *     expression tree, not dxdt's) that doesn't exist yet. Not a
 *     fundamental limit, just unbuilt — fit_init (lmdif path) keeps
 *     supporting both.
 *
 *   - Optimizer is Adam (ADR 0005 §2.4: lr=1e-4, standard beta1/beta2/eps),
 *     not Gauss-Newton: the whole reason this backend exists is that lmdif
 *     needs the full Jacobian of the residual vector, which reverse-mode/
 *     adjoint isn't cheap for. One Adam step = one full forward solve + one
 *     full backward solve (all segments) + one parameter update;
 *     "chunking" (adjoint_chunk) runs up to maxIterations *complete* Adam
 *     steps, unlike lmdif's function-evaluation-granularity chunking.
 *
 *   - The augmented [lambda; theta-gradient] state shares one rtol/atol
 *     (the same ones the forward solve uses) even though lambda and the
 *     theta-gradient accumulator can have very different natural scales —
 *     a known simplification, not revisited here; a per-component
 *     tolerance vector would need its own design pass if it ever matters
 *     in practice.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Exported from radau5_wrapper.c — called directly, in-process.      */
/* ------------------------------------------------------------------ */
typedef void (*ModelFn)(int, double, double *, double *, double *);

extern void set_model_fn(int table_idx);
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

/* buildAdjointWat's "fcn" export: void(n, t, y_ptr, lambda_ptr, pars_ptr,
 * out_dlambda_ptr, out_dtheta_ptr) — Emscripten signature "vidiiiii". This
 * one *is* a WAT-compiled JS callback (like the forward model_fn), so it's
 * registered the normal table-index way. */
typedef void (*AdjointFn)(int, double, double *, double *, double *, double *, double *);
static AdjointFn g_adjoint_fn = NULL;
void set_adjoint_fn(int table_idx) { g_adjoint_fn = (AdjointFn)(intptr_t)table_idx; }

/* The forward model_fn, kept separate from radau5_wrapper.c's g_model_fn:
 * that global gets pointed at adjoint_rhs_dispatch (below) while the
 * backward integration runs, but Hermite interpolation still needs to call
 * the real forward RHS to get f at each bracketing checkpoint, and the
 * forward solve itself needs to point g_model_fn back here first. */
static ModelFn g_forward_model_fn = NULL;
void set_forward_model_fn(int table_idx) { g_forward_model_fn = (ModelFn)(intptr_t)table_idx; }

/* ------------------------------------------------------------------ */
/* Adjoint session state — persists across adjoint_chunk() calls.     */
/* ------------------------------------------------------------------ */
#define ADJOINT_INFO_CONVERGED_GRADIENT 1
#define ADJOINT_INFO_PLATEAU 2
#define ADJOINT_INFO_TARGET_REACHED 3
#define ADJOINT_INFO_BUDGET_REACHED 4
/* Negative: genuine failure (allocation, or a solver IDID<0). Unlike
 * fit_fcn's per-trial-parameter-set penalty (lmdif's trust region can
 * reject and shrink away from a bad trial on its own), a single Adam step
 * needs an actual gradient — there's no equivalent "penalize and move on"
 * for a gradient-descent update, so a solver failure here fails the whole
 * chunk. */
#define ADJOINT_INFO_ERROR (-1)

typedef struct {
  int n_y;
  double *y0;

  int n_pars;
  double *pars; /* mutated in place by each Adam step */

  int n_theta;
  int *theta_idx; /* indices into pars[], analogous to fit_idx */

  int n_targets;
  int *target_index; /* index into y[] — state targets only, v1 (file doc comment) */
  double *target_scale;

  int n_points;
  double *data_t; /* ascending */
  double *data_y; /* target-major: data_y[k*n_points + j] */

  double t_end;
  int solver_id;
  double rtol, atol;

  /* Stopping criteria (ADR 0005 §2.5) */
  double target_residual_norm; /* negative disables */
  double grad_norm_tol;        /* <=0 disables */
  int plateau_patience;        /* <=0 disables */
  double plateau_min_delta;

  /* Adam state */
  double *adam_m, *adam_v; /* length n_theta */
  int adam_t;
  double lr, beta1, beta2, eps;

  int total_steps;
  int plateau_counter;
  double best_residual_norm;
  double last_residual_norm;
  double last_grad_norm;
  double *last_theta_grad; /* length n_theta — the raw gradient, not just its norm; mainly for tests/debugging */
} AdjointSession;

static AdjointSession *g_adj = NULL;

static void adjoint_session_free(AdjointSession *s) {
  if (!s) return;
  free(s->y0);
  free(s->pars);
  free(s->theta_idx);
  free(s->target_index);
  free(s->target_scale);
  free(s->data_t);
  free(s->data_y);
  free(s->adam_m);
  free(s->adam_v);
  free(s->last_theta_grad);
  free(s);
}

void adjoint_free(void) {
  adjoint_session_free(g_adj);
  g_adj = NULL;
}

/* ------------------------------------------------------------------ */
/* Forward-trajectory snapshot + cubic Hermite interpolation.         */
/*                                                                      */
/* out_t/out_y (radau5_wrapper.c) are a single shared buffer reused by */
/* every run_* call, so the forward solve's own trajectory has to be   */
/* copied out before the backward pass starts a fresh solve into the  */
/* same buffer.                                                        */
/* ------------------------------------------------------------------ */
static double *fwd_t = NULL, *fwd_y = NULL;
static int fwd_n = 0, fwd_dim = 0;
static double *fwd_pars = NULL; /* snapshot of the parameter vector the forward solve used */

static void fwd_snapshot_free(void) {
  free(fwd_t); fwd_t = NULL;
  free(fwd_y); fwd_y = NULL;
  free(fwd_pars); fwd_pars = NULL;
  fwd_n = fwd_dim = 0;
}

/* Cubic Hermite interpolation of y(t_query) from the snapshotted forward
 * trajectory, using y and f=dy/dt (recomputed via g_forward_model_fn — one
 * extra RHS evaluation per endpoint, ADR 0005 §2.3.1) at both ends of the
 * bracketing interval. y_out must have length fwd_dim.
 */
static void hermite_interp(double t_query, double *y_out) {
  if (fwd_n <= 0) { memset(y_out, 0, (size_t)fwd_dim * sizeof(double)); return; }
  if (fwd_n == 1 || t_query <= fwd_t[0]) {
    memcpy(y_out, fwd_y, (size_t)fwd_dim * sizeof(double));
    return;
  }
  if (t_query >= fwd_t[fwd_n - 1]) {
    memcpy(y_out, fwd_y + (size_t)(fwd_n - 1) * fwd_dim, (size_t)fwd_dim * sizeof(double));
    return;
  }
  int lo = 0, hi = fwd_n - 1;
  while (hi - lo > 1) {
    int mid = (lo + hi) >> 1;
    if (fwd_t[mid] <= t_query) lo = mid; else hi = mid;
  }
  const double t0 = fwd_t[lo], t1 = fwd_t[hi];
  const double *y0 = fwd_y + (size_t)lo * fwd_dim;
  const double *y1 = fwd_y + (size_t)hi * fwd_dim;
  const double h = t1 - t0;

  double *f0 = (double *)malloc((size_t)fwd_dim * sizeof(double));
  double *f1 = (double *)malloc((size_t)fwd_dim * sizeof(double));
  if (!f0 || !f1) {
    free(f0); free(f1);
    memcpy(y_out, y0, (size_t)fwd_dim * sizeof(double));
    return;
  }
  g_forward_model_fn(fwd_dim, t0, (double *)y0, f0, fwd_pars);
  g_forward_model_fn(fwd_dim, t1, (double *)y1, f1, fwd_pars);

  const double s = (h > 0.0) ? (t_query - t0) / h : 0.0;
  const double s2 = s * s, s3 = s2 * s;
  const double h00 = 2 * s3 - 3 * s2 + 1;
  const double h10 = s3 - 2 * s2 + s;
  const double h01 = -2 * s3 + 3 * s2;
  const double h11 = s3 - s2;
  for (int i = 0; i < fwd_dim; i++) {
    y_out[i] = h00 * y0[i] + h10 * h * f0[i] + h01 * y1[i] + h11 * h * f1[i];
  }
  free(f0);
  free(f1);
}

/* ------------------------------------------------------------------ */
/* Augmented adjoint RHS — registered via set_model_fn_ptr for each    */
/* backward run_* call. y_aug = [lambda(n_y); theta_grad(n_theta)].    */
/* ------------------------------------------------------------------ */
static int g_aug_n_y = 0;

static void adjoint_rhs_dispatch(int n_aug, double t, double *y_aug, double *dydt_aug,
                                  double *pars) {
  (void)n_aug;
  double *y_interp = (double *)malloc((size_t)fwd_dim * sizeof(double));
  if (!y_interp) return; /* leaves dydt_aug untouched — caller sees a stalled integration, not silent corruption */
  hermite_interp(t, y_interp);
  double *lambda = y_aug; /* first g_aug_n_y entries of the augmented state */
  g_adjoint_fn(g_aug_n_y, t, y_interp, lambda, pars,
               dydt_aug /* dlambda out */, dydt_aug + g_aug_n_y /* dtheta out */);
  free(y_interp);
}

/* ------------------------------------------------------------------ */
/* One Adam step: full forward solve, then a segment-by-segment        */
/* backward solve accumulating dLoss/dtheta, then the parameter update.*/
/*                                                                      */
/* Derivation of the jump, and why no extra sign-flip is needed here:  */
/* Loss = sum_j g_j(y(t_j)), g_j = sum_k ((y_{idx_k}(t_j)-data_k)/      */
/* scale_k)^2. Standard continuous-adjoint theory: dlambda/dt =        */
/* -(df/dy)^T lambda between data points, with a jump                  */
/* lambda(t_j-) = lambda(t_j+) + (dg_j/dy)^T applied *at* t_j when      */
/* integrating backward *through* it, lambda(t_end+) = 0.              */
/* dLoss/dtheta = integral_0^t_end lambda^T (df/dtheta) dt (g_j has no  */
/* direct theta-dependence here — v1 is state targets only).           */
/*                                                                      */
/* buildAdjointGraph (modelIr.ts) already seeds its reverse walk with   */
/* -1, so the compiled adjoint fcn's dtheta output *is*                */
/* -lambda^T(df/dtheta) at an instant. Accumulating a state Q with      */
/* dQ/dt = dtheta(t), integrated *backward* from Q(t_end)=0 down to     */
/* t=0, gives Q(0) = 0 - integral_0^t_end dtheta(t) dt =                */
/* integral_0^t_end lambda^T(df/dtheta) dt = dLoss/dtheta directly —    */
/* no extra negation anywhere in this file.                             */
/*                                                                      */
/* Returns 0 on success (writing *out_loss and *out_grad_norm), or a    */
/* negative IDID-style value from whichever run_* call failed, or       */
/* ADJOINT_INFO_ERROR on allocation failure.                            */
/* ------------------------------------------------------------------ */
static int adam_step(AdjointSession *s, double *out_loss, double *out_grad_norm) {
  const int n_aug = s->n_y + s->n_theta;
  double *y_work = (double *)malloc((size_t)s->n_y * sizeof(double));
  double *y_aug = (double *)calloc((size_t)n_aug, sizeof(double)); /* lambda=0, theta_grad=0 */
  double *y_interp = (double *)malloc((size_t)s->n_y * sizeof(double));
  double *residual = (double *)malloc((size_t)s->n_targets * (size_t)s->n_points * sizeof(double));
  if (!y_work || !y_aug || !y_interp || !residual) {
    free(y_work); free(y_aug); free(y_interp); free(residual);
    return ADJOINT_INFO_ERROR;
  }

  /* Forward pass: full trajectory, kept in the shared out_t/out_y buffer
   * until snapshotted below. */
  memcpy(y_work, s->y0, (size_t)s->n_y * sizeof(double));
  set_model_fn_ptr(g_forward_model_fn);
  const int out_cap = 4000;
  init_output(out_cap, s->n_y);
  int idid;
  switch (s->solver_id) {
    case SOLVER_DOP853:
      idid = run_dop853(s->n_y, 0.0, s->t_end, y_work, s->pars, s->rtol, s->atol, 0.0, 500000);
      break;
    case SOLVER_DOPRI5:
      idid = run_dopri5(s->n_y, 0.0, s->t_end, y_work, s->pars, s->rtol, s->atol, 0.0, 500000);
      break;
    default:
      idid = run_radau5(s->n_y, 0.0, s->t_end, y_work, s->pars, s->rtol, s->atol, 0.0, 500000);
      break;
  }
  if (idid < 0) {
    free_output();
    free(y_work); free(y_aug); free(y_interp); free(residual);
    return idid;
  }

  /* Snapshot the trajectory + the parameter vector this solve used —
   * out_t/out_y get reused by the backward run_* calls below. */
  fwd_snapshot_free();
  fwd_n = get_out_n();
  fwd_dim = s->n_y;
  fwd_t = (double *)malloc((size_t)fwd_n * sizeof(double));
  fwd_y = (double *)malloc((size_t)fwd_n * (size_t)fwd_dim * sizeof(double));
  fwd_pars = (double *)malloc((size_t)s->n_pars * sizeof(double));
  if (!fwd_t || !fwd_y || !fwd_pars) {
    free_output();
    fwd_snapshot_free();
    free(y_work); free(y_aug); free(y_interp); free(residual);
    return ADJOINT_INFO_ERROR;
  }
  memcpy(fwd_t, get_out_t(), (size_t)fwd_n * sizeof(double));
  memcpy(fwd_y, get_out_y(), (size_t)fwd_n * (size_t)fwd_dim * sizeof(double));
  memcpy(fwd_pars, s->pars, (size_t)s->n_pars * sizeof(double));
  free_output();

  /* Residuals + loss (same per-target normalization as fit_wrapper.c's
   * fit_fcn, ADR 0004 §2.5), computed once and reused both for reporting
   * and for each backward segment's jump. */
  double loss = 0.0;
  for (int j = 0; j < s->n_points; j++) {
    hermite_interp(s->data_t[j], y_interp);
    for (int k = 0; k < s->n_targets; k++) {
      double model_v = y_interp[s->target_index[k]];
      double data_v = s->data_y[(size_t)k * s->n_points + j];
      double r = (model_v - data_v) / s->target_scale[k];
      residual[(size_t)k * s->n_points + j] = r;
      loss += r * r;
    }
  }

  /* Backward pass: one segment at a time, from t_end down to 0, applying
   * each data point's jump the instant the integration arrives there
   * (before continuing into the segment below it) — see this function's
   * own comment above for the derivation. */
  g_aug_n_y = s->n_y;
  double t_hi = s->t_end;
  for (int j = s->n_points - 1; j >= 0; j--) {
    const double t_lo = s->data_t[j];
    if (t_hi > t_lo) {
      set_model_fn_ptr(adjoint_rhs_dispatch);
      int idid_b;
      switch (s->solver_id) {
        case SOLVER_DOP853:
          idid_b = run_dop853(n_aug, t_hi, t_lo, y_aug, s->pars, s->rtol, s->atol, 0.0, 500000);
          break;
        case SOLVER_DOPRI5:
          idid_b = run_dopri5(n_aug, t_hi, t_lo, y_aug, s->pars, s->rtol, s->atol, 0.0, 500000);
          break;
        default:
          idid_b = run_radau5(n_aug, t_hi, t_lo, y_aug, s->pars, s->rtol, s->atol, 0.0, 500000);
          break;
      }
      if (idid_b < 0) {
        fwd_snapshot_free();
        free(y_work); free(y_aug); free(y_interp); free(residual);
        return idid_b;
      }
    }
    for (int k = 0; k < s->n_targets; k++) {
      double r = residual[(size_t)k * s->n_points + j];
      y_aug[s->target_index[k]] += 2.0 * r / s->target_scale[k];
    }
    t_hi = t_lo;
  }
  if (t_hi > 0.0) {
    set_model_fn_ptr(adjoint_rhs_dispatch);
    int idid_b;
    switch (s->solver_id) {
      case SOLVER_DOP853:
        idid_b = run_dop853(n_aug, t_hi, 0.0, y_aug, s->pars, s->rtol, s->atol, 0.0, 500000);
        break;
      case SOLVER_DOPRI5:
        idid_b = run_dopri5(n_aug, t_hi, 0.0, y_aug, s->pars, s->rtol, s->atol, 0.0, 500000);
        break;
      default:
        idid_b = run_radau5(n_aug, t_hi, 0.0, y_aug, s->pars, s->rtol, s->atol, 0.0, 500000);
        break;
    }
    if (idid_b < 0) {
      fwd_snapshot_free();
      free(y_work); free(y_aug); free(y_interp); free(residual);
      return idid_b;
    }
  }

  /* y_aug[0..n_y) is lambda(0) (unused further); y_aug[n_y..) is
   * theta_grad = dLoss/dtheta, per this function's own derivation comment. */
  double *theta_grad = y_aug + s->n_y;

  double grad_norm_sq = 0.0;
  for (int k = 0; k < s->n_theta; k++) grad_norm_sq += theta_grad[k] * theta_grad[k];
  *out_grad_norm = sqrt(grad_norm_sq);
  *out_loss = sqrt(loss);
  memcpy(s->last_theta_grad, theta_grad, (size_t)s->n_theta * sizeof(double));

  /* Adam update. */
  s->adam_t += 1;
  const double bc1 = 1.0 - pow(s->beta1, (double)s->adam_t);
  const double bc2 = 1.0 - pow(s->beta2, (double)s->adam_t);
  for (int k = 0; k < s->n_theta; k++) {
    const double g = theta_grad[k];
    s->adam_m[k] = s->beta1 * s->adam_m[k] + (1.0 - s->beta1) * g;
    s->adam_v[k] = s->beta2 * s->adam_v[k] + (1.0 - s->beta2) * g * g;
    const double mhat = s->adam_m[k] / bc1;
    const double vhat = s->adam_v[k] / bc2;
    s->pars[s->theta_idx[k]] -= s->lr * mhat / (sqrt(vhat) + s->eps);
  }

  fwd_snapshot_free();
  free(y_work);
  free(y_aug);
  free(y_interp);
  free(residual);
  return 0;
}

/* ------------------------------------------------------------------ */
/* Exported API                                                        */
/* ------------------------------------------------------------------ */

/*
 * adjoint_init — one-time setup for an adjoint fit session. Call
 * set_forward_model_fn() and set_adjoint_fn() before this (analogous to
 * fit_init's set_model_fn()/set_derived_fn()). target_index/target_scale
 * are state-variable targets only (see this file's own doc comment).
 * data_t must be ascending.
 *
 * lr/beta1/beta2/eps: Adam hyperparameters (ADR 0005 §2.4 — lr defaults to
 * 1e-4; pass the standard 0.9/0.999/1e-8 for beta1/beta2/eps unless a
 * caller has a specific reason not to).
 *
 * grad_norm_tol/plateau_patience/plateau_min_delta/target_residual_norm:
 * ADR 0005 §2.5's stopping criteria — pass <=0 (or negative, for
 * target_residual_norm) to disable any of them.
 *
 * Returns 0 on success, -1 on allocation failure.
 */
int adjoint_init(int n_y, double *y0, int n_pars, double *pars, int n_theta, int *theta_idx,
                  int n_targets, int *target_index, double *target_scale, int n_points,
                  double *data_t, double *data_y, double t_end, int solver_id, double rtol,
                  double atol, double lr, double beta1, double beta2, double eps,
                  double target_residual_norm, double grad_norm_tol, int plateau_patience,
                  double plateau_min_delta) {
  adjoint_free();

  AdjointSession *s = (AdjointSession *)calloc(1, sizeof(AdjointSession));
  if (!s) return -1;

  s->n_y = n_y;
  s->y0 = (double *)malloc((size_t)n_y * sizeof(double));
  s->n_pars = n_pars;
  s->pars = (double *)malloc((size_t)n_pars * sizeof(double));
  s->n_theta = n_theta;
  s->theta_idx = (int *)malloc((size_t)n_theta * sizeof(int));
  s->n_targets = n_targets;
  s->target_index = (int *)malloc((size_t)n_targets * sizeof(int));
  s->target_scale = (double *)malloc((size_t)n_targets * sizeof(double));
  s->n_points = n_points;
  s->data_t = (double *)malloc((size_t)n_points * sizeof(double));
  s->data_y = (double *)malloc((size_t)n_targets * (size_t)n_points * sizeof(double));
  s->adam_m = (double *)calloc((size_t)n_theta, sizeof(double));
  s->adam_v = (double *)calloc((size_t)n_theta, sizeof(double));
  s->last_theta_grad = (double *)calloc((size_t)n_theta, sizeof(double));

  if (!s->y0 || !s->pars || !s->theta_idx || !s->target_index || !s->target_scale ||
      !s->data_t || !s->data_y || !s->adam_m || !s->adam_v || !s->last_theta_grad) {
    adjoint_session_free(s);
    return -1;
  }

  memcpy(s->y0, y0, (size_t)n_y * sizeof(double));
  memcpy(s->pars, pars, (size_t)n_pars * sizeof(double));
  memcpy(s->theta_idx, theta_idx, (size_t)n_theta * sizeof(int));
  memcpy(s->target_index, target_index, (size_t)n_targets * sizeof(int));
  memcpy(s->target_scale, target_scale, (size_t)n_targets * sizeof(double));
  memcpy(s->data_t, data_t, (size_t)n_points * sizeof(double));
  memcpy(s->data_y, data_y, (size_t)n_targets * (size_t)n_points * sizeof(double));

  s->t_end = t_end;
  s->solver_id = solver_id;
  s->rtol = rtol;
  s->atol = atol;
  s->lr = lr;
  s->beta1 = beta1;
  s->beta2 = beta2;
  s->eps = eps;
  s->target_residual_norm = target_residual_norm;
  s->grad_norm_tol = grad_norm_tol;
  s->plateau_patience = plateau_patience;
  s->plateau_min_delta = plateau_min_delta;
  s->adam_t = 0;
  s->total_steps = 0;
  s->plateau_counter = 0;
  s->best_residual_norm = -1.0; /* sentinel: "no step has run yet" */

  g_adj = s;

  /* Evaluate the initial loss/gradient so the caller has a real
   * "before optimization" data point, mirroring fit_init's own
   * accounting-invisible initial evaluation — but unlike that one, this
   * genuinely can't be free of side effects: computing a gradient here
   * *is* one Adam step. Counted as step 1, not hidden from total_steps,
   * since there's no equivalent of fit_init's nfev=0 trick without lying
   * about what actually happened. */
  double loss, grad_norm;
  int info = adam_step(s, &loss, &grad_norm);
  if (info < 0) {
    adjoint_free();
    return -1;
  }
  s->total_steps = 1;
  s->last_residual_norm = loss;
  s->last_grad_norm = grad_norm;
  s->best_residual_norm = loss;

  return 0;
}

/*
 * adjoint_chunk — run up to maxIterations more complete Adam steps.
 *
 * Returns: ADJOINT_INFO_BUDGET_REACHED (4) = budget exhausted this chunk,
 *            call adjoint_chunk again to continue;
 *          ADJOINT_INFO_CONVERGED_GRADIENT (1) = ||grad|| <= grad_norm_tol;
 *          ADJOINT_INFO_PLATEAU (2) = loss hasn't improved by
 *            plateau_min_delta for plateau_patience consecutive steps;
 *          ADJOINT_INFO_TARGET_REACHED (3) = residual norm crossed
 *            target_residual_norm;
 *          ADJOINT_INFO_ERROR (-1) = allocation failure;
 *          any other negative value = a solver IDID failure from adam_step.
 */
int adjoint_chunk(int maxIterations) {
  AdjointSession *s = g_adj;
  if (!s) return ADJOINT_INFO_ERROR;

  for (int i = 0; i < maxIterations; i++) {
    double loss, grad_norm;
    int info = adam_step(s, &loss, &grad_norm);
    if (info < 0) return info;

    s->total_steps += 1;
    s->last_residual_norm = loss;
    s->last_grad_norm = grad_norm;

    if (s->target_residual_norm >= 0.0 && loss <= s->target_residual_norm) {
      return ADJOINT_INFO_TARGET_REACHED;
    }
    if (s->grad_norm_tol > 0.0 && grad_norm <= s->grad_norm_tol) {
      return ADJOINT_INFO_CONVERGED_GRADIENT;
    }
    if (s->plateau_patience > 0) {
      if (s->best_residual_norm < 0.0 || loss < s->best_residual_norm - s->plateau_min_delta) {
        s->best_residual_norm = loss;
        s->plateau_counter = 0;
      } else {
        s->plateau_counter += 1;
        if (s->plateau_counter >= s->plateau_patience) return ADJOINT_INFO_PLATEAU;
      }
    }
  }
  return ADJOINT_INFO_BUDGET_REACHED;
}

int adjoint_get_steps(void) { return g_adj ? g_adj->total_steps : 0; }

double adjoint_get_residual_norm(void) { return g_adj ? g_adj->last_residual_norm : 0.0; }

double adjoint_get_grad_norm(void) { return g_adj ? g_adj->last_grad_norm : 0.0; }

/* Writes the last computed raw gradient (length n_theta, in theta_idx
 * order) into out. Mainly for tests/debugging — adjoint_chunk's own
 * stopping criteria only need the norm. */
void adjoint_get_grad(double *out) {
  if (!g_adj) return;
  memcpy(out, g_adj->last_theta_grad, (size_t)g_adj->n_theta * sizeof(double));
}

/* Writes the current full parameter vector (fixed values unchanged, theta
 * values as Adam has updated them) into out (length n_pars). */
void adjoint_get_params(double *out) {
  if (!g_adj) return;
  memcpy(out, g_adj->pars, (size_t)g_adj->n_pars * sizeof(double));
}
