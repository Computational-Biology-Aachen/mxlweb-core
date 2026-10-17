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
  _fit_get_predictions(outPtr: number): number;
  _fit_free(): void;
  _init_output(capacity: number, dim: number): void;
  _free_output(): void;
  _get_out_n(): number;
  _get_out_t(): number;
  _run_radau5(...args: number[]): number;
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

// dY/dt = u - k*Y — a protocol/condition parameter u driving first-order
// relaxation towards Y_ss = u/k.
const drivenRhsWat = buildModelWat(
  [
    {
      varName: "Y",
      expr: new Minus([new Name("u"), new Mul([new Name("k"), new Name("Y")])]),
    },
  ],
  ["Y"],
  ["k", "u"],
);
// uY = u*Y — a derived quantity that depends on the overridden parameter.
const drivenDerivedWat = buildDerivedWat(
  [{ name: "uY", expr: new Mul([new Name("u"), new Name("Y")]) }],
  ["Y"],
  ["k", "u"],
);

const EXP_TIME_COURSE = 0;
const EXP_STEADY_STATE = 1;

type TestExperiment = {
  kind: typeof EXP_TIME_COURSE | typeof EXP_STEADY_STATE;
  /** One row of override values (one per ovrIdx entry, NaN = keep) per segment. */
  segments: { tEnd: number; ovr: number[] }[];
  dataT: number[];
  /** Target-major within this experiment. */
  dataY: number[];
};

interface FitSetup {
  rhsWat: string;
  derivedWat?: string;
  nDerived?: number;
  y0: number[];
  pars: number[];
  fitIdx: number[];
  targetKind: "state" | "derived";
  ovrIdx?: number[];
  experiments: TestExperiment[];
  targetResidualNorm?: number;
  ssTol?: number;
  ssTMax?: number;
}

/** fit_init over the generalized experiment layout (fit_wrapper.c's own
 * doc comment); returns a disposer for the registered functions. */
function initFit(setup: FitSetup): { rc: number; dispose: () => void } {
  const modelIdx = compileWatFn(setup.rhsWat);
  mod._set_model_fn(modelIdx);
  let derivedIdx: number | null = null;
  if (setup.derivedWat) {
    derivedIdx = compileWatFn(setup.derivedWat);
    mod._set_derived_fn(derivedIdx);
  }
  const exps = setup.experiments;
  const ovrIdx = setup.ovrIdx ?? [];
  const allDataY = exps.flatMap((e) => e.dataY);
  const ptrs = {
    y0: allocF64(setup.y0),
    pars: allocF64(setup.pars),
    fitIdx: allocI32(setup.fitIdx),
    logFlags: allocI32(setup.fitIdx.map(() => 1)),
    targetKind: allocI32([setup.targetKind === "state" ? 0 : 1]),
    targetIndex: allocI32([0]),
    targetScale: allocF64([
      Math.max(...allDataY.filter((v) => !Number.isNaN(v)).map(Math.abs)),
    ]),
    ovrIdx: allocI32(ovrIdx),
    expKind: allocI32(exps.map((e) => e.kind)),
    expNSeg: allocI32(exps.map((e) => e.segments.length)),
    expNPoints: allocI32(exps.map((e) => e.dataT.length)),
    segTEnd: allocF64(exps.flatMap((e) => e.segments.map((g) => g.tEnd))),
    segOvr: allocF64(exps.flatMap((e) => e.segments.flatMap((g) => g.ovr))),
    dataT: allocF64(exps.flatMap((e) => e.dataT)),
    dataY: allocF64(allDataY),
  };
  const nSeg = exps.reduce((n, e) => n + e.segments.length, 0);
  const nPoints = exps.reduce((n, e) => n + e.dataT.length, 0);
  const rc = mod._fit_init(
    setup.y0.length,
    ptrs.y0,
    setup.pars.length,
    ptrs.pars,
    setup.fitIdx.length,
    ptrs.fitIdx,
    ptrs.logFlags,
    1,
    ptrs.targetKind,
    ptrs.targetIndex,
    ptrs.targetScale,
    ovrIdx.length,
    ptrs.ovrIdx,
    exps.length,
    ptrs.expKind,
    ptrs.expNSeg,
    ptrs.expNPoints,
    nSeg,
    ptrs.segTEnd,
    ptrs.segOvr,
    nPoints,
    ptrs.dataT,
    ptrs.dataY,
    setup.nDerived ?? (setup.derivedWat ? 1 : 0),
    0, // solver = radau5
    1e-8,
    1e-10,
    setup.ssTol ?? 1e-6,
    setup.ssTMax ?? 1e6,
    setup.targetResidualNorm ?? -1,
    0,
  );
  for (const ptr of Object.values(ptrs)) mod._free(ptr);
  return {
    rc,
    dispose: () => {
      mod._fit_free();
      mod.removeFunction(modelIdx);
      if (derivedIdx !== null) mod.removeFunction(derivedIdx);
    },
  };
}

function runToConvergence(setup: FitSetup) {
  const { rc, dispose } = initFit(setup);
  if (rc !== 0) {
    dispose();
    throw new Error(`fit_init failed: ${rc}`);
  }
  let info = 5;
  let chunks = 0;
  while (info === 5 && chunks < 50) {
    info = mod._fit_chunk(30);
    chunks++;
  }
  const nPars = setup.pars.length;
  const outPtr = mod._malloc(nPars * 8);
  mod._fit_get_params(outPtr);
  const params = Array.from(
    mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + nPars),
  );
  mod._free(outPtr);
  const residualNorm = mod._fit_get_residual_norm();
  dispose();
  return { params, info, chunks, residualNorm };
}

function runFit(
  targetKind: "state" | "derived",
  k0: number,
  trueK: number,
  targetResidualNorm = -1,
) {
  const y0Val = 10;
  const dataT = [0, 1, 2, 3, 4, 5];
  const modelValue = (k: number, t: number) => y0Val * Math.exp(-k * t);
  const dataValue = (t: number) =>
    targetKind === "state"
      ? modelValue(trueK, t)
      : trueK * modelValue(trueK, t);
  const { params, ...rest } = runToConvergence({
    rhsWat,
    derivedWat: targetKind === "derived" ? derivedWat : undefined,
    y0: [y0Val],
    pars: [k0],
    fitIdx: [0],
    targetKind,
    targetResidualNorm,
    experiments: [
      {
        kind: EXP_TIME_COURSE,
        segments: [{ tEnd: dataT[dataT.length - 1], ovr: [] }],
        dataT,
        dataY: dataT.map(dataValue),
      },
    ],
  });
  return { kFinal: params[0], ...rest };
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

  it("stops early once the residual norm crosses targetResidualNorm", () => {
    // A loose target — well above lmdif's own eventual converged residual
    // (~1e-6 or below for this noiseless problem) but not satisfied by the
    // k0=0.1 starting guess either, so the check has to actually engage
    // mid-fit rather than trivially at the first or last evaluation.
    const loose = runFit("state", 0.1, 0.5, 0.5);
    expect(loose.info).toBe(-2);
    // The reported residual must be the *trial* point that tripped the
    // check, not a stale value from whatever the previously accepted point
    // was — lmdif only writes trial evaluations into its own scratch fvec,
    // not the caller-visible one fit_chunk would otherwise recompute from.
    expect(loose.residualNorm).toBeLessThanOrEqual(0.5);

    const full = runFit("state", 0.1, 0.5, -1);
    expect(full.info).not.toBe(-2);
    expect(loose.residualNorm).toBeGreaterThan(full.residualNorm);

    // Stopping at a looser residual means less total optimization work than
    // running to full convergence.
    expect(loose.chunks).toBeLessThanOrEqual(full.chunks);
    // Recovered k should have moved from the starting guess (the target
    // check must fire on an actual accepted trial point, not leave x
    // stranded at k0) but not be fully converged onto trueK either.
    expect(loose.kFinal).not.toBeCloseTo(0.1, 1);
    expect(loose.kFinal).not.toBeCloseTo(0.5, 2);
  });
});

// Analytic solution of dY/dt = u - k*Y under a piecewise-constant u.
function protocolSolution(
  k: number,
  y0: number,
  segments: { tEnd: number; u: number }[],
  t: number,
): { y: number; u: number } {
  let tStart = 0;
  let y = y0;
  for (const seg of segments) {
    const tStop = Math.min(t, seg.tEnd);
    y = seg.u / k + (y - seg.u / k) * Math.exp(-k * (tStop - tStart));
    // A boundary point belongs to the earlier segment (fit_wrapper.c's
    // run_time_course doc comment).
    if (t <= seg.tEnd) return { y, u: seg.u };
    tStart = seg.tEnd;
  }
  throw new Error("t past the protocol");
}

describe("fit_wrapper.c: protocol time courses", () => {
  const segments = [
    { tEnd: 2, u: 1 },
    { tEnd: 4, u: 3 },
    { tEnd: 6, u: 0.5 },
  ];
  // Includes both boundaries (t=2, t=4) and stops short of the last t_end.
  const dataT = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
  const trueK = 0.8;

  function protocolSetup(
    targetKind: "state" | "derived",
    k0: number,
  ): FitSetup {
    return {
      rhsWat: drivenRhsWat,
      derivedWat: targetKind === "derived" ? drivenDerivedWat : undefined,
      y0: [0],
      pars: [k0, 1],
      fitIdx: [0],
      targetKind,
      ovrIdx: [1],
      experiments: [
        {
          kind: EXP_TIME_COURSE,
          segments: segments.map((s) => ({ tEnd: s.tEnd, ovr: [s.u] })),
          dataT,
          dataY: dataT.map((t) => {
            const { y, u } = protocolSolution(trueK, 0, segments, t);
            return targetKind === "state" ? y : u * y;
          }),
        },
      ],
    };
  }

  it("recovers k from a state target under a 3-segment protocol", () => {
    const { params } = runToConvergence(protocolSetup("state", 0.2));
    expect(params[0]).toBeCloseTo(trueK, 3);
  });

  it("evaluates derived targets with each segment's own parameters", () => {
    // At the true k, every prediction (boundary points included) must match
    // u*Y with the u of the segment the point belongs to — a boundary point
    // evaluated under the *next* segment's u would be off by a factor of 3
    // (t=2) or 1/6 (t=4). Tolerance covers the linear resampling of sparse
    // RADAU5 steps, not a semantic slack.
    const { rc, dispose } = initFit(protocolSetup("derived", trueK));
    expect(rc).toBe(0);
    const outPtr = mod._malloc(dataT.length * 8);
    expect(mod._fit_get_predictions(outPtr)).toBe(0);
    const predictions = Array.from(
      mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + dataT.length),
    );
    mod._free(outPtr);
    dispose();
    dataT.forEach((t, j) => {
      const { y, u } = protocolSolution(trueK, 0, segments, t);
      expect(Math.abs(predictions[j] - u * y)).toBeLessThan(1e-2 * (u * y + 1));
    });

    const { params } = runToConvergence(protocolSetup("derived", 0.2));
    expect(params[0]).toBeCloseTo(trueK, 2);
  });

  it("rejects data past the protocol's last segment", () => {
    const setup = protocolSetup("state", 0.2);
    setup.experiments[0].dataT = [...dataT, 7];
    setup.experiments[0].dataY = [...setup.experiments[0].dataY, 0];
    const { rc, dispose } = initFit(setup);
    dispose();
    expect(rc).toBe(-3);
  });
});

describe("fit_wrapper.c: steady states", () => {
  const trueK = 0.5;
  const conditions = [1, 2, 5];

  function ssSetup(
    targetKind: "state" | "derived",
    k0: number,
    extra: Partial<FitSetup> = {},
  ): FitSetup {
    return {
      rhsWat: drivenRhsWat,
      derivedWat: targetKind === "derived" ? drivenDerivedWat : undefined,
      y0: [0],
      pars: [k0, 1],
      fitIdx: [0],
      targetKind,
      ovrIdx: [1],
      experiments: conditions.map((u) => ({
        kind: EXP_STEADY_STATE,
        segments: [{ tEnd: 0, ovr: [u] }],
        dataT: [0],
        dataY: [targetKind === "state" ? u / trueK : (u * u) / trueK],
      })),
      ...extra,
    };
  }

  it("recovers k from multi-condition steady-state data", () => {
    const { params } = runToConvergence(ssSetup("state", 0.1));
    expect(params[0]).toBeCloseTo(trueK, 3);
  });

  it("recovers k from a derived steady-state target", () => {
    const { params } = runToConvergence(ssSetup("derived", 2));
    expect(params[0]).toBeCloseTo(trueK, 3);
  });

  it("treats NaN observations as missing", () => {
    const setup = ssSetup("state", 0.1);
    setup.experiments[1].dataY = [NaN];
    const { params } = runToConvergence(setup);
    expect(params[0]).toBeCloseTo(trueK, 3);
  });

  it("exposes the model values behind each residual via fit_get_predictions", () => {
    const { rc, dispose } = initFit(ssSetup("state", trueK));
    expect(rc).toBe(0);
    const outPtr = mod._malloc(conditions.length * 8);
    expect(mod._fit_get_predictions(outPtr)).toBe(0);
    const predictions = Array.from(
      mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + conditions.length),
    );
    mod._free(outPtr);
    dispose();
    predictions.forEach((p, i) =>
      expect(p).toBeCloseTo(conditions[i] / trueK, 4),
    );
  });

  it("penalizes a steady state that never converges instead of failing", () => {
    // k ~ 0: Y grows linearly and never settles within ssTMax.
    const { rc, dispose } = initFit(
      ssSetup("state", 1e-9, { ssTMax: 10, fitIdx: [] }),
    );
    expect(rc).toBe(0);
    const residualNorm = mod._fit_get_residual_norm();
    const outPtr = mod._malloc(conditions.length * 8);
    mod._fit_get_predictions(outPtr);
    const predictions = Array.from(
      mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + conditions.length),
    );
    mod._free(outPtr);
    dispose();
    expect(residualNorm).toBeCloseTo(1e3 * Math.sqrt(conditions.length), 6);
    expect(predictions.every(Number.isNaN)).toBe(true);
  });
});

describe("radau5_wrapper.c: output buffer", () => {
  it("grows past its initial capacity instead of dropping steps", () => {
    // dY/dt = -k*Y over a long horizon at tight tolerances takes far more
    // accepted steps than the deliberately tiny initial capacity.
    const modelIdx = compileWatFn(rhsWat);
    mod._set_model_fn(modelIdx);
    mod._init_output(4, 1);
    const y = allocF64([1]);
    const pars = allocF64([1]);
    const tEnd = 50;
    const idid = mod._run_radau5(1, 0, tEnd, y, pars, 1e-12, 1e-14, 0, 500000);
    const n = mod._get_out_n();
    const lastT = mod.HEAPF64[mod._get_out_t() / 8 + n - 1];
    mod._free_output();
    mod._free(y);
    mod._free(pars);
    mod.removeFunction(modelIdx);
    expect(idid).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(4);
    expect(lastT).toBeCloseTo(tEnd, 10);
  });
});
