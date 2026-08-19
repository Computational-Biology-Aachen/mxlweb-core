/**
 * wasmLoader.ts — shared Emscripten module loading + WAT-JIT-compile helpers.
 *
 * Used by both wasmWorker.ts (simulation) and fitWorker.ts (fitting, ADR 0004
 * in the mxlweb repo) — each Worker gets its own module-level cache since
 * Workers don't share JS realms, so this is safe to import from both.
 */
import { mathImports } from "./wat-codegen.js";

export interface EmscriptenModule {
  addFunction(fn: (...args: unknown[]) => unknown, sig: string): number;
  removeFunction(idx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _run_radau5(
    n: number,
    tStart: number,
    tEnd: number,
    yPtr: number,
    rparPtr: number,
    rtol: number,
    atol: number,
    hInit: number,
    nmax: number,
  ): number;
  _run_dop853(
    n: number,
    tStart: number,
    tEnd: number,
    yPtr: number,
    rparPtr: number,
    rtol: number,
    atol: number,
    hInit: number,
    nmax: number,
  ): number;
  _run_dopri5(
    n: number,
    tStart: number,
    tEnd: number,
    yPtr: number,
    rparPtr: number,
    rtol: number,
    atol: number,
    hInit: number,
    nmax: number,
  ): number;
  _set_model_fn(tableIdx: number): void;
  _init_output(capacity: number, dim: number): void;
  _free_output(): void;
  _get_out_n(): number;
  _get_out_t(): number; // pointer
  _get_out_y(): number; // pointer
  /** Fit-only exports (fit_wrapper.c) — unused by the plain simulation worker. */
  _set_derived_fn(tableIdx: number): void;
  _fit_init(
    nY: number,
    y0Ptr: number,
    nPars: number,
    parsPtr: number,
    nFit: number,
    fitIdxPtr: number,
    logFlagsPtr: number,
    nTargets: number,
    targetKindPtr: number,
    targetIndexPtr: number,
    targetScalePtr: number,
    nPoints: number,
    dataTPtr: number,
    dataYPtr: number,
    tEnd: number,
    nDerived: number,
    solverId: number,
    rtol: number,
    atol: number,
    targetResidualNorm: number,
  ): number;
  _fit_chunk(maxfev: number): number;
  _fit_get_nfev(): number;
  _fit_get_residual_norm(): number;
  _fit_get_params(outPtr: number): void;
  _fit_free(): void;
  /** Adjoint-only exports (adjoint_wrapper.c, ADR 0005 §2.3.3) — unused by "lm" fits and the plain simulation worker. */
  _set_forward_model_fn(tableIdx: number): void;
  _set_adjoint_fn(tableIdx: number): void;
  _adjoint_init(
    nY: number,
    y0Ptr: number,
    nPars: number,
    parsPtr: number,
    nTheta: number,
    thetaIdxPtr: number,
    nTargets: number,
    targetIndexPtr: number,
    targetScalePtr: number,
    nPoints: number,
    dataTPtr: number,
    dataYPtr: number,
    tEnd: number,
    solverId: number,
    rtol: number,
    atol: number,
    lr: number,
    beta1: number,
    beta2: number,
    eps: number,
    targetResidualNorm: number,
    gradNormTol: number,
    plateauPatience: number,
    plateauMinDelta: number,
  ): number;
  _adjoint_chunk(maxIterations: number): number;
  _adjoint_get_steps(): number;
  _adjoint_get_residual_norm(): number;
  _adjoint_get_grad_norm(): number;
  _adjoint_get_grad(outPtr: number): void;
  _adjoint_get_params(outPtr: number): void;
  _adjoint_free(): void;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  wasmMemory: WebAssembly.Memory;
}

export async function loadRadau(base: string): Promise<EmscriptenModule> {
  const glueUrl = `${base}/wasm/radau5.js`;
  const response = await fetch(glueUrl);
  if (!response.ok) {
    throw new Error(`Failed to load RADAU5 WASM glue from ${glueUrl}`);
  }
  const js = await response.text();
  // Emscripten MODULARIZE=1 output: eval returns a factory function
  const factory = new Function(js + "\nreturn RadauModule;")();
  const mod: EmscriptenModule = await factory({
    locateFile: (f: string) => `${base}/wasm/${f}`,
  });
  return mod;
}

// ------------------------------------------------------------
// WAT text → WASM binary, via the vendored `wat-compiler` CJS bundle
// (static/wasm/wat-compiler.js).
//
// wat-compiler ships a class method literally named `import(...)`, which
// Vite's dev-server import scanner (es-module-lexer) can't distinguish from
// a dynamic `import()` call — it rewrites the method into invalid JS
// (`import(__vite__injectQuery(...), ...)`) the moment the module is served,
// throwing "Unexpected token '('"/"missing ) after formal parameters" on
// every simulation. Loading it via fetch + Function, like `loadRadau` above
// does for the Emscripten glue, sidesteps Vite's transform pipeline entirely.
// ------------------------------------------------------------
let watCompilerPromise: Promise<(code: string) => Uint8Array> | null = null;

async function loadWatCompiler(
  base: string,
): Promise<(code: string) => Uint8Array> {
  const url = `${base}/wasm/wat-compiler.js`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load wat-compiler from ${url}`);
  }
  const js = await response.text();
  const factory = new Function("module", "exports", js);
  const mod: { exports: { default?: (code: string) => Uint8Array } } = {
    exports: {},
  };
  factory(mod, mod.exports);
  const wat2wasm = mod.exports.default;
  if (!wat2wasm) {
    throw new Error("wat-compiler bundle did not export a default function");
  }
  return wat2wasm;
}

async function watToWasm(wat: string, basePath: string): Promise<Uint8Array> {
  // Loads lazily — only fetched when the first simulation/fit runs.
  watCompilerPromise ??= loadWatCompiler(basePath);
  const wat2wasm = await watCompilerPromise;
  return wat2wasm(wat);
}

// Cache compiled model modules keyed by WAT string hash — module-scoped per
// Worker realm (see file docstring).
const modelCache = new Map<string, WebAssembly.Module>();

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/** Compile + instantiate a WAT-generated model module, sharing the
 * Emscripten module's linear memory (see buildModelWat / buildDerivedWat). */
export async function compileModel(
  wat: string,
  emMod: EmscriptenModule,
  basePath: string,
): Promise<WebAssembly.Instance> {
  const key = hashStr(wat);
  let compiled = modelCache.get(key);
  if (!compiled) {
    const bytes = await watToWasm(wat, basePath);
    compiled = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
    modelCache.set(key, compiled);
  }
  return WebAssembly.instantiate(compiled, {
    env: { memory: emMod.wasmMemory },
    math: mathImports() as WebAssembly.ModuleImports,
  });
}
