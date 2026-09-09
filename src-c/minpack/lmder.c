/* Vendored from devernay/cminpack (BSD-like, see COPYRIGHT.txt) — do not hand-edit numerics.
 * lmder is lmdif with one change: the Jacobian comes from the caller's own
 * fcnder_mn(..., iflag=2) instead of fdjac2's forward-difference
 * approximation — every other line of the Levenberg-Marquardt iteration is
 * identical, per MINPACK's own documented relationship between the two
 * (lmdif.c's own header: "the jacobian is calculated by a forward-difference
 * approximation" is the *only* thing lmder replaces). Jacobian evaluations
 * are counted separately (*njev), not folded into *nfev, matching every
 * other lmder implementation (netlib, upstream cminpack).
 */
#include "cminpack.h"
#include <math.h>
#include "cminpackP.h"

__cminpack_attr__
int __cminpack_func__(lmder)(__cminpack_decl_fcnder_mn__ void *p, int m, int n, real *x,
	real *fvec, real *fjac, int ldfjac, real ftol, real xtol, real
	gtol, int maxfev, real *diag, int mode, real factor, int nprint,
	int *nfev, int *njev, int *ipvt, real *qtf, real *wa1, real *wa2,
	real *wa3, real *wa4)
{
    /* Initialized data */

#define p1 ((real).1)
#define p5 ((real).5)
#define p25 ((real).25)
#define p75 .75
#define p0001 1e-4

    /* System generated locals */
    real d1, d2;

    /* Local variables */
    int i, j, l;
    real par, sum;
    int iter;
    real temp, temp1, temp2;
    int iflag;
    real delta = 0.;
    real ratio;
    real fnorm, gnorm;
    real pnorm, xnorm = 0., fnorm1, actred, dirder, epsmch, prered;
    int info;

/*     ********** */

/*     epsmch is the machine precision. */

    epsmch = __cminpack_func__(dpmpar)(1);

    info = 0;
    iflag = 0;
    *nfev = 0;
    *njev = 0;

/*     check the input parameters for errors. */

    if (n <= 0 || m < n || ldfjac < m || ftol < 0. || xtol < 0. ||
	    gtol < 0. || maxfev <= 0 || factor <= 0.) {
	goto TERMINATE;
    }
    if (mode == 2) {
        for (j = 0; j < n; ++j) {
            if (diag[j] <= 0.) {
                goto TERMINATE;
            }
        }
    }

/*     evaluate the function at the starting point */
/*     and calculate its norm. */

    iflag = fcnder_mn(p, m, n, x, fvec, fjac, ldfjac, 1);
    *nfev = 1;
    if (iflag < 0) {
	goto TERMINATE;
    }
    fnorm = __cminpack_func__(enorm)(m, fvec);

/*     initialize levenberg-marquardt parameter and iteration counter. */

    par = 0.;
    iter = 1;

/*     beginning of the outer loop. */

    for (;;) {

/*        calculate the jacobian matrix (analytic, caller-supplied). */

        iflag = fcnder_mn(p, m, n, x, fvec, fjac, ldfjac, 2);
        ++(*njev);
        if (iflag < 0) {
            goto TERMINATE;
        }

/*        if requested, call fcn to enable printing of iterates. */

        if (nprint > 0) {
            iflag = 0;
            if ((iter - 1) % nprint == 0) {
                iflag = fcnder_mn(p, m, n, x, fvec, fjac, ldfjac, 0);
            }
            if (iflag < 0) {
                goto TERMINATE;
            }
        }

/*        compute the qr factorization of the jacobian. */

        __cminpack_func__(qrfac)(m, n, fjac, ldfjac, TRUE_, ipvt, n,
              wa1, wa2, wa3);

/*        on the first iteration and if mode is 1, scale according */
/*        to the norms of the columns of the initial jacobian. */

        if (iter == 1) {
            if (mode != 2) {
                for (j = 0; j < n; ++j) {
                    diag[j] = wa2[j];
                    if (wa2[j] == 0.) {
                        diag[j] = 1.;
                    }
                }
            }

/*        on the first iteration, calculate the norm of the scaled x */
/*        and initialize the step bound delta. */

            for (j = 0; j < n; ++j) {
                wa3[j] = diag[j] * x[j];
            }
            xnorm = __cminpack_func__(enorm)(n, wa3);
            delta = factor * xnorm;
            if (delta == 0.) {
                delta = factor;
            }
        }

/*        form (q transpose)*fvec and store the first n components in */
/*        qtf. */

        for (i = 0; i < m; ++i) {
            wa4[i] = fvec[i];
        }
        for (j = 0; j < n; ++j) {
            if (fjac[j + j * ldfjac] != 0.) {
                sum = 0.;
                for (i = j; i < m; ++i) {
                    sum += fjac[i + j * ldfjac] * wa4[i];
                }
                temp = -sum / fjac[j + j * ldfjac];
                for (i = j; i < m; ++i) {
                    wa4[i] += fjac[i + j * ldfjac] * temp;
                }
            }
            fjac[j + j * ldfjac] = wa1[j];
            qtf[j] = wa4[j];
        }

/*        compute the norm of the scaled gradient. */

        gnorm = 0.;
        if (fnorm != 0.) {
            for (j = 0; j < n; ++j) {
                l = ipvt[j]-1;
                if (wa2[l] != 0.) {
                    sum = 0.;
                    for (i = 0; i <= j; ++i) {
                        sum += fjac[i + j * ldfjac] * (qtf[i] / fnorm);
                    }
                    /* Computing MAX */
                    d1 = fabs(sum / wa2[l]);
                    gnorm = max(gnorm,d1);
                }
            }
        }

/*        test for convergence of the gradient norm. */

        if (gnorm <= gtol) {
            info = 4;
        }
        if (info != 0) {
            goto TERMINATE;
        }

/*        rescale if necessary. */

        if (mode != 2) {
            for (j = 0; j < n; ++j) {
                /* Computing MAX */
                d1 = diag[j], d2 = wa2[j];
                diag[j] = max(d1,d2);
            }
        }

/*        beginning of the inner loop. */

        do {

/*           determine the levenberg-marquardt parameter. */

            __cminpack_func__(lmpar)(n, fjac, ldfjac, ipvt, diag, qtf, delta,
                  &par, wa1, wa2, wa3, wa4);

/*           store the direction p and x + p. calculate the norm of p. */

            for (j = 0; j < n; ++j) {
                wa1[j] = -wa1[j];
                wa2[j] = x[j] + wa1[j];
                wa3[j] = diag[j] * wa1[j];
            }
            pnorm = __cminpack_func__(enorm)(n, wa3);

/*           on the first iteration, adjust the initial step bound. */

            if (iter == 1) {
                delta = min(delta,pnorm);
            }

/*           evaluate the function at x + p and calculate its norm. */

            iflag = fcnder_mn(p, m, n, wa2, wa4, fjac, ldfjac, 1);
            ++(*nfev);
            if (iflag < 0) {
                goto TERMINATE;
            }
            fnorm1 = __cminpack_func__(enorm)(m, wa4);

/*           compute the scaled actual reduction. */

            actred = -1.;
            if (p1 * fnorm1 < fnorm) {
                /* Computing 2nd power */
                d1 = fnorm1 / fnorm;
                actred = 1 - d1 * d1;
            }

/*           compute the scaled predicted reduction and */
/*           the scaled directional derivative. */

            for (j = 0; j < n; ++j) {
                wa3[j] = 0.;
                l = ipvt[j]-1;
                temp = wa1[l];
                for (i = 0; i <= j; ++i) {
                    wa3[i] += fjac[i + j * ldfjac] * temp;
                }
            }
            temp1 = __cminpack_func__(enorm)(n, wa3) / fnorm;
            temp2 = (sqrt(par) * pnorm) / fnorm;
            prered = temp1 * temp1 + temp2 * temp2 / p5;
            dirder = -(temp1 * temp1 + temp2 * temp2);

/*           compute the ratio of the actual to the predicted */
/*           reduction. */

            ratio = 0.;
            if (prered != 0.) {
                ratio = actred / prered;
            }

/*           update the step bound. */

            if (ratio <= p25) {
                if (actred >= 0.) {
                    temp = p5;
                } else {
                    temp = p5 * dirder / (dirder + p5 * actred);
                }
                if (p1 * fnorm1 >= fnorm || temp < p1) {
                    temp = p1;
                }
                /* Computing MIN */
                d1 = pnorm / p1;
                delta = temp * min(delta,d1);
                par /= temp;
            } else {
                if (par == 0. || ratio >= p75) {
                    delta = pnorm / p5;
                    par = p5 * par;
                }
            }

/*           test for successful iteration. */

            if (ratio >= p0001) {

/*           successful iteration. update x, fvec, and their norms. */

                for (j = 0; j < n; ++j) {
                    x[j] = wa2[j];
                    wa2[j] = diag[j] * x[j];
                }
                for (i = 0; i < m; ++i) {
                    fvec[i] = wa4[i];
                }
                xnorm = __cminpack_func__(enorm)(n, wa2);
                fnorm = fnorm1;
                ++iter;
            }

/*           tests for convergence. */

            if (fabs(actred) <= ftol && prered <= ftol && p5 * ratio <= 1.) {
                info = 1;
            }
            if (delta <= xtol * xnorm) {
                info = 2;
            }
            if (fabs(actred) <= ftol && prered <= ftol && p5 * ratio <= 1. && info == 2) {
                info = 3;
            }
            if (info != 0) {
                goto TERMINATE;
            }

/*           tests for termination and stringent tolerances. */

            if (*nfev >= maxfev) {
                info = 5;
            }
            if (fabs(actred) <= epsmch && prered <= epsmch && p5 * ratio <= 1.) {
                info = 6;
            }
            if (delta <= epsmch * xnorm) {
                info = 7;
            }
            if (gnorm <= epsmch) {
                info = 8;
            }
            if (info != 0) {
                goto TERMINATE;
            }

/*           end of the inner loop. repeat if iteration unsuccessful. */

        } while (ratio < p0001);

/*        end of the outer loop. */

    }
TERMINATE:

/*     termination, either normal or user imposed. */

    if (iflag < 0) {
	info = iflag;
    }
    if (nprint > 0) {
	fcnder_mn(p, m, n, x, fvec, fjac, ldfjac, 0);
    }
    return info;

/*     last card of subroutine lmder. */

} /* lmder_ */
