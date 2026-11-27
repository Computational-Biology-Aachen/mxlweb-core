/*
 * nordsieck_tape.h — hooks through which the Nordsieck-array solvers (LSODA in
 * lsoda.c, CVODE in sundials/src/cvode/cvode.c) report every operation on
 * their history array, so discrete_adjoint.c can record the solve and
 * differentiate it backwards. Unset (NULL) hooks cost one branch per
 * operation.
 *
 * The array Z has columns 0..12 (column j = h^j y^(j) / j!), each of length
 * n; acor is the correction of the current step attempt. Every scalar
 * argument (step sizes, coefficients) is a constant of the recorded solve.
 */
#ifndef NORDSIECK_TAPE_H
#define NORDSIECK_TAPE_H

#define NT_MAX_COLS 13

typedef struct NtHooks {
  void *ctx;
  /* Z0 = y (the state the solve starts from), Z1 = h f(t, Z0); all other
   * columns are unset. */
  void (*init)(void *ctx, double t, double h, const double *y);
  /* Z1 = h f(t, Z0); y is Z0. */
  void (*deriv)(void *ctx, double t, double h, const double *y);
  /* Zj *= eta^j for j = 1..q. */
  void (*scale)(void *ctx, int q, double eta);
  /* Z = P Z on columns 0..q, P the Pascal matrix (prediction). */
  void (*predict)(void *ctx, int q);
  /* Z = P^-1 Z on columns 0..q (undoes a prediction). */
  void (*retract)(void *ctx, int q);
  /* The converged correction: acor solves acor + d Z1 - b f(t, Z0 + c acor) = 0,
   * with y = Z0 + c acor. */
  void (*correct)(void *ctx, double t, double d, double b, double c, const double *acor,
                  const double *y);
  /* Zj += coef[j] acor for j = 0..q. */
  void (*update)(void *ctx, int q, const double *coef);
  /* Z[col] = r acor. */
  void (*set_acor)(void *ctx, int col, double r);
  /* Z[col] = 0. */
  void (*set_zero)(void *ctx, int col);
  /* Z[dst] = r Z[src]. */
  void (*set_col)(void *ctx, int dst, int src, double r);
  /* Z[j0 + i] += coef[i] Z[src] for i = 0..count-1. */
  void (*axpy_multi)(void *ctx, int src, int j0, int count, const double *coef);
} NtHooks;

#endif
