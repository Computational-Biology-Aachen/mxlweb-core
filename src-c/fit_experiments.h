/*
 * fit_experiments.h — the experiment layout shared by all three fit drivers
 * (fit_wrapper.c lmdif, jacobian_wrapper.c lmder, adjoint_wrapper.c Adam):
 * a list of time courses (piecewise-constant parameter protocols) and steady
 * states (per-condition parameter overrides), all starting from y0 — see
 * docs/adrs/0009-fit-experiment-kinds.md and fit_init's doc comment for the
 * flat-array layout.
 */
#ifndef FIT_EXPERIMENTS_H
#define FIT_EXPERIMENTS_H

#include <stddef.h>

typedef void (*ModelFn)(int, double, double *, double *, double *);

/* Same calling convention as ModelFn ("vidiii"):
 * void derived_fn(int n_y, double t, double* y, double* out, double* pars) */
typedef ModelFn DerivedFn;

/* Registered via set_derived_fn / set_derived_grad_fn — shared by every
 * driver, since only one fit session exists per worker at a time. The
 * gradient function writes, per derived target d, [∂d/∂y (n_y), ∂d/∂θ
 * (n_theta)] (modelIr.ts's buildDerivedGradGraph). */
extern DerivedFn g_derived_fn;
extern DerivedFn g_derived_grad_fn;

/* Exported from radau5_wrapper.c. */
extern ModelFn get_model_fn(void);

enum { SOLVER_RADAU5 = 0, SOLVER_DOP853 = 1, SOLVER_DOPRI5 = 2 };

#define TARGET_STATE 0
#define TARGET_DERIVED 1

#define EXP_TIME_COURSE 0
#define EXP_STEADY_STATE 1

/* exp_walk's failure codes, besides a negative integrator IDID. */
#define EXP_NOT_CONVERGED (-100)
#define EXP_NO_MEMORY (-101)

/* Failed integration / non-converged steady state: the residual every
 * observation of that experiment gets (lmdif/lmder back away from it). */
#define EXP_PENALTY 1.0e3

typedef struct {
  int n_y;
  double *y0; /* length n_y, shared by every experiment */
  int n_pars; /* length of every parameter vector */

  int n_targets;
  int *target_kind;     /* length n_targets, TARGET_STATE | TARGET_DERIVED */
  int *target_index;    /* index into y[] or the derived_fn output */
  double *target_scale; /* normalization divisor */
  int n_derived;        /* derived_fn output length, 0 if unused */

  /* Parameter overrides: one shared list of parameter indices; every
   * segment carries one value per entry (NaN = keep the trial value). */
  int n_ovr;
  int *ovr_idx;

  int n_exp;
  int *exp_kind;
  int *exp_n_seg;
  int *exp_seg_off; /* derived: offset into seg_t_end */
  int *exp_n_points;
  int *exp_pt_off; /* derived: offset into data_t */

  int n_seg_total;
  double *seg_t_end; /* ascending within an experiment */
  double *seg_ovr;   /* n_seg_total * n_ovr */

  int n_points;
  double *data_t;
  /* n_targets * n_points: experiment e's block starts at
   * n_targets * exp_pt_off[e] and is target-major within it. NaN = missing. */
  double *data_y;

  int solver_id;
  double rtol, atol;
  double ss_tol;   /* steady state: ||f|| / max(||y||, 1) below this */
  double ss_t_max; /* steady state: give up past this time */
} ExpProblem;

/* Copies every array. Returns 0, -1 on allocation failure, -3 if the
 * experiment layout is inconsistent (fit_init's doc comment). */
int exp_problem_init(ExpProblem *P, int n_y, const double *y0, int n_pars, int n_targets,
                     const int *target_kind, const int *target_index,
                     const double *target_scale, int n_derived, int n_ovr, const int *ovr_idx,
                     int n_exp, const int *exp_kind, const int *exp_n_seg,
                     const int *exp_n_points, int n_seg_total, const double *seg_t_end,
                     const double *seg_ovr, int n_points, const double *data_t,
                     const double *data_y, int solver_id, double rtol, double atol,
                     double ss_tol, double ss_t_max);
void exp_problem_free(ExpProblem *P);

/* Residual vector length, n_targets * n_points. */
static inline int exp_m(const ExpProblem *P) { return P->n_targets * P->n_points; }

/* Index of (experiment e, target k, point j) into data_y / the residual. */
static inline size_t exp_index(const ExpProblem *P, int e, int k, int j) {
  return (size_t)P->n_targets * P->exp_pt_off[e] + (size_t)k * P->exp_n_points[e] + j;
}

/* 1 if some segment overrides one of the n_fit parameters fit_idx — the
 * gradient backends can't differentiate through an override. */
int exp_overrides_fitted(const ExpProblem *P, int n_fit, const int *fit_idx);

/* pars_seg = pars_trial with global segment seg's overrides applied. */
void exp_apply_overrides(const ExpProblem *P, int seg, const double *pars_trial,
                         double *pars_seg);

/* Start time of global segment seg of experiment e (0 for its first). */
double exp_seg_start(const ExpProblem *P, int e, int seg);

/* Linear interpolation of dense integrator output (dimension n) at t. */
void exp_interp_at(int n, int out_n, const double *out_t, const double *out_y, double t,
                   double *y_out);

/* Integrates y (dimension n) from t0 to t1 with fn and the problem's solver.
 * Records steps into radau5_wrapper.c's output buffer only if the caller
 * init_output'ed one. Returns the solver's IDID (< 0 = failure). */
int exp_integrate(const ExpProblem *P, ModelFn fn, int n, double t0, double t1, double *y,
                  double *pars);

/* Called for each data point j of experiment e with the state y (dimension
 * n, interpolated for a time course, the converged state for a steady state)
 * and the parameters of global segment seg it falls in. */
typedef void (*ExpPointFn)(void *ctx, int e, int seg, int j, double t, const double *y,
                           const double *pars_seg);

/* Called with the integrator's recorded steps before the points they cover:
 * once per time-course segment, once (all windows) for a steady state.
 * Returns 0, or nonzero to abort the walk (EXP_NO_MEMORY). */
typedef int (*ExpTrajFn)(void *ctx, int e, int seg, const double *pars_seg, int out_n,
                         const double *out_t, const double *out_y);

/*
 * Integrates experiment e with fn (dimension n, y = the initial state on
 * entry, overwritten) and reports every data point through on_point:
 *   - time course: segment by segment, carrying the state across
 *     boundaries; a point with t_prev < t <= t_end belongs to that segment
 *     (a boundary point to the earlier one, matching the simulation
 *     workers). Stops after the segment containing the last point.
 *   - steady state: windows ending at t = 1, 10, 100, ... (capped at
 *     ss_t_max) until ||fn(y)|| / max(||y||, 1) < ss_tol.
 * on_traj may be NULL (steady-state windows then record nothing).
 * *t_final (if non-NULL) receives the time the walk ended at.
 * Returns 0, a negative IDID, EXP_NOT_CONVERGED or EXP_NO_MEMORY.
 */
int exp_walk(const ExpProblem *P, int e, ModelFn fn, int n, double *y,
             const double *pars_trial, ExpPointFn on_point, ExpTrajFn on_traj, void *ctx,
             double *t_final);

/*
 * The residual (model - data) / scale for every observation under
 * pars_trial (0 for NaN data, EXP_PENALTY for an experiment that failed),
 * plus the raw model values (NaN when failed) into model_out if non-NULL.
 * fn is the forward model; derived targets use g_derived_fn.
 * Returns 0, or -1 on allocation failure.
 */
int exp_residuals(const ExpProblem *P, ModelFn fn, const double *pars_trial, double *fvec,
                  double *model_out);

#endif
