/**
 * Kvaerno's 5(4) ESDIRK method: L-stable, stiffly accurate, for stiff ODEs.
 *
 * Seven stages, the first explicit, the others implicit with the same diagonal
 * gamma = 0.26, so one iteration matrix I - h*gamma*J serves every stage of a
 * step. The 5th-order solution is the last stage, the embedded 4th-order one
 * the sixth; their difference is the error estimate. Coefficients from A.
 * Kvaerno, "Singly diagonally implicit Runge-Kutta methods with an explicit
 * first stage", BIT 44 (2004), as in diffrax's Kvaerno5.
 */

import { adaptiveStepper, type ErrorNormStep } from "../adaptive.js";
import type { BaseIntegratorKws, Integration, Model } from "../index.js";
import { approxJacobian, solveLinear } from "./utils.js";

interface IntegratorKws extends BaseIntegratorKws {
  rtol?: number;
  atol?: number;
  /** First step size; 0 picks 1% of the span. */
  hInit?: number;
  hMin?: number;
  hMax?: number;
  /** Newton iterations per stage before the step is rejected. */
  maxIter?: number;
  maxSteps?: number;
}

const GAMMA = 0.26;
/** Strictly lower part of the Butcher tableau, rows for stages 2..7. */
const A_LOWER = [
  [0.26],
  [0.13, 0.8403332099679081],
  [0.22371961478320504, 0.476755323197997, -0.06470895363112615],
  [
    0.16648564323248322, 0.1045001884159172, 0.03631482272098715,
    -0.13090704451073998,
  ],
  [
    0.13855640231268224, 0, -0.04245337201752043, 0.02446657898003141,
    0.6194303907248068,
  ],
  [
    0.13659751177640292, 0, -0.05496908796538376, -0.04118626728321046,
    0.629933048990164, 0.06962479448202728,
  ],
];
/** Stage times c_i (stages 2..7), c_i = sum_j a_ij + gamma. */
const C = [
  0.52, 1.230333209967908, 0.8957659843500759, 0.43639360985864756, 1, 1,
];

/** Kvaerno 5(4) with adaptive step size (see {@link adaptiveStepper}). */
export function kvaerno45(
  model: Model,
  {
    initialValues,
    tStart = 0,
    tEnd,
    pars = [],
    rtol = 1e-6,
    atol = 1e-8,
    hInit = 0,
    hMin = 0,
    hMax = Infinity,
    maxSteps = 10000,
    maxIter = 10,
  }: IntegratorKws,
): Integration {
  const n = initialValues.length;
  const step: ErrorNormStep = (t, y, h) => {
    // One Jacobian and iteration matrix W = I - h*gamma*J per step.
    const J = approxJacobian(model, t, y.slice(), pars);
    const W = J.map((row, i) =>
      row.map((v, j) => (i === j ? 1 : 0) - h * GAMMA * v),
    );
    const k: number[][] = [model(t, y, pars)];
    const stages: number[][] = [y];
    for (let s = 0; s < 6; s++) {
      const ti = t + C[s] * h;
      // Y = base + h*gamma*f(ti, Y), base = y + h * sum_j a_sj k_j
      const base = y.slice();
      for (let j = 0; j <= s; j++) {
        for (let l = 0; l < n; l++) base[l] += h * A_LOWER[s][j] * k[j][l];
      }
      const Y = base.map((b, l) => b + h * GAMMA * k[s][l]);
      let converged = false;
      for (let it = 0; it < maxIter; it++) {
        const f = model(ti, Y, pars);
        const res = Y.map((v, l) => v - base[l] - h * GAMMA * f[l]);
        let dY: number[];
        try {
          dY = solveLinear(W, res);
        } catch {
          return null; // singular iteration matrix: reject, smaller step
        }
        let norm = 0;
        for (let l = 0; l < n; l++) {
          Y[l] -= dY[l];
          const sc = atol + rtol * Math.abs(Y[l]);
          norm += (dY[l] / sc) ** 2;
        }
        norm = Math.sqrt(norm / n);
        if (!Number.isFinite(norm)) return null;
        if (norm < 1e-3) {
          converged = true;
          break;
        }
      }
      if (!converged) return null;
      stages.push(Y);
      k.push(model(ti, Y, pars));
    }
    // Stiffly accurate: the solution is the last stage, the embedded one the sixth.
    return { y: stages[6], yLow: stages[5] };
  };
  return adaptiveStepper(step, {
    name: "Kvaerno45",
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
