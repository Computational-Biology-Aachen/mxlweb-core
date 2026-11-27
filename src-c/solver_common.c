/*
 * solver_common.c — state shared by every solver wrapper: the model-function
 * slot, the output buffer JS reads results from, and the optional output grid.
 * Linked into both radau5.wasm (radau5_wrapper.c) and cvode.wasm
 * (cvode_wrapper.c), so both modules expose the same output API to JS.
 */

#include "solver_common.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Model function pointer                                              */
/* ------------------------------------------------------------------ */
ModelFn g_model_fn = NULL;

/* Called from JS before a run_* call to register the model function. The
 * table_idx comes from Emscripten's addFunction, which is only meaningful
 * for a JS-side callback — a WAT-compiled model function, in every existing
 * caller. */
void set_model_fn(intptr_t table_idx) {
    g_model_fn = (ModelFn)(intptr_t)table_idx;
}

/* C-internal counterpart of set_model_fn: registers a real, already-linked
 * C function pointer directly, bypassing the table-index indirection.
 * adjoint_wrapper.c (ADR 0005 §2.3.3) uses this to swap g_model_fn between
 * the forward model and its own native adjoint_rhs_dispatch across the
 * forward/backward halves of one Adam step, without needing a fake
 * Emscripten table entry for a function that was never a JS callback. */
void set_model_fn_ptr(ModelFn fn) {
    g_model_fn = fn;
}

/* The currently registered model function — fit_wrapper.c captures the one
 * JS registered via set_model_fn at fit_init, since the fit drivers swap
 * g_model_fn between several RHS functions (fit_experiments.c's exp_walk). */
ModelFn get_model_fn(void) {
    return g_model_fn;
}

/* ------------------------------------------------------------------ */
/* Output buffer (written by SOLOUT, read by JS after integration)    */
/* ------------------------------------------------------------------ */
static double *out_t  = NULL;
static double *out_y  = NULL;
static int     out_n  = 0;   /* number of accepted steps stored */
static int     out_cap = 0;
static int     out_dim = 0;
static int     out_failed_flag = 0;

void init_output(int capacity, int dim) {
    free(out_t);
    free(out_y);
    out_t   = (double *)malloc((size_t)(capacity > 0 ? capacity : 1) * sizeof(double));
    out_y   = (double *)malloc((size_t)(capacity > 0 ? capacity : 1) * (size_t)(dim > 0 ? dim : 1) * sizeof(double));
    out_n   = 0;
    out_cap = (out_t && out_y) ? capacity : 0;
    out_dim = dim;
    out_failed_flag = !(out_t && out_y);
}

void free_output(void) {
    free(out_t); out_t = NULL;
    free(out_y); out_y = NULL;
    out_n = out_cap = out_dim = 0;
}

int    get_out_n(void)    { return out_n; }
double *get_out_t(void)   { return out_t; }
double *get_out_y(void)   { return out_y; }

/* Appends one accepted step, doubling the buffer when full rather than
 * silently dropping steps — a long multi-segment protocol (e.g. an NPQ
 * light protocol with dozens of saturating pulses) easily exceeds any
 * fixed capacity. capacity==0 (init_output(0, dim)) disables recording
 * entirely, for callers that only need the final state. */
void record_point(double t, const double *y) {
    if (out_cap == 0) return;
    if (out_n == out_cap) {
        int new_cap = out_cap * 2;
        double *nt = (double *)realloc(out_t, (size_t)new_cap * sizeof(double));
        if (!nt) { out_failed_flag = 1; return; }
        out_t = nt; /* still holds out_cap points; out_cap grows only once both have */
        double *ny = (double *)realloc(out_y, (size_t)new_cap * (size_t)out_dim * sizeof(double));
        if (!ny) { out_failed_flag = 1; return; }
        out_y = ny;
        out_cap = new_cap;
    }
    out_t[out_n] = t;
    memcpy(out_y + (size_t)out_n * (size_t)out_dim, y, (size_t)out_dim * sizeof(double));
    out_n++;
}

int output_failed(void) { return out_failed_flag; }

/* Evaluates the registered model RHS once, outside any integrator — used
 * by fit_wrapper.c's steady-state convergence check (||dy/dt||). */
void eval_rhs(int n, double t, double *y, double *dydt, double *pars) {
    if (g_model_fn) g_model_fn(n, t, y, dydt, pars);
}

/* ------------------------------------------------------------------ */
/* Optional output grid (every driver in radau5_wrapper.c)             */
/* ------------------------------------------------------------------ */
/* When set, the next run_* call records its solver's continuous output (RADAU5's collocation
 * polynomial, DOP853's / DOPRI5's dense output, LSODA's interpolant) at exactly these times,
 * monotone in the direction of integration and inside the span, instead of one point per
 * accepted step. Consumed by that call and then cleared; the array must stay valid until it
 * returns. */
const double *grid_t = NULL;
int grid_n = 0;
int grid_i = 0;
double grid_dir = 1.0;
double *grid_y = NULL;

void set_output_grid(const double *t, int n) {
    grid_t = t;
    grid_n = n;
    grid_i = 0;
}

void clear_output_grid(void) {
    grid_t = NULL;
    grid_n = grid_i = 0;
    free(grid_y);
    grid_y = NULL;
}

/* ------------------------------------------------------------------ */
/* Input checks shared by every driver                                 */
/* ------------------------------------------------------------------ */
int check_run_input(int n, double t_start, double t_end, const double *y, double rtol, double atol,
                    double h_init) {
    if (n < 0 || !isfinite(t_start) || !isfinite(t_end) || !isfinite(rtol) || !isfinite(atol) ||
        !isfinite(h_init) || rtol < 0 || atol < 0 || h_init < 0)
        return 1;
    for (int i = 0; i < n; i++)
        if (!isfinite(y[i])) return 1;
    grid_dir = t_end >= t_start ? 1.0 : -1.0;
    for (int k = 0; grid_t && k < grid_n; k++) {
        if (!((grid_t[k] - t_start) * grid_dir >= 0 && (t_end - grid_t[k]) * grid_dir >= 0)) return 1;
        if (k > 0 && (grid_t[k] - grid_t[k - 1]) * grid_dir < 0) return 1;
    }
    return 0;
}

void record_trivial_run(double t_start, double t_end, const double *y) {
    if (grid_t) {
        for (; grid_i < grid_n; grid_i++) record_point(grid_t[grid_i], y);
    } else {
        record_point(t_start, y);
        if (t_end != t_start) record_point(t_end, y);
    }
}
