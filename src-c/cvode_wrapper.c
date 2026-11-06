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

/* Gives up with CV_TOO_MUCH_WORK once nmax steps are taken in total. */
static int step_budget(void *mem, int nmax) {
    long int steps = 0;
    CVodeGetNumSteps(mem, &steps);
    if (steps >= nmax) return CV_TOO_MUCH_WORK;
    return CVodeSetMaxNumSteps(mem, nmax - steps);
}

/*
 * run_cvode — same contract as run_lsoda in radau5_wrapper.c, plus `adams`:
 * 0 for BDF with Newton iteration and a dense difference-quotient Jacobian
 * (stiff problems), 1 for Adams-Moulton with fixed-point iteration
 * (non-stiff). Records every step, or with set_output_grid exactly the grid
 * times from CVODE's own interpolant. Never steps past t_end, and integrates
 * backward when t_end < t_start. nmax caps the total number of steps.
 *
 * Returns 1 on success, or CVODE's negative flag: -1 too many steps, -2 too
 * much accuracy requested, -3 repeated error test failures, -4 repeated
 * convergence failures, -8 the right-hand side kept failing (non-finite),
 * -22 bad input, ... (see cvode.h). Returns -99 if allocation fails.
 */
int run_cvode(int n, double t_start, double t_end,
              double *y, double *rpar,
              double rtol, double atol,
              double h_init, int nmax, int adams) {
    const int NMAX = (nmax > 0) ? nmax : 100000;
    SUNContext ctx = NULL;
    if (SUNContext_Create(SUN_COMM_NULL, &ctx) != 0) {
        clear_output_grid();
        return -99;
    }
    N_Vector v = N_VMake_Serial(n, y, ctx); /* works on y in place */
    void *mem = CVodeCreate(adams ? CV_ADAMS : CV_BDF, ctx);
    SUNMatrix A = NULL;
    SUNLinearSolver ls = NULL;
    SUNNonlinearSolver nls = NULL;
    int flag = (v && mem) ? CV_SUCCESS : -99;
    if (flag == CV_SUCCESS) flag = CVodeInit(mem, cvode_rhs, t_start, v);
    if (flag == CV_SUCCESS) flag = CVodeSStolerances(mem, rtol, atol);
    if (flag == CV_SUCCESS) flag = CVodeSetUserData(mem, rpar);
    if (flag == CV_SUCCESS) flag = CVodeSetStopTime(mem, t_end);
    if (flag == CV_SUCCESS && h_init != 0.0) flag = CVodeSetInitStep(mem, h_init);
    if (flag == CV_SUCCESS && adams) {
        nls = SUNNonlinSol_FixedPoint(v, 0, ctx);
        flag = nls ? CVodeSetNonlinearSolver(mem, nls) : -99;
    } else if (flag == CV_SUCCESS) {
        A = SUNDenseMatrix(n, n, ctx);
        ls = A ? SUNLinSol_Dense(v, A, ctx) : NULL;
        flag = ls ? CVodeSetLinearSolver(mem, ls, A) : -99;
    }

    const double dir = t_end >= t_start ? 1.0 : -1.0;
    double t = t_start;
    if (flag == CV_SUCCESS && grid_t) {
        for (; grid_i < grid_n && flag >= 0; grid_i++) {
            double tout = grid_t[grid_i];
            if ((tout - t_end) * dir > 0) break;
            if ((tout - t) * dir > 0) {
                flag = step_budget(mem, NMAX);
                if (flag >= 0) flag = CVode(mem, tout, v, &t, CV_NORMAL);
                if (flag < 0) break;
            }
            record_point(tout, y);
        }
        if (flag >= 0 && (t_end - t) * dir > 0) {
            /* Finish the segment, so y is the state at t_end. */
            flag = step_budget(mem, NMAX);
            if (flag >= 0) flag = CVode(mem, t_end, v, &t, CV_NORMAL);
        }
    } else if (flag == CV_SUCCESS) {
        record_point(t, y);
        while ((t_end - t) * dir > 0 && flag >= 0) {
            flag = step_budget(mem, NMAX);
            if (flag >= 0) flag = CVode(mem, t_end, v, &t, CV_ONE_STEP);
            if (flag >= 0) record_point(t, y);
        }
    }

    CVodeFree(&mem);
    SUNNonlinSolFree(nls);
    SUNLinSolFree(ls);
    SUNMatDestroy(A);
    N_VDestroy(v);
    SUNContext_Free(&ctx);
    clear_output_grid();
    return flag < 0 ? flag : 1;
}
