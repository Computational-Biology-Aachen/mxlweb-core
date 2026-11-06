/**
 * wasmWorker.ts — native WASM backend (radau5 / dop853 / dopri5 / lsoda /
 * cvode_bdf / cvode_adams)
 *
 * Architecture:
 *   1. On __INIT__: load Emscripten module from static/wasm/radau5.js
 *      (contains RADAU5, DOP853, DOPRI5 — compiled from Fortran via f2c — and
 *      SciPy's C LSODA, all vendored from mxl-solvers). SUNDIALS' CVODE lives
 *      in its own static/wasm/cvode.js, fetched only by the first cvode_*
 *      request, so sites that never pick CVODE never download it.
 *   2. Per request:
 *      a. JIT-compile WAT string → model WASM (shares that runtime's memory)
 *      b. Register model function in function table
 *      c. Call run_<solver>() — dispatched by SimulationRequest.method
 *      d. Read time-series from output buffer
 *      e. Evaluate derived variables in JS
 *      f. Protocol: repeat per segment with updated pars
 *   3. Post SimulationResult
 */

import type {
  SimulationError,
  SimulationRequest,
  SimulationResult,
} from "../../index.js";
import {
  compileModel,
  loadCvode,
  loadRadau,
  type SimulationModule,
} from "./wasmLoader.js";
import { runtimeFor, simulate } from "./simulate.js";
export {}; // make it a module

let basePath = "";
let radauPromise: Promise<SimulationModule> | null = null;
let cvodePromise: Promise<SimulationModule> | null = null;

function postError(requestId: string, err: SimulationError) {
  postMessage({ time: [], values: [], requestId, err } as SimulationResult);
}

onmessage = async function (event: MessageEvent) {
  if (event.data.type === "__INIT__") {
    basePath = event.data.basePath || "";
    radauPromise = loadRadau(basePath);
    return;
  }

  const req = event.data as SimulationRequest;
  const { requestId } = req;
  const runtime = runtimeFor(req.method);

  let mod: SimulationModule | null;
  try {
    if (runtime === "cvode") cvodePromise ??= loadCvode(basePath);
    mod = await (runtime === "cvode" ? cvodePromise : radauPromise);
  } catch (e) {
    console.error(e);
    mod = null;
  }
  if (!mod) {
    postError(requestId, {
      message: `${runtime} WASM module not loaded`,
      hints: [
        `static/wasm/${runtime}.js and ${runtime}.wasm must be present (run npm run build:wasm)`,
        "Check the browser console for fetch errors",
      ],
    });
    if (runtime === "cvode") cvodePromise = null; // retry on the next request
    return;
  }

  try {
    const result = await simulate(mod, req, (wat) =>
      compileModel(wat, mod, basePath),
    );
    const message: SimulationResult = { ...result, requestId };
    postMessage(message);
  } catch (e) {
    postError(requestId, {
      message: e instanceof Error ? e.message : String(e),
      hints: ["Check the browser console for details"],
    });
  }
};
