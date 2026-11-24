/**
 * Terms, hidden-state nn_blocks and input/output scales (mxl-schemas 0.5,
 * mxlweb-core #51), checked against MxlPy: `tests/assets/terms/*` are written
 * by `scripts/gen-term-fixtures.py` with `mxlpy.serialize.save`, together
 * with MxlPy's right-hand side and term contributions at one point.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  additiveMechanism,
  isNNBlockOwnedWeightName,
  KineticModelBuilder,
  type ModelBuilderBase,
  type MxlJsonDocument,
  OdeModelBuilder,
  relativeMultiplyMechanism,
  SteadyStateModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import {
  mxlJsonToModel,
  type NNWeightsFile,
} from "@computational-biology-aachen/mxlweb-core/mxl";
import { modelToSbml } from "@computational-biology-aachen/mxlweb-core/sbml";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import wat2wasm from "wat-compiler";
import { describe, expect, it } from "vitest";

type Expected = {
  time: number;
  variables: Record<string, number>;
  rhs: Record<string, number>;
  contributions: Record<string, number>;
};

type Rhs = (t: number, y: number[], p: number[]) => number[];

const ASSETS = resolve(import.meta.dirname, "assets/terms");

function load(name: string): {
  doc: MxlJsonDocument;
  weights: Map<string, NNWeightsFile>;
  expected: Expected;
} {
  const read = (file: string) =>
    JSON.parse(readFileSync(resolve(ASSETS, name, file), "utf8"));
  const doc = read("model.mxl.json") as MxlJsonDocument;
  const weights = new Map<string, NNWeightsFile>();
  for (const block of Object.values(doc.model.nn_blocks ?? {})) {
    if (block.weights_ref !== undefined) {
      weights.set(block.weights_ref, read(block.weights_ref));
    }
  }
  return { doc, weights, expected: read("expected.json") };
}

function relClose(actual: number, expected: number, label: string) {
  const scale = Math.max(Math.abs(expected), 1e-300);
  expect(
    Math.abs(actual - expected) / scale,
    `${label}: ${actual} vs ${expected}`,
  ).toBeLessThan(1e-12);
}

function compileWatRhs(wat: string, nVars: number): Rhs {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(wat2wasm(wat)),
    { env: { memory }, math: mathImports() },
  );
  const fcn = instance.exports.fcn as (...a: number[]) => void;
  const heap = new Float64Array(memory.buffer);
  return (t, y, p) => {
    heap.set(y, 0);
    heap.set(p, 2 * nVars);
    fcn(nVars, t, 0, nVars * 8, 2 * nVars * 8);
    return Array.from({ length: nVars }, (_, i) => heap[nVars + i]);
  };
}

function checkAgainstMxlpy(model: ModelBuilderBase, expected: Expected) {
  const names = model.getNames();
  expect(names).toEqual(Object.keys(expected.rhs));
  const y = names.map((n) => expected.variables[n]);
  const pars = model.resolveAllAddressableValues();

  const js = new Function(`return (${model.buildJs()})`)() as Rhs;
  const wat = compileWatRhs(model.buildWat(), names.length);
  for (const [backend, rhs] of [
    ["js", js],
    ["wat", wat],
  ] as const) {
    rhs(expected.time, y, pars).forEach((v, i) =>
      relClose(v, expected.rhs[names[i]], `${backend} d${names[i]}/dt`),
    );
  }

  const { allDerived } = model.buildJsDerived();
  const all = new Function(`return (${allDerived})`)();
  const values: number[] = all(expected.time, y, pars);
  const derived = model.derivedNames();
  for (const [name, value] of Object.entries(expected.contributions)) {
    relClose(values[derived.indexOf(name)], value, `contribution ${name}`);
  }
}

describe.each(["kinetic", "ode"])("%s fixture matches MxlPy", (name) => {
  const { doc, weights, expected } = load(name);

  it("right-hand side and contributions", () => {
    checkAgainstMxlpy(mxlJsonToModel(doc, weights), expected);
  });

  it("round-trips through .mxl.json and the weights files", () => {
    const model = mxlJsonToModel(doc, weights);
    const json = JSON.parse(model.buildMxlJson(name)) as MxlJsonDocument;
    expect(json.spec_version).toBe("0.5");
    const sidecars = new Map(
      [...model.nnBlocks.keys()].map((key) => [
        `${key}.weights.json`,
        JSON.parse(model.buildNNWeightsFile(key)) as NNWeightsFile,
      ]),
    );
    checkAgainstMxlpy(mxlJsonToModel(json, sidecars), expected);
  });

  it("starts the hidden states at the sidecar's h0", () => {
    const model = mxlJsonToModel(doc, weights);
    const initial = new Map(
      model.getNames().map((n, i) => [n, model.resolveInitialValues()[i]]),
    );
    for (const [key, block] of Object.entries(doc.model.nn_blocks ?? {})) {
      const h0 = weights.get(block.weights_ref!)!.h0 as number[];
      h0.forEach((v, i) => expect(initial.get(`${key}_h${i}`)).toBe(v));
    }
  });
});

describe("hidden-state blocks", () => {
  const base = () =>
    new KineticModelBuilder()
      .addParameter("k", { value: 1 })
      .addVariable("S", { value: 1 })
      .addReaction("v", {
        fn: new Mul([new Name("k"), new Name("S")]),
        stoichiometry: [{ name: "S", value: new Num(-1) }],
      });
  const hiddenConfig = {
    inputs: ["S"],
    layers: [{ type: "dense" as const, width: 2 }],
    seed: 7,
    targetKind: "variable" as const,
    targets: ["S"],
    trained: true,
    mechanism: additiveMechanism(),
    hiddenStates: 2,
  };

  it("untrained: Glorot readout, zero biases, h0 = 0, no scale parameter", () => {
    const m = base().addNNBlock("aug", hiddenConfig);
    expect(m.getNames()).toEqual(["S", "aug_h0", "aug_h1"]);
    expect(m.resolveInitialValues()).toEqual([1, 0, 0]);
    expect(m.nnWeights.get("aug_W_0_0")).not.toBe(0);
    expect(m.nnWeights.get("aug_b0_0")).toBe(0);
    expect(m.parameters.has("aug_scale")).toBe(false);
    expect(m.nnBlockScaleParameterNames().size).toBe(0);
    expect([...m.nnBlockWeightNames("aug")]).toContain("aug_W_0_1");
  });

  it("removing the block removes its states and readout", () => {
    const m = base().addNNBlock("aug", hiddenConfig).removeNNBlock("aug");
    expect(m.getNames()).toEqual(["S"]);
    expect(m.nnWeights.size).toBe(0);
    expect(m.nnHiddenInitials.size).toBe(0);
  });

  it("rejects inconsistent configs", () => {
    const { hiddenStates: _, ...markovian } = hiddenConfig;
    expect(() => base().addNNBlock("b", markovian)).toThrow(/needs a scale/);
    expect(() =>
      base().addNNBlock("b", { ...hiddenConfig, hiddenStates: 3 }),
    ).toThrow(/width 2, expected 3/);
    expect(() =>
      base().addNNBlock("b", { ...hiddenConfig, inputScales: [0] }),
    ).toThrow(/positive inputScales/);
    expect(() => base().addNNBlock("b", hiddenConfig, undefined, [1])).toThrow(
      /2 hidden states but 1 initial values/,
    );
  });

  it("refuses generated ids that are already taken", () => {
    expect(() =>
      base()
        .addReadout("aug_S", { fn: new Num(1) })
        .addNNBlock("aug", hiddenConfig),
    ).toThrow(/already taken: aug_S/);
    expect(() =>
      base()
        .addParameter("aug_h1", { value: 1 })
        .addNNBlock("aug", hiddenConfig),
    ).toThrow(/already taken: aug_h1/);
  });

  it("updateNNBlock keeps the old block when the new config is invalid", () => {
    const m = base().addNNBlock("aug", hiddenConfig);
    expect(() =>
      m.updateNNBlock("aug", { ...hiddenConfig, hiddenStates: 5 }),
    ).toThrow(/expected 5/);
    expect(m.getNames()).toEqual(["S", "aug_h0", "aug_h1"]);
    expect(m.nnWeights.has("aug_W_0_0")).toBe(true);
  });

  it("renders the readout and a dh/dt row in LaTeX", () => {
    const tex = base().addNNBlock("aug", hiddenConfig).buildTex();
    expect(tex).toContain(String.raw`(W_{aug} \vec{h}_{aug})_{0}`);
    expect(tex).toContain(
      String.raw`\frac{d \vec{h}_{aug}}{dt} &= NN_{aug}(\vec{x}, \vec{h}_{aug})`,
    );
  });

  it("buildMxlweb emits h0 and the readout weights", () => {
    const src = base()
      .addNNBlock("aug", hiddenConfig, undefined, [0.5, -1])
      .buildMxlweb();
    expect(src).toContain("hiddenStates: 2");
    expect(src).toContain('["aug_W_0_1", ');
    expect(src).toMatch(/\), \[0\.5,-1\]\)/);
  });

  it("buildMxlpy and SBML export refuse them", () => {
    const m = base().addNNBlock("aug", hiddenConfig);
    expect(() => m.buildMxlpy()).toThrow(/export as \.mxl\.json/);
    expect(() => modelToSbml(m, "m")).toThrow(/NN blocks/);
  });

  it("owns readout names only with a digit after _W_", () => {
    expect(isNNBlockOwnedWeightName("aug_W_0_1", "aug")).toBe(true);
    expect(isNNBlockOwnedWeightName("aug_Water", "aug")).toBe(false);
  });
});

describe("terms", () => {
  const model = () =>
    new KineticModelBuilder()
      .addParameter("k", { value: 2 })
      .addVariable("S", { value: 3 })
      .addReaction("v", {
        fn: new Mul([new Name("k"), new Name("S")]),
        stoichiometry: [{ name: "S", value: new Num(-1) }],
      });

  it("compose in insertion order and report their contributions", () => {
    const m = model()
      .addTerm("add", {
        fn: new Num(1),
        target: "S",
        targetKind: "variable",
        mechanism: additiveMechanism(),
      })
      .addTerm("rel", {
        fn: new Num(0.5),
        target: "S",
        targetKind: "variable",
        mechanism: relativeMultiplyMechanism(),
      })
      .addTerm("rate", {
        fn: new Num(1),
        target: "v",
        targetKind: "reaction",
        mechanism: additiveMechanism(),
      });
    const rhs = new Function(`return (${m.buildJs()})`)() as Rhs;
    // v = 2*3 + 1 = 7; dS/dt = (-7 + 1) * 1.5 = -9
    expect(rhs(0, [3], m.resolveAllAddressableValues())).toEqual([-9]);
    const all = new Function(`return (${m.buildJsDerived().allDerived})`)();
    const values = all(0, [3], m.resolveAllAddressableValues());
    const names = m.derivedNames();
    expect(values[names.indexOf("rate")]).toBe(1);
    expect(values[names.indexOf("add")]).toBe(1);
    expect(values[names.indexOf("rel")]).toBe(-3);
    expect(m.buildTex()).toContain("(1 + (0.5))");
  });

  it("are removed with their target; updateTerm keeps the order", () => {
    const add = (target: string, targetKind: "variable" | "reaction") => ({
      fn: new Num(1),
      target,
      targetKind,
      mechanism: additiveMechanism(),
    });
    const m = model()
      .addTerm("a", add("S", "variable"))
      .addTerm("b", add("v", "reaction"))
      .addTerm("c", add("S", "variable"));
    m.updateTerm("a", { ...add("S", "variable"), fn: new Num(2) });
    expect([...m.terms.keys()]).toEqual(["a", "b", "c"]);
    expect(() => m.updateTerm("nope", add("S", "variable"))).toThrow(
      /no term "nope"/,
    );
    m.removeReaction("v");
    expect([...m.terms.keys()]).toEqual(["a", "c"]);
    m.removeVariable("S");
    expect(m.terms.size).toBe(0);
  });

  it("reject ids that are already taken", () => {
    const term = {
      fn: new Num(1),
      target: "S",
      targetKind: "variable" as const,
      mechanism: additiveMechanism(),
    };
    expect(() => model().addTerm("k", term)).toThrow(/"k" is already taken/);
    expect(() => model().addTerm("v", term)).toThrow(/already taken/);
    expect(() => model().addTerm("time", term)).toThrow(/already taken/);
  });

  it("are written to .mxl.json only when present", () => {
    expect(JSON.parse(model().buildMxlJson("m")).model.terms).toBeUndefined();
    expect(JSON.parse(model().buildMxlJson("m")).spec_version).toBe("0.2");
  });

  it("reject unknown targets and models without dynamics", () => {
    const term = {
      fn: new Num(1),
      target: "nope",
      targetKind: "variable" as const,
      mechanism: additiveMechanism(),
    };
    expect(() => model().addTerm("t", term)).toThrow(/unknown variable/);
    expect(() =>
      model().addTerm("t", { ...term, targetKind: "reaction" }),
    ).toThrow(/unknown reaction/);
    expect(() =>
      new OdeModelBuilder()
        .addVariable("x", { value: 1 })
        .addTerm("t", { ...term, target: "x", targetKind: "reaction" }),
    ).toThrow(/no reactions/);
    expect(() => new SteadyStateModelBuilder().addTerm("t", term)).toThrow(
      /aren't supported on SteadyStateModelBuilder/,
    );
  });

  it("buildMxlweb emits them after the reactions", () => {
    const src = model()
      .addTerm("t", {
        fn: new Num(1),
        target: "v",
        targetKind: "reaction",
        mechanism: additiveMechanism(),
      })
      .buildMxlweb();
    expect(src.indexOf(".addTerm(")).toBeGreaterThan(
      src.indexOf(".addReaction("),
    );
  });
});
