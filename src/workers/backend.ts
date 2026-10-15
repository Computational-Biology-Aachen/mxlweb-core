import type { ModelBuilderBase } from "../modelBuilderBase.js";
import type { WorkerPool } from "./workerPool.js";

export type BuildOpts = {
  userParameters?: string[];
  derivedSelection?: string[];
};

export type BackendRequest = {
  rhsFn?: string;
  rhsWat?: string;
  allDerivedFn: string;
  selectDerivedFn: string;
  pars: number[];
  parNames?: string[];
  method: string;
};

/** One compute backend (a worker pool plus how to build its requests) —
 * defined per site, since which backends a site ships (js/py/wasm) differs. */
export interface SimulationBackend {
  id: string;
  label: string;
  method: string;
  getPool(): WorkerPool;
  buildRequest(model: ModelBuilderBase, opts: BuildOpts): BackendRequest;
}
