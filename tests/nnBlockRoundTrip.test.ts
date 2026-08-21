/**
 * Round-trip tests for NN blocks (ADR 0005 §2.1; mxl-schemas nn_blocks v2)
 * through both serialization paths — `.mxl.json` (`buildMxlJson`/
 * `buildNNWeightsFile`/`mxlJsonToModel`) and the generated TS source
 * (`buildMxlweb`). The property that actually matters here: a block's
 * *fitted* weight/scale values must survive a round-trip, not reset to a
 * fresh Glorot-random draw. Weights and scale now survive via two different
 * mechanisms (mxl-schemas nn_blocks v2's structural split):
 *  - `scale` remains an ordinary `Parameter`, so both export paths still
 *    order NN-block reconstruction *before* the parameter section is
 *    applied, letting the parameter values win — same trick as before.
 *  - weights/biases live in `nnWeights` and never touch `parameters` at
 *    all; they instead round-trip via an explicit `trainedWeights`
 *    argument (`.mxl.json`: the `weights_ref` sidecar; `buildMxlweb`: the
 *    third `.addNNBlock(...)` argument), with no ordering dependency.
 * These tests exist specifically to catch a regression of either path.
 */
import {
  buildNNBlock,
  KineticModelBuilder,
  OdeModelBuilder,
  softplusActivation,
  type NNBlockConfig,
} from "@computational-biology-aachen/mxlweb-core";
import {
  mxlJsonToModel,
  type NNWeightsFile,
} from "@computational-biology-aachen/mxlweb-core/mxl";
import {
  Add,
  Base,
  Exp,
  Ln,
  Max,
  Minus,
  Abs,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

function makeBlock(): NNBlockConfig {
  return {
    inputs: ["x"],
    layers: [
      { type: "dense", width: 2, activation: softplusActivation() },
      { type: "dense", width: 1 },
    ],
    seed: 3,
    targets: ["x"],
    trained: true,
    scale: 0.1,
    mechanism: new Add([new Name("ode"), new Name("nde")]),
  };
}

/** Structural equality for an NNBlockConfig, comparing `Base` fields via `toJson()` (fresh imports get fresh process-unique `id`s, so plain `toEqual` on the `Base` instances themselves would spuriously fail) — including each layer's optional `activation.expression`, nested inside `layers`. */
function expectSameBlock(actual: NNBlockConfig, expected: NNBlockConfig) {
  expect(actual.inputs).toEqual(expected.inputs);
  expect(actual.layers.length).toEqual(expected.layers.length);
  actual.layers.forEach((layer, i) => {
    const expectedLayer = expected.layers[i];
    expect(layer.type).toEqual(expectedLayer.type);
    expect(layer.width).toEqual(expectedLayer.width);
    expect(layer.activation?.name).toEqual(expectedLayer.activation?.name);
    expect(layer.activation?.expression.toJson()).toEqual(
      expectedLayer.activation?.expression.toJson(),
    );
  });
  expect(actual.seed).toEqual(expected.seed);
  expect(actual.targets).toEqual(expected.targets);
  expect(actual.trained).toEqual(expected.trained);
  expect(actual.scale).toEqual(expected.scale);
  expect(actual.mechanism.toJson()).toEqual(expected.mechanism.toJson());
}

describe("NN blocks round-trip through .mxl.json", () => {
  it("architecture survives (kinetic)", () => {
    const block = makeBlock();
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", block);
    const weightsByRef = new Map<string, NNWeightsFile>([
      ["corr.weights.json", JSON.parse(builder.buildNNWeightsFile("corr"))],
    ]);
    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
      weightsByRef,
    ) as KineticModelBuilder;
    expectSameBlock(reimported.nnBlocks.get("corr")!, block);
    // No reaction created — mechanism composition happens at lower() time,
    // not via stoichiometry (NNBlockConfig.mechanism's doc comment).
    expect(reimported.reactions.size).toBe(0);
  });

  it("architecture survives (ode)", () => {
    const block = makeBlock();
    const builder = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .setDifferential("x", new Num(0))
      .addNNBlock("corr", block);
    const weightsByRef = new Map<string, NNWeightsFile>([
      ["corr.weights.json", JSON.parse(builder.buildNNWeightsFile("corr"))],
    ]);
    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
      weightsByRef,
    ) as OdeModelBuilder;
    expectSameBlock(reimported.nnBlocks.get("corr")!, block);
  });

  it("fitted weight values survive — NOT reset to a fresh random draw", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", makeBlock());
    // Simulate a fit result: overwrite one weight to a value the seeded
    // Glorot init would essentially never produce on its own.
    builder.nnWeights.set("corr_w0_0_0", 12345.678);

    const weightsByRef = new Map<string, NNWeightsFile>([
      ["corr.weights.json", JSON.parse(builder.buildNNWeightsFile("corr"))],
    ]);
    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
      weightsByRef,
    ) as KineticModelBuilder;
    expect(reimported.nnWeights.get("corr_w0_0_0")).toBe(12345.678);
    // Weights never leak into `parameters` — only `scale` does.
    expect(reimported.parameters.has("corr_w0_0_0")).toBe(false);
  });

  it("fitted scale value survives — NOT reset to config.scale's initial value", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", makeBlock());
    builder.updateParameter("corr_scale", { value: 42.5 });

    const weightsByRef = new Map<string, NNWeightsFile>([
      ["corr.weights.json", JSON.parse(builder.buildNNWeightsFile("corr"))],
    ]);
    const reimported = mxlJsonToModel(
      builder.buildMxlJson("m"),
      weightsByRef,
    ) as KineticModelBuilder;
    expect(reimported.parameters.get("corr_scale")?.value).toBe(42.5);
  });

  it("throws when trained but no weights file is supplied", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", makeBlock());
    expect(() => mxlJsonToModel(builder.buildMxlJson("m"))).toThrow(
      /no weights file supplied/,
    );
  });
});

describe("NN blocks round-trip through buildMxlweb", () => {
  const bindings = {
    KineticModelBuilder,
    Add,
    Base,
    Exp,
    Ln,
    Max,
    Minus,
    Abs,
    Mul,
    Name,
    Num,
  };

  function evalGenerated(source: string): KineticModelBuilder {
    const names = Object.keys(bindings);
    const fn = new Function(
      ...names,
      source
        // Strip every whole `import ... from "...";` statement, not just
        // its first line — softplus's activation tree alone pulls in
        // enough constructors (Abs/Add/Exp/Ln/Max/Minus/Name/Num) that
        // buildMxlweb's own template wraps the mathml import across
        // multiple lines, which a `/^import .*$/gm` (single-line-only)
        // strip leaves as dangling orphaned syntax.
        .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
        .replace(
          /export function initModel\(\)[^{]*\{/,
          "return function () {",
        ),
    );
    const initModel = fn(
      ...names.map((n) => (bindings as Record<string, unknown>)[n]),
    );
    return initModel() as KineticModelBuilder;
  }

  it("emits .addNNBlock(...) before the parameter chain, and fitted scale/weights both survive", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", makeBlock());
    builder.nnWeights.set("corr_w0_0_0", 999.5);
    builder.updateParameter("corr_scale", { value: 7.25 });

    const source = builder.buildMxlweb();
    const addNNBlockIdx = source.indexOf(".addNNBlock(");
    const addParameterIdx = source.indexOf(".addParameter(");
    expect(addNNBlockIdx).toBeGreaterThan(-1);
    expect(addParameterIdx).toBeGreaterThan(-1);
    expect(addNNBlockIdx).toBeLessThan(addParameterIdx);

    const rebuilt = evalGenerated(source);
    expect(rebuilt.nnWeights.get("corr_w0_0_0")).toBe(999.5);
    expect(rebuilt.parameters.get("corr_scale")?.value).toBe(7.25);
  });

  it("re-derives the exact same weight/bias key set via buildNNBlock, independent of the fitted values", () => {
    const builder = new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("corr", makeBlock());
    const source = builder.buildMxlweb();
    const rebuilt = evalGenerated(source);
    const { weights } = buildNNBlock({
      name: "corr",
      inputs: makeBlock().inputs,
      layers: makeBlock().layers,
      seed: makeBlock().seed,
      scale: makeBlock().scale,
    });
    expect(new Set(rebuilt.nnWeights.keys())).toEqual(new Set(weights.keys()));
  });
});
