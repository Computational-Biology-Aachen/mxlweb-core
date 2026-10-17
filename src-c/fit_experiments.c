/*
 * fit_experiments.c — see fit_experiments.h.
 */
#include "fit_experiments.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Exported from radau5_wrapper.c — called directly, in-process.      */
/* ------------------------------------------------------------------ */
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
extern void eval_rhs(int n, double t, double *y, double *dydt, double *pars);

DerivedFn g_derived_fn = NULL;
DerivedFn g_derived_grad_fn = NULL;

void set_derived_fn(int table_idx) { g_derived_fn = (DerivedFn)(intptr_t)table_idx; }
void set_derived_grad_fn(int table_idx) {
  g_derived_grad_fn = (DerivedFn)(intptr_t)table_idx;
}

void exp_problem_free(ExpProblem *P) {
  free(P->y0);
  free(P->target_kind);
  free(P->target_index);
  free(P->target_scale);
  free(P->ovr_idx);
  free(P->exp_kind);
  free(P->exp_n_seg);
  free(P->exp_seg_off);
  free(P->exp_n_points);
  free(P->exp_pt_off);
  free(P->seg_t_end);
  free(P->seg_ovr);
  free(P->data_t);
  free(P->data_y);
  memset(P, 0, sizeof(*P));
}

int exp_problem_init(ExpProblem *P, int n_y, const double *y0, int n_pars, int n_targets,
                     const int *target_kind, const int *target_index,
                     const double *target_scale, int n_derived, int n_ovr, const int *ovr_idx,
                     int n_exp, const int *exp_kind, const int *exp_n_seg,
                     const int *exp_n_points, int n_seg_total, const double *seg_t_end,
                     const double *seg_ovr, int n_points, const double *data_t,
                     const double *data_y, int solver_id, double rtol, double atol,
                     double ss_tol, double ss_t_max) {
  memset(P, 0, sizeof(*P));

#define ALLOC_COPY(field, src, count, type)                          \
  do {                                                               \
    size_t bytes_ = (size_t)(count) * sizeof(type);                  \
    P->field = (type *)malloc(bytes_ > 0 ? bytes_ : 1);              \
    if (!P->field) {                                                 \
      exp_problem_free(P);                                           \
      return -1;                                                     \
    }                                                                \
    if ((src) && bytes_ > 0) memcpy(P->field, (src), bytes_);         \
  } while (0)

  ALLOC_COPY(y0, y0, n_y, double);
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
#undef ALLOC_COPY

  P->n_y = n_y;
  P->n_pars = n_pars;
  P->n_targets = n_targets;
  P->n_derived = n_derived;
  P->n_ovr = n_ovr;
  P->n_exp = n_exp;
  P->n_seg_total = n_seg_total;
  P->n_points = n_points;
  P->solver_id = solver_id;
  P->rtol = rtol;
  P->atol = atol;
  P->ss_tol = ss_tol;
  P->ss_t_max = ss_t_max;

  int seg_off = 0, pt_off = 0;
  for (int e = 0; e < n_exp; e++) {
    P->exp_seg_off[e] = seg_off;
    P->exp_pt_off[e] = pt_off;
    if (exp_n_seg[e] < 1 || (exp_kind[e] == EXP_STEADY_STATE && exp_n_seg[e] != 1)) {
      exp_problem_free(P);
      return -3;
    }
    seg_off += exp_n_seg[e];
    pt_off += exp_n_points[e];
    if (seg_off > n_seg_total || pt_off > n_points) {
      exp_problem_free(P);
      return -3;
    }
    if (exp_kind[e] == EXP_TIME_COURSE && exp_n_points[e] > 0 &&
        data_t[pt_off - 1] > seg_t_end[seg_off - 1]) {
      exp_problem_free(P);
      return -3;
    }
  }
  if (seg_off != n_seg_total || pt_off != n_points) {
    exp_problem_free(P);
    return -3;
  }
  return 0;
}

int exp_overrides_fitted(const ExpProblem *P, int n_fit, const int *fit_idx) {
  for (int i = 0; i < P->n_ovr; i++) {
    int fitted = 0;
    for (int c = 0; c < n_fit; c++) fitted |= fit_idx[c] == P->ovr_idx[i];
    if (!fitted) continue;
    for (int seg = 0; seg < P->n_seg_total; seg++) {
      if (!isnan(P->seg_ovr[(size_t)seg * P->n_ovr + i])) return 1;
    }
  }
  return 0;
}

void exp_apply_overrides(const ExpProblem *P, int seg, const double *pars_trial,
                         double *pars_seg) {
  memcpy(pars_seg, pars_trial, (size_t)P->n_pars * sizeof(double));
  const double *ovr = P->seg_ovr + (size_t)seg * P->n_ovr;
  for (int i = 0; i < P->n_ovr; i++) {
    if (!isnan(ovr[i])) pars_seg[P->ovr_idx[i]] = ovr[i];
  }
}

double exp_seg_start(const ExpProblem *P, int e, int seg) {
  return seg == P->exp_seg_off[e] ? 0.0 : P->seg_t_end[seg - 1];
}

/* C port of wasmWorker.ts's resampleUniform, generalized from uniform to
 * arbitrary (still ascending) query times. */
void exp_interp_at(int n, int out_n, const double *out_t, const double *out_y, double t,
                   double *y_out) {
  if (out_n <= 0) {
    memset(y_out, 0, (size_t)n * sizeof(double));
    return;
  }
  if (out_n == 1 || t <= out_t[0]) {
    memcpy(y_out, out_y, (size_t)n * sizeof(double));
    return;
  }
  if (t >= out_t[out_n - 1]) {
    memcpy(y_out, out_y + (size_t)(out_n - 1) * n, (size_t)n * sizeof(double));
    return;
  }
  int lo = 0, hi = out_n - 1;
  while (hi - lo > 1) {
    int mid = (lo + hi) >> 1;
    if (out_t[mid] <= t)
      lo = mid;
    else
      hi = mid;
  }
  double t_lo = out_t[lo], t_hi = out_t[hi];
  double alpha = (t_hi > t_lo) ? (t - t_lo) / (t_hi - t_lo) : 0.0;
  const double *y_lo = out_y + (size_t)lo * n;
  const double *y_hi = out_y + (size_t)hi * n;
  for (int i = 0; i < n; i++) y_out[i] = y_lo[i] + alpha * (y_hi[i] - y_lo[i]);
}

int exp_integrate(const ExpProblem *P, ModelFn fn, int n, double t0, double t1, double *y,
                  double *pars) {
  set_model_fn_ptr(fn);
  switch (P->solver_id) {
    case SOLVER_DOP853:
      return run_dop853(n, t0, t1, y, pars, P->rtol, P->atol, 0.0, 500000);
    case SOLVER_DOPRI5:
      return run_dopri5(n, t0, t1, y, pars, P->rtol, P->atol, 0.0, 500000);
    default:
      return run_radau5(n, t0, t1, y, pars, P->rtol, P->atol, 0.0, 500000);
  }
}

static int rhs_converged(const ExpProblem *P, int n, double t, double *y, double *pars,
                         double *rhs) {
  eval_rhs(n, t, y, rhs, pars);
  double f2 = 0.0, y2 = 0.0;
  for (int i = 0; i < n; i++) {
    if (!isfinite(rhs[i])) return 0;
    f2 += rhs[i] * rhs[i];
    y2 += y[i] * y[i];
  }
  double ynorm = sqrt(y2);
  return sqrt(f2) / (ynorm > 1.0 ? ynorm : 1.0) < P->ss_tol;
}

static int walk_time_course(const ExpProblem *P, int e, ModelFn fn, int n, double *y,
                            const double *pars_trial, double *pars_seg, double *y_interp,
                            ExpPointFn on_point, ExpTrajFn on_traj, void *ctx,
                            double *t_final) {
  const int n_e = P->exp_n_points[e];
  const double *t_data = P->data_t + P->exp_pt_off[e];
  double t = 0.0;
  int j = 0;
  for (int g = 0; g < P->exp_n_seg[e] && j < n_e; g++) {
    const int seg = P->exp_seg_off[e] + g;
    const double t_end = P->seg_t_end[seg];
    exp_apply_overrides(P, seg, pars_trial, pars_seg);

    init_output(2000, n);
    if (t_end > t) {
      int idid = exp_integrate(P, fn, n, t, t_end, y, pars_seg);
      if (idid < 0) {
        free_output();
        return idid;
      }
    }
    const int out_n = get_out_n();
    const double *out_t = get_out_t();
    const double *out_y = get_out_y();
    if (on_traj && on_traj(ctx, e, seg, pars_seg, out_n, out_t, out_y) != 0) {
      free_output();
      return EXP_NO_MEMORY;
    }
    for (; j < n_e && t_data[j] <= t_end; j++) {
      if (out_n > 0) {
        exp_interp_at(n, out_n, out_t, out_y, t_data[j], y_interp);
      } else {
        /* Zero-length segment (t_end == t): the state is just y. */
        memcpy(y_interp, y, (size_t)n * sizeof(double));
      }
      on_point(ctx, e, seg, j, t_data[j], y_interp, pars_seg);
    }
    free_output();
    t = t_end;
  }
  if (t_final) *t_final = t;
  return 0;
}

/* The browser analogue of MxlPy's simulate_to_steady_state. Steps are only
 * recorded (all windows into one buffer) when on_traj wants them. */
static int walk_steady_state(const ExpProblem *P, int e, ModelFn fn, int n, double *y,
                             const double *pars_trial, double *pars_seg, double *rhs,
                             ExpPointFn on_point, ExpTrajFn on_traj, void *ctx,
                             double *t_final) {
  const int seg = P->exp_seg_off[e];
  exp_apply_overrides(P, seg, pars_trial, pars_seg);
  set_model_fn_ptr(fn);
  init_output(on_traj ? 2000 : 0, n);

  double t = 0.0;
  int converged = rhs_converged(P, n, t, y, pars_seg, rhs);
  for (double t_next = 1.0; !converged && t < P->ss_t_max; t_next *= 10.0) {
    if (t_next > P->ss_t_max) t_next = P->ss_t_max;
    int idid = exp_integrate(P, fn, n, t, t_next, y, pars_seg);
    if (idid < 0) {
      free_output();
      return idid;
    }
    t = t_next;
    converged = rhs_converged(P, n, t, y, pars_seg, rhs);
  }
  if (!converged) {
    free_output();
    return EXP_NOT_CONVERGED;
  }
  if (on_traj && on_traj(ctx, e, seg, pars_seg, get_out_n(), get_out_t(), get_out_y()) != 0) {
    free_output();
    return EXP_NO_MEMORY;
  }
  free_output();
  for (int j = 0; j < P->exp_n_points[e]; j++) on_point(ctx, e, seg, j, t, y, pars_seg);
  if (t_final) *t_final = t;
  return 0;
}

int exp_walk(const ExpProblem *P, int e, ModelFn fn, int n, double *y,
             const double *pars_trial, ExpPointFn on_point, ExpTrajFn on_traj, void *ctx,
             double *t_final) {
  double *pars_seg = (double *)malloc((size_t)(P->n_pars > 0 ? P->n_pars : 1) * sizeof(double));
  double *scratch = (double *)malloc((size_t)n * sizeof(double));
  int rc = EXP_NO_MEMORY;
  if (pars_seg && scratch) {
    rc = P->exp_kind[e] == EXP_STEADY_STATE
             ? walk_steady_state(P, e, fn, n, y, pars_trial, pars_seg, scratch, on_point,
                                 on_traj, ctx, t_final)
             : walk_time_course(P, e, fn, n, y, pars_trial, pars_seg, scratch, on_point,
                                on_traj, ctx, t_final);
  }
  free(pars_seg);
  free(scratch);
  return rc;
}

/* ------------------------------------------------------------------ */
/* exp_residuals                                                       */
/* ------------------------------------------------------------------ */
typedef struct {
  const ExpProblem *P;
  double *fvec;
  double *model_out;
  double *derived_out;
} ResidualCtx;

static void residual_point(void *vctx, int e, int seg, int j, double t, const double *y,
                           const double *pars_seg) {
  (void)seg;
  ResidualCtx *c = (ResidualCtx *)vctx;
  const ExpProblem *P = c->P;
  if (P->n_derived > 0) g_derived_fn(P->n_y, t, (double *)y, c->derived_out, (double *)pars_seg);
  for (int k = 0; k < P->n_targets; k++) {
    double model_v = P->target_kind[k] == TARGET_STATE ? y[P->target_index[k]]
                                                        : c->derived_out[P->target_index[k]];
    size_t idx = exp_index(P, e, k, j);
    double data_v = P->data_y[idx];
    c->fvec[idx] = isnan(data_v) ? 0.0 : (model_v - data_v) / P->target_scale[k];
    if (c->model_out) c->model_out[idx] = model_v;
  }
}

int exp_residuals(const ExpProblem *P, ModelFn fn, const double *pars_trial, double *fvec,
                  double *model_out) {
  ResidualCtx c = {P, fvec, model_out, NULL};
  double *y = (double *)malloc((size_t)P->n_y * sizeof(double));
  if (P->n_derived > 0) c.derived_out = (double *)malloc((size_t)P->n_derived * sizeof(double));
  if (!y || (P->n_derived > 0 && !c.derived_out)) {
    free(y);
    free(c.derived_out);
    return -1;
  }
  int rc = 0;
  for (int e = 0; e < P->n_exp; e++) {
    memcpy(y, P->y0, (size_t)P->n_y * sizeof(double));
    int ok = exp_walk(P, e, fn, P->n_y, y, pars_trial, residual_point, NULL, &c, NULL);
    if (ok == EXP_NO_MEMORY) {
      rc = -1;
      break;
    }
    if (ok < 0) {
      /* Integration failed (or a steady state never converged) for this
       * trial parameter set — penalize, don't abort. */
      for (int k = 0; k < P->n_targets; k++) {
        for (int j = 0; j < P->exp_n_points[e]; j++) {
          size_t idx = exp_index(P, e, k, j);
          fvec[idx] = isnan(P->data_y[idx]) ? 0.0 : EXP_PENALTY;
          if (model_out) model_out[idx] = NAN;
        }
      }
    }
  }
  free(y);
  free(c.derived_out);
  return rc;
}
