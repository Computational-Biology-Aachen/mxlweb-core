/**
 * Public entry point for `@computational-biology-aachen/mxlweb-core`.
 *
 * Re-exports the model builders ({@link ModelBuilderBase}, the kinetic and ODE
 * builders), the intermediate representation, and the JS integrator types, and
 * defines the message protocol exchanged with the compute web workers
 * ({@link SimulationRequest} / {@link SimulationResult} / {@link SimulationError}).
 *
 * @module
 */

export * from "./modelBuilderBase.js";
export * from "./modelIr.js";
export * from "./kineticModelBuilder.js";
export * from "./odeModelBuilder.js";
export * from "./backends/js/integrators/index.js";

/**
 * A request posted to a compute worker to run one simulation.
 *
 * The model is shipped as source strings — `rhsFn` (JS/Python right-hand side)
 * or `rhsWat` (WAT for the native WASM backend) — plus the functions for
 * computing and selecting derived quantities, the initial state, parameters,
 * time span and chosen `method`. An optional `protocol` splits the run into
 * segments whose entries override named parameters (e.g. a changing light
 * intensity); `rtol`/`atol` tune solver tolerances. `requestId` correlates the
 * matching {@link SimulationResult}.
 */
export interface SimulationRequest {
  // Required; don't change!
  requestId: string;
  rhsFn?: string;
  /** WAT module string for native WASM backend (method === 'radau5') */
  rhsWat?: string;
  allDerivedFn: string;
  selectDerivedFn: string;
  initialValues: number[];
  rhsNames: Array<string>;
  allDerivedNames: Array<string>;
  selectDerivedNames: Array<string>;
  tEnd: number;
  nTimePoints: number;
  pars: number[];
  method: string;
  calculateDerived: boolean;
  // Optional
  type?: string;
  parNames?: string[];
  protocol?: Array<{ t_end: number } & Record<string, number>>;
  /** Relative solver tolerance. Defaults per backend if omitted. */
  rtol?: number;
  /** Absolute solver tolerance. Defaults per backend if omitted. */
  atol?: number;
}

/**
 * A user-facing error from a failed simulation: a `message`, actionable `hints`,
 * and — when the failure is a non-finite derivative — the offending `dxdt` and
 * `args` values to aid debugging.
 */
export interface SimulationError {
  message: string;
  hints: Array<string>;
  dxdt?: Array<{ name: string; val: number }>;
  args?: Array<{ name: string; val: number }>;
}

/**
 * The result posted back from a worker: the sampled `time` points and state
 * `values`, the `requestId` of the originating {@link SimulationRequest}, and an
 * `err` if the run failed.
 */
export interface SimulationResult {
  time: number[];
  values: number[][];
  requestId?: string;
  err?: SimulationError;
}
