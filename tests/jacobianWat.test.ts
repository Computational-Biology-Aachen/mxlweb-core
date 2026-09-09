/**
 * End-to-end verification of the forward-sensitivity augmented-system WAT
 * generator (`modelIr.ts`'s `buildJacobianGraph`/`irToJacobianWat`) — the
 * analytic-Jacobian input for the "lm" backend's `lmder` path.
 *
 * `ds_{k,j}/dt = Σ_m (∂f_k/∂y_m)·s_{m,j} + ∂f_k/∂θ_j` is an *algebraic*
 * identity at any fixed (y, s, θ, t) — no ODE integration needed to check
 * it. This compiles the generated WAT to WASM, evaluates the augmented RHS
 * once at an arbitrary point (real y, arbitrary s, real θ), and compares
 * against ∂f_k/∂y_m and ∂f_k/∂θ_j computed by finite-differencing the plain
 * (JS-codegen'd) forward RHS — the same style `adjointWat.test.ts` uses for
 * dlambda/dtheta.
 */
import {
  KineticModelBuilder,
  additiveMechanism,
  softplusActivation,
  OdeModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import wat2wasm from "wat-compiler";
import { describe, expect, it } from "vitest";

function compileJsRhs(
  src: string,
): (t: number, vars: number[], pars: number[]) => number[] {
  return new Function(`return (${src});`)() as (
    t: number,
    vars: number[],
    pars: number[],
  ) => number[];
}

function centralDiff(
  g: (x: number[]) => number,
  x: number[],
  i: number,
  h = 1e-5,
): number {
  const plus = [...x];
  plus[i] += h;
  const minus = [...x];
  minus[i] -= h;
  return (g(plus) - g(minus)) / (2 * h);
}

/** Compiles a `buildJacobianWat` module: standard `buildModelWat` "fcn"
 * signature (n, t, y_ptr, f_ptr, pars_ptr) — the augmented state is treated
 * as ordinary extra state variables, no special calling convention. */
function compileJacobianWat(
  wat: string,
  nAug: number,
  nPars: number,
): (yAug: number[], pars: number[]) => number[] {
  const bytes = wat2wasm(wat);
  const memory = new WebAssembly.Memory({ initial: 4 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
    math: mathImports(),
  });
  const fcn = instance.exports.fcn as (
    n: number,
    t: number,
    yPtr: number,
    fPtr: number,
    parsPtr: number,
  ) => void;
  const heap = new Float64Array(memory.buffer);
  const yByte = 0;
  const fByte = nAug * 8;
  const parByte = 2 * nAug * 8;

  return (yAug, pars) => {
    for (let i = 0; i < nAug; i++) heap[yByte / 8 + i] = yAug[i];
    for (let i = 0; i < nPars; i++) heap[parByte / 8 + i] = pars[i];
    fcn(nAug, 0, yByte, fByte, parByte);
    return Array.from({ length: nAug }, (_, i) => heap[fByte / 8 + i]);
  };
}

describe("jacobian WAT: kinetic model with two coupled reactions", () => {
  it("ds/dt matches finite differences of the forward RHS", () => {
    const builder = new KineticModelBuilder()
      .addVariable("A", { value: 1 })
      .addVariable("B", { value: 1 })
      .addParameter("k1", { value: 0.7 })
      .addParameter("k2", { value: 0.3 })
      .addReaction("v1", {
        fn: new Mul([new Name("k1"), new Name("A")]),
        stoichiometry: [
          { name: "A", value: new Num(-1) },
          { name: "B", value: new Num(1) },
        ],
      })
      .addReaction("v2", {
        fn: new Mul([new Name("k2"), new Name("B")]),
        stoichiometry: [{ name: "B", value: new Num(-1) }],
      });

    const nY = 2;
    const thetaNames = ["k1", "k2"];
    const nTheta = thetaNames.length;
    const jacobianWat = builder.buildJacobianWat(thetaNames);
    const rhs = compileJsRhs(builder.buildJs());
    const runJacobian = compileJacobianWat(
      jacobianWat,
      nY + nY * nTheta,
      nY + nY * nTheta,
    );

    const y = [1.3, 0.6];
    const pars = builder.resolveParameters(); // [k1, k2]
    // Arbitrary current sensitivities — ds/dt is linear in s, so any values
    // exercise the identity; zero would trivially hide a wrong dfDy term.
    const s = [
      [0.5, -0.2],
      [-1.1, 0.9],
    ]; // s[j][k]

    const yAug = [
      ...y,
      ...Array.from({ length: nTheta * nY }, (_, idx) => {
        const j = Math.floor(idx / nY);
        const k = idx % nY;
        return s[j][k];
      }),
    ];
    const dydtAug = runJacobian(yAug, pars);

    const dfDy: number[][] = [];
    const dfDTheta: number[][] = [];
    for (let k = 0; k < nY; k++) {
      dfDy.push(
        Array.from({ length: nY }, (_, m) =>
          centralDiff((yy) => rhs(0, yy, pars)[k], y, m),
        ),
      );
      dfDTheta.push(
        Array.from({ length: nTheta }, (_, j) =>
          centralDiff((pp) => rhs(0, y, pp)[k], pars, j),
        ),
      );
    }

    for (let k = 0; k < nY; k++) {
      expect(dydtAug[k]).toBeCloseTo(rhs(0, y, pars)[k], 6);
    }
    for (let j = 0; j < nTheta; j++) {
      for (let k = 0; k < nY; k++) {
        const expected =
          dfDy[k].reduce((acc, dkm, m) => acc + dkm * s[j][m], 0) +
          dfDTheta[k][j];
        expect(dydtAug[nY + j * nY + k]).toBeCloseTo(expected, 3);
      }
    }
  });
});

describe("jacobian WAT: OdeModelBuilder with an active NN block", () => {
  it("ds/dt matches finite differences, with the block's weights among theta", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.4 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
      .addNNBlock("corr", {
        inputs: ["x"],
        layers: [
          { type: "dense", width: 2, activation: softplusActivation() },
          { type: "dense", width: 1 },
        ],
        seed: 1,
        targets: ["x"],
        trained: true,
        scale: 0.1,
        mechanism: additiveMechanism(),
      });

    const nY = 1;
    const thetaNames = builder.getAllAddressableNames();
    const weightNames = [...builder.nnBlockWeightNames("corr")];
    expect(weightNames.length).toBeGreaterThan(0);
    expect(thetaNames).toEqual(["k", "corr_scale", ...weightNames]);
    const nTheta = thetaNames.length;

    const jacobianWat = builder.buildJacobianWat(thetaNames);
    const rhs = compileJsRhs(builder.buildJs());
    const runJacobian = compileJacobianWat(
      jacobianWat,
      nY + nY * nTheta,
      nY + nY * nTheta,
    );

    const y = [0.8];
    const pars = builder.resolveAllAddressableValues();
    const s = Array.from({ length: nTheta }, (_, j) => [0.3 + 0.1 * j]); // s[j][0]

    const yAug = [...y, ...s.map((row) => row[0])];
    const dydtAug = runJacobian(yAug, pars);

    const dfDy0 = centralDiff((yy) => rhs(0, yy, pars)[0], y, 0);
    const dfDTheta = Array.from({ length: nTheta }, (_, j) =>
      centralDiff((pp) => rhs(0, y, pp)[0], pars, j),
    );

    expect(dydtAug[0]).toBeCloseTo(rhs(0, y, pars)[0], 6);
    for (let j = 0; j < nTheta; j++) {
      const expected = dfDy0 * s[j][0] + dfDTheta[j];
      expect(dydtAug[nY + j]).toBeCloseTo(expected, 3);
    }

    // Same non-vacuous guard as adjointWat.test.ts: at least one weight's
    // sensitivity RHS must actually depend on ∂f/∂θ (not silently zero from
    // a dropped NN-block contribution).
    const weightThetaIdx = thetaNames
      .map((name, i) => (name.startsWith("corr_") ? i : -1))
      .filter((i) => i >= 0);
    expect(weightThetaIdx.some((j) => Math.abs(dfDTheta[j]) > 1e-6)).toBe(true);
  });
});
