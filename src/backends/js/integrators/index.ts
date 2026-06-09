/**
 * Core types shared by the pure-JavaScript ODE integrators.
 *
 * An {@link Integrator} advances a {@link Model} (the right-hand side `dy/dt =
 * f(t, y, pars)`) from `tStart` to `tEnd` and returns the sampled trajectory as
 * an {@link Integration}. Concrete methods live under `explicit/` (non-stiff)
 * and `implicit/` (stiff).
 *
 * @module
 */

/**
 * The right-hand side of an ODE system: given the current time `t`, state
 * vector `y` and parameter vector `pars`, returns the derivative `dy/dt`.
 */
export type Model = (
  t: number,
  y: Array<number>,
  pars: Array<number>,
) => Array<number>;

/**
 * The result of an integration: the sampled `time` points and the matching
 * state `values` (`values[i]` is the full state vector at `time[i]`). `err`
 * carries a message if the integration failed or was truncated.
 */
export interface Integration {
  time: number[];
  values: number[][];
  err?: string;
}

/** Options common to every integrator: the initial state, parameter vector and time span. */
export interface BaseIntegratorKws {
  initialValues: Array<number>;
  pars: number[];
  tEnd: number;
  // Optional ones
  tStart?: number;
}

/** A function that integrates a {@link Model} over a time span and returns its {@link Integration}. Specific methods extend {@link BaseIntegratorKws} with their own options (e.g. `stepSize`, tolerances). */
export type Integrator = (
  model: Model,
  options: BaseIntegratorKws,
) => Integration;
