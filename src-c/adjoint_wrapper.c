/*
 * adjoint_wrapper.c — chunked Adam-over-continuous-adjoint fit driver.
 *
 * Architecture: ADR 0005 (mxlweb repo), §2.3/§2.3.1-2.3.4/§2.4/§2.5. Summary
 * of what's different from fit_wrapper.c's lmdif driver, and why:
 *
 *   - No new low-level solver code: the backward pass reuses run_radau5/
 *     run_dop853/run_dopri5 (radau5_wrapper.c) completely unchanged, just
 *     with a different RHS registered via set_model_fn_ptr — that entry
 *     point's ModelFn signature (n, t, y, dydt, pars) is generic enough that
 *     the augmented adjoint state [lambda; theta-gradient] is just another
 *     "y" vector as far as the integrator is concerned. Hairer's solvers
 *     already support xend < xstart (integrating in decreasing time), so
 *     "backward" needs no special solver support either.
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
 *     seed at the end — see adam_step's own comment for the derivation.
 *
 *   - Experiments (ADR 0009) — the forward pass is fit_experiments.c's
 *     exp_walk, the same as the lm drivers':
 *       - protocol: the backward pass also stops at every segment boundary,
 *         integrating each piece with that segment's own parameters and
 *         Hermite-interpolating only within that segment's own checkpoints
 *         (f jumps at a boundary). lambda itself is continuous there: the
 *         boundary times are fixed and the state is continuous;
 *       - steady state: the forward windows run until convergence at T*;
 *         the condition is then exactly a one-point time course at T*, so
 *         the gradient is that of y(T*) — the integrate-from-y0 steady
 *         state, conserved moieties included. One that never converges
 *         adds the usual penalty to the loss but no gradient (Adam has no
 *         trust region to back away with);
 *       - a fitted parameter must not also be overridden (init returns -4):
 *         the adjoint RHS would still differentiate the overridden value.
 *
 *   - Derived targets d(t, y, p) use g_derived_grad_fn (fit_experiments.h):
 *     the jump is (∂g/∂d)·∂d/∂y and the direct term (∂g/∂d)·∂d/∂θ goes
 *     straight into the theta-gradient accumulator.
 *
 *   - Optimizer is Adam (ADR 0005 §2.4: lr=1e-4, standard beta1/beta2/eps),
 *     not Gauss-Newton: the whole reason this backend exists is that lmdif
 *     needs the full Jacobian of the residual vector, which reverse-mode/
 *     adjoint isn't cheap for. One Adam step = one full forward solve + one
 *     full backward solve per experiment + one parameter update;
 *     "chunking" (adjoint_chunk) runs up to maxIterations *complete* Adam
 *     steps, unlike lmdif's function-evaluation-granularity chunking.
 *
 *   - The augmented [lambda; theta-gradient] state shares one rtol/atol
 *     (the same ones the forward solve uses) even though lambda and the
 *     theta-gradient accumulator can have very different natural scales —
 *     a known simplification, not revisited here.
 */

#include "fit_experiments.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Exported from radau5_wrapper.c — called directly, in-process.      */
/* ------------------------------------------------------------------ */
extern void init_output(int capacity, int dim);

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
 * the real forward RHS to get f at each bracketing checkpoint. */
static ModelFn g_forward_model_fn = NULL;
void set_forward_model_fn(int table_idx) { g_forward_model_fn = (ModelFn)(intptr_t)table_idx; }

/* Fires every `progress_interval` Adam steps from inside adjoint_chunk's
 * own loop — see fit_wrapper.c's identical g_progress_fn doc comment for
 * the full rationale. Registered once, globally. */
typedef void (*ProgressFn)(int, double);
static ProgressFn g_progress_fn = NULL;
void adjoint_set_progress_fn(int table_idx) {
  g_progress_fn = (ProgressFn)(intptr_t)table_idx;
}

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
 * for a time course's gradient-descent update, so a solver failure there
 * fails the whole chunk. */
#define ADJOINT_INFO_ERROR (-1)

typedef struct {
  ExpProblem P; /* y0, targets, experiments, solver settings */

  int n_pars;
  double *pars; /* mutated in place by each Adam step */

  int n_theta;
  int *theta_idx; /* indices into pars[], analogous to fit_idx */

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
  double *predictions;     /* length n_targets * n_points, from the last forward pass */

  /* Mid-chunk progress reporting — see g_progress_fn's own doc comment.
   * <=0 disables. */
  int progress_interval;
} AdjointSession;

static AdjointSession *g_adj = NULL;

static void adjoint_session_free(AdjointSession *s) {
  if (!s) return;
  exp_problem_free(&s->P);
  free(s->pars);
  free(s->theta_idx);
  free(s->adam_m);
  free(s->adam_v);
  free(s->last_theta_grad);
  free(s->predictions);
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
/* every run_* call, so each forward segment's steps are copied out    */
/* (snapshot_segment, exp_walk's on_traj) before the next solve.       */
/* ------------------------------------------------------------------ */
static double *fwd_t = NULL, *fwd_y = NULL;
static int fwd_n = 0, fwd_cap = 0, fwd_dim = 0;
/* Per global segment index: its checkpoints fwd_[t|y][seg_start ..
 * seg_start + seg_count) and the parameter vector it was integrated with. */
static int *seg_start = NULL, *seg_count = NULL;
static double *seg_pars = NULL;
/* The segment hermite_interp currently reads (set_hermite_segment). */
static int cur_lo = 0, cur_n = 0;
static double *cur_pars = NULL;

static void snapshot_free(void) {
  free(fwd_t); fwd_t = NULL;
  free(fwd_y); fwd_y = NULL;
  free(seg_start); seg_start = NULL;
  free(seg_count); seg_count = NULL;
  free(seg_pars); seg_pars = NULL;
  fwd_n = fwd_cap = fwd_dim = 0;
}

static int snapshot_alloc(const ExpProblem *P) {
  snapshot_free();
  fwd_dim = P->n_y;
  int n_seg = P->n_seg_total > 0 ? P->n_seg_total : 1;
  seg_start = (int *)calloc((size_t)n_seg, sizeof(int));
  seg_count = (int *)calloc((size_t)n_seg, sizeof(int));
  seg_pars = (double *)malloc((size_t)n_seg * (size_t)(P->n_pars > 0 ? P->n_pars : 1) *
                              sizeof(double));
  return seg_start && seg_count && seg_pars ? 0 : -1;
}

/* exp_walk's on_traj; vctx is adam_step's ForwardCtx, whose first member
 * is the session. */
static int snapshot_segment(void *vctx, int e, int seg, const double *pars_seg, int out_n,
                            const double *out_t, const double *out_y) {
  (void)e;
  const ExpProblem *P = &(*(AdjointSession **)vctx)->P;
  if (fwd_n + out_n > fwd_cap) {
    int cap = fwd_cap > 0 ? fwd_cap : 1024;
    while (cap < fwd_n + out_n) cap *= 2;
    double *t = (double *)realloc(fwd_t, (size_t)cap * sizeof(double));
    if (!t) return -1;
    fwd_t = t;
    double *y = (double *)realloc(fwd_y, (size_t)cap * (size_t)fwd_dim * sizeof(double));
    if (!y) return -1;
    fwd_y = y;
    fwd_cap = cap;
  }
  seg_start[seg] = fwd_n;
  seg_count[seg] = out_n;
  memcpy(seg_pars + (size_t)seg * P->n_pars, pars_seg, (size_t)P->n_pars * sizeof(double));
  memcpy(fwd_t + fwd_n, out_t, (size_t)out_n * sizeof(double));
  memcpy(fwd_y + (size_t)fwd_n * fwd_dim, out_y, (size_t)out_n * (size_t)fwd_dim * sizeof(double));
  fwd_n += out_n;
  return 0;
}

static void set_hermite_segment(const ExpProblem *P, int seg) {
  cur_lo = seg_start[seg];
  cur_n = seg_count[seg];
  cur_pars = seg_pars + (size_t)seg * P->n_pars;
}

/* Cubic Hermite interpolation of y(t_query) from the current segment's
 * checkpoints, using y and f=dy/dt (recomputed via g_forward_model_fn — one
 * extra RHS evaluation per endpoint, ADR 0005 §2.3.1) at both ends of the
 * bracketing interval. y_out must have length fwd_dim.
 */
static void hermite_interp(double t_query, double *y_out) {
  const double *ts = fwd_t + cur_lo;
  const double *ys = fwd_y + (size_t)cur_lo * fwd_dim;
  if (cur_n <= 0) { memset(y_out, 0, (size_t)fwd_dim * sizeof(double)); return; }
  if (cur_n == 1 || t_query <= ts[0]) {
    memcpy(y_out, ys, (size_t)fwd_dim * sizeof(double));
    return;
  }
  if (t_query >= ts[cur_n - 1]) {
    memcpy(y_out, ys + (size_t)(cur_n - 1) * fwd_dim, (size_t)fwd_dim * sizeof(double));
    return;
  }
  int lo = 0, hi = cur_n - 1;
  while (hi - lo > 1) {
    int mid = (lo + hi) >> 1;
    if (ts[mid] <= t_query) lo = mid; else hi = mid;
  }
  const double t0 = ts[lo], t1 = ts[hi];
  const double *y0 = ys + (size_t)lo * fwd_dim;
  const double *y1 = ys + (size_t)hi * fwd_dim;
  const double h = t1 - t0;

  double *f0 = (double *)malloc((size_t)fwd_dim * sizeof(double));
  double *f1 = (double *)malloc((size_t)fwd_dim * sizeof(double));
  if (!f0 || !f1) {
    free(f0); free(f1);
    memcpy(y_out, y0, (size_t)fwd_dim * sizeof(double));
    return;
  }
  g_forward_model_fn(fwd_dim, t0, (double *)y0, f0, cur_pars);
  g_forward_model_fn(fwd_dim, t1, (double *)y1, f1, cur_pars);

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
/* Forward pass: residuals, loss and each observation's jump.          */
/* ------------------------------------------------------------------ */
typedef struct {
  AdjointSession *s; /* first: snapshot_segment reads it */
  double loss;            /* sum of squared residuals so far */
  int *pt_seg;            /* per global point: its segment */
  double *pt_t;           /* per global point: its time (T* for a steady state) */
  double *jump_lambda;    /* per global point: n_y */
  double *jump_theta;     /* per global point: n_theta (derived targets' direct term) */
  double *y_h;            /* n_y scratch */
  double *derived_out;    /* n_derived */
  double *grad_out;       /* n_derived * (n_y + n_theta) */
} ForwardCtx;

/* Loss = sum_obs r^2, r = (model - data) / scale, so an observation's
 * dLoss/dmodel is 2r/scale. A state target's jump is that on its own
 * lambda entry; a derived target's is that times ∂d/∂y, plus that times
 * ∂d/∂θ straight into the theta-gradient. */
static void adjoint_point(void *vctx, int e, int seg, int j, double t, const double *y,
                          const double *pars_seg) {
  ForwardCtx *c = (ForwardCtx *)vctx;
  AdjointSession *s = c->s;
  const ExpProblem *P = &s->P;
  const int n_y = P->n_y, n_theta = s->n_theta;
  const int gp = P->exp_pt_off[e] + j;

  /* Hermite within the segment, as the backward pass sees y — except a
   * zero-length segment, whose state is exactly y. */
  if (seg_count[seg] >= 2) {
    set_hermite_segment(P, seg);
    hermite_interp(t, c->y_h);
  } else {
    memcpy(c->y_h, y, (size_t)n_y * sizeof(double));
  }
  if (P->n_derived > 0) {
    g_derived_fn(n_y, t, c->y_h, c->derived_out, (double *)pars_seg);
    g_derived_grad_fn(n_y, t, c->y_h, c->grad_out, (double *)pars_seg);
  }

  c->pt_seg[gp] = seg;
  c->pt_t[gp] = t;
  double *jl = c->jump_lambda + (size_t)gp * n_y;
  double *jt = c->jump_theta + (size_t)gp * n_theta;
  memset(jl, 0, (size_t)n_y * sizeof(double));
  memset(jt, 0, (size_t)n_theta * sizeof(double));
  for (int k = 0; k < P->n_targets; k++) {
    const int derived = P->target_kind[k] == TARGET_DERIVED;
    const int ti = P->target_index[k];
    const double model_v = derived ? c->derived_out[ti] : c->y_h[ti];
    const size_t idx = exp_index(P, e, k, j);
    s->predictions[idx] = model_v;
    const double data_v = P->data_y[idx];
    if (isnan(data_v)) continue;
    const double r = (model_v - data_v) / P->target_scale[k];
    c->loss += r * r;
    const double w = 2.0 * r / P->target_scale[k];
    if (!derived) {
      jl[ti] += w;
    } else {
      const double *grad = c->grad_out + (size_t)ti * (size_t)(n_y + n_theta);
      for (int m = 0; m < n_y; m++) jl[m] += w * grad[m];
      for (int col = 0; col < n_theta; col++) jt[col] += w * grad[n_y + col];
    }
  }
}

/* One backward piece within global segment seg, t_hi down to t_lo. */
static int backward(AdjointSession *s, int seg, double t_hi, double t_lo, double *y_aug) {
  if (!(t_hi > t_lo)) return 0;
  const ExpProblem *P = &s->P;
  set_hermite_segment(P, seg);
  init_output(0, P->n_y + s->n_theta);
  int idid = exp_integrate(P, adjoint_rhs_dispatch, P->n_y + s->n_theta, t_hi, t_lo, y_aug,
                           cur_pars);
  return idid < 0 ? idid : 0;
}

/* ------------------------------------------------------------------ */
/* One Adam step: per experiment a full forward solve, then a backward  */
/* solve accumulating dLoss/dtheta, then the parameter update.          */
/*                                                                      */
/* Derivation of the jump, and why no extra sign-flip is needed here:  */
/* Loss = sum_j g_j(y(t_j)), g_j = sum_k ((y_{idx_k}(t_j)-data_k)/      */
/* scale_k)^2. Standard continuous-adjoint theory: dlambda/dt =        */
/* -(df/dy)^T lambda between data points, with a jump                  */
/* lambda(t_j-) = lambda(t_j+) + (dg_j/dy)^T applied *at* t_j when      */
/* integrating backward *through* it, lambda(t_end+) = 0.              */
/* dLoss/dtheta = integral_0^t_end lambda^T (df/dtheta) dt (+ the       */
/* direct dg_j/dtheta of a derived target).                            */
/*                                                                      */
/* buildAdjointGraph (modelIr.ts) already seeds its reverse walk with   */
/* -1, so the compiled adjoint fcn's dtheta output *is*                */
/* -lambda^T(df/dtheta) at an instant. Accumulating a state Q with      */
/* dQ/dt = dtheta(t), integrated *backward* from Q(t_end)=0 down to     */
/* t=0, gives Q(0) = 0 - integral_0^t_end dtheta(t) dt =                */
/* integral_0^t_end lambda^T(df/dtheta) dt = dLoss/dtheta directly —    */
/* no extra negation anywhere in this file. Q simply keeps accumulating */
/* across experiments; lambda restarts at 0 for each.                   */
/*                                                                      */
/* Returns 0 on success (writing *out_loss and *out_grad_norm), or a    */
/* negative IDID-style value from whichever run_* call failed, or       */
/* ADJOINT_INFO_ERROR on allocation failure.                            */
/* ------------------------------------------------------------------ */
static int adam_step(AdjointSession *s, double *out_loss, double *out_grad_norm) {
  const ExpProblem *P = &s->P;
  const int n_y = P->n_y, n_theta = s->n_theta;
  const int n_aug = n_y + n_theta;
  const int n_pts = P->n_points > 0 ? P->n_points : 1;

  ForwardCtx c;
  memset(&c, 0, sizeof(c));
  c.s = s;
  double *y_work = (double *)malloc((size_t)n_y * sizeof(double));
  double *y_aug = (double *)calloc((size_t)n_aug, sizeof(double)); /* lambda=0, theta_grad=0 */
  c.pt_seg = (int *)malloc((size_t)n_pts * sizeof(int));
  c.pt_t = (double *)malloc((size_t)n_pts * sizeof(double));
  c.jump_lambda = (double *)malloc((size_t)n_pts * (size_t)n_y * sizeof(double));
  c.jump_theta = (double *)malloc((size_t)n_pts * (size_t)(n_theta > 0 ? n_theta : 1) * sizeof(double));
  c.y_h = (double *)malloc((size_t)n_y * sizeof(double));
  if (P->n_derived > 0) {
    c.derived_out = (double *)malloc((size_t)P->n_derived * sizeof(double));
    c.grad_out = (double *)malloc((size_t)P->n_derived * (size_t)n_aug * sizeof(double));
  }
  int rc = 0;
  if (!y_work || !y_aug || !c.pt_seg || !c.pt_t || !c.jump_lambda || !c.jump_theta || !c.y_h ||
      (P->n_derived > 0 && (!c.derived_out || !c.grad_out)) || snapshot_alloc(P) < 0) {
    rc = ADJOINT_INFO_ERROR;
    goto done;
  }
  g_aug_n_y = n_y;

  for (int e = 0; e < P->n_exp && rc == 0; e++) {
    const int n_e = P->exp_n_points[e];
    const int off = P->exp_pt_off[e];
    fwd_n = 0;
    memcpy(y_work, P->y0, (size_t)n_y * sizeof(double));
    int ok = exp_walk(P, e, g_forward_model_fn, n_y, y_work, s->pars, adjoint_point,
                      snapshot_segment, &c, NULL);
    if (ok == EXP_NO_MEMORY) {
      rc = ADJOINT_INFO_ERROR;
      break;
    }
    if (ok < 0) {
      if (P->exp_kind[e] != EXP_STEADY_STATE) {
        rc = ok;
        break;
      }
      for (int k = 0; k < P->n_targets; k++) {
        for (int j = 0; j < n_e; j++) {
          size_t idx = exp_index(P, e, k, j);
          s->predictions[idx] = NAN;
          if (!isnan(P->data_y[idx])) c.loss += EXP_PENALTY * EXP_PENALTY;
        }
      }
      continue;
    }
    if (n_e == 0) continue;

    /* Backward pass: from the last observation down to 0, stopping at
     * every observation (its jump) and every segment boundary (switching
     * parameters and Hermite checkpoints) on the way. */
    memset(y_aug, 0, (size_t)n_y * sizeof(double));
    int g = c.pt_seg[off + n_e - 1];
    double t_hi = c.pt_t[off + n_e - 1];
    for (int j = n_e - 1; j >= 0 && rc == 0; j--) {
      const int gp = off + j;
      while (g > c.pt_seg[gp] && rc == 0) {
        const double lo = exp_seg_start(P, e, g);
        rc = backward(s, g, t_hi, lo, y_aug);
        t_hi = lo;
        g--;
      }
      if (rc == 0) rc = backward(s, g, t_hi, c.pt_t[gp], y_aug);
      t_hi = c.pt_t[gp];
      const double *jl = c.jump_lambda + (size_t)gp * n_y;
      const double *jt = c.jump_theta + (size_t)gp * n_theta;
      for (int i = 0; i < n_y; i++) y_aug[i] += jl[i];
      for (int col = 0; col < n_theta; col++) y_aug[n_y + col] += jt[col];
    }
    while (rc == 0 && g > P->exp_seg_off[e]) {
      const double lo = exp_seg_start(P, e, g);
      rc = backward(s, g, t_hi, lo, y_aug);
      t_hi = lo;
      g--;
    }
    if (rc == 0) rc = backward(s, g, t_hi, 0.0, y_aug);
  }
  if (rc != 0) goto done;

  {
    /* y_aug[n_y..) is theta_grad = dLoss/dtheta, per this function's own
     * derivation comment. */
    double *theta_grad = y_aug + n_y;
    double grad_norm_sq = 0.0;
    for (int k = 0; k < n_theta; k++) grad_norm_sq += theta_grad[k] * theta_grad[k];
    *out_grad_norm = sqrt(grad_norm_sq);
    *out_loss = sqrt(c.loss);
    memcpy(s->last_theta_grad, theta_grad, (size_t)n_theta * sizeof(double));

    /* Adam update. */
    s->adam_t += 1;
    const double bc1 = 1.0 - pow(s->beta1, (double)s->adam_t);
    const double bc2 = 1.0 - pow(s->beta2, (double)s->adam_t);
    for (int k = 0; k < n_theta; k++) {
      const double gk = theta_grad[k];
      s->adam_m[k] = s->beta1 * s->adam_m[k] + (1.0 - s->beta1) * gk;
      s->adam_v[k] = s->beta2 * s->adam_v[k] + (1.0 - s->beta2) * gk * gk;
      const double mhat = s->adam_m[k] / bc1;
      const double vhat = s->adam_v[k] / bc2;
      s->pars[s->theta_idx[k]] -= s->lr * mhat / (sqrt(vhat) + s->eps);
    }
  }

done:
  snapshot_free();
  free(y_work);
  free(y_aug);
  free(c.pt_seg);
  free(c.pt_t);
  free(c.jump_lambda);
  free(c.jump_theta);
  free(c.y_h);
  free(c.derived_out);
  free(c.grad_out);
  return rc;
}

/* ------------------------------------------------------------------ */
/* Exported API                                                        */
/* ------------------------------------------------------------------ */

/*
 * adjoint_init — one-time setup for an adjoint fit session. Call
 * set_forward_model_fn() and set_adjoint_fn() (and, with derived targets,
 * set_derived_fn()/set_derived_grad_fn()) before this. The arguments up to
 * ss_t_max are fit_init's (see its doc comment for the experiment layout),
 * minus log_flags — Adam updates the parameters in linear space.
 *
 * lr/beta1/beta2/eps: Adam hyperparameters (ADR 0005 §2.4 — lr defaults to
 * 1e-4; pass the standard 0.9/0.999/1e-8 for beta1/beta2/eps unless a
 * caller has a specific reason not to).
 *
 * grad_norm_tol/plateau_patience/plateau_min_delta/target_residual_norm:
 * ADR 0005 §2.5's stopping criteria — pass <=0 (or negative, for
 * target_residual_norm) to disable any of them.
 *
 * progress_interval: see fit_init's identical parameter — fires the
 * registered progress callback (adjoint_set_progress_fn) every this many
 * Adam steps within a chunk. <=0 disables.
 *
 * Returns 0 on success, -1 on allocation failure, -3 if the experiment
 * layout is inconsistent, -4 if a fitted parameter is also a protocol/
 * condition override, -5 if derived targets lack set_derived_fn/
 * set_derived_grad_fn, -6 if the initial forward/backward solve failed.
 */
int adjoint_init(int n_y, double *y0, int n_pars, double *pars, int n_theta, int *theta_idx,
                 int n_targets, int *target_kind, int *target_index, double *target_scale,
                 int n_ovr, int *ovr_idx, int n_exp, int *exp_kind, int *exp_n_seg,
                 int *exp_n_points, int n_seg_total, double *seg_t_end, double *seg_ovr,
                 int n_points, double *data_t, double *data_y, int n_derived, int solver_id,
                 double rtol, double atol, double ss_tol, double ss_t_max, double lr,
                 double beta1, double beta2, double eps, double target_residual_norm,
                 double grad_norm_tol, int plateau_patience, double plateau_min_delta,
                 int progress_interval) {
  adjoint_free();

  if (n_derived > 0 && (!g_derived_fn || !g_derived_grad_fn)) return -5;

  AdjointSession *s = (AdjointSession *)calloc(1, sizeof(AdjointSession));
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
    adjoint_session_free(s);
    return -4;
  }

  const size_t m = (size_t)exp_m(&s->P);
  s->n_pars = n_pars;
  s->pars = (double *)malloc((size_t)(n_pars > 0 ? n_pars : 1) * sizeof(double));
  s->n_theta = n_theta;
  s->theta_idx = (int *)malloc((size_t)(n_theta > 0 ? n_theta : 1) * sizeof(int));
  s->adam_m = (double *)calloc((size_t)(n_theta > 0 ? n_theta : 1), sizeof(double));
  s->adam_v = (double *)calloc((size_t)(n_theta > 0 ? n_theta : 1), sizeof(double));
  s->last_theta_grad = (double *)calloc((size_t)(n_theta > 0 ? n_theta : 1), sizeof(double));
  s->predictions = (double *)malloc((m > 0 ? m : 1) * sizeof(double));

  if (!s->pars || !s->theta_idx || !s->adam_m || !s->adam_v || !s->last_theta_grad ||
      !s->predictions) {
    adjoint_session_free(s);
    return -1;
  }

  memcpy(s->pars, pars, (size_t)n_pars * sizeof(double));
  memcpy(s->theta_idx, theta_idx, (size_t)n_theta * sizeof(int));
  for (size_t i = 0; i < m; i++) s->predictions[i] = NAN;

  s->lr = lr;
  s->beta1 = beta1;
  s->beta2 = beta2;
  s->eps = eps;
  s->target_residual_norm = target_residual_norm;
  s->grad_norm_tol = grad_norm_tol;
  s->plateau_patience = plateau_patience;
  s->plateau_min_delta = plateau_min_delta;
  s->progress_interval = progress_interval;
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
    return info == ADJOINT_INFO_ERROR ? -1 : -6;
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

    /* Mid-chunk progress — see g_progress_fn's own doc comment. */
    if (s->progress_interval > 0 && g_progress_fn &&
        s->total_steps % s->progress_interval == 0) {
      g_progress_fn(s->total_steps, loss);
    }

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

/* Writes the raw model value behind every residual entry from the last
 * forward pass (length n_targets * n_points, data_y's layout; NaN for a
 * steady state that never converged) — the parameters *before* that step's
 * Adam update, matching adjoint_get_residual_norm. Returns 0, or -1 without
 * a session. */
int adjoint_get_predictions(double *out) {
  if (!g_adj) return -1;
  memcpy(out, g_adj->predictions, (size_t)exp_m(&g_adj->P) * sizeof(double));
  return 0;
}
