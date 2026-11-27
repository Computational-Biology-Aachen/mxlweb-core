/**
 * Runge-Kutta 4(5) Dormand-Prince solver
 * Other names
 * dopri5
 * Dormand--Prince 5(4)
 */

import type { BaseIntegratorKws, Integration, Model } from "../index.js";
import { adaptiveStepper, type ErrorNormStep } from "../adaptive.js";

interface IntegratorKws extends BaseIntegratorKws {
  rtol?: number;
  atol?: number;
  /** First step size; 0 picks 1% of the span. */
  hInit?: number;
  hMin?: number;
  hMax?: number;
  maxSteps?: number;
}

// Dormand-Prince coefficients
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B_HAT = [
  5179 / 57600,
  0,
  7571 / 16695,
  393 / 640,
  -92097 / 339200,
  187 / 2100,
  1 / 40,
];

/**
 * Adaptive Dormand-Prince 5(4). Records every accepted step, ends exactly at
 * `tEnd` (also when `tEnd < tStart`, integrating backward), and returns `err`
 * instead of a truncated trajectory when it runs out of steps or the step size
 * collapses (a singularity or a non-finite right-hand side).
 */
export function rk45(
  model: Model,
  {
    initialValues,
    tEnd,
    pars = [],
    tStart = 0,
    rtol = 1e-6,
    atol = 1e-6,
    hInit = 0,
    hMin = 0,
    hMax = Infinity,
    maxSteps = 10000,
  }: IntegratorKws,
): Integration {
  const n = initialValues.length;
  const step: ErrorNormStep = (t, y, h) => {
    const k: number[][] = Array(7);
    for (let i = 0; i < 7; i++) {
      const yi = y.slice();
      for (let j = 0; j < i; j++) {
        const aij = A[i][j] ?? 0;
        for (let l = 0; l < n; l++) yi[l] += h * aij * k[j][l];
      }
      k[i] = model(t + C[i] * h, yi, pars);
    }
    const y5 = y.slice();
    const y4 = y.slice();
    for (let l = 0; l < n; l++) {
      for (let i = 0; i < 7; i++) {
        y5[l] += h * B[i] * k[i][l];
        y4[l] += h * B_HAT[i] * k[i][l];
      }
    }
    return { y: y5, yLow: y4 };
  };
  return adaptiveStepper(step, {
    name: "RK45",
    initialValues,
    tStart,
    tEnd,
    rtol,
    atol,
    hInit,
    hMin,
    hMax,
    maxSteps,
    order: 4,
  });
}
