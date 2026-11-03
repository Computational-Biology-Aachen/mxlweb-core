/**
 * Numeric kernels behind the array nodes (`array.ts`) and the tree evaluator
 * (`evaluate.ts`). Each follows the numpy/scipy function named in its doc
 * comment, so the TypeScript and Python sides of a model or analysis agree.
 *
 * @module
 */

/** `np.sum`. */
export function arraySum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

/** `np.mean`. */
export function arrayMean(xs: readonly number[]): number {
  return arraySum(xs) / xs.length;
}

/** `np.std(xs, ddof=1)`: the sample standard deviation. */
export function arrayStd(xs: readonly number[]): number {
  const m = arrayMean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/** `np.max`. */
export function arrayMax(xs: readonly number[]): number {
  let best = -Infinity;
  for (const x of xs) if (x > best || Number.isNaN(x)) best = x;
  return best;
}

/** `np.min`. */
export function arrayMin(xs: readonly number[]): number {
  let best = Infinity;
  for (const x of xs) if (x < best || Number.isNaN(x)) best = x;
  return best;
}

/** Element `i` of `xs` (0-based; negative counts from the end, as in numpy). */
export function arrayIndex(xs: readonly number[], i: number): number {
  const k = Math.trunc(i);
  const j = k < 0 ? xs.length + k : k;
  if (j < 0 || j >= xs.length) {
    throw new Error(`Index ${i} out of range for length ${xs.length}`);
  }
  return xs[j];
}

/** `xs[start:stop]` (numpy slice semantics, negative bounds count from the end). */
export function arraySlice(
  xs: readonly number[],
  start: number,
  stop: number,
): number[] {
  return xs.slice(Math.trunc(start), Math.trunc(stop));
}

/** Index of the sample of `times` nearest `t` (the first one on a tie, as `np.argmin`). */
export function nearestIndex(times: readonly number[], t: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  }
  return best;
}

function safeDiv(a: number, b: number): number {
  return b !== 0 ? a / b : 0;
}

/**
 * Composite Simpson's rule over the pairs of intervals starting at `0, 2, …`
 * below `stop` (scipy's `_basic_simpson` with explicit, possibly uneven `x`).
 */
function basicSimpson(
  y: readonly number[],
  x: readonly number[],
  stop: number,
): number {
  let total = 0;
  for (let i = 0; i < stop; i += 2) {
    const h0 = x[i + 1] - x[i];
    const h1 = x[i + 2] - x[i + 1];
    const hsum = h0 + h1;
    const hprod = h0 * h1;
    const h0divh1 = safeDiv(h0, h1);
    total +=
      (hsum / 6) *
      (y[i] * (2 - safeDiv(1, h0divh1)) +
        y[i + 1] * (hsum * safeDiv(hsum, hprod)) +
        y[i + 2] * (2 - h0divh1));
  }
  return total;
}

/**
 * `scipy.integrate.simpson(y, x=x)` (SciPy ≥ 1.11): composite Simpson's rule;
 * with an even number of samples, Simpson's rule over all but the last
 * interval plus Cartwright's correction for the last one.
 */
export function simpson(y: readonly number[], x: readonly number[]): number {
  const n = y.length;
  if (x.length !== n) {
    throw new Error(`Simpson: y has ${n} samples but x has ${x.length}`);
  }
  if (n < 2) return 0;
  if (n % 2 === 1) return basicSimpson(y, x, n - 2);
  if (n === 2) return 0.5 * (x[1] - x[0]) * (y[1] + y[0]);
  const h0 = x[n - 2] - x[n - 3];
  const h1 = x[n - 1] - x[n - 2];
  const alpha = safeDiv(2 * h1 ** 2 + 3 * h0 * h1, 6 * (h1 + h0));
  const beta = safeDiv(h1 ** 2 + 3 * h0 * h1, 6 * h0);
  const eta = safeDiv(h1 ** 3, 6 * h0 * (h0 + h1));
  return (
    basicSimpson(y, x, n - 3) +
    alpha * y[n - 1] +
    beta * y[n - 2] -
    eta * y[n - 3]
  );
}
