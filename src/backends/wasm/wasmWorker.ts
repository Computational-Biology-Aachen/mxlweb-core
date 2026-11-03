/**
 * wasmWorker.ts — native WASM backend (radau5 / dop853 / dopri5 / lsoda)
 *
 * Architecture:
 *   1. On __INIT__: load Emscripten module from static/wasm/radau5.js
 *      (contains RADAU5, DOP853, DOPRI5 — compiled from Fortran via f2c — and
 *      SciPy's C LSODA, all vendored from mxl-solvers)
 *   2. Per request:
 *      a. JIT-compile WAT string → model WASM (shares Emscripten memory)
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
  loadRadau,
  type EmscriptenModule,
} from "./wasmLoader.js";
import { simulate } from "./simulate.js";
export {}; // make it a module

let basePath = "";
let radauPromise: Promise<EmscriptenModule> | null = null;

onmessage = async function (event: MessageEvent) {
  if (event.data.type === "__INIT__") {
    basePath = event.data.basePath || "";
    radauPromise = loadRadau(basePath);
    return;
  }

  const mod = await radauPromise;

  if (!mod) {
    const msg: SimulationResult = {
      time: [],
      values: [],
      requestId: event.data.requestId,
      err: {
        message: "RADAU5 WASM module not loaded",
        hints: [
          "static/wasm/radau5.js and radau5.wasm must be present (run npm run build:wasm)",
          "Check the browser console for fetch errors",
        ],
      },
    };
    postMessage(msg);
    return;
  }

  const req = event.data as SimulationRequest;
  const { requestId } = req;

  try {
    const result = await simulate(mod, req, (wat) =>
      compileModel(wat, mod, basePath),
    );
    const message: SimulationResult = { ...result, requestId };
    postMessage(message);
  } catch (e) {
    const err: SimulationError = {
      message: e instanceof Error ? e.message : String(e),
      hints: ["Check the browser console for details"],
    };
    postMessage({ time: [], values: [], requestId, err } as SimulationResult);
  }
};
