/*
 * cvode_wrapper.c — SUNDIALS' CVODE for the browser, built into its own
 * module (static/wasm/cvode.wasm) so sites only download it when a CVODE
 * method is picked. Shares solver_common.c with radau5_wrapper.c, so JS drives
 * it exactly like run_lsoda: set_model_fn, init_output, optionally
 * set_output_grid, run_cvode, then get_out_*.
 *
 * CVODE is vendored from mxl-solvers (sundials/, see VENDORED), © Lawrence
 * Livermore National Security and the SUNDIALS contributors, BSD-3-Clause
 * (SUNDIALS-LICENCE.txt, SUNDIALS-NOTICE.txt).
 */

#include "solver_common.h"
#include <cvode/cvode.h>
#include <float.h>
#include <math.h>
#include <nvector/nvector_serial.h>
#include <sunlinsol/sunlinsol_dense.h>
#include <sunmatrix/sunmatrix_dense.h>
#include <sunnonlinsol/sunnonlinsol_fixedpoint.h>

static int cvode_rhs(sunrealtype t, N_Vector y, N_Vector dydt, void *rpar) {
    int n = (int)N_VGetLength(y);
    double *f = N_VGetArrayPointer(dydt);
    if (!g_model_fn) return -1;
    g_model_fn(n, t, N_VGetArrayPointer(y), f, (double *)rpar);
    for (int i = 0; i < n; i++) {
        if (!isfinite(f[i])) return 1; /* recoverable: CVODE retries with a smaller step */
    }
    return 0;
}

/* run_cvode: the step size became negligible (see there). */
#define CVODE_STALLED (-98)

/* Records the grid times up to t, the end of the step just taken, from CVODE's interpolant. */
static void record_grid_cvode(void *mem, double t, const double *y, N_Vector tmp) {
    while (grid_i < grid_n && (grid_t[grid_i] - t) * grid_dir <= 0) {
        double tg = grid_t[grid_i++];
        if (tg == t) {
            record_point(t, y);
        } else {
            CVodeGetDky(mem, tg, 0, tmp);
            record_point(tg, N_VGetArrayPointer(tmp));
        }
    }
}

/*
 * run_cvode — same contract as run_lsoda in radau5_wrapper.c, plus `adams`:
 * 0 for BDF with Newton iteration and a dense difference-quotient Jacobian
 * (stiff problems), 1 for Adams-Moulton with fixed-point iteration
 * (non-stiff). Records every step, or with set_output_grid exactly the grid
 * times from CVODE's own interpolant. Never steps past t_end, and integrates
 * backward when t_end < t_start. nmax caps the total number of steps (<= 0:
 * 100000). Input is checked like the other drivers' (check_run_input), and
 * t_start == t_end or n == 0 is a no-op.
 *
 * Returns 1 on success, or CVODE's negative flag: -1 too many steps, -2 too
 * much accuracy requested, -3 repeated error test failures, -4 repeated
 * convergence failures, -8 the right-hand side kept failing (non-finite),
 * -22 bad input, ... (see cvode.h). Returns -98 if the step size became
 * negligible (a singularity, or a right-hand side that stays non-finite,
 * which CVODE would otherwise retry with ever smaller steps until nmax), -99
 * if allocation fails.
 */
int run_cvode(int n, double t_start, double t_end,
              double *y, double *rpar,
              double rtol, double atol,
              double h_init, int nmax, int adams) {
    const int NMAX = (nmax > 0) ? nmax : 100000;
    if (check_run_input(n, t_start, t_end, y, rtol, atol, h_init)) {
        clear_output_grid();
        return CV_ILL_INPUT;
    }
    if (n == 0 || t_start == t_end) {
        record_trivial_run(t_start, t_end, y);
        int failed = output_failed();
        clear_output_grid();
        return failed ? -99 : 1;
    }
    SUNContext ctx = NULL;
    if (SUNContext_Create(SUN_COMM_NULL, &ctx) != 0) {
        clear_output_grid();
        return -99;
    }
    N_Vector v = N_VMake_Serial(n, y, ctx); /* works on y in place */
    N_Vector tmp = N_VNew_Serial(n, ctx);
    void *mem = CVodeCreate(adams ? CV_ADAMS : CV_BDF, ctx);
    SUNMatrix A = NULL;
    SUNLinearSolver ls = NULL;
    SUNNonlinearSolver nls = NULL;
    const double dir = t_end >= t_start ? 1.0 : -1.0;
    int flag = (v && tmp && mem) ? CV_SUCCESS : -99;
    if (flag == CV_SUCCESS) flag = CVodeInit(mem, cvode_rhs, t_start, v);
    if (flag == CV_SUCCESS) flag = CVodeSStolerances(mem, rtol, atol);
    if (flag == CV_SUCCESS) flag = CVodeSetUserData(mem, rpar);
    if (flag == CV_SUCCESS) flag = CVodeSetStopTime(mem, t_end);
    if (flag == CV_SUCCESS) flag = CVodeSetMaxNumSteps(mem, NMAX);
    if (flag == CV_SUCCESS && h_init != 0.0) flag = CVodeSetInitStep(mem, dir * h_init);
    if (flag == CV_SUCCESS && adams) {
        nls = SUNNonlinSol_FixedPoint(v, 0, ctx);
        flag = nls ? CVodeSetNonlinearSolver(mem, nls) : -99;
    } else if (flag == CV_SUCCESS) {
        A = SUNDenseMatrix(n, n, ctx);
        ls = A ? SUNLinSol_Dense(v, A, ctx) : NULL;
        flag = ls ? CVodeSetLinearSolver(mem, ls, A) : -99;
    }

    /* One step at a time (CV_ONE_STEP, never past the stop time), with or without a grid, so
     * asking for one doesn't change the steps. A step that no longer moves t is a stall:
     * after 10 such steps (LSODA's MXHNIL) the run fails with -98. */
    double t = t_start;
    int tiny_steps = 0;
    if (flag == CV_SUCCESS) {
        if (grid_t) record_grid_cvode(mem, t, y, tmp);
        else record_point(t, y);
    }
    while (flag >= 0 && (t_end - t) * dir > 0) {
        long int steps = 0;
        CVodeGetNumSteps(mem, &steps);
        if (steps >= NMAX) {
            flag = CV_TOO_MUCH_WORK;
            break;
        }
        flag = CVode(mem, t_end, v, &t, CV_ONE_STEP);
        if (flag < 0) break;
        if (grid_t) record_grid_cvode(mem, t, y, tmp);
        else record_point(t, y);
        double h = 0;
        CVodeGetLastStep(mem, &h);
        if (fabs(h) <= 4 * DBL_EPSILON * fabs(t) && ++tiny_steps >= 10) flag = CVODE_STALLED;
    }
    if (flag >= 0 && output_failed()) flag = -99;

    CVodeFree(&mem);
    SUNNonlinSolFree(nls);
    SUNLinSolFree(ls);
    SUNMatDestroy(A);
    if (tmp) N_VDestroy(tmp);
    N_VDestroy(v);
    SUNContext_Free(&ctx);
    clear_output_grid();
    return flag < 0 ? flag : 1;
}
