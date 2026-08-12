/**
 * Public entry point for `@computational-biology-aachen/mxlweb-core`.
 *
 * Re-exports the model builders ({@link ModelBuilderBase}, the kinetic, ODE, and
 * steady-state builders), the intermediate representation, and the JS integrator
 * types, and
 * defines the message protocol exchanged with the compute web workers
 * ({@link SimulationRequest} / {@link SimulationResult} / {@link SimulationError}).
 *
 * @module
 */

export * from "./modelBuilderBase.js";
export * from "./modelIr.js";
export * from "./kineticModelBuilder.js";
export * from "./odeModelBuilder.js";
export * from "./steadyStateModelBuilder.js";
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

/**
 * Fitting a model's parameters to uploaded data (ADR 0004 in the mxlweb repo)
 * runs entirely inside the WASM backend: `fitWorker.ts` vendors cminpack's
 * `lmdif` alongside the Radau5/DOP853/DOPRI5 integrators (mxlweb-core's
 * `build:wasm`), so the fit's inner loop never crosses the JS↔WASM boundary
 * per trial parameter set. Fitting runs in chunks — call {@link FitChunkRequest}
 * repeatedly and report {@link FitProgress} between chunks — so the caller can
 * show live progress and cancel by simply not requesting the next chunk.
 */
export type FitSolver = "radau5" | "dop853" | "dopri5";

/**
 * One fit target: either a raw state variable or a derived quantity computed
 * by `derivedWat` (see {@link FitInitRequest}). `scale` normalizes this
 * target's residuals (e.g. `max(|data|)` for its column) so targets of very
 * different magnitude (a concentration vs. a flux) contribute comparably to
 * the fit's loss.
 */
export interface FitTarget {
  kind: "state" | "derived";
  /** Index into y[] (kind="state") or derivedWat's output buffer (kind="derived"). */
  index: number;
  scale: number;
}

/**
 * One-time setup for a fit session. Compiles `rhsWat` (and `derivedWat`, if
 * any target has kind="derived") and calls the WASM `fit_init`. Follow with
 * one or more {@link FitChunkRequest}s, then a {@link FitFreeRequest}.
 */
export interface FitInitRequest {
  requestId: string;
  rhsWat: string;
  /** Required iff some target has kind="derived" — see `irToWatDerived`. */
  derivedWat?: string;
  /** Size of derivedWat's output buffer (0 if derivedWat is omitted). */
  nDerived: number;
  y0: number[];
  /** Full parameter vector — fixed values stay put; fitted values (selected
   * by `fitIdx`) are the initial guess. */
  pars: number[];
  /** Indices into `pars` of the parameters being fit. */
  fitIdx: number[];
  /** Per fit parameter: true = fit in log-space (requires pars[fitIdx[i]] > 0
   * — guarantees positivity without a bounded solver; see ADR 0004 §2.4). */
  logFlags: boolean[];
  targets: FitTarget[];
  /** Ascending timestamps, shared across all targets. */
  dataT: number[];
  /** Target-major: dataY[k * dataT.length + j] is target k's value at dataT[j]. */
  dataY: number[];
  /** Integration end time — should cover the last data timestamp. */
  tEnd: number;
  solver: FitSolver;
  rtol: number;
  atol: number;
}

export interface FitInitResult {
  requestId: string;
  ok: boolean;
  error?: string;
}

/**
 * Runs `lmdif` for at most `maxfev` more function evaluations, continuing
 * from wherever the previous chunk left off (a restart, not a true resume —
 * see ADR 0004 §2.7). Send another `FitChunkRequest` while the resulting
 * {@link FitProgress}'s `done` is false to keep going; simply stop sending
 * them to cancel.
 */
export interface FitChunkRequest {
  requestId: string;
  maxfev: number;
}

/**
 * Progress/result from one chunk. `done` is false only when `info` is
 * MINPACK's "maxfev reached" code (5) — every other non-negative value means
 * `lmdif` itself considers the fit finished (converged, degenerate step, or
 * improper input); negative `info` is a fatal error (see `err`).
 */
export interface FitProgress {
  requestId: string;
  info: number;
  nfev: number;
  residualNorm: number;
  params: number[];
  done: boolean;
  err?: SimulationError;
}

export interface FitFreeRequest {
  requestId: string;
}
