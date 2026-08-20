/**
 * End-to-end verification of the graph-level backward-WAT orchestration
 * (ADR 0005 §4, `modelIr.ts`'s `buildAdjointGraph`/`irToAdjointWat`).
 *
 * `pushGradient.test.ts` already verifies every node type's local rule in
 * isolation; this file verifies the *orchestration* — walking a whole
 * model's `ModelIR.intermediates` in reverse, correctly threading λ through
 * a real reaction network (and an NN block, closing the loop with ADR 0005
 * §2.1's generator) — by actually compiling the generated adjoint WAT to
 * WASM and checking its output against finite differences of `L = Σ λ_i f_i`
 * computed from the *forward* JS codegen, for a fixed λ.
 *
 * Since `dlambda_i = -∂L/∂y_i` and `dtheta_k = -∂L/∂θ_k` by construction,
 * this simultaneously confirms the orchestration is wired correctly *and*
 * that the sign convention matches what a real backward integrator needs.
 */
import {
  KineticModelBuilder,
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

/** L(y, pars) = Σ_i lambda[i] * f_i(y, pars), for a fixed lambda — the scalar the adjoint differentiates. */
function makeL(
  rhs: (t: number, vars: number[], pars: number[]) => number[],
  lambda: number[],
) {
  return (vars: number[], pars: number[]) => {
    const f = rhs(0, vars, pars);
    return f.reduce((acc, fi, i) => acc + lambda[i] * fi, 0);
  };
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

function compileAdjointWat(
  wat: string,
  nVars: number,
  nPars: number,
  nTheta: number,
): (
  y: number[],
  lambda: number[],
  pars: number[],
) => { dlambda: number[]; dtheta: number[] } {
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
    lambdaPtr: number,
    parsPtr: number,
    dlambdaPtr: number,
    dthetaPtr: number,
  ) => void;
  const heap = new Float64Array(memory.buffer);
  const yByte = 0;
  const lambdaByte = nVars * 8;
  const parByte = 2 * nVars * 8;
  const dlambdaByte = (2 * nVars + nPars) * 8;
  const dthetaByte = (3 * nVars + nPars) * 8;

  return (y, lambda, pars) => {
    for (let i = 0; i < nVars; i++) heap[yByte / 8 + i] = y[i];
    for (let i = 0; i < nVars; i++) heap[lambdaByte / 8 + i] = lambda[i];
    for (let i = 0; i < nPars; i++) heap[parByte / 8 + i] = pars[i];
    fcn(nVars, 0, yByte, lambdaByte, parByte, dlambdaByte, dthetaByte);
    return {
      dlambda: Array.from(
        { length: nVars },
        (_, i) => heap[dlambdaByte / 8 + i],
      ),
      dtheta: Array.from(
        { length: nTheta },
        (_, i) => heap[dthetaByte / 8 + i],
      ),
    };
  };
}

describe("adjoint WAT: kinetic model with two coupled reactions", () => {
  it("dlambda and dtheta match finite differences of L = sum(lambda_i * f_i)", () => {
    // A -> B -> (decays), two mass-action reactions sharing rate constants
    // as fitted parameters: exercises coupling between state variables and
    // sharing of an intermediate (the rate expressions) across the walk.
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

    // thetaNames must align index-for-index with `pars` for the finite-diff
    // check below (centralDiff(..., pars, k) perturbs pars[k], asserted
    // against dtheta[k]) — true here because it's the model's full,
    // insertion-ordered parameter list, not a reordered/partial subset.
    const thetaNames = ["k1", "k2"];
    const adjointWat = builder.buildAdjointWat(thetaNames);
    const rhs = compileJsRhs(builder.buildJs());
    const runAdjoint = compileAdjointWat(adjointWat, 2, 2, thetaNames.length);

    const y = [1.3, 0.6];
    const pars = builder.resolveParameters(); // [k1, k2]
    const lambda = [0.4, -0.9];

    const { dlambda, dtheta } = runAdjoint(y, lambda, pars);

    const L = makeL(rhs, lambda);
    for (let i = 0; i < 2; i++) {
      const numeric = centralDiff((yy) => L(yy, pars), y, i);
      expect(-dlambda[i]).toBeCloseTo(numeric, 3);
    }
    for (let k = 0; k < thetaNames.length; k++) {
      const numeric = centralDiff((pp) => L(y, pp), pars, k);
      expect(-dtheta[k]).toBeCloseTo(numeric, 3);
    }
  });
});

describe("adjoint WAT: OdeModelBuilder with an active NN block", () => {
  it("dlambda and dtheta match finite differences, with the block's weights among theta", () => {
    // Closes the full loop: buildNNBlock's generated expression, wired via
    // addNNBlock, differentiated by the same orchestration as any
    // hand-written model — no NN-specific code anywhere in this path
    // (ADR 0005 §2.1's central claim).
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.4 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
      .addNNBlock("corr", {
        inputs: ["x"],
        depth: 1,
        width: 2,
        seed: 1,
        targets: ["x"],
        trained: true,
        scale: 0.1,
        mechanism: "additive",
      });

    const weightNames = [...builder.parameters.keys()].filter((k) =>
      k.startsWith("corr_"),
    );
    expect(weightNames.length).toBeGreaterThan(0);
    // Same alignment note as the previous test — this is the full parameter
    // list ("k" was added before the block, weightNames preserves the
    // block's own insertion order), so it matches `pars`'s order exactly.
    const thetaNames = ["k", ...weightNames];
    const adjointWat = builder.buildAdjointWat(thetaNames);
    const rhs = compileJsRhs(builder.buildJs());
    const runAdjoint = compileAdjointWat(
      adjointWat,
      1,
      builder.parameters.size,
      thetaNames.length,
    );

    const y = [0.8];
    const pars = builder.resolveParameters();
    const lambda = [1.7];

    const { dlambda, dtheta } = runAdjoint(y, lambda, pars);

    const L = makeL(rhs, lambda);
    const numericDlambda0 = centralDiff((yy) => L(yy, pars), y, 0);
    expect(-dlambda[0]).toBeCloseTo(numericDlambda0, 3);

    for (let k = 0; k < thetaNames.length; k++) {
      const numeric = centralDiff((pp) => L(y, pp), pars, k);
      expect(-dtheta[k]).toBeCloseTo(numeric, 3);
    }

    // Guards against a silently vacuous version of this test: a missing
    // `mechanism` field (schema-required but not enforced by vitest, which
    // doesn't type-check tests/ — tsconfig.json only includes src/) makes
    // composeNNBlocks drop the block's contribution entirely, so dx/dt
    // stops depending on its weights at all — dtheta for those indices
    // would then correctly match a numeric derivative that's also exactly
    // zero, "passing" without ever exercising the NN block's gradient path.
    const weightThetaIdx = thetaNames
      .map((name, i) => (name.startsWith("corr_") ? i : -1))
      .filter((i) => i >= 0);
    expect(weightThetaIdx.some((i) => Math.abs(dtheta[i]) > 1e-6)).toBe(true);
  });
});
