/**
 * Tests for how NN blocks (ADR 0005 §2.1) wire into each model builder —
 * `nnBlock.test.ts` covers the generator itself in isolation; this file
 * covers `ModelBuilderBase.addNNBlock`/`removeNNBlock`/`updateNNBlock` and
 * each builder's `wireNNBlockOutputs` override.
 */
import {
  KineticModelBuilder,
  type NNBlockConfig,
  OdeModelBuilder,
  SteadyStateModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import { Mul, Name, Num } from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

function evalJs(fn: string, args: unknown[]): number[] {
  const compiled = eval(fn) as (...a: unknown[]) => number[];
  return compiled(...args);
}

const smallBlock: NNBlockConfig = {
  inputs: ["x"],
  depth: 1,
  width: 2,
  seed: 1,
  targets: ["x"],
  trained: true,
};

describe("KineticModelBuilder.addNNBlock", () => {
  it("adds every weight/bias as a Parameter", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    // layer0 (1 in -> 2 out): 2*1+2=4; output layer (2 -> 1): 1*2+1=3
    const generated = [...builder.parameters.keys()].filter((k) =>
      k.startsWith("corr_"),
    );
    expect(generated).toHaveLength(4 + 3);
  });

  it("adds one reaction per output, with stoichiometry {target: 1}", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    expect(builder.reactions.has("corr_out0")).toBe(true);
    const rxn = builder.reactions.get("corr_out0")!;
    expect(rxn.stoichiometry).toEqual([{ name: "x", value: expect.any(Num) }]);
    expect((rxn.stoichiometry[0].value as Num).value).toBe(1);
  });

  it("the wired reaction actually contributes to dx/dt", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    const js = builder.buildJs();
    const pars = builder.resolveParameters();
    const [dxdt] = evalJs(js, [0, [1], pars]);
    // With x=1 and Glorot-initialized weights (seed=1), the block's
    // contribution is whatever it is — the real assertion is just that it's
    // *not* the "no block" answer of exactly 0 (a plain KineticModelBuilder
    // with no reactions at all always returns dx/dt=0).
    expect(dxdt).not.toBe(0);
  });

  it("removeNNBlock cleans up both the reaction and the generated parameters", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    builder.removeNNBlock("corr");
    expect(builder.reactions.has("corr_out0")).toBe(false);
    expect(builder.nnBlocks.has("corr")).toBe(false);
    expect([...builder.parameters.keys()].some((k) => k.startsWith("corr_"))).toBe(
      false,
    );
    // Back to a plain, block-free model: dx/dt is exactly 0.
    const js = builder.buildJs();
    const [dxdt] = evalJs(js, [0, [1], builder.resolveParameters()]);
    expect(dxdt).toBe(0);
  });

  it("updateNNBlock re-architects (different parameter count)", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    builder.updateNNBlock("corr", { ...smallBlock, width: 5 });
    // layer0 (1->5): 5+5=10; output (5->1): 5+1=6
    const generated = [...builder.parameters.keys()].filter((k) =>
      k.startsWith("corr_"),
    );
    expect(generated).toHaveLength(10 + 6);
  });

  it("clone() copies nnBlocks", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    const cloned = builder.clone();
    expect(cloned.nnBlocks.has("corr")).toBe(true);
    expect(cloned.reactions.has("corr_out0")).toBe(true);
  });

  it("two blocks targeting the same variable both contribute", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("a", { ...smallBlock, seed: 1 })
      .addNNBlock("b", { ...smallBlock, seed: 2 });
    const js = builder.buildJs();
    const [both] = evalJs(js, [0, [1], builder.resolveParameters()]);

    const onlyA = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("a", { ...smallBlock, seed: 1 });
    const [justA] = evalJs(onlyA.buildJs(), [
      0,
      [1],
      onlyA.resolveParameters(),
    ]);

    // Different seeds (near-certainly) produce different, nonzero
    // contributions, so the sum shouldn't equal either one alone.
    expect(both).not.toBeCloseTo(justA, 6);
  });
});

describe("OdeModelBuilder.addNNBlock", () => {
  it("dxdtExpr sums the hand-authored differential and the block's contribution", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]));
    builder.addNNBlock("corr", smallBlock);

    const js = builder.buildJs();
    const pars = builder.resolveParameters();
    const [dxdt] = evalJs(js, [0, [1], pars]);

    // Mechanistic-only baseline (no block) for comparison: k*x = 0.5*1 = 0.5.
    const mechanisticOnly = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]));
    const [mechanisticDxdt] = evalJs(mechanisticOnly.buildJs(), [
      0,
      [1],
      mechanisticOnly.resolveParameters(),
    ]);

    expect(dxdt).not.toBeCloseTo(mechanisticDxdt, 6);
  });

  it("removeNNBlock reverts to exactly the hand-authored differential", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]));
    const [before] = evalJs(builder.buildJs(), [0, [1], builder.resolveParameters()]);

    builder.addNNBlock("corr", smallBlock);
    builder.removeNNBlock("corr");
    const [after] = evalJs(builder.buildJs(), [0, [1], builder.resolveParameters()]);

    expect(after).toBeCloseTo(before, 10);
  });
});

describe("SteadyStateModelBuilder.addNNBlock", () => {
  it("throws — no differential equation for a block to feed into — and leaves the builder untouched", () => {
    const builder = new SteadyStateModelBuilder().addParameter("p", { value: 1 });
    expect(() => builder.addNNBlock("corr", { ...smallBlock, inputs: ["p"] })).toThrow();
    // The reordering fix in addNNBlock (wire before mutate) means no
    // partial state should have been left behind by the throw.
    expect(builder.nnBlocks.size).toBe(0);
    expect([...builder.parameters.keys()]).toEqual(["p"]);
  });
});
