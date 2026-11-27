/**
 * The pure-JS adaptive integrators (rk45, kvaerno45) and backward Euler, with
 * contracts ported from diffrax (test_reverse_time, test_t0_eq_t1,
 * test_ode_order), OrdinaryDiffEq.jl (check_error, FIRK "test adaptivity") and
 * scipy.integrate (test_integration_stiff). Errors are relative.
 */
import type { Model } from "../../../src/backends/js/index.js";
import {
  backwardEuler,
  kvaerno45,
  rk45,
} from "../../../src/backends/js/index.js";
import { describe, expect, it } from "vitest";

const decay: Model = (_t, y) => [-y[0]];
const relErr = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const robertson: Model = (_t, y) => [
  -0.04 * y[0] + 1e4 * y[1] * y[2],
  0.04 * y[0] - 1e4 * y[1] * y[2] - 3e7 * y[1] * y[1],
  3e7 * y[1] * y[1],
];
const ROBERTSON_40 = [
  0.715827068719394, 9.185534764557337e-6, 0.2841637457458413,
];

describe.each([
  ["rk45", rk45],
  ["kvaerno45", kvaerno45],
] as const)("%s", (_name, integrator) => {
  it("ends exactly at tEnd, accurately, recording every step", () => {
    const r = integrator(decay, {
      initialValues: [1],
      tEnd: 1,
      pars: [],
      rtol: 1e-9,
      atol: 1e-12,
    });
    expect(r.err).toBeUndefined();
    expect(r.time[0]).toBe(0);
    expect(r.values[0]).toEqual([1]);
    expect(r.time.at(-1)).toBe(1);
    expect(relErr(r.values.at(-1)![0], Math.exp(-1))).toBeLessThan(1e-7);
    for (let i = 1; i < r.time.length; i++)
      expect(r.time[i]).toBeGreaterThan(r.time[i - 1]);
  });

  it("integrates backward when tEnd < tStart", () => {
    const r = integrator(decay, {
      initialValues: [1],
      tStart: 1,
      tEnd: 0,
      pars: [],
      rtol: 1e-9,
      atol: 1e-12,
    });
    expect(r.err).toBeUndefined();
    expect(r.time.at(-1)).toBe(0);
    expect(relErr(r.values.at(-1)![0], Math.E)).toBeLessThan(1e-7);
  });

  it("returns y0 for a zero-length span", () => {
    const r = integrator(decay, {
      initialValues: [2],
      tStart: 1,
      tEnd: 1,
      pars: [],
    });
    expect(r).toEqual({ time: [1], values: [[2]] });
  });

  it("gets more accurate as the tolerance falls", () => {
    let prev = Infinity;
    for (const rtol of [1e-4, 1e-6, 1e-8]) {
      const r = integrator(decay, {
        initialValues: [1],
        tEnd: 2,
        pars: [],
        rtol,
        atol: rtol * 1e-2,
      });
      const err = relErr(r.values.at(-1)![0], Math.exp(-2));
      expect(err).toBeLessThan(prev);
      expect(err).toBeLessThan(100 * rtol);
      prev = err;
    }
  });

  it("reports a NaN right-hand side instead of returning NaN", () => {
    const r = integrator((t, y) => [t > 0.5 ? Number.NaN : -y[0]], {
      initialValues: [1],
      tEnd: 1,
      pars: [],
    });
    expect(r.err).toMatch(/negligible/);
    expect(r.values.flat().every(Number.isFinite)).toBe(true);
  });

  it("reports a blow-up", () => {
    const r = integrator((_t, y) => [y[0] * y[0]], {
      initialValues: [1],
      tEnd: 2,
      pars: [],
    });
    expect(r.err).toBeDefined();
    expect(r.time.at(-1)).toBeLessThan(1.01); // the pole is at t = 1
  });

  it("reports running out of steps", () => {
    const r = integrator(decay, {
      initialValues: [1],
      tEnd: 100,
      pars: [],
      maxSteps: 3,
      rtol: 1e-10,
      atol: 1e-12,
    });
    expect(r.err).toMatch(/maximum number of steps/);
  });

  it("refuses a non-finite initial state", () => {
    const r = integrator(decay, {
      initialValues: [Number.NaN],
      tEnd: 1,
      pars: [],
    });
    expect(r.err).toMatch(/finite/);
  });
});

describe("kvaerno45 on stiff problems", () => {
  it("matches Hairer & Wanner's Robertson reference at t = 40", () => {
    const r = kvaerno45(robertson, {
      initialValues: [1, 0, 0],
      tEnd: 40,
      pars: [],
      rtol: 1e-8,
      atol: 1e-12,
    });
    expect(r.err).toBeUndefined();
    r.values
      .at(-1)!
      .forEach((v, i) => expect(relErr(v, ROBERTSON_40[i])).toBeLessThan(1e-5));
  });

  it("takes far fewer steps than rk45 (scipy test_integration_stiff)", () => {
    const stiff = kvaerno45(robertson, {
      initialValues: [1, 0, 0],
      tEnd: 40,
      pars: [],
    });
    const explicit = rk45(robertson, {
      initialValues: [1, 0, 0],
      tEnd: 40,
      pars: [],
      maxSteps: 5000,
    });
    expect(stiff.err).toBeUndefined();
    expect(stiff.time.length).toBeLessThan(500);
    // rk45 is stability-limited: it either runs out of steps or needs many more.
    expect(
      explicit.err !== undefined ||
        explicit.time.length > 10 * stiff.time.length,
    ).toBe(true);
  });
});

describe("backwardEuler", () => {
  it("converges with order 1 (diffrax test_ode_order)", () => {
    const err = (stepSize: number) => {
      const r = backwardEuler(decay, {
        initialValues: [1],
        tEnd: 1,
        pars: [],
        stepSize,
        rtol: 1e-12,
        atol: 1e-14,
      });
      expect(r.time.at(-1)).toBe(1);
      return relErr(r.values.at(-1)![0], Math.exp(-1));
    };
    const slope = Math.log2(err(0.02) / err(0.01));
    expect(Math.abs(slope - 1)).toBeLessThan(0.1);
  });

  it("integrates backward", () => {
    const r = backwardEuler(decay, {
      initialValues: [1],
      tStart: 1,
      tEnd: 0,
      pars: [],
      stepSize: 1e-3,
    });
    expect(r.time.at(-1)).toBe(0);
    expect(relErr(r.values.at(-1)![0], Math.E)).toBeLessThan(1e-3);
  });

  it("reports a Newton failure instead of carrying on", () => {
    const r = backwardEuler((t, y) => [t > 0.5 ? Number.NaN : -y[0]], {
      initialValues: [1],
      tEnd: 1,
      pars: [],
    });
    expect(r.err).toMatch(/did not converge/);
  });
});
