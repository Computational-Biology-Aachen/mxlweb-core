/**
 * The adaptive step-size loop shared by the embedded Runge-Kutta pairs
 * (rk45, kvaerno45): error control, step-size selection, direction of
 * integration and failure reporting. Each method only supplies one step.
 */
import type { Integration } from "./index.js";

/**
 * One step of size `h` (signed: negative integrates backward) from `(t, y)`:
 * the solution `y` and the embedded lower-order solution `yLow` whose
 * difference estimates the error, or `null` if the step failed outright (e.g. a
 * Newton iteration that didn't converge), which the loop treats as a rejected
 * step.
 */
export type ErrorNormStep = (
  t: number,
  y: number[],
  h: number,
) => { y: number[]; yLow: number[] } | null;

export interface AdaptiveOptions {
  /** Shown in error messages. */
  name: string;
  initialValues: number[];
  tStart: number;
  tEnd: number;
  rtol: number;
  atol: number;
  /** First step size, 0 = 1% of the span. */
  hInit: number;
  hMin: number;
  hMax: number;
  maxSteps: number;
  /** Order of the embedded (lower-order) solution: the error scales as h^(order + 1). */
  order: number;
}

const SAFETY = 0.9;
const MIN_FACTOR = 0.2;
const MAX_FACTOR = 5;

/**
 * Runs `step` from tStart to tEnd. Every accepted step is recorded; the last
 * step is shortened to land on tEnd exactly. A step whose error estimate isn't
 * finite (a NaN or Inf right-hand side) is rejected and the step size cut by
 * 10, so a solution that can't be continued fails with `err` once the step
 * size is negligible, instead of looping until maxSteps or returning NaN.
 */
export function adaptiveStepper(
  step: ErrorNormStep,
  o: AdaptiveOptions,
): Integration {
  const time = [o.tStart];
  const values = [o.initialValues.slice()];
  const fail = (msg: string): Integration => ({
    time,
    values,
    err: `${o.name}: ${msg}`,
  });
  if (
    !Number.isFinite(o.tStart) ||
    !Number.isFinite(o.tEnd) ||
    !o.initialValues.every(Number.isFinite)
  ) {
    return fail("the time span and initial values must be finite");
  }
  const n = o.initialValues.length;
  const span = Math.abs(o.tEnd - o.tStart);
  if (span === 0 || n === 0) {
    if (span !== 0) {
      time.push(o.tEnd);
      values.push([]);
    }
    return { time, values };
  }
  const dir = o.tEnd > o.tStart ? 1 : -1;
  let h = Math.min(o.hInit > 0 ? o.hInit : 0.01 * span, span, o.hMax);
  let t = o.tStart;
  let y = o.initialValues.slice();
  let rejected = false;

  for (let steps = 0; dir * (o.tEnd - t) > 0;) {
    if (steps >= o.maxSteps) {
      return fail(`maximum number of steps (${o.maxSteps}) reached at t=${t}`);
    }
    if (h <= 10 * Number.EPSILON * Math.max(Math.abs(t), 1) || h < o.hMin) {
      return fail(`step size became negligible at t=${t}`);
    }
    const remaining = Math.abs(o.tEnd - t);
    const last = h >= remaining;
    if (last) h = remaining;

    const res = step(t, y, dir * h);
    let errNorm = Infinity;
    if (res) {
      errNorm = 0;
      for (let l = 0; l < n; l++) {
        const sc =
          o.atol + o.rtol * Math.max(Math.abs(y[l]), Math.abs(res.y[l]));
        errNorm += ((res.y[l] - res.yLow[l]) / sc) ** 2;
      }
      errNorm = Math.sqrt(errNorm / n);
    }

    if (!Number.isFinite(errNorm)) {
      // NaN / Inf, or a failed step: shrink hard and retry.
      h *= 0.1;
      rejected = true;
      continue;
    }
    if (errNorm <= 1 && res) {
      steps++;
      t = last ? o.tEnd : t + dir * h;
      y = res.y;
      time.push(t);
      values.push(y.slice());
    }
    let factor =
      errNorm === 0
        ? MAX_FACTOR
        : SAFETY * Math.pow(1 / errNorm, 1 / (o.order + 1));
    factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
    // Don't grow right after a rejection (Hairer & Wanner).
    if (errNorm > 1 || rejected) factor = Math.min(factor, 1);
    rejected = errNorm > 1;
    h = Math.min(o.hMax, h * factor);
  }
  return { time, values };
}
