/**
 * The plain simulation path on the real WASM runtime: dense output at requested
 * times, protocols, steady states and RHS output, against analytic solutions of
 * dY/dt = a - k*Y, where Y(t) = a/k + (Y0 - a/k) * exp(-k*t).
 */
import { buildModelWat } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Minus,
  Mul,
  Name,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compileModelNode,
  loadRadauNode,
} from "../src/backends/wasm/nodeLoader.js";
import { simulate } from "../src/backends/wasm/simulate.js";
import type { EmscriptenModule } from "../src/backends/wasm/wasmLoader.js";
import type { SimulationRequest } from "../src/index.js";

const rhsWat = buildModelWat(
  [
    {
      varName: "Y",
      expr: new Minus([new Name("a"), new Mul([new Name("k"), new Name("Y")])]),
    },
  ],
  ["Y"],
  ["a", "k"],
);

const baseReq: SimulationRequest = {
  requestId: "t",
  rhsWat,
  allDerivedFn: "",
  selectDerivedFn: "",
  initialValues: [2],
  rhsNames: ["Y"],
  allDerivedNames: [],
  selectDerivedNames: [],
  tEnd: 10,
  nTimePoints: 100,
  pars: [0, 1],
  parNames: ["a", "k"],
  method: "radau5",
  calculateDerived: false,
  rtol: 1e-10,
  atol: 1e-12,
};

const exact = (t: number, y0: number, a: number, k: number) =>
  a / k + (y0 - a / k) * Math.exp(-k * t);

let mod: EmscriptenModule;
const run = (req: Partial<SimulationRequest>) =>
  simulate(mod, { ...baseReq, ...req }, (wat) => compileModelNode(wat, mod));

beforeAll(async () => {
  mod = await loadRadauNode();
});

describe("simulate", () => {
  it("outputs exactly the requested times, off the solver's steps", async () => {
    const tEval = [0, 1e-6, 1e-3, 0.1, 1.2345, 7, 10];
    const res = await run({ tEval });
    expect(res.time).toEqual(tEval);
    res.values.forEach(([v], i) => {
      const want = exact(tEval[i], 2, 0, 1);
      expect(Math.abs(v - want) / want).toBeLessThan(1e-6);
    });
    expect(res.finalState[0]).toBeCloseTo(exact(10, 2, 0, 1), 8);
  });

  it("is more accurate than the interpolated output", async () => {
    const tEval = Array.from({ length: 100 }, (_, i) => (i * 10) / 99);
    const maxRelErr = (r: { time: number[]; values: number[][] }) =>
      Math.max(
        ...r.time.map((t, i) => {
          const want = exact(t, 2, 0, 1);
          return Math.abs(r.values[i][0] - want) / want;
        }),
      );
    const dense = await run({ tEval });
    const interp = await run({});
    expect(maxRelErr(dense)).toBeLessThan(maxRelErr(interp) / 100);
  });

  it("assigns tEval across protocol segments", async () => {
    const res = await run({
      tEnd: 0,
      protocol: [
        { t_end: 1, k: 1 },
        { t_end: 3, k: 2 },
      ],
      tEval: [0, 0.5, 1, 2, 3],
    });
    expect(res.time).toEqual([0, 0.5, 1, 2, 3]);
    const atSwitch = exact(1, 2, 0, 1);
    expect(res.values[2][0]).toBeCloseTo(atSwitch, 7);
    expect(res.values[3][0]).toBeCloseTo(exact(1, atSwitch, 0, 2), 7);
    expect(res.values[4][0]).toBeCloseTo(exact(2, atSwitch, 0, 2), 7);
  });

  it("grows the heap for very long outputs", async () => {
    const tEval = Array.from({ length: 2_000_000 }, (_, i) => i / 200_000);
    const res = await run({ tEval, rtol: 1e-6, atol: 1e-8 });
    expect(res.time).toHaveLength(tEval.length);
    expect(res.values[tEval.length - 1][0]).toBeCloseTo(
      exact(tEval[tEval.length - 1], 2, 0, 1),
      4,
    );
  });

  it("keeps the interpolated output unchanged without tEval", async () => {
    const res = await run({ nTimePoints: 11 });
    expect(res.time).toHaveLength(11);
    expect(res.time[10]).toBe(10);
  });

  it("finds a steady state", async () => {
    const res = await run({ pars: [3, 2], steadyState: {} });
    expect(res.values).toHaveLength(1);
    expect(res.values[0][0]).toBeCloseTo(1.5, 5);
  });

  it("fails rather than returning an unconverged steady state", async () => {
    await expect(
      run({ pars: [3, 1e-9], steadyState: { tMax: 200 } }),
    ).rejects.toThrow(/No steady state/);
  });

  it("returns dy/dt per output point", async () => {
    const res = await run({ pars: [3, 2], tEval: [0, 1], returnRhs: true });
    res.rhs!.forEach(([dy], i) => {
      expect(dy).toBeCloseTo(3 - 2 * res.values[i][0], 10);
    });
  });
});
