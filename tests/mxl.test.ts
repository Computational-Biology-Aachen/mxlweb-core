import {
  KineticModelBuilder,
  OdeModelBuilder,
  SteadyStateModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Bool,
  Divide,
  LessEqual,
  Log,
  Min,
  Minus,
  Mul,
  Name,
  nodeFromJson,
  Num,
  Pi,
  Piecewise,
  Pow,
  Sqrt,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { mxlJsonToModel } from "@computational-biology-aachen/mxlweb-core/mxl";
import { describe, expect, it } from "vitest";

// A kinetic model exercising every node arity (unary/binary/n-ary/leaves +
// Log/Sqrt), a symbolic initial value, sliders with `desc`, display/LaTeX names,
// and multi-entry stoichiometry.
function kineticFixture(): KineticModelBuilder {
  return new KineticModelBuilder()
    .addVariable("A", {
      value: 1,
      displayName: "Species A",
      texName: "A",
      slider: { min: "0", max: "10", step: "0.1", desc: "initial A" },
    })
    .addVariable("B", { value: new Mul([new Name("A"), new Num(2)]) })
    .addParameter("k", {
      value: 0.5,
      slider: { min: "0", max: "1", step: "0.01", desc: "rate" },
    })
    .addParameter("Km", { value: 2, texName: "K_m" })
    .addReaction("v1", {
      fn: new Divide([
        new Mul([new Name("k"), new Name("A")]),
        new Add([new Name("Km"), new Name("A")]),
      ]),
      stoichiometry: [
        { name: "A", value: new Num(-1) },
        { name: "B", value: new Num(1) },
      ],
      displayName: "first reaction",
      texName: "v_1",
    })
    .addAssignment("total", {
      fn: new Min([
        new Piecewise([
          new Num(100),
          new LessEqual([new Name("A"), new Num(0)]),
          new Log(new Name("A"), new Num(10)),
        ]),
        new Sqrt(new Name("B"), new Num(2)),
        new Pow(new Name("k"), new Pi()),
        new Minus([new Name("A"), new Name("B")]),
        new Bool(true),
      ]),
      displayName: "total",
    });
}

function odeFixture(): OdeModelBuilder {
  return new OdeModelBuilder()
    .addVariable("x", { value: 1, texName: "x" })
    .addVariable("y", { value: 2 })
    .addParameter("k", { value: 0.5 })
    .setDifferential("x", new Minus([new Mul([new Name("k"), new Name("x")])]))
    .addAssignment("sum", { fn: new Add([new Name("x"), new Name("y")]) });
}

function steadyStateFixture(): SteadyStateModelBuilder {
  return new SteadyStateModelBuilder()
    .addParameter("S", {
      value: 1,
      slider: { min: "0", max: "10", step: "0.1" },
    })
    .addParameter("Vmax", { value: 2, texName: "V_{max}" })
    .addAssignment("v", {
      displayName: "rate",
      fn: new Divide([new Mul([new Name("Vmax"), new Name("S")]), new Num(2)]),
    });
}

describe("mxlJsonToModel round-trip", () => {
  it("kinetic model is identical through build → parse → build", () => {
    const json = kineticFixture().buildMxlJson("kinetic_demo", "a demo");
    const rebuilt = mxlJsonToModel(json);
    expect(rebuilt).toBeInstanceOf(KineticModelBuilder);
    expect(rebuilt.buildMxlJson("kinetic_demo", "a demo")).toBe(json);
  });

  it("ode model preserves derivatives (and the implicit dx/dt = 0)", () => {
    const json = odeFixture().buildMxlJson("ode_demo");
    const rebuilt = mxlJsonToModel(json);
    expect(rebuilt).toBeInstanceOf(OdeModelBuilder);
    expect(rebuilt.buildMxlJson("ode_demo")).toBe(json);
  });

  it("steady-state model is identical through build → parse → build", () => {
    const json = steadyStateFixture().buildMxlJson("ss_demo");
    const rebuilt = mxlJsonToModel(json);
    expect(rebuilt).toBeInstanceOf(SteadyStateModelBuilder);
    expect(rebuilt.buildMxlJson("ss_demo")).toBe(json);
  });

  it("accepts an already-parsed document object", () => {
    const json = kineticFixture().buildMxlJson("m");
    const rebuilt = mxlJsonToModel(JSON.parse(json));
    expect(rebuilt.buildMxlJson("m")).toBe(json);
  });

  it("rebuilds a runnable model (parsed kinetic simulates like the original)", () => {
    const original = kineticFixture();
    const rebuilt = mxlJsonToModel(original.buildMxlJson("m"));
    expect(rebuilt.buildJs()).toBe(original.buildJs());
  });
});

describe("nodeFromJson", () => {
  it("round-trips every node arity through toJson → fromJson", () => {
    const exprs = [
      new Num(2.5),
      new Name("x"),
      new Bool(false),
      new Pi(),
      new Minus([new Name("x")]),
      new Pow(new Name("x"), new Num(2)),
      new Log(new Name("x"), new Num(10)),
      new Sqrt(new Name("y"), new Num(2)),
      new Divide([
        new Mul([new Name("Vmax"), new Name("S")]),
        new Add([new Name("Km"), new Name("S")]),
      ]),
    ];
    for (const expr of exprs) {
      expect(nodeFromJson(expr.toJson()).toJson()).toEqual(expr.toJson());
    }
  });

  it("throws on an unknown node type", () => {
    expect(() => nodeFromJson({ type: "Bogus" })).toThrow(
      /unknown math node type: Bogus/,
    );
  });
});

describe("mxlJsonToModel errors", () => {
  it("throws on an unknown model kind", () => {
    const doc = JSON.stringify({
      spec_version: "1.0",
      kind: "bogus",
      model_id: "m",
      model: {},
    });
    expect(() => mxlJsonToModel(doc)).toThrow(/unknown mxl model kind: bogus/);
  });

  it("rejects a document that fails schema validation", () => {
    // Parameter `value` must be a math node, not a bare number.
    const doc = JSON.stringify({
      spec_version: "1.0",
      kind: "kinetic",
      model_id: "m",
      model: {
        variables: {},
        parameters: { k: { value: 42 } },
        reactions: {},
        derived: {},
        readouts: {},
      },
    });
    expect(() => mxlJsonToModel(doc)).toThrow(/invalid kinetic \.mxl\.json/);
  });
});
