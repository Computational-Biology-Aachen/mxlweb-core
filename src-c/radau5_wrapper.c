/*
 * radau5_wrapper.c — Clean C API over f2c-generated ODE solvers
 *
 * Contains wrappers for RADAU5 (stiff), DOP853 (explicit RK8(5,3)), DOPRI5
 * (explicit RK4(5)) and LSODA (Adams/BDF, switching automatically). All four
 * share the output buffer and model-function slot in solver_common.c — only
 * one solver runs at a time. The solvers themselves are vendored from
 * mxl-solvers (VENDORED).
 *
 * Model function signature (WAT side must match):
 *   void model_fn(int n, double t, double* y, double* dydt, double* pars)
 * Emscripten addFunction type string: "vidiii"
 */

#include "f2c.h"
#include "lsoda.h"
#include "solver_common.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Forward declaration of the f2c-generated RADAU5 entry point        */
/* ------------------------------------------------------------------ */
extern int radau5_(integer *n, U_fp fcn, doublereal *x, doublereal *y,
                   doublereal *xend, doublereal *h, doublereal *rtol,
                   doublereal *atol, integer *itol, U_fp jac, integer *ijac,
                   integer *mljac, integer *mujac, U_fp mas, integer *imas,
                   integer *mlmas, integer *mumas, U_fp solout, integer *iout,
                   doublereal *work, integer *lwork, integer *iwork,
                   integer *liwork, doublereal *rpar, integer *ipar,
                   integer *idid);

extern doublereal contr5_(integer *i__, doublereal *x, doublereal *cont, integer *lrc);

extern double radau5_jac_growth;

/* ------------------------------------------------------------------ */
/* FCN dispatcher (registered with RADAU5 as the RHS callback)        */
/* ------------------------------------------------------------------ */
/* Fortran ABI: all args are pointers */
static int fcn_dispatch(integer *n, doublereal *x, doublereal *y,
                        doublereal *f, doublereal *rpar, integer *ipar) {
    (void)ipar;
    if (g_model_fn) {
        g_model_fn((int)*n, *x, y, f, rpar);
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* Dummy JAC / MAS (IJAC=0, IMAS=0 → never called)                   */
/* ------------------------------------------------------------------ */
static int dummy_jac(integer *n, doublereal *x, doublereal *y,
                     doublereal *dfy, integer *ldfy,
                     doublereal *rpar, integer *ipar) {
    (void)n; (void)x; (void)y; (void)dfy; (void)ldfy;
    (void)rpar; (void)ipar;
    return 0;
}

static int dummy_mas(integer *n, doublereal *am, integer *lmas,
                     doublereal *rpar, integer *ipar) {
    (void)n; (void)am; (void)lmas; (void)rpar; (void)ipar;
    return 0;
}

/* Records the grid times up to and including x (in the direction of integration) from
 * interp(i, t), the solver's continuous output for component i (1-based). The first SOLOUT
 * call (nr == 1) comes before any step, when no interpolant exists yet, and a grid time equal
 * to the step endpoint is recorded from y itself, which is more accurate than the polynomial. */
typedef doublereal (*InterpFn)(integer i, doublereal t, void *ctx);

static void record_grid_until(integer nr, double x, const double *y, integer n, InterpFn interp, void *ctx) {
    while (grid_i < grid_n && (grid_t[grid_i] - x) * grid_dir <= 0) {
        double t = grid_t[grid_i++];
        if (nr < 2 || t == x) {
            record_point(t, y);
            continue;
        }
        for (integer i = 1; i <= n; i++) grid_y[i - 1] = interp(i, t, ctx);
        record_point(t, grid_y);
    }
}

typedef struct {
    doublereal *cont;
    integer *lrc;
} Radau5Dense;

static doublereal radau5_interp(integer i, doublereal t, void *ctx) {
    Radau5Dense *d = (Radau5Dense *)ctx;
    return contr5_(&i, &t, d->cont, d->lrc);
}

/* ------------------------------------------------------------------ */
/* SOLOUT dispatcher                                                   */
/* ------------------------------------------------------------------ */
/* Fortran ABI: (nr, xold, x, y, cont, lrc, n, rpar, ipar, irtrn)    */
static int solout_dispatch(integer *nr, doublereal *xold, doublereal *x,
                           doublereal *y, doublereal *cont, integer *lrc,
                           integer *n, doublereal *rpar, integer *ipar,
                           integer *irtrn) {
    (void)xold; (void)rpar; (void)ipar;
    if (grid_t) {
        Radau5Dense d = {cont, lrc};
        record_grid_until(*nr, *x, y, *n, radau5_interp, &d);
    } else {
        record_point(*x, y);
    }
    *irtrn = 1; /* continue */
    return 0;
}

/* The status of a run whose output buffer couldn't grow: the recorded points are incomplete. */
#define OUTPUT_ALLOC_FAILED (-9)

/* ------------------------------------------------------------------ */
/* Main exported API                                                   */
/* ------------------------------------------------------------------ */
/*
 * run_radau5 — drive RADAU5 for a single segment
 *
 * Parameters (all passed by value from JS via ccall):
 *   n        number of state variables
 *   t_start  integration start time
 *   t_end    integration end time; t_end < t_start integrates backward
 *   y        pointer into Emscripten heap (HEAPF64), length n; the state at t_end on return
 *   rpar     pointer into heap (parameters), length npars
 *   rtol     relative tolerance (scalar, >= 0)
 *   atol     absolute tolerance (scalar, >= 0)
 *   h_init   size of the first step, 0 → the solver's own guess (its sign is the direction's)
 *   nmax     max steps (<= 0 → 100000)
 *
 * Caller must call init_output(capacity, n) before and free_output() after, and may call
 * set_output_grid before (times monotone in the direction of integration, inside the span).
 *
 * Returns IDID:  1 = success,  2 = interrupted by SOLOUT,
 *               -1 = bad input, -2 = too many steps,
 *               -3 = step too small (also a non-finite RHS or a blow-up),
 *               -4 = singular matrix, -9 = allocation failed
 *
 * Before calling: set_model_fn(table_idx) and init_output(nout, n)
 * After calling:  read results via get_out_n / get_out_t / get_out_y
 *
 * run_dop853, run_dopri5 and run_lsoda share this contract (LSODA's codes differ, see there).
 */
static int radau5_impl(int n, double t_start, double t_end,
                       double *y, double *rpar,
                       double rtol, double atol,
                       double h_init, int nmax, int tuned) {

    integer N     = (integer)n;
    integer ITOL  = 0; /* scalar tolerances */
    integer IJAC  = 0; /* numerical Jacobian */
    integer MLJAC = N; /* full Jacobian */
    integer MUJAC = N;
    integer IMAS  = 0; /* identity mass matrix */
    integer MLMAS = N;
    integer MUMAS = N;
    integer IOUT  = 1; /* call SOLOUT after every accepted step */
    integer IDID  = 0;
    integer IPAR  = 0;

    integer NMAX = (nmax > 0) ? (integer)nmax : 100000;

    /* Work arrays: LWORK = 4*N*N + 12*N + 20 */
    integer LWORK  = 4 * N * N + 12 * N + 20;
    integer LIWORK = 3 * N + 20;
    doublereal *work  = (doublereal *)calloc((size_t)LWORK,  sizeof(doublereal));
    integer    *iwork = (integer    *)calloc((size_t)LIWORK, sizeof(integer));
    if (!work || !iwork) { free(work); free(iwork); return OUTPUT_ALLOC_FAILED; }

    /* radau5_ does --iwork and --work, so IWORK(k) = iwork[k-1], WORK(k) = work[k-1]. */
    iwork[0] = 1;    /* IWORK(1): Hessenberg form, cheap per decomposition with a reused Jacobian */
    iwork[1] = NMAX; /* IWORK(2): maximal number of steps */
    radau5_jac_growth = 0.;
    if (tuned) {
        /* Measured in misc/mxl-perf against Hairer's defaults. */
        iwork[2] = 10;  /* IWORK(3): Newton iterations (default 7), avoids costly step rejections */
        work[2] = 0.05; /* WORK(3): reuse the Jacobian more often (default 0.001 recomputes nearly every step) */
        work[5] = 1.5;  /* WORK(6): keep the decomposition while the step grows up to 1.5x (default 1.2) */
        radau5_jac_growth = 8.; /* recompute the Jacobian after 8x step growth, see radau5.c */
    }

    doublereal rtol_d   = (doublereal)rtol;
    doublereal atol_d   = (doublereal)atol;
    doublereal h        = (doublereal)h_init; /* RADAU5 applies the direction's sign itself */
    doublereal xend     = (doublereal)t_end;
    doublereal xstart   = (doublereal)t_start;

    /* radau5_ applies --y, --rpar, --work, --iwork internally (f2c param
       adjustments), so pass raw 0-based pointers directly. */
    radau5_(&N, (U_fp)fcn_dispatch, &xstart, y, &xend,
            &h, &rtol_d, &atol_d, &ITOL,
            (U_fp)dummy_jac, &IJAC, &MLJAC, &MUJAC,
            (U_fp)dummy_mas, &IMAS, &MLMAS, &MUMAS,
            (U_fp)solout_dispatch, &IOUT,
            work, &LWORK, iwork, &LIWORK,
            rpar, &IPAR, &IDID);

    free(work);
    free(iwork);
    return (int)IDID;
}

/* The steps every driver shares around its solver call: input checks, the trivial cases, the
 * grid's scratch space, output-buffer failures and clearing the grid. */
static int drive(int (*impl)(int, double, double, double *, double *, double, double, double, int, int),
                 int n, double t_start, double t_end, double *y, double *rpar, double rtol, double atol,
                 double h_init, int nmax, int tuned, int bad_input_code, int success_code) {
    int status;
    if (check_run_input(n, t_start, t_end, y, rtol, atol, h_init)) {
        status = bad_input_code;
    } else if (n == 0 || t_start == t_end) {
        record_trivial_run(t_start, t_end, y);
        status = success_code;
    } else if (grid_t && !(grid_y = (double *)malloc((size_t)n * sizeof(double)))) {
        status = OUTPUT_ALLOC_FAILED;
    } else {
        status = impl(n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, tuned);
    }
    if (output_failed()) status = OUTPUT_ALLOC_FAILED;
    clear_output_grid();
    return status;
}

int run_radau5(int n, double t_start, double t_end,
               double *y, double *rpar,
               double rtol, double atol,
               double h_init, int nmax) {
    return drive(radau5_impl, n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 1, -1, 1);
}

/* Hairer's default Jacobian handling, for the fit drivers: they difference the
 * objective across parameters, and reusing Jacobians makes it too rough for that. */
int run_radau5_fit(int n, double t_start, double t_end,
                   double *y, double *rpar,
                   double rtol, double atol,
                   double h_init, int nmax) {
    return drive(radau5_impl, n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 0, -1, 1);
}

/* ================================================================== */
/* DOP853 / DOPRI5 — explicit Runge-Kutta 8(5,3) and 5(4) by Hairer   */
/* ================================================================== */

extern int dop853_(integer *n, U_fp fcn, doublereal *x, doublereal *y,
                   doublereal *xend, doublereal *rtol, doublereal *atol,
                   integer *itol, U_fp solout, integer *iout,
                   doublereal *work, integer *lwork, integer *iwork,
                   integer *liwork, doublereal *rpar, integer *ipar,
                   integer *idid);
extern int dopri5_(integer *n, U_fp fcn, doublereal *x, doublereal *y,
                   doublereal *xend, doublereal *rtol, doublereal *atol,
                   integer *itol, U_fp solout, integer *iout,
                   doublereal *work, integer *lwork, integer *iwork,
                   integer *liwork, doublereal *rpar, integer *ipar,
                   integer *idid);
extern doublereal contd8_(integer *ii, doublereal *x, doublereal *con, integer *icomp, integer *nd);
extern doublereal contd5_(integer *ii, doublereal *x, doublereal *con, integer *icomp, integer *nd);

typedef struct {
    doublereal (*contd)(integer *, doublereal *, doublereal *, integer *, integer *);
    doublereal *con;
    integer *icomp, *nd;
} DopDense;

static doublereal dop_interp(integer i, doublereal t, void *ctx) {
    DopDense *d = (DopDense *)ctx;
    return d->contd(&i, &t, d->con, d->icomp, d->nd);
}

/* DOP853 SOLOUT: (nr,xold,x,y,n,con,icomp,nd,rpar,ipar,irtrn,xout) */
static int solout_dop853(integer *nr, doublereal *xold, doublereal *x,
                          doublereal *y, integer *n, doublereal *con,
                          integer *icomp, integer *nd,
                          doublereal *rpar, integer *ipar,
                          integer *irtrn, doublereal *xout) {
    (void)xold; (void)rpar; (void)ipar; (void)xout;
    if (grid_t) {
        DopDense d = {contd8_, con, icomp, nd};
        record_grid_until(*nr, *x, y, *n, dop_interp, &d);
    } else {
        record_point(*x, y);
    }
    *irtrn = 1;
    return 0;
}

/* DOPRI5 SOLOUT: (nr,xold,x,y,n,con,icomp,nd,rpar,ipar,irtrn) */
static int solout_dopri5(integer *nr, doublereal *xold, doublereal *x,
                          doublereal *y, integer *n, doublereal *con,
                          integer *icomp, integer *nd,
                          doublereal *rpar, integer *ipar,
                          integer *irtrn) {
    (void)xold; (void)rpar; (void)ipar;
    if (grid_t) {
        DopDense d = {contd5_, con, icomp, nd};
        record_grid_until(*nr, *x, y, *n, dop_interp, &d);
    } else {
        record_point(*x, y);
    }
    *irtrn = 1;
    return 0;
}

/* order 8 → DOP853, 5 → DOPRI5. With a grid, IOUT = 2 asks for dense output of every
 * component (NRDENS = N), which costs DOP853 three extra RHS calls per step but doesn't
 * change the steps. */
static int dop_impl(int n, double t_start, double t_end,
                    double *y, double *rpar,
                    double rtol, double atol,
                    double h_init, int nmax, int order) {
    integer N    = (integer)n;
    integer ITOL = 0;
    integer IOUT = grid_t ? 2 : 1;
    integer IDID = 0;
    integer IPAR = 0;
    integer NRDENS = grid_t ? N : 0;

    /* DOP853: LWORK = 11*N + 8*NRDENS + 21; DOPRI5: 8*N + 5*NRDENS + 21. LIWORK = NRDENS + 21. */
    integer LWORK  = order == 8 ? 11 * N + 8 * NRDENS + 21 : 8 * N + 5 * NRDENS + 21;
    integer LIWORK = NRDENS + 21;
    doublereal *work  = (doublereal *)calloc((size_t)LWORK,  sizeof(doublereal));
    integer    *iwork = (integer    *)calloc((size_t)LIWORK, sizeof(integer));
    if (!work || !iwork) { free(work); free(iwork); return OUTPUT_ALLOC_FAILED; }

    /* dop853_/dopri5_ do --work and --iwork, so WORK(k) = work[k-1]. */
    iwork[0] = (nmax > 0) ? (integer)nmax : 100000; /* IWORK(1): NMAX */
    iwork[3] = -1;                                  /* IWORK(4): suppress stiffness detection */
    iwork[4] = NRDENS;                              /* IWORK(5): components with dense output */
    /* WORK(7): the first step, signed in the direction of integration (the codes take it as
     * given); 0 lets HINIT guess it. */
    work[6] = t_end >= t_start ? h_init : -h_init;

    doublereal rtol_d = (doublereal)rtol;
    doublereal atol_d = (doublereal)atol;
    doublereal xend   = (doublereal)t_end;
    doublereal xstart = (doublereal)t_start;

    if (order == 8) {
        dop853_(&N, (U_fp)fcn_dispatch, &xstart, y, &xend, &rtol_d, &atol_d, &ITOL, (U_fp)solout_dop853, &IOUT,
                work, &LWORK, iwork, &LIWORK, rpar, &IPAR, &IDID);
    } else {
        dopri5_(&N, (U_fp)fcn_dispatch, &xstart, y, &xend, &rtol_d, &atol_d, &ITOL, (U_fp)solout_dopri5, &IOUT,
                work, &LWORK, iwork, &LIWORK, rpar, &IPAR, &IDID);
    }

    free(work);
    free(iwork);
    return (int)IDID;
}

/* Same contract as run_radau5; with set_output_grid the grid times come from the codes' own
 * dense output (CONTD8 / CONTD5). */
int run_dop853(int n, double t_start, double t_end,
               double *y, double *rpar,
               double rtol, double atol,
               double h_init, int nmax) {
    return drive(dop_impl, n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 8, -1, 1);
}

int run_dopri5(int n, double t_start, double t_end,
               double *y, double *rpar,
               double rtol, double atol,
               double h_init, int nmax) {
    return drive(dop_impl, n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 5, -1, 1);
}

/* ================================================================== */
/* LSODA — SciPy's C translation of Hindmarsh's ODEPACK LSODA         */
/* ================================================================== */

/* LSODA's right-hand side takes no parameter array. */
static double *g_lsoda_rpar = NULL;

static void lsoda_dispatch(int *n, double *t, double *y, double *dydt) {
    if (g_model_fn) g_model_fn(*n, *t, y, dydt, g_lsoda_rpar);
}

/* Records the grid times up to t, the end of the step just taken, from LSODA's interpolant. */
static void record_grid_lsoda(double t, const double *y, double *rwork, lsoda_common_struct_t *S) {
    while (grid_i < grid_n && (grid_t[grid_i] - t) * grid_dir <= 0) {
        double tg = grid_t[grid_i++];
        int iflag = 0;
        if (tg == t) {
            record_point(t, y);
        } else {
            lsoda_intdy(tg, 0, rwork, grid_y, &iflag, S);
            record_point(tg, grid_y);
        }
    }
}

static int lsoda_impl(int n, double t_start, double t_end,
                      double *y, double *rpar,
                      double rtol, double atol,
                      double h_init, int nmax, int unused) {
    (void)unused;
    const int NMAX = (nmax > 0) ? nmax : 100000;
    /* Work array sizes as in SciPy's odepack: Adams up to order 12, BDF up to 5,
     * full internal Jacobian (JT = 2). */
    const int lrn = 20 + n * 13 + 3 * n, lrs = 20 + n * 6 + 3 * n + n * n + 2;
    const int lrw = lrn > lrs ? lrn : lrs, liw = 20 + n;
    double *rwork = (double *)calloc((size_t)lrw, sizeof(double));
    int *iwork = (int *)calloc((size_t)liw, sizeof(int));
    if (!rwork || !iwork) {
        free(rwork);
        free(iwork);
        return -9;
    }
    const double dir = t_end >= t_start ? 1.0 : -1.0;
    int istate = 1, iopt = 1, itask;
    rwork[0] = t_end;          /* RWORK(1): TCRIT, LSODA never steps (or evaluates) past t_end */
    rwork[4] = dir * h_init;   /* RWORK(5): first step, signed; 0 = LSODA's own guess */
    iwork[5] = NMAX;           /* IWORK(6): steps allowed per call */
    lsoda_common_struct_t S;
    memset(&S, 0, sizeof S);
    g_lsoda_rpar = rpar;
    double t = t_start;

    /* One step at a time (ITASK = 5), never past TCRIT, with or without a grid: grid times
     * come from LSODA's interpolant over each step, so asking for them doesn't change the
     * steps. A step that no longer moves t (|h| below the spacing of doubles at t, which
     * LSODA only warns about) means a singularity or a non-finite RHS: after LSODA's own
     * count of such warnings (MXHNIL = 10) the run fails with -7 instead of using up nmax. */
    itask = 5;
    if (grid_t) {
        record_grid_lsoda(t, y, rwork, &S);
    } else {
        record_point(t, y);
    }
    while ((t_end - t) * dir > 0 && istate > 0) {
        double tout = t_end;
        lsoda(lsoda_dispatch, n, y, &t, &tout, 1, &rtol, &atol, &itask, &istate, &iopt,
              rwork, lrw, iwork, liw, NULL, 2, &S);
        if (istate < 0) break;
        if (grid_t) {
            record_grid_lsoda(t, y, rwork, &S);
        } else {
            record_point(t, y);
        }
        if (iwork[10] > NMAX) istate = -1; /* IWORK(11): steps so far */
        else if (S.nhnil >= 10) istate = -7;
    }
    if (istate > 0 && iwork[10] > NMAX) istate = -1;

    free(rwork);
    free(iwork);
    return istate < 0 ? istate : 1;
}

/*
 * run_lsoda — same contract as run_radau5. Records every step, or, with
 * set_output_grid, exactly the grid times from LSODA's own interpolant. nmax
 * caps the total number of steps. Like Hairer's solvers it integrates
 * backward when t_end < t_start (the adjoint fit relies on that); a grid is
 * then expected in decreasing order.
 *
 * Returns 1 on success, or LSODA's negative ISTATE: -1 too many steps,
 * -2 too much accuracy requested, -3 bad input, -4 repeated error test
 * failures, -5 repeated convergence failures, -6 an error weight became zero.
 * Returns -7 if the step size became negligible (a singularity, a blow-up or a
 * non-finite RHS) and -9 if allocation fails.
 */
int run_lsoda(int n, double t_start, double t_end,
              double *y, double *rpar,
              double rtol, double atol,
              double h_init, int nmax) {
    return drive(lsoda_impl, n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 0, -3, 1);
}
