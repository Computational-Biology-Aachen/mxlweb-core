/**
 * Protocols, steady states, derived targets and missing data under the two
 * gradient fit drivers (ADR 0009) — jacobian_wrapper.c's forward
 * sensitivities and adjoint_wrapper.c's continuous adjoint — checked against
 * the closed-form solution of dY/dt = u - kY (u piecewise constant per
 * protocol segment / per steady-state condition), not just against another
 * numerical approximation. Loads the real build:wasm output, like
 * fit.test.ts and adjointC.test.ts.
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

interface GradModule {
  addFunction(fn: (...args: unknown[]) => unknown, sig: string): number;
  removeFunction(idx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _set_model_fn(idx: number): void;
  _set_derived_fn(idx: number): void;
  _set_derived_grad_fn(idx: number): void;
  _jacobian_set_plain_fn(idx: number): void;
  _jacobian_set_augmented_fn(idx: number): void;
  _jacobian_init(...args: number[]): number;
  _jacobian_chunk(maxfev: number): number;
  _jacobian_get_params(outPtr: number): void;
  _jacobian_get_predictions(outPtr: number): number;
  _jacobian_get_jacobian(outPtr: number): number;
  _jacobian_get_residual_norm(): number;
  _jacobian_free(): void;
  _set_forward_model_fn(idx: number): void;
  _set_adjoint_fn(idx: number): void;
  _adjoint_init(...args: number[]): number;
  _adjoint_chunk(maxIterations: number): number;
  _adjoint_get_grad(outPtr: number): void;
  _adjoint_get_params(outPtr: number): void;
  _adjoint_get_predictions(outPtr: number): number;
  _adjoint_get_residual_norm(): number;
  _adjoint_free(): void;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  wasmMemory: WebAssembly.Memory;
}

let mod: GradModule;

beforeAll(async () => {
  const fs = await import("node:fs");
  const js = fs.readFileSync(path.join(wasmDir, "radau5.js"), "utf8");
  const cjsPath = path.join(
    os.tmpdir(),
    "mxlweb-core-gradient-radau5-glue.generated.cjs",
  );
  fs.writeFileSync(cjsPath, js + "\nmodule.exports = RadauModule;\n");
  const require = createRequire(import.meta.url);
  const factory = require(cjsPath) as (opts: {
    locateFile: (f: string) => string;
  }) => Promise<GradModule>;
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
function readF64(n: number, fill: (ptr: number) => unknown): number[] {
  const ptr = mod._malloc(Math.max(n, 1) * 8);
  fill(ptr);
  const out = Array.from(mod.HEAPF64.subarray(ptr / 8, ptr / 8 + n));
  mod._free(ptr);
  return out;
}
function compileWatFn(wat: string, sig = "vidiii"): number {
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(wat2wasm(wat)),
    {
      env: { memory: mod.wasmMemory },
      math: mathImports() as WebAssembly.ModuleImports,
    },
  );
  return mod.addFunction(
    instance.exports.fcn as (...a: unknown[]) => void,
    sig,
  );
}

// dY/dt = u - k*Y, derived uY = u*Y; pars = [k, u].
const builder = new OdeModelBuilder()
  .addVariable("Y", { value: 0 })
  .addParameter("k", { value: 0.3 })
  .addParameter("u", { value: 1 })
  .addAssignment("uY", { fn: new Mul([new Name("u"), new Name("Y")]) })
  .setDifferential(
    "Y",
    new Minus([new Name("u"), new Mul([new Name("k"), new Name("Y")])]),
  );
const K_TRUE = 0.5;
const K0 = 0.3;

const EXP_TIME_COURSE = 0;
const EXP_STEADY_STATE = 1;

type Segment = { tEnd: number; u: number };
type Experiment =
  | { kind: "protocol"; segments: Segment[]; dataT: number[] }
  | { kind: "steadyState"; u: number };

/** Closed-form Y(t) under a protocol from Y(0) = 0, and the segment's u (a
 * boundary point belongs to the earlier segment, as in the C drivers). */
function protocolY(k: number, segments: Segment[], t: number) {
  let y = 0;
  let t0 = 0;
  for (const seg of segments) {
    const yAt = (tt: number) =>
      seg.u / k + (y - seg.u / k) * Math.exp(-k * (tt - t0));
    if (t <= seg.tEnd) return { y: yAt(t), u: seg.u };
    y = yAt(seg.tEnd);
    t0 = seg.tEnd;
  }
  throw new Error("t past the protocol");
}

/** Model value behind every observation, experiment-major (one target). */
function analyticPredictions(
  k: number,
  experiments: Experiment[],
  target: "state" | "derived",
): number[] {
  return experiments.flatMap((e) => {
    const points =
      e.kind === "steadyState"
        ? [{ y: e.u / k, u: e.u }]
        : e.dataT.map((t) => protocolY(k, e.segments, t));
    return points.map(({ y, u }) => (target === "state" ? y : u * y));
  });
}

interface Setup {
  backend: "jacobian" | "adjoint";
  target: "state" | "derived";
  experiments: Experiment[];
  /** Observations; defaults to the analytic values at K_TRUE. */
  dataY?: number[];
  fitIdx?: number[];
  k0?: number;
  lr?: number;
}

function init(setup: Setup): {
  rc: number;
  dataY: number[];
  scale: number;
  dispose: () => void;
} {
  const fitIdx = setup.fitIdx ?? [0];
  const thetaNames = fitIdx.map((i) => ["k", "u"][i]);
  const fnIdxs: number[] = [];
  const rhsIdx = compileWatFn(builder.buildWat());
  fnIdxs.push(rhsIdx);
  if (setup.target === "derived") {
    const derivedIdx = compileWatFn(builder.buildWatDerived(["uY"]));
    const gradIdx = compileWatFn(
      builder.buildWatDerivedGrad(["uY"], thetaNames),
    );
    fnIdxs.push(derivedIdx, gradIdx);
    mod._set_derived_fn(derivedIdx);
    mod._set_derived_grad_fn(gradIdx);
  }
  if (setup.backend === "jacobian") {
    mod._jacobian_set_plain_fn(rhsIdx);
    const augIdx = compileWatFn(builder.buildJacobianWat(thetaNames));
    fnIdxs.push(augIdx);
    mod._jacobian_set_augmented_fn(augIdx);
  } else {
    mod._set_forward_model_fn(rhsIdx);
    const adjIdx = compileWatFn(
      builder.buildAdjointWat(thetaNames),
      "vidiiiii",
    );
    fnIdxs.push(adjIdx);
    mod._set_adjoint_fn(adjIdx);
  }

  const exps = setup.experiments;
  const dataY = setup.dataY ?? analyticPredictions(K_TRUE, exps, setup.target);
  const scale = Math.max(
    ...dataY.filter((v) => !Number.isNaN(v)).map(Math.abs),
  );
  const segs = exps.map((e) =>
    e.kind === "steadyState" ? [{ tEnd: 0, u: e.u }] : e.segments,
  );
  const ptrs = {
    y0: allocF64([0]),
    pars: allocF64([setup.k0 ?? K0, 1]),
    fitIdx: allocI32(fitIdx),
    logFlags: allocI32(fitIdx.map(() => 0)),
    targetKind: allocI32([setup.target === "state" ? 0 : 1]),
    targetIndex: allocI32([0]),
    targetScale: allocF64([scale]),
    ovrIdx: allocI32([1]),
    expKind: allocI32(
      exps.map((e) =>
        e.kind === "steadyState" ? EXP_STEADY_STATE : EXP_TIME_COURSE,
      ),
    ),
    expNSeg: allocI32(segs.map((s) => s.length)),
    expNPoints: allocI32(
      exps.map((e) => (e.kind === "steadyState" ? 1 : e.dataT.length)),
    ),
    segTEnd: allocF64(segs.flat().map((s) => s.tEnd)),
    segOvr: allocF64(segs.flat().map((s) => s.u)),
    dataT: allocF64(
      exps.flatMap((e) => (e.kind === "steadyState" ? [0] : e.dataT)),
    ),
    dataY: allocF64(dataY),
  };
  const head = [1, ptrs.y0, 2, ptrs.pars, fitIdx.length, ptrs.fitIdx];
  const targets = [1, ptrs.targetKind, ptrs.targetIndex, ptrs.targetScale];
  const layout = [
    1,
    ptrs.ovrIdx,
    exps.length,
    ptrs.expKind,
    ptrs.expNSeg,
    ptrs.expNPoints,
    segs.flat().length,
    ptrs.segTEnd,
    ptrs.segOvr,
    dataY.length,
    ptrs.dataT,
    ptrs.dataY,
    setup.target === "derived" ? 1 : 0,
    0, // radau5
    1e-10,
    1e-12,
    1e-10, // ss_tol — tight, so y(T*) is the steady state to well below the test tolerance
    1e8,
  ];
  const rc =
    setup.backend === "jacobian"
      ? mod._jacobian_init(...head, ptrs.logFlags, ...targets, ...layout, -1, 0)
      : mod._adjoint_init(
          ...head,
          ...targets,
          ...layout,
          setup.lr ?? 1e-4,
          0.9,
          0.999,
          1e-8,
          -1,
          -1,
          0,
          0,
          0,
        );
  for (const ptr of Object.values(ptrs)) mod._free(ptr);
  return {
    rc,
    dataY,
    scale,
    dispose: () => {
      if (setup.backend === "jacobian") mod._jacobian_free();
      else mod._adjoint_free();
      fnIdxs.forEach((idx) => mod.removeFunction(idx));
    },
  };
}

/** Central difference of the analytic predictions in k. */
function analyticDPred(
  experiments: Experiment[],
  target: "state" | "derived",
  k: number,
) {
  const h = 1e-6;
  const up = analyticPredictions(k + h, experiments, target);
  const down = analyticPredictions(k - h, experiments, target);
  return up.map((v, i) => (v - down[i]) / (2 * h));
}

function expectRelClose(actual: number[], expected: number[], rel: number) {
  expect(actual).toHaveLength(expected.length);
  const scale = Math.max(...expected.map(Math.abs), 1e-12);
  actual.forEach((a, i) => {
    if (Number.isNaN(expected[i])) expect(a).toBeNaN();
    else expect(Math.abs(a - expected[i])).toBeLessThan(rel * scale);
  });
}

const protocol: Experiment = {
  kind: "protocol",
  segments: [
    { tEnd: 2, u: 1 },
    { tEnd: 5, u: 3 },
    { tEnd: 8, u: 0.5 },
  ],
  // Includes t=0 and both boundaries (which belong to the earlier segment).
  dataT: [0, 1, 2, 3.5, 5, 6.5, 8],
};
const steadyStates: Experiment[] = [1, 2, 5].map((u) => ({
  kind: "steadyState" as const,
  u,
}));

const cases: {
  name: string;
  experiments: Experiment[];
  target: "state" | "derived";
}[] = [
  { name: "protocol, state target", experiments: [protocol], target: "state" },
  {
    name: "protocol, derived target",
    experiments: [protocol],
    target: "derived",
  },
  {
    name: "steady states, state target",
    experiments: steadyStates,
    target: "state",
  },
  {
    name: "steady states, derived target",
    experiments: steadyStates,
    target: "derived",
  },
  {
    name: "protocol + steady states",
    experiments: [protocol, ...steadyStates],
    target: "derived",
  },
];

describe("jacobian_wrapper.c: analytic Jacobian over experiments", () => {
  for (const c of cases) {
    it(`${c.name}: Jacobian and predictions match the closed form`, () => {
      const { rc, scale, dispose } = init({ backend: "jacobian", ...c });
      expect(rc).toBe(0);
      const m = analyticPredictions(K0, c.experiments, c.target).length;
      const pred = readF64(m, (p) => mod._jacobian_get_predictions(p));
      expectRelClose(
        pred,
        analyticPredictions(K0, c.experiments, c.target),
        1e-3,
      );
      const jac = readF64(m, (p) => mod._jacobian_get_jacobian(p));
      const expected = analyticDPred(c.experiments, c.target, K0).map(
        (d) => d / scale,
      );
      expectRelClose(jac, expected, 1e-2);
      dispose();
    });
  }

  it("zeroes the Jacobian row of a missing observation", () => {
    const dataY = analyticPredictions(K_TRUE, [protocol], "state");
    dataY[3] = NaN;
    const { rc, dispose } = init({
      backend: "jacobian",
      target: "state",
      experiments: [protocol],
      dataY,
    });
    expect(rc).toBe(0);
    const jac = readF64(dataY.length, (p) => mod._jacobian_get_jacobian(p));
    expect(jac[3]).toBe(0);
    expect(Math.abs(jac[4])).toBeGreaterThan(0);
    dispose();
  });

  for (const c of [cases[1], cases[3]]) {
    it(`${c.name}: lmder recovers k`, () => {
      const { rc, dispose } = init({ backend: "jacobian", ...c });
      expect(rc).toBe(0);
      let info = 5;
      for (let i = 0; i < 50 && info === 5; i++) info = mod._jacobian_chunk(30);
      const [k] = readF64(2, (p) => mod._jacobian_get_params(p));
      expect(k).toBeCloseTo(K_TRUE, 3);
      dispose();
    });
  }
});

describe("adjoint_wrapper.c: gradient over experiments", () => {
  for (const c of cases) {
    it(`${c.name}: gradient and predictions match the closed form`, () => {
      const { rc, dataY, scale, dispose } = init({ backend: "adjoint", ...c });
      expect(rc).toBe(0);
      const pred0 = analyticPredictions(K0, c.experiments, c.target);
      const pred = readF64(pred0.length, (p) =>
        mod._adjoint_get_predictions(p),
      );
      expectRelClose(pred, pred0, 1e-3);
      const dPred = analyticDPred(c.experiments, c.target, K0);
      const expectedGrad = pred0.reduce(
        (acc, p, i) => acc + (2 * (p - dataY[i]) * dPred[i]) / (scale * scale),
        0,
      );
      const [grad] = readF64(1, (p) => mod._adjoint_get_grad(p));
      expect(Math.abs(grad - expectedGrad)).toBeLessThan(
        1e-3 * Math.abs(expectedGrad),
      );
      dispose();
    });
  }

  it("ignores a missing observation in the loss and gradient", () => {
    const full = init({
      backend: "adjoint",
      target: "state",
      experiments: [protocol],
    });
    const [gradFull] = readF64(1, (p) => mod._adjoint_get_grad(p));
    const scale = full.scale;
    full.dispose();

    const dataY = analyticPredictions(K_TRUE, [protocol], "state");
    const pred0 = analyticPredictions(K0, [protocol], "state");
    const dPred = analyticDPred([protocol], "state", K0);
    dataY[3] = NaN;
    const { rc, dispose } = init({
      backend: "adjoint",
      target: "state",
      experiments: [protocol],
      dataY,
    });
    expect(rc).toBe(0);
    const [grad] = readF64(1, (p) => mod._adjoint_get_grad(p));
    const dropped =
      (2 *
        (pred0[3] - analyticPredictions(K_TRUE, [protocol], "state")[3]) *
        dPred[3]) /
      (scale * scale);
    expect(Math.abs(grad - (gradFull - dropped))).toBeLessThan(
      1e-3 * Math.abs(gradFull),
    );
    dispose();
  });

  it("steady states: Adam moves k to the true value", () => {
    const { rc, dispose } = init({
      backend: "adjoint",
      target: "state",
      experiments: steadyStates,
      lr: 2e-2,
    });
    expect(rc).toBe(0);
    mod._adjoint_chunk(300);
    const [k] = readF64(2, (p) => mod._adjoint_get_params(p));
    expect(k).toBeCloseTo(K_TRUE, 2);
    dispose();
  });
});

describe("gradient backends: rejected layouts", () => {
  for (const backend of ["jacobian", "adjoint"] as const) {
    it(`${backend}: fitting an overridden parameter is rejected (-4)`, () => {
      const { rc, dispose } = init({
        backend,
        target: "state",
        experiments: [protocol],
        fitIdx: [1],
      });
      expect(rc).toBe(-4);
      dispose();
    });

    it(`${backend}: data past the protocol's end is rejected (-3)`, () => {
      const { rc, dispose } = init({
        backend,
        target: "state",
        experiments: [{ ...protocol, dataT: [0, 9] } as Experiment],
        dataY: [0, 1],
      });
      expect(rc).toBe(-3);
      dispose();
    });
  }
});
