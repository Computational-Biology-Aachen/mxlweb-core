/*
 * solver_common.c — state shared by every solver wrapper: the model-function
 * slot, the output buffer JS reads results from, and the optional output grid.
 * Linked into both radau5.wasm (radau5_wrapper.c) and cvode.wasm
 * (cvode_wrapper.c), so both modules expose the same output API to JS.
 */

#include "solver_common.h"
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
void set_model_fn(int table_idx) {
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

void init_output(int capacity, int dim) {
    free(out_t);
    free(out_y);
    out_t   = (double *)malloc((size_t)capacity * sizeof(double));
    out_y   = (double *)malloc((size_t)capacity * (size_t)dim * sizeof(double));
    out_n   = 0;
    out_cap = capacity;
    out_dim = dim;
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
        if (!nt) return;
        out_t = nt;
        double *ny = (double *)realloc(out_y, (size_t)new_cap * (size_t)out_dim * sizeof(double));
        if (!ny) return;
        out_y = ny;
        out_cap = new_cap;
    }
    out_t[out_n] = t;
    memcpy(out_y + (size_t)out_n * (size_t)out_dim, y, (size_t)out_dim * sizeof(double));
    out_n++;
}

/* Evaluates the registered model RHS once, outside any integrator — used
 * by fit_wrapper.c's steady-state convergence check (||dy/dt||). */
void eval_rhs(int n, double t, double *y, double *dydt, double *pars) {
    if (g_model_fn) g_model_fn(n, t, y, dydt, pars);
}

/* ------------------------------------------------------------------ */
/* Optional output grid (RADAU5 and LSODA)                             */
/* ------------------------------------------------------------------ */
/* When set, run_radau5 records the collocation polynomial at exactly these
 * ascending times instead of one point per accepted step, and run_lsoda its
 * own interpolant. Consumed by the next run_radau5 or run_lsoda and then
 * cleared; the array must stay valid until it returns. */
const double *grid_t = NULL;
int grid_n = 0;
int grid_i = 0;
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
