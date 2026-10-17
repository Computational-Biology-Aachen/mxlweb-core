/**
 * The derived-target gradient WAT (`modelIr.ts`'s `buildDerivedGradGraph`,
 * ADR 0009) against finite differences of the plain derived WAT, and the
 * size bound `liftSubexpressions` gives every gradient module.
 */
import { OdeModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Add,
  Divide,
  Exp,
  GreaterThan,
  Ln,
  Mul,
  Name,
  Num,
  Piecewise,
  Pow,
  type Base,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import wat2wasm from "wat-compiler";
import { describe, expect, it } from "vitest";

/** Compiles a derived-shaped module (n, t, y_ptr, out_ptr, pars_ptr). */
function compileDerived(
  wat: string,
  nOut: number,
): (y: number[], pars: number[]) => number[] {
  const memory = new WebAssembly.Memory({ initial: 4 });
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(wat2wasm(wat)),
    { env: { memory }, math: mathImports() },
  );
  const fcn = instance.exports.fcn as (...args: number[]) => void;
  const heap = new Float64Array(memory.buffer);
  return (y, pars) => {
    heap.set(y, 0);
    heap.set(pars, 64);
    fcn(y.length, 0.5, 0, 128 * 8, 64 * 8);
    return Array.from(heap.subarray(128, 128 + nOut));
  };
}

// dA/dt = -k1*A, dB/dt = k1*A - k2*B; readouts nest exp/ln/pow/piecewise.
function model(): OdeModelBuilder {
  const A = new Name("A");
  const B = new Name("B");
  return new OdeModelBuilder()
    .addVariable("A", { value: 1 })
    .addVariable("B", { value: 0 })
    .addParameter("k1", { value: 0.7 })
    .addParameter("k2", { value: 0.2 })
    .addParameter("c", { value: 3 })
    .addAssignment("v1", { fn: new Mul([new Name("k1"), A]) })
    .addReadout("signal", {
      fn: new Add([
        new Exp(new Divide([new Name("v1"), new Add([B, new Name("c")])])),
        new Ln(new Add([new Pow(B, new Num(2)), new Num(1)])),
        new Piecewise([
          new Mul([new Name("k2"), A]),
          new GreaterThan([A, B]),
          new Name("c"),
        ]),
      ]),
    })
    .setDifferential("A", new Mul([new Num(-1), new Name("v1")]))
    .setDifferential(
      "B",
      new Add([new Name("v1"), new Mul([new Num(-1), new Name("k2"), B])]),
    );
}

describe("buildDerivedGradGraph", () => {
  it("matches finite differences of the derived value in y and theta", () => {
    const m = model();
    const names = m.getAllAddressableNames(); // [k1, k2, c]
    const theta = ["k1", "c"];
    const value = compileDerived(m.buildWatDerived(["signal", "v1"]), 2);
    const grad = compileDerived(
      m.buildWatDerivedGrad(["signal", "v1"], theta),
      2 * (2 + theta.length),
    );
    const y = [0.8, 0.3];
    const pars = names.map((n) => ({ k1: 0.7, k2: 0.2, c: 3 })[n]!);
    const got = grad(y, pars);
    const h = 1e-6;
    for (let d = 0; d < 2; d++) {
      const block = got.slice(d * 4, d * 4 + 4);
      const fd = (bump: (y: number[], p: number[], s: number) => void) => {
        const yp = [...y];
        const pp = [...pars];
        bump(yp, pp, h);
        const ym = [...y];
        const pm = [...pars];
        bump(ym, pm, -h);
        return (value(yp, pp)[d] - value(ym, pm)[d]) / (2 * h);
      };
      const expected = [
        fd((yy, _, s) => (yy[0] += s)),
        fd((yy, _, s) => (yy[1] += s)),
        ...theta.map((t) => fd((_, pp, s) => (pp[names.indexOf(t)] += s))),
      ];
      block.forEach((g, i) => expect(g).toBeCloseTo(expected[i], 6));
    }
  });
});

describe("gradient modules stay linear in the model's size", () => {
  // A chain of n nested exp(x/(Y+c)) — a naive reverse pass copies the
  // subtree below every node into its derivative, quadratic in depth.
  function nested(n: number): OdeModelBuilder {
    let expr: Base = new Name("Y");
    for (let i = 0; i < n; i++) {
      expr = new Exp(
        new Divide([expr, new Add([new Name("Y"), new Name("c")])]),
      );
    }
    return new OdeModelBuilder()
      .addVariable("Y", { value: 1 })
      .addParameter("c", { value: 2 })
      .addReadout("out", { fn: expr })
      .setDifferential("Y", new Mul([new Num(-1), expr]));
  }

  it("grows ~linearly with nesting depth", () => {
    for (const build of [
      (m: OdeModelBuilder) => m.buildJacobianWat(["c"]),
      (m: OdeModelBuilder) => m.buildAdjointWat(["c"]),
      (m: OdeModelBuilder) => m.buildWatDerivedGrad(["out"], ["c"]),
    ]) {
      const small = build(nested(10)).length;
      const large = build(nested(40)).length;
      expect(large / small).toBeLessThan(6);
    }
  });
});
