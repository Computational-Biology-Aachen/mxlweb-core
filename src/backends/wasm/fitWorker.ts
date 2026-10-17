/**
 * fitWorker.ts — dedicated worker for chunked model-fitting (ADR 0004, mxlweb
 * repo). Separate from wasmWorker.ts: fitting's message lifecycle (one-time
 * init, then repeated chunk/progress round-trips) is fundamentally different
 * from the plain simulation worker's one-shot request/response, and keeping
 * the two apart avoids overloading wasmWorker.ts's protocol.
 *
 * Three drivers (ADR 0005): "lm" (ADR 0004's original lmdif driver), its
 * analytic-Jacobian lmder variant (jacobian_wrapper.c) and "adjoint" (Adam
 * over the continuous adjoint, adjoint_wrapper.c) — all over the same
 * experiment layout (ADR 0009), chosen
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
  DEFAULT_SS_T_MAX,
  DEFAULT_SS_TOL,
  flattenExperiments,
} from "./fitExperiments.js";
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

// Mid-chunk progress (ADR 0005 §2.5, `FitInitRequest.progressUpdateInterval`'s
// doc comment) — a single JS callback shared across all three C drivers
// (fit_wrapper.c/jacobian_wrapper.c/adjoint_wrapper.c each get their own
// `*_set_progress_fn`, but the same registered table index), registered
// once per worker lifetime the first time `mod` loads, not per fit session:
// it's stateless itself, just reads whatever `session`/`currentChunkRequestId`
// currently are at call time. `currentChunkRequestId` is set right before
// each `_fit_chunk`/`_jacobian_chunk`/`_adjoint_chunk` call and read back
// inside the callback, which fires *synchronously* from within that
// (blocking, from JS's perspective) WASM call — calling back into other
// exported WASM functions (`_fit_get_params` etc.) from here is safe, the
// same reentrant JS<->WASM pattern `previewTrajectory` already relies on
// one layer up, just one layer deeper here.
let progressFnIdx: number | null = null;
let currentChunkRequestId: string | null = null;

function registerProgressFn(mod: EmscriptenModule) {
  if (progressFnIdx !== null) return;
  const onIntermediateProgress = (...args: unknown[]) => {
    const n = args[0] as number;
    const residualNorm = args[1] as number;
    if (!session || currentChunkRequestId === null) return;
    const outPtr = mod._malloc(session.nPars * 8);
    let params: number[];
    try {
      if (session.backend === "adjoint") mod._adjoint_get_params(outPtr);
      else if (session.backend === "lm-jacobian")
        mod._jacobian_get_params(outPtr);
      else mod._fit_get_params(outPtr);
      params = Array.from(
        mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + session.nPars),
      );
    } finally {
      mod._free(outPtr);
    }
    postProgress({
      requestId: currentChunkRequestId,
      backend: session.backend === "adjoint" ? "adjoint" : "lm",
      nfev: n,
      residualNorm,
      params,
      done: false,
      intermediate: true,
    });
  };
  progressFnIdx = mod.addFunction(onIntermediateProgress, "vid");
  mod._fit_set_progress_fn(progressFnIdx);
  mod._jacobian_set_progress_fn(progressFnIdx);
  mod._adjoint_set_progress_fn(progressFnIdx);
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
  /** "lm-jacobian" is an internal-only variant of "lm" (jacobian_wrapper.c's
   * analytic-Jacobian lmder path) — reported to the caller as plain "lm"
   * (see `FitInitRequest.jacobianWat`'s doc comment), distinguished here
   * only so handleFitChunk/handleFitFree call the right exported C
   * functions. */
  backend: "lm" | "lm-jacobian" | "adjoint";
  /** Every function-table slot this session registered (rhs, derived,
   * derived gradients, augmented/adjoint RHS), released on FIT_FREE. */
  fnIdxs: number[];
  nPars: number;
  /** Length of `FitProgress.predictions`. */
  nPredictions: number;
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
    case -3:
      return "Inconsistent fit data: time-course data extends past the protocol's last segment.";
    case -4:
      return "A fitted parameter is also set by the protocol/conditions — the gradient backends can't differentiate through that.";
    case -5:
      return "Derived fit targets need derivedWat and derivedGradWat.";
    case -6:
      return "The initial adjoint forward/backward solve failed.";
    default:
      return `fit_init failed (code ${rc}).`;
  }
}

function readPredictions(
  mod: EmscriptenModule,
  s: FitSession,
): number[] | undefined {
  const outPtr = mod._malloc(Math.max(s.nPredictions, 1) * 8);
  try {
    const rc =
      s.backend === "adjoint"
        ? mod._adjoint_get_predictions(outPtr)
        : s.backend === "lm-jacobian"
          ? mod._jacobian_get_predictions(outPtr)
          : mod._fit_get_predictions(outPtr);
    if (rc !== 0) return undefined;
    return Array.from(
      mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + s.nPredictions),
    );
  } finally {
    mod._free(outPtr);
  }
}

async function compileFn(
  mod: EmscriptenModule,
  wat: string,
  sig: string,
): Promise<number> {
  const instance = await compileModel(wat, mod, basePath);
  return mod.addFunction(
    instance.exports.fcn as (...args: unknown[]) => void,
    sig,
  );
}

type Flat = Exclude<ReturnType<typeof flattenExperiments>, string>;

/** The argument groups every `*_init` shares, as heap pointers (freed after
 * `call` returns — each init copies everything into its own session). */
type InitArgs = {
  /** nY, y0, nPars, pars, nFit, fitIdx */
  head: [number, number, number, number, number, number];
  logFlags: number;
  /** nTargets, targetKind, targetIndex, targetScale */
  targets: [number, number, number, number];
  /** nOvr ... ssTMax (fit_init's experiment, derived and solver block) */
  experiments: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
};

function withInitArgs(
  mod: EmscriptenModule,
  req: FitInitRequest,
  flat: Flat,
  call: (a: InitArgs) => number,
): number {
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
    ovrIdx: allocI32(mod, flat.ovrIdx),
    expKind: allocI32(mod, flat.expKind),
    expNSeg: allocI32(mod, flat.expNSeg),
    expNPoints: allocI32(mod, flat.expNPoints),
    segTEnd: allocF64(mod, flat.segTEnd),
    segOvr: allocF64(mod, flat.segOvr),
    dataT: allocF64(mod, flat.dataT),
    dataY: allocF64(mod, flat.dataY),
  };
  try {
    return call({
      head: [
        req.y0.length,
        ptrs.y0,
        req.pars.length,
        ptrs.pars,
        req.fitIdx.length,
        ptrs.fitIdx,
      ],
      logFlags: ptrs.logFlags,
      targets: [
        req.targets.length,
        ptrs.targetKind,
        ptrs.targetIndex,
        ptrs.targetScale,
      ],
      experiments: [
        flat.ovrIdx.length,
        ptrs.ovrIdx,
        flat.expKind.length,
        ptrs.expKind,
        ptrs.expNSeg,
        ptrs.expNPoints,
        flat.segTEnd.length,
        ptrs.segTEnd,
        ptrs.segOvr,
        flat.dataT.length,
        ptrs.dataT,
        ptrs.dataY,
        req.nDerived,
        SOLVER_ID[req.solver],
        req.rtol,
        req.atol,
        req.ssTol ?? DEFAULT_SS_TOL,
        req.ssTMax ?? DEFAULT_SS_T_MAX,
      ],
    });
  } finally {
    for (const ptr of Object.values(ptrs)) mod._free(ptr);
  }
}

/**
 * FIT_INIT for all three drivers (ADR 0009 — every one takes the same
 * experiment layout):
 *   - "lm": fit_wrapper.c's finite-difference lmdif over `rhsWat`;
 *   - "lm-jacobian" (`req.jacobianWat` present): jacobian_wrapper.c's
 *     lmder, with `rhsWat` for residual-only evaluations and the augmented
 *     forward-sensitivity `jacobianWat` (n_y*(1+n_theta) outputs) for
 *     Jacobian evaluations — one augmented solve instead of n_theta+1
 *     perturbed forward solves;
 *   - "adjoint" (`req.backend`): adjoint_wrapper.c's Adam, with `rhsWat`
 *     registered as the *forward* model (`set_forward_model_fn` — that
 *     driver toggles g_model_fn between it and its own adjoint dispatcher)
 *     and `adjointWat`.
 * Derived targets register `derivedWat` (all three) and, for the gradient
 * backends, `derivedGradWat`.
 */
async function handleFitInit(req: FitInitRequest, mod: EmscriptenModule) {
  const backend: FitSession["backend"] =
    req.backend === "adjoint"
      ? "adjoint"
      : req.jacobianWat
        ? "lm-jacobian"
        : "lm";
  const fail = (error: string) =>
    postInitResult({ requestId: req.requestId, ok: false, error });
  if (backend === "adjoint" && !req.adjointWat) {
    fail('backend: "adjoint" requires adjointWat.');
    return;
  }
  const hasDerived = req.targets.some((t) => t.kind === "derived");
  if (backend !== "lm" && hasDerived && !req.derivedGradWat) {
    fail(fitInitError(-5));
    return;
  }
  const flat = flattenExperiments(req);
  if (typeof flat === "string") {
    fail(flat);
    return;
  }

  const fnIdxs: number[] = [];
  const release = () => fnIdxs.forEach((idx) => mod.removeFunction(idx));
  let rc: number;
  try {
    const rhsIdx = await compileFn(mod, req.rhsWat, "vidiii");
    fnIdxs.push(rhsIdx);
    if (req.derivedWat) {
      const idx = await compileFn(mod, req.derivedWat, "vidiii");
      fnIdxs.push(idx);
      mod._set_derived_fn(idx);
    }
    if (backend !== "lm" && hasDerived) {
      const idx = await compileFn(mod, req.derivedGradWat!, "vidiii");
      fnIdxs.push(idx);
      mod._set_derived_grad_fn(idx);
    }

    if (backend === "lm") {
      mod._set_model_fn(rhsIdx);
      rc = withInitArgs(mod, req, flat, (a) =>
        mod._fit_init(
          ...a.head,
          a.logFlags,
          ...a.targets,
          ...a.experiments,
          req.targetResidualNorm ?? -1,
          req.progressUpdateInterval ?? 0,
        ),
      );
    } else if (backend === "lm-jacobian") {
      mod._jacobian_set_plain_fn(rhsIdx);
      const augIdx = await compileFn(mod, req.jacobianWat!, "vidiii");
      fnIdxs.push(augIdx);
      mod._jacobian_set_augmented_fn(augIdx);
      rc = withInitArgs(mod, req, flat, (a) =>
        mod._jacobian_init(
          ...a.head,
          a.logFlags,
          ...a.targets,
          ...a.experiments,
          req.targetResidualNorm ?? -1,
          req.progressUpdateInterval ?? 0,
        ),
      );
    } else {
      mod._set_forward_model_fn(rhsIdx);
      const adjointIdx = await compileFn(mod, req.adjointWat!, "vidiiiii");
      fnIdxs.push(adjointIdx);
      mod._set_adjoint_fn(adjointIdx);
      rc = withInitArgs(mod, req, flat, (a) =>
        mod._adjoint_init(
          ...a.head,
          ...a.targets,
          ...a.experiments,
          ADAM_LR,
          ADAM_BETA1,
          ADAM_BETA2,
          ADAM_EPS,
          req.targetResidualNorm ?? -1,
          req.gradNormTol ?? -1,
          req.plateau?.patience ?? 0,
          req.plateau?.minDelta ?? 0,
          req.progressUpdateInterval ?? 0,
        ),
      );
    }
  } catch (e) {
    release();
    throw e;
  }

  if (rc !== 0) {
    release();
    fail(fitInitError(rc));
    return;
  }

  session = {
    backend,
    fnIdxs,
    nPars: req.pars.length,
    nPredictions: req.targets.length * flat.dataT.length,
  };
  postInitResult({
    requestId: req.requestId,
    ok: true,
    initialResidualNorm:
      backend === "adjoint"
        ? mod._adjoint_get_residual_norm()
        : backend === "lm-jacobian"
          ? mod._jacobian_get_residual_norm()
          : mod._fit_get_residual_norm(),
    initialPredictions: readPredictions(mod, session),
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

  currentChunkRequestId = req.requestId;

  if (session.backend === "adjoint") {
    handleAdjointChunk(req, mod, session);
    return;
  }
  if (session.backend === "lm-jacobian") {
    handleJacobianChunk(req, mod, session);
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
    backend: "lm",
    nfev: mod._fit_get_nfev(),
    residualNorm: mod._fit_get_residual_norm(),
    params,
    predictions: readPredictions(mod, session),
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

/** The "lm" backend's analytic-Jacobian path (session.backend ===
 * "lm-jacobian", `handleJacobianInit`) — same lmdif-derived `info` code
 * semantics as the plain "lm" path (`infoToReason`/`FIT_TARGET_REACHED`
 * apply unchanged), reported to the caller as ordinary "lm" (this file's own
 * `FitSession.backend` doc comment). */
function handleJacobianChunk(
  req: FitChunkRequest,
  mod: EmscriptenModule,
  s: FitSession,
) {
  const info = mod._jacobian_chunk(req.maxIterations);
  const outPtr = mod._malloc(s.nPars * 8);
  let params: number[];
  try {
    mod._jacobian_get_params(outPtr);
    params = Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + s.nPars));
  } finally {
    mod._free(outPtr);
  }

  const done = info !== 5;
  postProgress({
    requestId: req.requestId,
    backend: "lm",
    nfev: mod._jacobian_get_nfev(),
    residualNorm: mod._jacobian_get_residual_norm(),
    params,
    predictions: readPredictions(mod, s),
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
    predictions: readPredictions(mod, s),
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
  } else if (session?.backend === "lm-jacobian") {
    mod._jacobian_free();
  } else {
    mod._fit_free();
  }
  if (session) {
    session.fnIdxs.forEach((idx) => mod.removeFunction(idx));
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
        backend: session?.backend === "adjoint" ? "adjoint" : "lm",
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
  registerProgressFn(mod);

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
