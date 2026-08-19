/**
 * fitWorker.ts — dedicated worker for chunked model-fitting (ADR 0004, mxlweb
 * repo). Separate from wasmWorker.ts: fitting's message lifecycle (one-time
 * init, then repeated chunk/progress round-trips) is fundamentally different
 * from the plain simulation worker's one-shot request/response, and keeping
 * the two apart avoids overloading wasmWorker.ts's protocol.
 *
 * Two backends (ADR 0005): "lm" (ADR 0004's original lmdif driver) and
 * "adjoint" (Adam over the continuous adjoint, adjoint_wrapper.c) — chosen
 * by the caller (`FitInitRequest.backend`) before this worker ever sees the
 * request; this file just dispatches to whichever the request already
 * asked for.
 *
 * Architecture:
 *   1. On __INIT__: load the same Emscripten module as wasmWorker.ts (it
 *      exports both the integrators and fit_wrapper.c's fit_* functions).
 *   2. On FIT_INIT: JIT-compile rhsWat (and derivedWat, if used) into WASM
 *      instances sharing the Emscripten module's memory, register them via
 *      set_model_fn/set_derived_fn, marshal the fit setup into the WASM heap,
 *      and call fit_init. The marshalled arrays are freed immediately after —
 *      fit_init copies everything into its own session state.
 *   3. On FIT_CHUNK: call fit_chunk(maxIterations) and report progress. The
 *      caller drives the loop by sending another FIT_CHUNK while `done` is
 *      false; cancellation is just not sending one.
 *   4. On FIT_FREE: release the WASM-side session and function-table slots.
 */
import type {
  FitChunkRequest,
  FitFreeRequest,
  FitInitRequest,
  FitInitResult,
  FitProgress,
  FitSolver,
  FitStopReason,
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

// Matches fit_wrapper.c's FIT_TARGET_REACHED — negative (so lmdif itself
// treats it as an early-exit signal, see fit_fcn's iflag return) but not a
// real failure, unlike every other negative `info` value.
const FIT_TARGET_REACHED = -2;

// Adam hyperparameters (ADR 0005 §2.4) — deliberately not user-configurable
// anywhere in the wire protocol: mxlweb's audience should never need to
// know an optimizer choice exists. lr=1e-4 matches prior real usage across
// adam/adamw/adabelief in this problem domain; beta1/beta2/eps are the
// standard Adam defaults.
const ADAM_LR = 1e-4;
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;

// Matches adjoint_wrapper.c's ADJOINT_INFO_* constants.
const ADJOINT_INFO_CONVERGED_GRADIENT = 1;
const ADJOINT_INFO_PLATEAU = 2;
const ADJOINT_INFO_TARGET_REACHED = 3;
const ADJOINT_INFO_BUDGET_REACHED = 4;

/**
 * Maps lmdif's raw `info` code to a backend-agnostic {@link FitStopReason}
 * (ADR 0005 §2.5, `index.ts`'s `FitStopReason` doc comment has the full
 * table). Only called once `handleFitChunk` has already established the fit
 * is actually finished (`info !== 5`) — `5` ("this chunk's own maxIterations
 * budget was reached") is *not* a terminal state at the worker level: the
 * overall session budget is tracked client-side (`Fit.svelte`, ADR 0004
 * §2.7), which caps each chunk's `maxIterations` but never reports back
 * "the whole session's budget is now exhausted" through this protocol. So
 * `"budget_reached"` is currently unreachable from the "lm" backend; it's
 * reserved for the "adjoint" backend, which does own a real
 * iterations-exhausted concept within a single session.
 */
function infoToReason(info: number): FitStopReason {
  switch (info) {
    case 1:
    case 3:
      return "converged_residual";
    case 2:
      return "converged_step";
    case 4:
    case 8:
      return "converged_gradient";
    case 6:
    case 7:
      return "plateau";
    case FIT_TARGET_REACHED:
      return "target_reached";
    default:
      return "error"; // 0 (bad input) and any other negative code
  }
}

/**
 * Maps adjoint_wrapper.c's ADJOINT_INFO_* code to a {@link FitStopReason}.
 * `ADJOINT_INFO_BUDGET_REACHED` is deliberately *not* terminal here (mapped
 * to `done: false`, like lmdif's info===5) rather than `"budget_reached"`:
 * it's this *chunk's* own `maxIterations` budget, not a whole-session total
 * — exactly mirroring the "lm" backend's own chunking (the overall session
 * budget is tracked client-side for both backends, ADR 0004 §2.7). An
 * earlier version of this file's doc comment claimed budget_reached was
 * reserved as a genuine session-terminal signal unique to "adjoint" — that
 * was written before this chunking design was worked out in adjoint_
 * wrapper.c and turned out not to hold; both backends behave the same way
 * here.
 */
function adjointInfoToReason(info: number): FitStopReason {
  switch (info) {
    case ADJOINT_INFO_CONVERGED_GRADIENT:
      return "converged_gradient";
    case ADJOINT_INFO_PLATEAU:
      return "plateau";
    case ADJOINT_INFO_TARGET_REACHED:
      return "target_reached";
    default:
      return "error"; // any negative value — a solver failure or allocation error
  }
}

interface FitSession {
  backend: "lm" | "adjoint";
  /** "lm": the forward model_fn. "adjoint": also the forward model_fn (registered via set_forward_model_fn instead of set_model_fn — see handleAdjointInit). */
  primaryFnIdx: number;
  /** "lm": derived_fn, if any target needed one. "adjoint": the adjoint_fn — always present, never null (adjointWat is required for this backend). */
  secondaryFnIdx: number | null;
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
  if (req.backend === "adjoint") {
    await handleAdjointInit(req, mod);
    return;
  }

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
      req.targetResidualNorm ?? -1,
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

  session = {
    backend: "lm",
    primaryFnIdx: modelFnIdx,
    secondaryFnIdx: derivedFnIdx,
    nPars: req.pars.length,
  };
  postInitResult({
    requestId: req.requestId,
    ok: true,
    initialResidualNorm: mod._fit_get_residual_norm(),
  });
}

/**
 * The "adjoint" backend's FIT_INIT path (ADR 0005 §2.3.3/§2.3.4). Compiles
 * `rhsWat` (registered as the *forward* model, `set_forward_model_fn` —
 * distinct from "lm"'s `set_model_fn`, since adjoint_wrapper.c toggles
 * between the forward RHS and its own native adjoint dispatcher across one
 * Adam step, see that file's doc comment) and `adjointWat` (required here,
 * unlike the "lm" path where it's never generated at all). v1-restricted to
 * state-variable targets — see `adjointWat`'s own doc comment on
 * `FitInitRequest`.
 */
async function handleAdjointInit(req: FitInitRequest, mod: EmscriptenModule) {
  if (!req.adjointWat) {
    postInitResult({
      requestId: req.requestId,
      ok: false,
      error: 'backend: "adjoint" requires adjointWat.',
    });
    return;
  }
  if (req.targets.some((t) => t.kind === "derived")) {
    postInitResult({
      requestId: req.requestId,
      ok: false,
      error:
        'The "adjoint" backend only supports state-variable fit targets, not derived quantities — see adjointWat\'s doc comment on FitInitRequest.',
    });
    return;
  }

  const forwardInstance = await compileModel(req.rhsWat, mod, basePath);
  const forwardFn = forwardInstance.exports.fcn as (
    ...args: unknown[]
  ) => void;
  const forwardFnIdx = mod.addFunction(forwardFn, "vidiii");
  mod._set_forward_model_fn(forwardFnIdx);

  const adjointInstance = await compileModel(req.adjointWat, mod, basePath);
  const adjointFn = adjointInstance.exports.fcn as (
    ...args: unknown[]
  ) => void;
  const adjointFnIdx = mod.addFunction(adjointFn, "vidiiiii");
  mod._set_adjoint_fn(adjointFnIdx);

  const ptrs = {
    y0: allocF64(mod, req.y0),
    pars: allocF64(mod, req.pars),
    thetaIdx: allocI32(mod, req.fitIdx),
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
    rc = mod._adjoint_init(
      req.y0.length,
      ptrs.y0,
      req.pars.length,
      ptrs.pars,
      req.fitIdx.length,
      ptrs.thetaIdx,
      req.targets.length,
      ptrs.targetIndex,
      ptrs.targetScale,
      req.dataT.length,
      ptrs.dataT,
      ptrs.dataY,
      req.tEnd,
      SOLVER_ID[req.solver],
      req.rtol,
      req.atol,
      ADAM_LR,
      ADAM_BETA1,
      ADAM_BETA2,
      ADAM_EPS,
      req.targetResidualNorm ?? -1,
      req.gradNormTol ?? -1,
      req.plateau?.patience ?? 0,
      req.plateau?.minDelta ?? 0,
    );
  } finally {
    for (const ptr of Object.values(ptrs)) mod._free(ptr);
  }

  if (rc !== 0) {
    mod.removeFunction(forwardFnIdx);
    mod.removeFunction(adjointFnIdx);
    postInitResult({
      requestId: req.requestId,
      ok: false,
      error: `adjoint_init failed (code ${rc}).`,
    });
    return;
  }

  session = {
    backend: "adjoint",
    primaryFnIdx: forwardFnIdx,
    secondaryFnIdx: adjointFnIdx,
    nPars: req.pars.length,
  };
  postInitResult({
    requestId: req.requestId,
    ok: true,
    initialResidualNorm: mod._adjoint_get_residual_norm(),
  });
}

function handleFitChunk(req: FitChunkRequest, mod: EmscriptenModule) {
  if (!session) {
    const err: SimulationError = {
      message: "fit_chunk called before a successful FIT_INIT",
      hints: [],
    };
    postProgress({
      requestId: req.requestId,
      backend: "lm",
      nfev: 0,
      residualNorm: 0,
      params: [],
      done: true,
      reason: "error",
      err,
    });
    return;
  }

  if (session.backend === "adjoint") {
    handleAdjointChunk(req, mod, session);
    return;
  }

  const info = mod._fit_chunk(req.maxIterations);
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

  // info === 5 ("this chunk's own maxIterations reached") is not a terminal
  // state — see infoToReason's doc comment.
  const done = info !== 5;
  postProgress({
    requestId: req.requestId,
    backend: session.backend,
    nfev: mod._fit_get_nfev(),
    residualNorm: mod._fit_get_residual_norm(),
    params,
    done,
    reason: done ? infoToReason(info) : undefined,
    err:
      info < 0 && info !== FIT_TARGET_REACHED
        ? {
            message: `Fit failed (code ${info}).`,
            hints: ["Check the browser console."],
          }
        : undefined,
  });
}

/** The "adjoint" backend's FIT_CHUNK path — see `adjointInfoToReason`'s doc comment for why `ADJOINT_INFO_BUDGET_REACHED` maps to `done: false`, not a terminal reason. */
function handleAdjointChunk(
  req: FitChunkRequest,
  mod: EmscriptenModule,
  s: FitSession,
) {
  const info = mod._adjoint_chunk(req.maxIterations);
  const outPtr = mod._malloc(s.nPars * 8);
  let params: number[];
  try {
    mod._adjoint_get_params(outPtr);
    params = Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + s.nPars));
  } finally {
    mod._free(outPtr);
  }

  const done = info !== ADJOINT_INFO_BUDGET_REACHED;
  postProgress({
    requestId: req.requestId,
    backend: "adjoint",
    nfev: mod._adjoint_get_steps(),
    residualNorm: mod._adjoint_get_residual_norm(),
    gradNorm: mod._adjoint_get_grad_norm(),
    params,
    done,
    reason: done ? adjointInfoToReason(info) : undefined,
    err:
      info < 0
        ? {
            message: `Adjoint fit failed (code ${info}).`,
            hints: ["Check the browser console."],
          }
        : undefined,
  });
}

function handleFitFree(req: FitFreeRequest, mod: EmscriptenModule) {
  if (session?.backend === "adjoint") {
    mod._adjoint_free();
  } else {
    mod._fit_free();
  }
  if (session) {
    mod.removeFunction(session.primaryFnIdx);
    if (session.secondaryFnIdx !== null) mod.removeFunction(session.secondaryFnIdx);
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
        backend: session?.backend ?? "lm",
        nfev: 0,
        residualNorm: 0,
        params: [],
        done: true,
        reason: "error",
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
