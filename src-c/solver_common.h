/*
 * solver_common.h — see solver_common.c.
 */
#ifndef SOLVER_COMMON_H
#define SOLVER_COMMON_H

/* Clean signature: void(int n, double t, double* y, double* dydt, double* pars)
   Emscripten table type string: "vidiii" */
typedef void (*ModelFn)(int, double, double *, double *, double *);

/* The registered model RHS; set via set_model_fn (JS) or set_model_fn_ptr (C). */
extern ModelFn g_model_fn;
void set_model_fn(int table_idx);
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

/* Output grid: when grid_t is set, solvers record exactly these times
 * (grid_i is the next one) instead of every step. grid_y is scratch space
 * for interpolated states. Solvers clear the grid when they return. */
extern const double *grid_t;
extern int grid_n;
extern int grid_i;
extern double *grid_y;
void set_output_grid(const double *t, int n);
void clear_output_grid(void);

#endif /* SOLVER_COMMON_H */
