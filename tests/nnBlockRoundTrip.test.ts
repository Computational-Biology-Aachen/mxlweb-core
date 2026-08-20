/**
 * Round-trip tests for NN blocks (ADR 0005 §2.1) through both serialization
 * paths — `.mxl.json` (`buildMxlJson`/`mxlJsonToModel`) and the generated TS
 * source (`buildMxlweb`). The property that actually matters here: a block's
 * *fitted* weight values must survive a round-trip, not reset to a fresh
 * Glorot-random draw — `addNNBlock` always reinitializes from `seed`, so
 * both export paths deliberately order NN-block reconstruction *before* the
 * parameter section is applied, letting the parameter values win. These
 * tests exist specifically to catch a regression of that ordering.
 */
import {
  KineticModelBuilder,
  type NNBlockConfig,
  OdeModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import { mxlJsonToModel } from "@computational-biology-aachen/mxlweb-core/mxl";
import {
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

const block: NNBlockConfig = {
  inputs: ["x"],
  depth: 1,
  width: 2,
  seed: 3,
  targets: ["x"],
  trained: true,
  scale: 0.1,
  mechanism: "additive",
};

describe("NN blocks round-trip through .mxl.json", () => {
  it("architecture survives (kinetic)", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", block);
    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
    ) as KineticModelBuilder;
    expect(reimported.nnBlocks.get("corr")).toEqual(block);
    // No reaction created — mechanism composition happens at lower() time,
    // not via stoichiometry (NNBlockConfig.mechanism's doc comment).
    expect(reimported.reactions.size).toBe(0);
  });

  it("architecture survives (ode)", () => {
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .setDifferential("x", new Num(0))
      .addNNBlock("corr", block);
    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
    ) as OdeModelBuilder;
    expect(reimported.nnBlocks.get("corr")).toEqual(block);
  });

  it("fitted weight values survive — NOT reset to a fresh random draw", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", block);
    // Simulate a fit result: overwrite one weight to a value the seeded
    // Glorot init would essentially never produce on its own.
    builder.updateParameter("corr_w0_0_0", { value: 12345.678 });

    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
    ) as KineticModelBuilder;
    expect(reimported.parameters.get("corr_w0_0_0")?.value).toBe(12345.678);
  });
});

describe("NN blocks round-trip through buildMxlweb", () => {
  it("emits .addNNBlock(...) before the parameter chain, and fitted values survive", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", block);
    builder.updateParameter("corr_w0_0_0", { value: 999.5 });

    const source = builder.buildMxlweb();
    const addNNBlockIdx = source.indexOf(".addNNBlock(");
    const addParameterIdx = source.indexOf(".addParameter(");
    expect(addNNBlockIdx).toBeGreaterThan(-1);
    expect(addParameterIdx).toBeGreaterThan(-1);
    expect(addNNBlockIdx).toBeLessThan(addParameterIdx);

    // Actually execute the generated source and check the fitted value
    // survived, not just the textual ordering. buildMxlweb's output
    // references its imports as bare identifiers (KineticModelBuilder,
    // Name, Num, ...), so evaluate it in a scope where those are already
    // bound as function parameters, with the (unresolvable-in-eval) import
    // lines stripped and its `export function` turned into a `return`.
    const withBindings = new Function(
      "KineticModelBuilder",
      "Mul",
      "Name",
      "Num",
      source
        .replace(/^import .*$/gm, "")
        .replace(
          /export function initModel\(\)[^{]*\{/,
          "return function () {",
        ),
    );
    const initModel = withBindings(KineticModelBuilder, Mul, Name, Num);
    const rebuilt = initModel() as KineticModelBuilder;
    expect(rebuilt.parameters.get("corr_w0_0_0")?.value).toBe(999.5);
  });
});
