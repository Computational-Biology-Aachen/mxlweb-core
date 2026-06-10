// Euler's method, first order

import type { BaseIntegratorKws, Integration, Model } from "../index.js";

/** Euler options: the base integrator options plus a fixed `stepSize`. */
interface IntegratorKws extends BaseIntegratorKws {
  stepSize: number;
}

/**
 * The forward (explicit) Euler method: a first-order, fixed-step integrator,
 * `y_{n+1} = y_n + h · f(t_n, y_n)`. Simple and cheap but low-accuracy and only
 * conditionally stable — mainly useful for teaching and bootstrapping.
 */
export function euler(
  rhs: Model,
  { initialValues, tStart = 0, tEnd, stepSize, pars = [] }: IntegratorKws,
): Integration {
  const n = Math.ceil((tEnd - tStart) / stepSize) + 1;
  const values: Array<Array<number>> = Array(n);
  const time: Array<number> = Array.from(
    Array(n),
    (_, k) => k * stepSize + tStart,
  );

  values[0] = initialValues;
  for (let i = 0; i < n - 1; i++) {
    values[i + 1] = values[i].map(
      (val, idx) => val + rhs(time[i], values[i], pars)[idx] * stepSize,
    );
  }
  return { time, values };
}
