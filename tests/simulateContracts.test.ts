/**
 * Contracts every WASM solver keeps through `simulate`, ported from other ODE
 * suites' tests: diffrax (test_saveat_solution, test_t0_eq_t1), OrdinaryDiffEq.jl
 * (InterfaceI, check_error), scipy.integrate (test_ivp, gh-8217, gh-17846) and
 * SUNDIALS (iterators / reinit). The solvers' own C contracts are tested in
 * mxl-solvers; these check that the TypeScript layer passes them through.
 */
import { buildModelWat } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Minus,
  Mul,
  Name,
  Num,
  Pow,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compileModelNode,
  loadCvodeNode,
  loadRadauNode,
} from "../src/backends/wasm/nodeLoader.js";
import { runtimeFor, simulate } from "../src/backends/wasm/simulate.js";
import type {
  Runtime,
  SimulationModule,
} from "../src/backends/wasm/wasmLoader.js";
import type { SimulationRequest } from "../src/index.js";

const METHODS = [
  "radau5",
  "dop853",
  "dopri5",
  "lsoda",
  "cvode_bdf",
  "cvode_adams",
] as const;

/** dY/dt = a - k*Y */
const linearWat = buildModelWat(
  [
    {
      varName: "Y",
      expr: new Minus([new Name("a"), new Mul([new Name("k"), new Name("Y")])]),
    },
  ],
  ["Y"],
  ["a", "k"],
);
/** dY/dt = Y^2: blows up at t = 1/Y0 */
const squareWat = buildModelWat(
  [{ varName: "Y", expr: new Mul([new Name("Y"), new Name("Y")]) }],
  ["Y"],
  ["a", "k"],
);
/** dY/dt = (a - t*k)^0.5 - Y: NaN once t > a/k (the generated WASM clamps ln, not pow) */
const nanLaterWat = buildModelWat(
  [
    {
      varName: "Y",
      expr: new Minus([
        new Pow(
          new Minus([
            new Name("a"),
            new Mul([new Name("time"), new Name("k")]),
          ]),
          new Num(0.5),
        ),
        new Name("Y"),
      ]),
    },
  ],
  ["Y"],
  ["a", "k"],
);

const baseReq: SimulationRequest = {
  requestId: "t",
  rhsWat: linearWat,
  allDerivedFn: "",
  selectDerivedFn: "",
  initialValues: [2],
  rhsNames: ["Y"],
  allDerivedNames: [],
  selectDerivedNames: [],
  tEnd: 10,
  nTimePoints: 50,
  pars: [0, 1],
  parNames: ["a", "k"],
  method: "radau5",
  calculateDerived: false,
  rtol: 1e-10,
  atol: 1e-12,
};

let runtimes: Record<Runtime, SimulationModule>;
const run = (req: Partial<SimulationRequest>) => {
  const full = { ...baseReq, ...req };
  const mod = runtimes[runtimeFor(full.method)];
  return simulate(mod, full, (wat) => compileModelNode(wat, mod));
};

beforeAll(async () => {
  runtimes = { radau5: await loadRadauNode(), cvode: await loadCvodeNode() };
});

describe.each(METHODS)("%s", (method) => {
  it("returns y0 exactly for a zero-length span and repeated times", async () => {
    const res = await run({ method, tEnd: 0, tEval: [0, 0, 0] });
    expect(res.time).toEqual([0, 0, 0]);
    expect(res.values).toEqual([[2], [2], [2]]);
  });

  it("returns every requested time, y(t0) bitwise and repeats identical", async () => {
    const tEval = [0, 0.125, 0.6, 0.61, 0.61, 0.8, 1];
    const res = await run({ method, tEnd: 1, tEval });
    expect(res.time).toEqual(tEval);
    expect(res.values[0]).toEqual([2]);
    expect(res.values[3]).toEqual(res.values[4]);
    res.values.forEach(([v], i) => {
      const want = 2 * Math.exp(-tEval[i]);
      expect(Math.abs(v - want) / want).toBeLessThan(1e-7);
    });
  });

  it("rejects requested times outside the span or out of order", async () => {
    await expect(run({ method, tEnd: 1, tEval: [0, 0.5, 2] })).rejects.toThrow(
      /failed/,
    );
    await expect(
      run({ method, tEnd: 1, tEval: [0, 0.7, 0.3] }),
    ).rejects.toThrow(/failed/);
  });

  it("rejects a non-finite initial state", async () => {
    await expect(run({ method, initialValues: [Number.NaN] })).rejects.toThrow(
      /failed/,
    );
  });

  it("fails, rather than returning garbage, when the RHS turns NaN", async () => {
    // (1 - t)^0.5: NaN from t = 1 on
    await expect(
      run({
        method,
        rhsWat: nanLaterWat,
        pars: [1, 1],
        tEnd: 2,
        rtol: 1e-8,
        atol: 1e-10,
      }),
    ).rejects.toThrow(/failed/);
  });

  it("fails on a blow-up", async () => {
    await expect(
      run({
        method,
        rhsWat: squareWat,
        initialValues: [1],
        tEnd: 2,
        rtol: 1e-8,
        atol: 1e-8,
      }),
    ).rejects.toThrow(/failed/);
  });

  it("gives identical results for identical requests", async () => {
    const req = { method, tEval: [0, 0.3, 3, 10] };
    const first = await run(req);
    await run({ method, pars: [1, 2] });
    const again = await run(req);
    expect(again.values).toEqual(first.values);
  });
});
