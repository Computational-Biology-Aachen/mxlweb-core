/*
 * solver_common.h — see solver_common.c.
 */
#ifndef SOLVER_COMMON_H
#define SOLVER_COMMON_H

#include <stdint.h>

/* Clean signature: void(int n, double t, double* y, double* dydt, double* pars)
   Emscripten table type string: "vidiii" */
typedef void (*ModelFn)(int, double, double *, double *, double *);

/* The registered model RHS; set via set_model_fn (a WASM table index from JS, or a function
   pointer from native C) or set_model_fn_ptr (C). */
extern ModelFn g_model_fn;
void set_model_fn(intptr_t table_idx);
void set_model_fn_ptr(ModelFn fn);
ModelFn get_model_fn(void);
void eval_rhs(int n, double t, double *y, double *dydt, double *pars);

/* Output buffer: one row per recorded point. */
void init_output(int capacity, int dim);
void free_output(void);
int get_out_n(void);
double *get_out_t(void);
double *get_out_y(void);
void record_point(double t, const double *y);
/* Set when init_output or record_point couldn't allocate and a point was dropped; the
 * drivers then fail with -9 instead of returning an incomplete trajectory. */
int output_failed(void);

/* Output grid: when grid_t is set, solvers record exactly these times
 * (grid_i is the next one) instead of every step. grid_y is scratch space
 * for interpolated states, grid_dir the direction of integration (+1 / -1).
 * Solvers clear the grid when they return. */
extern const double *grid_t;
extern int grid_n;
extern int grid_i;
extern double grid_dir;
extern double *grid_y;
void set_output_grid(const double *t, int n);
void clear_output_grid(void);

/* Input checks shared by every driver (run_radau5, run_dop853, run_dopri5, run_lsoda and
 * mxlweb-core's run_cvode): 1 for what the solvers would turn into nonsense or an endless
 * loop — a non-finite span, state, tolerance or initial step, negative tolerances or initial
 * step, and a grid that isn't monotone in the direction of integration or leaves
 * [t_start, t_end] — else 0. Sets grid_dir. */
int check_run_input(int n, double t_start, double t_end, const double *y, double rtol, double atol,
                    double h_init);
/* Nothing to integrate (t_start == t_end, or no state): records the grid, or t_start (and
 * t_end), with y unchanged. The solvers themselves fail on a zero-length span or n == 0. */
void record_trivial_run(double t_start, double t_end, const double *y);

#endif /* SOLVER_COMMON_H */
