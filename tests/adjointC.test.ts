/**
 * End-to-end test of the actual compiled C adjoint session
 * (src-c/adjoint_wrapper.c, ADR 0005 §2.3.1-2.3.4/§2.4/§2.5) — loads the
 * real build:wasm output (same artifact the browser worker uses, matching
 * fit.test.ts's own loading pattern for the lmdif path) and exercises
 * adjoint_init/adjoint_chunk/adjoint_get_* directly.
 *
 * `adjointWat.test.ts` already verifies the *generated WAT* for the
 * adjoint RHS is correct in isolation; this file verifies everything
 * layered on top of it that only exists in C: the real Radau5 forward
 * solve, cubic Hermite interpolation of its trajectory, the segment-by-
 * segment backward integration with a jump at each data point, and the
 * Adam update — by comparing the gradient the C session actually computes
 * against the *analytic* gradient of the loss for a model with a known
 * closed-form solution (dY/dt = -kY, Y(t) = y0*exp(-k*t)), not just another
 * numerical approximation.
 */
import { OdeModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Minus,
  Mul,
  Name,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wat2wasm from "wat-compiler";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(__dirname, "..", "static", "wasm");

interface AdjointModule {
  addFunction(fn: (...args: unknown[]) => unknown, sig: string): number;
  removeFunction(idx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _set_forward_model_fn(idx: number): void;
  _set_adjoint_fn(idx: number): void;
  _adjoint_init(...args: number[]): number;
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

let mod: AdjointModule;

beforeAll(async () => {
  const fs = await import("node:fs");
  const js = fs.readFileSync(path.join(wasmDir, "radau5.js"), "utf8");
  const cjsPath = path.join(
    os.tmpdir(),
    "mxlweb-core-adjoint-radau5-glue.generated.cjs",
  );
  fs.writeFileSync(cjsPath, js + "\nmodule.exports = RadauModule;\n");
  const require = createRequire(import.meta.url);
  const factory = require(cjsPath) as (opts: {
    locateFile: (f: string) => string;
  }) => Promise<AdjointModule>;
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

function compileWatFn(wat: string, sig: string): number {
  const bytes = wat2wasm(wat);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory: mod.wasmMemory },
    math: mathImports() as WebAssembly.ModuleImports,
  });
  const fcn = instance.exports.fcn as (...args: unknown[]) => void;
  return mod.addFunction(fcn, sig);
}

describe("adjoint_wrapper.c: gradient matches the analytic loss gradient", () => {
  it("dY/dt = -kY against 6 data points (exercises the multi-segment jump path)", () => {
    const builder = new OdeModelBuilder()
      .addVariable("Y", { value: 10 })
      .addParameter("k", { value: 0.3 }) // k0 — deliberately not the true k
      .setDifferential(
        "Y",
        new Minus([new Mul([new Name("k"), new Name("Y")])]),
      );

    const rhsWat = builder.buildWat();
    const adjointWat = builder.buildAdjointWat(["k"]);

    const forwardIdx = compileWatFn(rhsWat, "vidiii");
    const adjointIdx = compileWatFn(adjointWat, "vidiiiii");
    mod._set_forward_model_fn(forwardIdx);
    mod._set_adjoint_fn(adjointIdx);

    const y0Val = 10;
    const kTrue = 0.5;
    const dataT = [0, 1, 2, 3, 4, 5];
    const analyticY = (k: number, t: number) => y0Val * Math.exp(-k * t);
    const dataY = dataT.map((t) => analyticY(kTrue, t));
    const scale = Math.max(...dataY.map(Math.abs));

    // Analytic loss(k) = sum_j ((y0*exp(-k*t_j) - data_j)/scale)^2, and its
    // central-difference derivative — the independent reference this test
    // checks the C session's gradient against.
    const loss = (k: number) =>
      dataT.reduce((acc, t, j) => {
        const r = (analyticY(k, t) - dataY[j]) / scale;
        return acc + r * r;
      }, 0);
    const h = 1e-6;
    const analyticGrad = (loss(0.3 + h) - loss(0.3 - h)) / (2 * h);

    const ptrs = {
      y0: allocF64([y0Val]),
      pars: allocF64([0.3]),
      thetaIdx: allocI32([0]),
      targetIndex: allocI32([0]),
      targetScale: allocF64([scale]),
      dataT: allocF64(dataT),
      dataY: allocF64(dataY),
    };

    const rc = mod._adjoint_init(
      1,
      ptrs.y0,
      1,
      ptrs.pars,
      1,
      ptrs.thetaIdx,
      1,
      ptrs.targetIndex,
      ptrs.targetScale,
      dataT.length,
      ptrs.dataT,
      ptrs.dataY,
      dataT[dataT.length - 1],
      0, // solver = radau5
      1e-9,
      1e-11, // rtol, atol — tight, matching fit.test.ts's own precedent
      1e-4,
      0.9,
      0.999,
      1e-8, // lr, beta1, beta2, eps
      -1,
      -1,
      0,
      0, // target_residual_norm, grad_norm_tol, plateau_patience, plateau_min_delta (all disabled)
    );
    for (const ptr of Object.values(ptrs)) mod._free(ptr);
    expect(rc).toBe(0);

    const gradPtr = mod._malloc(8);
    mod._adjoint_get_grad(gradPtr);
    const cGrad = mod.HEAPF64[gradPtr / 8];
    mod._free(gradPtr);

    expect(mod._adjoint_get_steps()).toBe(1);
    expect(mod._adjoint_get_residual_norm()).toBeCloseTo(
      Math.sqrt(loss(0.3)),
      4,
    );
    expect(cGrad).toBeCloseTo(analyticGrad, 3);

    // Adam already took one step inside adjoint_init — k should have moved
    // *toward* kTrue (0.5), i.e. increased from 0.3, confirming the sign
    // convention is right end to end (a wrong sign would move it further
    // from kTrue instead).
    const paramsPtr = mod._malloc(8);
    mod._adjoint_get_params(paramsPtr);
    const kAfterOneStep = mod.HEAPF64[paramsPtr / 8];
    mod._free(paramsPtr);
    expect(kAfterOneStep).toBeGreaterThan(0.3);
    expect(kAfterOneStep).toBeLessThan(0.5);

    mod._adjoint_free();
    mod.removeFunction(forwardIdx);
    mod.removeFunction(adjointIdx);
  });

  it("adjoint_chunk runs further Adam steps and keeps reducing the residual norm", () => {
    const builder = new OdeModelBuilder()
      .addVariable("Y", { value: 10 })
      .addParameter("k", { value: 0.3 })
      .setDifferential(
        "Y",
        new Minus([new Mul([new Name("k"), new Name("Y")])]),
      );

    const rhsWat = builder.buildWat();
    const adjointWat = builder.buildAdjointWat(["k"]);
    const forwardIdx = compileWatFn(rhsWat, "vidiii");
    const adjointIdx = compileWatFn(adjointWat, "vidiiiii");
    mod._set_forward_model_fn(forwardIdx);
    mod._set_adjoint_fn(adjointIdx);

    const y0Val = 10;
    const kTrue = 0.5;
    const dataT = [0, 1, 2, 3, 4, 5];
    const dataY = dataT.map((t) => y0Val * Math.exp(-kTrue * t));
    const scale = Math.max(...dataY.map(Math.abs));

    const ptrs = {
      y0: allocF64([y0Val]),
      pars: allocF64([0.3]),
      thetaIdx: allocI32([0]),
      targetIndex: allocI32([0]),
      targetScale: allocF64([scale]),
      dataT: allocF64(dataT),
      dataY: allocF64(dataY),
    };
    const rc = mod._adjoint_init(
      1,
      ptrs.y0,
      1,
      ptrs.pars,
      1,
      ptrs.thetaIdx,
      1,
      ptrs.targetIndex,
      ptrs.targetScale,
      dataT.length,
      ptrs.dataT,
      ptrs.dataY,
      dataT[dataT.length - 1],
      0,
      1e-9,
      1e-11,
      1e-2 /* larger lr for a faster-converging test */,
      0.9,
      0.999,
      1e-8,
      -1,
      -1,
      0,
      0,
    );
    for (const ptr of Object.values(ptrs)) mod._free(ptr);
    expect(rc).toBe(0);

    const initialResidual = mod._adjoint_get_residual_norm();
    const info = mod._adjoint_chunk(200);
    const finalResidual = mod._adjoint_get_residual_norm();

    expect(info).toBe(4); // ADJOINT_INFO_BUDGET_REACHED — 200 steps ran, no early stop configured
    expect(mod._adjoint_get_steps()).toBe(1 + 200);
    expect(finalResidual).toBeLessThan(initialResidual);

    const paramsPtr = mod._malloc(8);
    mod._adjoint_get_params(paramsPtr);
    const kFinal = mod.HEAPF64[paramsPtr / 8];
    mod._free(paramsPtr);
    expect(kFinal).toBeCloseTo(kTrue, 1);

    mod._adjoint_free();
    mod.removeFunction(forwardIdx);
    mod.removeFunction(adjointIdx);
  });
});
