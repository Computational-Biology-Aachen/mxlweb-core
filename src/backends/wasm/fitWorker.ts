/**
 * fitWorker.ts — dedicated worker for chunked model-fitting (ADR 0004, mxlweb
 * repo). Separate from wasmWorker.ts: fitting's message lifecycle (one-time
 * init, then repeated chunk/progress round-trips) is fundamentally different
 * from the plain simulation worker's one-shot request/response, and keeping
 * the two apart avoids overloading wasmWorker.ts's protocol.
 *
 * Architecture:
 *   1. On __INIT__: load the same Emscripten module as wasmWorker.ts (it
 *      exports both the integrators and fit_wrapper.c's fit_* functions).
 *   2. On FIT_INIT: JIT-compile rhsWat (and derivedWat, if used) into WASM
 *      instances sharing the Emscripten module's memory, register them via
 *      set_model_fn/set_derived_fn, marshal the fit setup into the WASM heap,
 *      and call fit_init. The marshalled arrays are freed immediately after —
 *      fit_init copies everything into its own session state.
 *   3. On FIT_CHUNK: call fit_chunk(maxfev) and report progress. The caller
 *      drives the loop by sending another FIT_CHUNK while `done` is false;
 *      cancellation is just not sending one.
 *   4. On FIT_FREE: release the WASM-side session and function-table slots.
 */
import type {
  FitChunkRequest,
  FitFreeRequest,
  FitInitRequest,
  FitInitResult,
  FitProgress,
  FitSolver,
  SimulationError,
} from "../../index.js";
import {
  compileModel,
  loadRadau,
  type EmscriptenModule,
} from "./wasmLoader.js";
export {}; // make it a module

let basePath = "";
let radauPromise: Promise<EmscriptenModule> | null = null;

// Every outgoing message carries an explicit `type` — fitStore.ts (mxlweb)
// dispatches on it rather than guessing from field presence. A previous
// version routed by "does this have an `info` field", which mis-routed
// handleFitFree's bare acknowledgment (no `info`, no `ok`) to the init
// handler, clobbering an already-successful fit's result.
function postInitResult(result: FitInitResult) {
  postMessage({ type: "FIT_INIT_RESULT", ...result });
}
function postProgress(progress: FitProgress) {
  postMessage({ type: "FIT_PROGRESS", ...progress });
}

const SOLVER_ID: Record<FitSolver, number> = {
  radau5: 0,
  dop853: 1,
  dopri5: 2,
};

interface FitSession {
  modelFnIdx: number;
  derivedFnIdx: number | null;
  nPars: number;
}
let session: FitSession | null = null;

function allocF64(mod: EmscriptenModule, values: number[]): number {
  const ptr = mod._malloc(Math.max(values.length, 1) * 8);
  mod.HEAPF64.set(values, ptr / 8);
  return ptr;
}

function allocI32(mod: EmscriptenModule, values: number[]): number {
  const ptr = mod._malloc(Math.max(values.length, 1) * 4);
  mod.HEAP32.set(values, ptr / 4);
  return ptr;
}

function fitInitError(rc: number): string {
  switch (rc) {
    case -1:
      return "Out of memory setting up the fit.";
    case -2:
      return 'A parameter marked "fit in log-space" has a non-positive initial value.';
    default:
      return `fit_init failed (code ${rc}).`;
  }
}

async function handleFitInit(req: FitInitRequest, mod: EmscriptenModule) {
  const modelInstance = await compileModel(req.rhsWat, mod, basePath);
  const modelFn = modelInstance.exports.fcn as (...args: unknown[]) => void;
  const modelFnIdx = mod.addFunction(modelFn, "vidiii");
  mod._set_model_fn(modelFnIdx);

  let derivedFnIdx: number | null = null;
  if (req.derivedWat) {
    const derivedInstance = await compileModel(req.derivedWat, mod, basePath);
    const derivedFn = derivedInstance.exports.fcn as (
      ...args: unknown[]
    ) => void;
    derivedFnIdx = mod.addFunction(derivedFn, "vidiii");
    mod._set_derived_fn(derivedFnIdx);
  }

  const nPoints = req.dataT.length;
  const ptrs = {
    y0: allocF64(mod, req.y0),
    pars: allocF64(mod, req.pars),
    fitIdx: allocI32(mod, req.fitIdx),
    logFlags: allocI32(
      mod,
      req.logFlags.map((b) => (b ? 1 : 0)),
    ),
    targetKind: allocI32(
      mod,
      req.targets.map((t) => (t.kind === "derived" ? 1 : 0)),
    ),
    targetIndex: allocI32(
      mod,
      req.targets.map((t) => t.index),
    ),
    targetScale: allocF64(
      mod,
      req.targets.map((t) => t.scale),
    ),
    dataT: allocF64(mod, req.dataT),
    dataY: allocF64(mod, req.dataY),
  };

  let rc: number;
  try {
    rc = mod._fit_init(
      req.y0.length,
      ptrs.y0,
      req.pars.length,
      ptrs.pars,
      req.fitIdx.length,
      ptrs.fitIdx,
      ptrs.logFlags,
      req.targets.length,
      ptrs.targetKind,
      ptrs.targetIndex,
      ptrs.targetScale,
      nPoints,
      ptrs.dataT,
      ptrs.dataY,
      req.tEnd,
      req.nDerived,
      SOLVER_ID[req.solver],
      req.rtol,
      req.atol,
    );
  } finally {
    for (const ptr of Object.values(ptrs)) mod._free(ptr);
  }

  if (rc !== 0) {
    mod.removeFunction(modelFnIdx);
    if (derivedFnIdx !== null) mod.removeFunction(derivedFnIdx);
    postInitResult({
      requestId: req.requestId,
      ok: false,
      error: fitInitError(rc),
    });
    return;
  }

  session = { modelFnIdx, derivedFnIdx, nPars: req.pars.length };
  postInitResult({ requestId: req.requestId, ok: true });
}

function handleFitChunk(req: FitChunkRequest, mod: EmscriptenModule) {
  if (!session) {
    const err: SimulationError = {
      message: "fit_chunk called before a successful FIT_INIT",
      hints: [],
    };
    postProgress({
      requestId: req.requestId,
      info: -1,
      nfev: 0,
      residualNorm: 0,
      params: [],
      done: true,
      err,
    });
    return;
  }

  const info = mod._fit_chunk(req.maxfev);
  const outPtr = mod._malloc(session.nPars * 8);
  let params: number[];
  try {
    mod._fit_get_params(outPtr);
    params = Array.from(
      mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + session.nPars),
    );
  } finally {
    mod._free(outPtr);
  }

  postProgress({
    requestId: req.requestId,
    info,
    nfev: mod._fit_get_nfev(),
    residualNorm: mod._fit_get_residual_norm(),
    params,
    done: info !== 5,
    err:
      info < 0
        ? {
            message: `Fit failed (code ${info}).`,
            hints: ["Check the browser console."],
          }
        : undefined,
  });
}

function handleFitFree(req: FitFreeRequest, mod: EmscriptenModule) {
  mod._fit_free();
  if (session) {
    mod.removeFunction(session.modelFnIdx);
    if (session.derivedFnIdx !== null) mod.removeFunction(session.derivedFnIdx);
    session = null;
  }
  postMessage({ type: "FIT_FREE_RESULT", requestId: req.requestId });
}

onmessage = async function (event: MessageEvent) {
  if (event.data.type === "__INIT__") {
    basePath = event.data.basePath || "";
    radauPromise = loadRadau(basePath);
    return;
  }

  // Reports a fatal error in the shape the sender expects (FitInitResult for
  // FIT_INIT, FitProgress for FIT_CHUNK/FIT_FREE) — a generic {err} shape
  // would be indistinguishable from FitInitResult to fitStore.ts's routing
  // (neither has an `info` field), silently swallowing the real message.
  function reportFatal(message: string) {
    if (event.data.type === "FIT_INIT") {
      postInitResult({
        requestId: event.data.requestId,
        ok: false,
        error: message,
      });
    } else {
      postProgress({
        requestId: event.data.requestId,
        info: -1,
        nfev: 0,
        residualNorm: 0,
        params: [],
        done: true,
        err: { message, hints: ["Check the browser console for details"] },
      });
    }
  }

  const mod = await radauPromise;
  if (!mod) {
    reportFatal(
      "RADAU5 WASM module not loaded — static/wasm/radau5.js and radau5.wasm must be present (run npm run build:wasm). Check the browser console for fetch errors.",
    );
    return;
  }

  try {
    switch (event.data.type) {
      case "FIT_INIT":
        await handleFitInit(event.data as FitInitRequest, mod);
        break;
      case "FIT_CHUNK":
        handleFitChunk(event.data as FitChunkRequest, mod);
        break;
      case "FIT_FREE":
        handleFitFree(event.data as FitFreeRequest, mod);
        break;
      default:
        break;
    }
  } catch (e) {
    reportFatal(e instanceof Error ? e.message : String(e));
  }
};
