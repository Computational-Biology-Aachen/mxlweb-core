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
import { modelToSbml } from "@computational-biology-aachen/mxlweb-core/sbml";
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
  scale: 0.1,
  mechanism: "additive",
};

describe("KineticModelBuilder.addNNBlock", () => {
  it("adds every weight/bias as a Parameter", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    // layer0 (1 in -> 2 out): 2*1+2=4; output layer (2 -> 1): 1*2+1=3; +1 scale
    const generated = [...builder.parameters.keys()].filter((k) =>
      k.startsWith("corr_"),
    );
    expect(generated).toHaveLength(4 + 3 + 1);
  });

  it("does not create a reaction — mechanism composition happens at lower() time instead", () => {
    // Retired: an NN block used to be wired as an ordinary reaction
    // (stoichiometry {target: 1}), which is exactly what made a
    // multiplicative mechanism impossible to add later (multiplying a
    // variable's whole dx/dt isn't expressible as one more stoichiometric
    // term). Now composeNNBlocks handles every block, for both mechanisms
    // and both builders, at the shared lower() stage — see
    // NNBlockConfig.mechanism's doc comment.
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    expect(builder.reactions.size).toBe(0);
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

  it("removeNNBlock cleans up the generated parameters", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    builder.removeNNBlock("corr");
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
    // layer0 (1->5): 5+5=10; output (5->1): 5+1=6; +1 scale
    const generated = [...builder.parameters.keys()].filter((k) =>
      k.startsWith("corr_"),
    );
    expect(generated).toHaveLength(10 + 6 + 1);
  });

  it("clone() copies nnBlocks", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    const cloned = builder.clone();
    expect(cloned.nnBlocks.has("corr")).toBe(true);
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

  it("buildTex renders the block's contribution too, not just the hand-authored differential", () => {
    // buildTex() used to read `this.differentials.get(name)` directly,
    // bypassing dxdtExpr() entirely -- unlike buildJs()/buildWat()/every
    // other codegen path, which all go through dxdtExpr and so already got
    // this right. A model's "Generated LaTeX" preview silently omitted any
    // NN block as a result.
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5, texName: "k" })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]));

    const withoutBlock = builder.buildTex();
    builder.addNNBlock("corr", smallBlock);
    const withBlock = builder.buildTex();

    expect(withBlock).not.toBe(withoutBlock);
    expect(withBlock).toContain("k \\cdot x");
    expect(withBlock).toContain("NN_{corr}(\\vec{x})");
  });

  it("collapses the block to NN_{block}(x), not the fully-expanded expression tree", () => {
    // The full expansion (every weight/bias/max/ln/abs node, literally) is
    // unreadable regardless of whether it parses as valid LaTeX -- a 6x64
    // block prints ~20,800 nested terms -- and isn't how the UDE/Neural-ODE
    // literature notates this split anyway (e.g. Rackauckas et al.:
    // `f(x,p,t) + NN(x,θ)`). No generated weight/bias name should appear at
    // all in the rendered row.
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", { ...smallBlock, depth: 3 });

    const tex = builder.buildTex();
    for (const name of builder.parameters.keys()) {
      expect(tex).not.toContain(name);
    }
  });

  it("omits a redundant '0 +' prefix for a pure-NODE variable (no hand-authored differential)", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    expect(builder.buildTex()).toContain("&= s_{corr} \\cdot NN_{corr}(\\vec{x})");
  });

  it("escapes a block name containing '_' so it stays valid inside \\text{} (KaTeX, unlike plain LaTeX, rejects a bare '_' there)", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("my_block", smallBlock);
    const tex = builder.buildTex();
    expect(tex).toContain("s_{my\\_block} \\cdot NN_{my\\_block}(\\vec{x})");
  });
});

describe("KineticModelBuilder.buildTex with an NN block", () => {
  it("collapses the block's composed contribution to NN_{block}(x) instead of the expanded rate law", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", { ...smallBlock, depth: 3 });

    const tex = builder.buildTex();
    expect(tex).toContain("NN_{corr}(\\vec{x})");
    for (const name of builder.parameters.keys()) {
      expect(tex).not.toContain(name);
    }
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

// nnBlockOwnedParameterNames is the single source of truth mxl-web's UI
// filters through so a block's generated weights/biases never leak in as
// individual editable rows (ADR 0005 §2.1.3) — a review after the first UI
// implementation pass found three independent, slightly different
// reimplementations of this same prefix match with no shared home, and none
// applied to ModelEditor's own parameter table at all.
describe("ModelBuilderBase.nnBlockOwnedParameterNames", () => {
  it("covers exactly the generated weights/biases, not hand-authored parameters", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5 })
      .addNNBlock("corr", smallBlock);
    const owned = builder.nnBlockOwnedParameterNames();
    expect(owned.has("k")).toBe(false);
    const generated = [...builder.parameters.keys()].filter((n) => n !== "k");
    expect(generated.length).toBeGreaterThan(0);
    for (const name of generated) expect(owned.has(name)).toBe(true);
  });

  it("is empty once the block is removed", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    builder.removeNNBlock("corr");
    expect(builder.nnBlockOwnedParameterNames().size).toBe(0);
  });

  it("doesn't cross-match one block's prefix against another's similarly-named parameter", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("corr_wise_choice", { value: 1 })
      .addNNBlock("corr", smallBlock);
    expect(builder.nnBlockOwnedParameterNames().has("corr_wise_choice")).toBe(
      false,
    );
  });
});

// Grill-me follow-up to ADR 0005 §2.1: a "mechanism" selector
// (additive/multiplicative) for how a block composes onto its target(s).
// Multiplication can't be expressed as one more stoichiometric reaction
// term, which is exactly why NN blocks stopped being wired as reactions at
// all (see the "does not create a reaction" test above) — composeNNBlocks
// composes both mechanisms, for both builders, at the shared lower() stage
// instead. These tests verify the actual formulas numerically, not just
// that *something* changed.
describe("NN block mechanism: relative_multiply composes as f * (1 + scale*NN)", () => {
  it("OdeModelBuilder: verified numerically against the additive case's own raw contribution", () => {
    const mkBuilder = (mechanism: "additive" | "relative_multiply") =>
      new OdeModelBuilder()
        .addVariable("x", { value: 1 })
        .addParameter("k", { value: 0.5 })
        .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
        .addNNBlock("corr", { ...smallBlock, mechanism });

    const [dxdtMultiplicative] = evalJs(
      mkBuilder("relative_multiply").buildJs(),
      [0, [1], mkBuilder("relative_multiply").resolveParameters()],
    );
    const [dxdtAdditive] = evalJs(mkBuilder("additive").buildJs(), [
      0,
      [1],
      mkBuilder("additive").resolveParameters(),
    ]);

    // f(x) = k*x = 0.5. The additive case is exactly f + scale*NN, so
    // scale*NN = dxdtAdditive - f — extracting it this way (rather than
    // replicating Glorot init by hand) lets this test check the actual
    // composition formula without depending on nnBlock.ts's internals.
    const f = 0.5;
    const scaledNN = dxdtAdditive - f;
    expect(dxdtMultiplicative).toBeCloseTo(f * (1 + scaledNN), 8);
  });

  it("KineticModelBuilder: same formula, despite having no stoichiometric way to express it directly", () => {
    const mkBuilder = (mechanism: "additive" | "relative_multiply") =>
      new KineticModelBuilder()
        .addVariable("x", { value: 1 })
        .addReaction("v1", {
          fn: new Mul([new Num(0.5), new Name("x")]),
          stoichiometry: [{ name: "x", value: new Num(1) }],
        })
        .addNNBlock("corr", { ...smallBlock, mechanism });

    const [dxdtMultiplicative] = evalJs(
      mkBuilder("relative_multiply").buildJs(),
      [0, [1], mkBuilder("relative_multiply").resolveParameters()],
    );
    const [dxdtAdditive] = evalJs(mkBuilder("additive").buildJs(), [
      0,
      [1],
      mkBuilder("additive").resolveParameters(),
    ]);

    const f = 0.5;
    const scaledNN = dxdtAdditive - f;
    expect(dxdtMultiplicative).toBeCloseTo(f * (1 + scaledNN), 8);
  });

  it("mixed mechanisms on the same variable: every multiplicative block combines into one factor first, then every additive block is summed on top", () => {
    // Every block targets every variable (no per-block picker), so this is
    // the common case for a model with 2+ blocks, not a rare edge case.
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
      .addNNBlock("m", { ...smallBlock, seed: 1, mechanism: "relative_multiply" })
      .addNNBlock("a", { ...smallBlock, seed: 2, mechanism: "additive" });
    const [dxdt] = evalJs(builder.buildJs(), [0, [1], builder.resolveParameters()]);

    // Isolate each block's own raw scaled-NN contribution via its
    // standalone additive case, same technique as above.
    const isolatedScaledNN = (id: string, seed: number) => {
      const solo = new OdeModelBuilder()
        .addVariable("x", { value: 1 })
        .addParameter("k", { value: 0.5 })
        .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
        .addNNBlock(id, { ...smallBlock, seed, mechanism: "additive" });
      const [dxdtSolo] = evalJs(solo.buildJs(), [0, [1], solo.resolveParameters()]);
      return dxdtSolo - 0.5;
    };
    const scaledNNm = isolatedScaledNN("m", 1);
    const scaledNNa = isolatedScaledNN("a", 2);

    const f = 0.5;
    const expected = f * (1 + scaledNNm) + scaledNNa;
    expect(dxdt).toBeCloseTo(expected, 8);
  });

  it("buildTex wraps the mechanistic term in parens and shows (1 + s*NN(x)) as a multiplicative factor", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5, texName: "k" })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
      .addNNBlock("corr", { ...smallBlock, mechanism: "relative_multiply" });
    expect(builder.buildTex()).toContain(
      "(k \\cdot x) \\cdot (1 + s_{corr} \\cdot NN_{corr}(\\vec{x}))",
    );
  });
});

describe("NN block mechanism: multiply composes as f * scale*NN (bare product, no safeguard)", () => {
  it("verified numerically against the additive case's own raw contribution", () => {
    const mkBuilder = (mechanism: "additive" | "multiply") =>
      new OdeModelBuilder()
        .addVariable("x", { value: 1 })
        .addParameter("k", { value: 0.5 })
        .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
        .addNNBlock("corr", { ...smallBlock, mechanism });

    const [dxdtMultiply] = evalJs(mkBuilder("multiply").buildJs(), [
      0,
      [1],
      mkBuilder("multiply").resolveParameters(),
    ]);
    const [dxdtAdditive] = evalJs(mkBuilder("additive").buildJs(), [
      0,
      [1],
      mkBuilder("additive").resolveParameters(),
    ]);

    // f(x) = k*x = 0.5. scale*NN = dxdtAdditive - f (same extraction
    // technique as relative_multiply's test above). "multiply" is the bare
    // product f * (scale*NN), unlike relative_multiply's f * (1 + scale*NN).
    const f = 0.5;
    const scaledNN = dxdtAdditive - f;
    expect(dxdtMultiply).toBeCloseTo(f * scaledNN, 8);
  });

  it("buildTex shows scale*NN(x) as a bare multiplicative factor, no (1 + ...) wrapping", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5, texName: "k" })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
      .addNNBlock("corr", { ...smallBlock, mechanism: "multiply" });
    expect(builder.buildTex()).toContain(
      "(k \\cdot x) \\cdot s_{corr} \\cdot NN_{corr}(\\vec{x})",
    );
  });

  it("three mechanisms on the same variable: relative_multiply and multiply combine into one running product, then additive is summed on top", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addParameter("k", { value: 0.5 })
      .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
      .addNNBlock("rm", { ...smallBlock, seed: 1, mechanism: "relative_multiply" })
      .addNNBlock("mu", { ...smallBlock, seed: 2, mechanism: "multiply" })
      .addNNBlock("ad", { ...smallBlock, seed: 3, mechanism: "additive" });
    const [dxdt] = evalJs(builder.buildJs(), [0, [1], builder.resolveParameters()]);

    const isolatedScaledNN = (id: string, seed: number) => {
      const solo = new OdeModelBuilder()
        .addVariable("x", { value: 1 })
        .addParameter("k", { value: 0.5 })
        .setDifferential("x", new Mul([new Name("k"), new Name("x")]))
        .addNNBlock(id, { ...smallBlock, seed, mechanism: "additive" });
      const [dxdtSolo] = evalJs(solo.buildJs(), [0, [1], solo.resolveParameters()]);
      return dxdtSolo - 0.5;
    };
    const scaledNNrm = isolatedScaledNN("rm", 1);
    const scaledNNmu = isolatedScaledNN("mu", 2);
    const scaledNNad = isolatedScaledNN("ad", 3);

    const f = 0.5;
    const expected = f * (1 + scaledNNrm) * scaledNNmu + scaledNNad;
    expect(dxdt).toBeCloseTo(expected, 8);
  });
});

describe("KineticModelBuilder.buildMxlpy with NN blocks", () => {
  it("throws rather than silently omitting a block's dynamical contribution", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    expect(() => builder.buildMxlpy()).toThrow(/NN blocks/);
  });

  it("still works normally for a model with no NN blocks", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addReaction("v1", {
        fn: new Name("x"),
        stoichiometry: [{ name: "x", value: new Num(-1) }],
      });
    expect(() => builder.buildMxlpy()).not.toThrow();
  });
});

describe("modelToSbml with NN blocks", () => {
  it("throws rather than silently omitting a block's dynamical contribution", () => {
    // Same hazard as buildMxlpy: modelToSbml builds <listOfReactions>
    // purely from model.reactions, which used to get a block "for free"
    // via the now-removed reaction trick. Missed in the first pass of the
    // mechanism-composition change -- caught by an independent review.
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", smallBlock);
    expect(() => modelToSbml(builder, "m")).toThrow(/NN blocks/);
  });

  it("still works normally for a model with no NN blocks", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addReaction("v1", {
        fn: new Name("x"),
        stoichiometry: [{ name: "x", value: new Num(-1) }],
      });
    expect(() => modelToSbml(builder, "m")).not.toThrow();
  });
});

