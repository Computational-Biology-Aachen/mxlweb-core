/**
 * Fit-recovery test for the WASM fitting backend (ADR 0004, mxlweb repo).
 *
 * Loads the actual compiled static/wasm/radau5.js glue (the same checked-in
 * artifact the browser worker uses — see build:wasm in package.json), builds
 * a tiny exponential-decay model via the real mathml AST + buildModelWat /
 * buildDerivedWat (same codegen path a real model uses), generates synthetic
 * noiseless data from a known parameter, perturbs the initial guess, and
 * asserts the chunked fit_init/fit_chunk loop recovers the true parameter —
 * for both a state-variable target and a derived-quantity target.
 */
import {
  buildDerivedWat,
  buildModelWat,
  mathImports,
} from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Minus,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wat2wasm from "wat-compiler";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(__dirname, "..", "static", "wasm");

// dY/dt = -k*Y
const rhsWat = buildModelWat(
  [
    {
      varName: "Y",
      expr: new Minus([new Num(0), new Mul([new Name("k"), new Name("Y")])]),
    },
  ],
  ["Y"],
  ["k"],
);
// flux = k*Y
const derivedWat = buildDerivedWat(
  [{ name: "flux", expr: new Mul([new Name("k"), new Name("Y")]) }],
  ["Y"],
  ["k"],
);

interface FitModule {
  addFunction(fn: (...args: unknown[]) => unknown, sig: string): number;
  removeFunction(idx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _set_model_fn(idx: number): void;
  _set_derived_fn(idx: number): void;
  _fit_init(...args: number[]): number;
  _fit_chunk(maxfev: number): number;
  _fit_get_nfev(): number;
  _fit_get_residual_norm(): number;
  _fit_get_params(outPtr: number): void;
  _fit_free(): void;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  wasmMemory: WebAssembly.Memory;
}

let mod: FitModule;

beforeAll(async () => {
  const fs = await import("node:fs");
  const js = fs.readFileSync(path.join(wasmDir, "radau5.js"), "utf8");
  // MODULARIZE=1 output mixes `require(...)` (Node branch) with top-level
  // await inside its async factory; Node's ESM loader misdetects that as
  // ambiguous CJS/ESM when evaluated via `new Function` from an ESM test
  // file. Writing it to a real .cjs file and `require`-ing it (as a
  // consuming app's bundler would) sidesteps the sniffing entirely.
  const cjsPath = path.join(
    os.tmpdir(),
    "mxlweb-core-radau5-glue.generated.cjs",
  );
  fs.writeFileSync(cjsPath, js + "\nmodule.exports = RadauModule;\n");
  const require = createRequire(import.meta.url);
  const factory = require(cjsPath) as (opts: {
    locateFile: (f: string) => string;
  }) => Promise<FitModule>;
  mod = await factory({ locateFile: (f) => path.join(wasmDir, f) });
});

function allocF64(values: number[]): number {
  const ptr = mod._malloc(Math.max(values.length, 1) * 8);
  mod.HEAPF64.set(values, ptr / 8);
  return ptr;
}
function allocI32(values: number[]): number {
  const ptr = mod._malloc(Math.max(values.length, 1) * 4);
  mod.HEAP32.set(values, ptr / 4);
  return ptr;
}

// Compiles WAT to WASM and registers it in the Emscripten module's function
// table, sharing its linear memory — same pattern as wasmLoader.ts's
// compileModel, kept local here since this test runs in Node (not a Worker),
// so wasmLoader's fetch-based glue loading doesn't apply.
function compileWatFn(wat: string): number {
  const bytes = wat2wasm(wat);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory: mod.wasmMemory },
    math: mathImports() as WebAssembly.ModuleImports,
  });
  const fcn = instance.exports.fcn as (...args: unknown[]) => void;
  return mod.addFunction(fcn, "vidiii");
}

function runFit(targetKind: "state" | "derived", k0: number, trueK: number) {
  const y0Val = 10;
  const dataT = [0, 1, 2, 3, 4, 5];
  const modelValue = (k: number, t: number) => y0Val * Math.exp(-k * t);
  const dataValue = (t: number) =>
    targetKind === "state"
      ? modelValue(trueK, t)
      : trueK * modelValue(trueK, t);
  const dataY = dataT.map(dataValue);

  const modelIdx = compileWatFn(rhsWat);
  mod._set_model_fn(modelIdx);
  let derivedIdx: number | null = null;
  if (targetKind === "derived") {
    derivedIdx = compileWatFn(derivedWat);
    mod._set_derived_fn(derivedIdx);
  }

  const ptrs = {
    y0: allocF64([y0Val]),
    pars: allocF64([k0]),
    fitIdx: allocI32([0]),
    logFlags: allocI32([1]),
    targetKind: allocI32([targetKind === "state" ? 0 : 1]),
    targetIndex: allocI32([0]),
    targetScale: allocF64([Math.max(...dataY.map(Math.abs))]),
    dataT: allocF64(dataT),
    dataY: allocF64(dataY),
  };

  const rc = mod._fit_init(
    1,
    ptrs.y0,
    1,
    ptrs.pars,
    1,
    ptrs.fitIdx,
    ptrs.logFlags,
    1,
    ptrs.targetKind,
    ptrs.targetIndex,
    ptrs.targetScale,
    dataT.length,
    ptrs.dataT,
    ptrs.dataY,
    dataT[dataT.length - 1],
    targetKind === "derived" ? 1 : 0,
    0, // solver = radau5
    1e-8,
    1e-10,
  );
  for (const ptr of Object.values(ptrs)) mod._free(ptr);
  if (rc !== 0) throw new Error(`fit_init failed: ${rc}`);

  let info = 5;
  let chunks = 0;
  while (info === 5 && chunks < 50) {
    info = mod._fit_chunk(30);
    chunks++;
  }

  const outPtr = mod._malloc(8);
  mod._fit_get_params(outPtr);
  const kFinal = mod.HEAPF64[outPtr / 8];
  mod._free(outPtr);
  mod._fit_free();
  mod.removeFunction(modelIdx);
  if (derivedIdx !== null) mod.removeFunction(derivedIdx);

  return { kFinal, info, chunks };
}

describe("fit_wrapper.c: chunked LM fit recovery", () => {
  it("recovers a state-variable target from a perturbed initial guess", () => {
    const { kFinal } = runFit("state", 0.1, 0.5);
    expect(kFinal).toBeCloseTo(0.5, 2);
  });

  it("recovers a derived-quantity target from a perturbed initial guess", () => {
    const { kFinal } = runFit("derived", 0.15, 0.5);
    expect(kFinal).toBeCloseTo(0.5, 2);
  });

  it("resumes correctly across multiple maxfev chunks", () => {
    // k0=0.1 is known (see ADR 0004 §2.7) to exhaust the first chunk's
    // budget before converging — exercises the restart-from-x path.
    const { kFinal, chunks } = runFit("state", 0.1, 0.5);
    expect(chunks).toBeGreaterThan(1);
    expect(kFinal).toBeCloseTo(0.5, 2);
  });
});
