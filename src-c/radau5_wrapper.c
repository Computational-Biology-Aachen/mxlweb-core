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

static void record_grid_points(integer nr, double x, const double *y,
                               double *cont, integer *lrc, integer n) {
    while (grid_i < grid_n && grid_t[grid_i] <= x) {
        double t = grid_t[grid_i++];
        /* CONTR5 is only defined from the second SOLOUT call on, and the step
         * endpoint itself is more accurate than the polynomial. */
        if (nr < 2 || t == x) {
            record_point(t, y);
            continue;
        }
        for (integer i = 1; i <= n; i++) {
            grid_y[i - 1] = contr5_(&i, &t, cont, lrc);
        }
        record_point(t, grid_y);
    }
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
        record_grid_points(*nr, *x, y, cont, lrc, *n);
    } else {
        record_point(*x, y);
    }
    *irtrn = 1; /* continue */
    return 0;
}

/* ------------------------------------------------------------------ */
/* Main exported API                                                   */
/* ------------------------------------------------------------------ */
/*
 * run_radau5 — drive RADAU5 for a single segment
 *
 * Parameters (all passed by value from JS via ccall):
 *   n        number of state variables
 *   t_start  integration start time
 *   t_end    integration end time
 *   y        pointer into Emscripten heap (HEAPF64), length n
 *   rpar     pointer into heap (parameters), length npars
 *   rtol     relative tolerance (scalar)
 *   atol     absolute tolerance (scalar)
 *   h_init   initial step size guess (0 → RADAU5 default)
 *   nmax     max steps (0 → 100000)
 *
 * Caller must call init_output(capacity, n) before and free_output() after.
 *
 * Returns IDID:  1 = success,  2 = interrupted by SOLOUT,
 *               -1 = bad input, -2 = too many steps,
 *               -3 = step too small, -4 = singular matrix
 *
 * Before calling: set_model_fn(table_idx) and init_output(nout, n)
 * After calling:  read results via get_out_n / get_out_t / get_out_y
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
    if (!work || !iwork) { free(work); free(iwork); return -1; }

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
    doublereal h        = (h_init != 0.0) ? (doublereal)h_init : 0.0;
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

int run_radau5(int n, double t_start, double t_end,
               double *y, double *rpar,
               double rtol, double atol,
               double h_init, int nmax) {
    if (grid_t) grid_y = (double *)malloc((size_t)n * sizeof(double));
    int idid = radau5_impl(n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 1);
    clear_output_grid();
    return idid;
}

/* Hairer's default Jacobian handling, for the fit drivers: they difference the
 * objective across parameters, and reusing Jacobians makes it too rough for that. */
int run_radau5_fit(int n, double t_start, double t_end,
                   double *y, double *rpar,
                   double rtol, double atol,
                   double h_init, int nmax) {
    return radau5_impl(n, t_start, t_end, y, rpar, rtol, atol, h_init, nmax, 0);
}

/* ================================================================== */
/* DOP853 — explicit Runge-Kutta 8(5,3) by Hairer & Wanner           */
/* ================================================================== */

extern int dop853_(integer *n, U_fp fcn, doublereal *x, doublereal *y,
                   doublereal *xend, doublereal *rtol, doublereal *atol,
                   integer *itol, U_fp solout, integer *iout,
                   doublereal *work, integer *lwork, integer *iwork,
                   integer *liwork, doublereal *rpar, integer *ipar,
                   integer *idid);

/* DOP853 SOLOUT: (nr,xold,x,y,n,con,icomp,nd,rpar,ipar,irtrn,xout) */
static int solout_dop853(integer *nr, doublereal *xold, doublereal *x,
                          doublereal *y, integer *n, doublereal *con,
                          integer *icomp, integer *nd,
                          doublereal *rpar, integer *ipar,
                          integer *irtrn, doublereal *xout) {
    (void)nr; (void)xold; (void)n; (void)con; (void)icomp; (void)nd;
    (void)rpar; (void)ipar; (void)xout;
    record_point(*x, y);
    *irtrn = 1;
    return 0;
}

int run_dop853(int n, double t_start, double t_end,
               double *y, double *rpar,
               double rtol, double atol,
               double h_init, int nmax) {

    integer N    = (integer)n;
    integer ITOL = 0;
    integer IOUT = 1;
    integer IDID = 0;
    integer IPAR = 0;

    /* LWORK = 11*N + 21  (NRDENS=0) */
    integer LWORK  = 11 * N + 21;
    integer LIWORK = 21;
    doublereal *work  = (doublereal *)calloc((size_t)LWORK,  sizeof(doublereal));
    integer    *iwork = (integer    *)calloc((size_t)LIWORK, sizeof(integer));
    if (!work || !iwork) { free(work); free(iwork); return -1; }

    iwork[0] = (nmax > 0) ? (integer)nmax : 100000; /* NMAX */
    iwork[3] = -1; /* suppress stiffness detection */

    doublereal rtol_d = (doublereal)rtol;
    doublereal atol_d = (doublereal)atol;
    doublereal h      = (doublereal)h_init;
    doublereal xend   = (doublereal)t_end;
    doublereal xstart = (doublereal)t_start;

    dop853_(&N, (U_fp)fcn_dispatch, &xstart, y, &xend,
            &rtol_d, &atol_d, &ITOL,
            (U_fp)solout_dop853, &IOUT,
            work, &LWORK, iwork, &LIWORK,
            rpar, &IPAR, &IDID);

    free(work);
    free(iwork);
    return (int)IDID;
}

/* ================================================================== */
/* DOPRI5 — explicit Runge-Kutta 4(5) (Dormand-Prince) by Hairer     */
/* ================================================================== */

extern int dopri5_(integer *n, U_fp fcn, doublereal *x, doublereal *y,
                   doublereal *xend, doublereal *rtol, doublereal *atol,
                   integer *itol, U_fp solout, integer *iout,
                   doublereal *work, integer *lwork, integer *iwork,
                   integer *liwork, doublereal *rpar, integer *ipar,
                   integer *idid);

/* DOPRI5 SOLOUT: (nr,xold,x,y,n,con,icomp,nd,rpar,ipar,irtrn) */
static int solout_dopri5(integer *nr, doublereal *xold, doublereal *x,
                          doublereal *y, integer *n, doublereal *con,
                          integer *icomp, integer *nd,
                          doublereal *rpar, integer *ipar,
                          integer *irtrn) {
    (void)nr; (void)xold; (void)n; (void)con; (void)icomp; (void)nd;
    (void)rpar; (void)ipar;
    record_point(*x, y);
    *irtrn = 1;
    return 0;
}

int run_dopri5(int n, double t_start, double t_end,
               double *y, double *rpar,
               double rtol, double atol,
               double h_init, int nmax) {

    integer N    = (integer)n;
    integer ITOL = 0;
    integer IOUT = 1;
    integer IDID = 0;
    integer IPAR = 0;

    /* LWORK = 8*N + 21  (NRDENS=0) */
    integer LWORK  = 8 * N + 21;
    integer LIWORK = 21;
    doublereal *work  = (doublereal *)calloc((size_t)LWORK,  sizeof(doublereal));
    integer    *iwork = (integer    *)calloc((size_t)LIWORK, sizeof(integer));
    if (!work || !iwork) { free(work); free(iwork); return -1; }

    iwork[0] = (nmax > 0) ? (integer)nmax : 100000; /* NMAX */
    iwork[3] = -1; /* suppress stiffness detection */

    doublereal rtol_d = (doublereal)rtol;
    doublereal atol_d = (doublereal)atol;
    doublereal h      = (doublereal)h_init;
    doublereal xend   = (doublereal)t_end;
    doublereal xstart = (doublereal)t_start;

    dopri5_(&N, (U_fp)fcn_dispatch, &xstart, y, &xend,
            &rtol_d, &atol_d, &ITOL,
            (U_fp)solout_dopri5, &IOUT,
            work, &LWORK, iwork, &LIWORK,
            rpar, &IPAR, &IDID);

    free(work);
    free(iwork);
    return (int)IDID;
}

/* ================================================================== */
/* LSODA — SciPy's C translation of Hindmarsh's ODEPACK LSODA         */
/* ================================================================== */

/* LSODA's right-hand side takes no parameter array. */
static double *g_lsoda_rpar = NULL;

static void lsoda_dispatch(int *n, double *t, double *y, double *dydt) {
    if (g_model_fn) g_model_fn(*n, *t, y, dydt, g_lsoda_rpar);
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
 * Returns -9 if allocation fails.
 */
int run_lsoda(int n, double t_start, double t_end,
              double *y, double *rpar,
              double rtol, double atol,
              double h_init, int nmax) {
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
        clear_output_grid();
        return -9;
    }
    int istate = 1, iopt = 1, itask;
    rwork[4] = h_init; /* RWORK(5): first step size, 0 = LSODA's own guess */
    iwork[5] = NMAX;   /* IWORK(6): steps allowed per call */
    lsoda_common_struct_t S;
    memset(&S, 0, sizeof S);
    g_lsoda_rpar = rpar;
    double t = t_start;
    const double dir = t_end >= t_start ? 1.0 : -1.0;

    if (grid_t) {
        itask = 1; /* integrate past each grid time, then interpolate back */
        for (; grid_i < grid_n && istate > 0; grid_i++) {
            double tout = grid_t[grid_i];
            if ((tout - t_end) * dir > 0) break;
            if ((tout - t) * dir > 0) {
                lsoda(lsoda_dispatch, n, y, &t, &tout, 1, &rtol, &atol, &itask, &istate, &iopt,
                      rwork, lrw, iwork, liw, NULL, 2, &S);
                if (istate < 0) break;
            }
            record_point(tout, y);
        }
        if (istate > 0 && (t_end - t) * dir > 0) {
            /* Finish the segment, so y is the state at t_end. */
            double tout = t_end;
            lsoda(lsoda_dispatch, n, y, &t, &tout, 1, &rtol, &atol, &itask, &istate, &iopt,
                  rwork, lrw, iwork, liw, NULL, 2, &S);
        }
    } else {
        itask = 5;          /* one step at a time, never past t_end */
        rwork[0] = t_end;   /* RWORK(1): TCRIT */
        record_point(t, y);
        while ((t_end - t) * dir > 0 && istate > 0) {
            double tout = t_end;
            lsoda(lsoda_dispatch, n, y, &t, &tout, 1, &rtol, &atol, &itask, &istate, &iopt,
                  rwork, lrw, iwork, liw, NULL, 2, &S);
            if (istate > 0) record_point(t, y);
            if (iwork[10] > NMAX) istate = -1; /* IWORK(11): steps so far */
        }
    }
    if (istate > 0 && iwork[10] > NMAX) istate = -1;

    free(rwork);
    free(iwork);
    clear_output_grid();
    return istate < 0 ? istate : 1;
}
