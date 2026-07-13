import {
  KineticModelBuilder,
  type ModelBuilderBase,
  OdeModelBuilder,
  SteadyStateModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Abs,
  Add,
  Bool,
  Divide,
  LessEqual,
  LessThan,
  Log,
  Max,
  Min,
  Minus,
  Mul,
  Name,
  Num,
  Pi,
  Piecewise,
  Pow,
  Sqrt,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

const MATHML = {
  Abs,
  Add,
  Bool,
  Divide,
  LessEqual,
  LessThan,
  Log,
  Max,
  Min,
  Minus,
  Mul,
  Name,
  Num,
  Pi,
  Piecewise,
  Pow,
  Sqrt,
};

const BUILDERS = {
  KineticModelBuilder,
  OdeModelBuilder,
  SteadyStateModelBuilder,
};

// Strip the ESM imports + `export`, then evaluate the generated `initModel()`
// with the referenced classes injected — a true round-trip of buildMxlweb().
function evalMxlweb(src: string): ModelBuilderBase {
  const body = src
    .replace(/import[^;]*;\s*/g, "")
    .replace(/\bexport\b/g, "")
    // Strip the TS return-type annotation so `new Function` (plain JS) accepts it.
    .replace(/function initModel\(\)[^{]*\{/, "function initModel() {");
  const classes = { ...MATHML, ...BUILDERS };
  const names = Object.keys(classes);
  const fn = new Function(...names, `${body}\nreturn initModel();`);
  return fn(...names.map((n) => classes[n as keyof typeof classes]));
}

describe("Base.toTs", () => {
  it("round-trips an expression through its constructor source", () => {
    const expr = new Min([
      new Divide([new Mul([new Name("Vmax"), new Name("S")]), new Num(2)]),
      new Piecewise([
        new Num(100),
        new LessEqual([new Name("S"), new Num(0)]),
        new Log(new Name("S"), new Num(10)),
      ]),
      new Sqrt(new Name("S"), new Num(2)),
    ]);
    const rebuilt = new Function(
      ...Object.keys(MATHML),
      `return ${expr.toTs()}`,
    )(...Object.values(MATHML));
    expect(rebuilt.toJs()).toBe(expr.toJs());
    expect(rebuilt.toTex(new Map())).toBe(expr.toTex(new Map()));
  });

  it("escapes string names (LaTeX backslashes survive)", () => {
    expect(new Name("a\\b").toTs()).toBe('new Name("a\\\\b")');
  });

  it("collects the constructors it uses", () => {
    const ctors = new Mul([
      new Name("x"),
      new Log(new Name("y"), new Num(2)),
    ]).getCtors(new Set<string>());
    expect(ctors).toEqual(new Set(["Mul", "Name", "Log", "Num"]));
  });
});

describe("buildMxlweb round-trip", () => {
  it("steady-state model", () => {
    const m = new SteadyStateModelBuilder()
      .addParameter("S", { value: 1, texName: "S" })
      .addParameter("Vmax", {
        value: 2,
        displayName: "Vmax",
        texName: "V_{max}",
        slider: { min: "0", max: "10", step: "0.1" },
      })
      .addAssignment("v", {
        displayName: "v",
        fn: new Divide([
          new Mul([new Name("Vmax"), new Name("S")]),
          new Num(2),
        ]),
      });
    const src = m.buildMxlweb();
    expect(src).toContain(
      "export function initModel(): SteadyStateModelBuilder",
    );
    expect(src).toContain("import {\n  Divide,\n  Mul,\n  Name,\n  Num,\n}");

    const rebuilt = evalMxlweb(src);
    expect(rebuilt).toBeInstanceOf(SteadyStateModelBuilder);
    expect(rebuilt.buildJsDerived().allDerived).toBe(
      m.buildJsDerived().allDerived,
    );
    expect(rebuilt.buildTex()).toBe(m.buildTex());
  });

  it("ode model (preserves differentials)", () => {
    const m = new OdeModelBuilder()
      .addVariable("x", { value: 1, texName: "x" })
      .addParameter("k", { value: 0.5 })
      .setDifferential(
        "x",
        new Minus([new Mul([new Name("k"), new Name("x")])]),
      );
    const src = m.buildMxlweb();
    expect(src).toContain(".setDifferential(");

    const rebuilt = evalMxlweb(src);
    expect(rebuilt).toBeInstanceOf(OdeModelBuilder);
    expect(rebuilt.buildJs()).toBe(m.buildJs());
    expect(rebuilt.buildTex()).toBe(m.buildTex());
  });

  it("kinetic model (preserves reactions and stoichiometry)", () => {
    const m = new KineticModelBuilder()
      .addVariable("A", { value: 1 })
      .addVariable("B", { value: 0 })
      .addParameter("k", { value: 0.5 })
      .addReaction("v1", {
        fn: new Mul([new Name("k"), new Name("A")]),
        stoichiometry: [
          { name: "A", value: new Num(-1) },
          { name: "B", value: new Num(1) },
        ],
      });
    const src = m.buildMxlweb();
    expect(src).toContain(".addReaction(");
    expect(src).toContain("stoichiometry:");

    const rebuilt = evalMxlweb(src);
    expect(rebuilt).toBeInstanceOf(KineticModelBuilder);
    expect(rebuilt.buildJs()).toBe(m.buildJs());
    expect(rebuilt.buildTex()).toBe(m.buildTex());
  });
});

describe("Base.toJson", () => {
  it("serialises every node arity to the mxl-schemas node shape", () => {
    expect(new Num(2.5).toJson()).toEqual({ type: "Num", value: 2.5 });
    expect(new Name("x").toJson()).toEqual({ type: "Name", value: "x" });
    expect(new Bool(true).toJson()).toEqual({ type: "Bool", value: true });
    // Value-less leaf: only the discriminator.
    expect(new Pi().toJson()).toEqual({ type: "Pi" });
    // Unary → child, binary → left/right, Log/Sqrt → child + base.
    expect(new Minus([new Name("x")]).toJson()).toEqual({
      type: "Minus",
      children: [{ type: "Name", value: "x" }],
    });
    expect(new Pow(new Name("x"), new Num(2)).toJson()).toEqual({
      type: "Pow",
      left: { type: "Name", value: "x" },
      right: { type: "Num", value: 2 },
    });
    expect(new Log(new Name("x"), new Num(10)).toJson()).toEqual({
      type: "Log",
      child: { type: "Name", value: "x" },
      base: { type: "Num", value: 10 },
    });
  });

  it("nests n-ary children recursively", () => {
    const expr = new Divide([
      new Mul([new Name("Vmax"), new Name("S")]),
      new Add([new Name("Km"), new Name("S")]),
    ]);
    expect(expr.toJson()).toEqual({
      type: "Divide",
      children: [
        {
          type: "Mul",
          children: [
            { type: "Name", value: "Vmax" },
            { type: "Name", value: "S" },
          ],
        },
        {
          type: "Add",
          children: [
            { type: "Name", value: "Km" },
            { type: "Name", value: "S" },
          ],
        },
      ],
    });
  });
});

describe("buildMxlJson", () => {
  it("kinetic model: envelope, reactions, stoichiometry and metadata", () => {
    const m = new KineticModelBuilder()
      .addVariable("A", { value: 1, displayName: "Species A", texName: "A" })
      .addVariable("B", { value: 0 })
      .addParameter("k", {
        value: 0.5,
        slider: { min: "0", max: "1", step: "0.01", desc: "rate" },
      })
      .addReaction("v1", {
        fn: new Mul([new Name("k"), new Name("A")]),
        stoichiometry: [
          { name: "A", value: new Num(-1) },
          { name: "B", value: new Num(1) },
        ],
        displayName: "first reaction",
      })
      .addAssignment("total", {
        fn: new Add([new Name("A"), new Name("B")]),
      });

    const doc = JSON.parse(m.buildMxlJson("kinetic_demo", "a demo"));

    expect(doc.spec_version).toBe("1.0");
    expect(doc.kind).toBe("kinetic");
    expect(doc.model_id).toBe("kinetic_demo");
    expect(doc.description).toBe("a demo");
    expect(doc.$schema).toBe(
      "https://raw.githubusercontent.com/Computational-Biology-Aachen/mxl-schemas/main/v1/kinetic-model.schema.json",
    );
    expect(Object.keys(doc.model)).toEqual([
      "variables",
      "parameters",
      "reactions",
      "derived",
      "readouts",
    ]);

    expect(doc.model.variables.A).toEqual({
      value: { type: "Num", value: 1 },
      displayName: "Species A",
      texName: "A",
    });
    expect(doc.model.parameters.k.slider).toEqual({
      min: "0",
      max: "1",
      step: "0.01",
      desc: "rate",
    });
    expect(doc.model.reactions.v1).toEqual({
      fn: {
        type: "Mul",
        children: [
          { type: "Name", value: "k" },
          { type: "Name", value: "A" },
        ],
      },
      stoichiometry: {
        A: { type: "Num", value: -1 },
        B: { type: "Num", value: 1 },
      },
      displayName: "first reaction",
    });
    expect(doc.model.derived.total.fn.type).toBe("Add");
    expect(doc.model.readouts).toEqual({});
  });

  it("ode model: derivative on each variable, missing differential is zero", () => {
    const m = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addVariable("y", { value: 2 })
      .addParameter("k", { value: 0.5 })
      .setDifferential(
        "x",
        new Minus([new Mul([new Name("k"), new Name("x")])]),
      );

    const doc = JSON.parse(m.buildMxlJson("ode_demo"));

    expect(doc.kind).toBe("ode");
    expect(doc.description).toBeUndefined();
    expect("reactions" in doc.model).toBe(false);
    expect(doc.model.variables.x.fn.type).toBe("Minus");
    // A variable with no differential exports dx/dt = 0.
    expect(doc.model.variables.y.fn).toEqual({ type: "Num", value: 0 });
    expect(doc.model.readouts).toEqual({});
  });

  it("steady-state model: only parameters + derived, no readouts", () => {
    const m = new SteadyStateModelBuilder()
      .addParameter("S", {
        value: 1,
        slider: { min: "0", max: "10", step: "0.1" },
      })
      .addParameter("Vmax", { value: 2, texName: "V_{max}" })
      .addAssignment("v", {
        displayName: "rate",
        fn: new Divide([
          new Mul([new Name("Vmax"), new Name("S")]),
          new Num(2),
        ]),
      });

    const doc = JSON.parse(m.buildMxlJson("ss_demo"));

    expect(doc.kind).toBe("steady-state");
    expect(doc.$schema).toContain("steady-state-model.schema.json");
    expect(Object.keys(doc.model)).toEqual(["parameters", "derived"]);
    expect(doc.model.parameters.S.slider).toEqual({
      min: "0",
      max: "10",
      step: "0.1",
    });
    expect(doc.model.derived.v.displayName).toBe("rate");
    expect(doc.model.derived.v.fn.type).toBe("Divide");
  });
});

describe("buildMxlweb under a minified production build", () => {
  // Reproduces the "export as code" bug from a real deployment: a
  // Piecewise/Abs/Sqrt-shaped model (mirroring bellasio2019) downloaded from a
  // minified site produced imports like `import { B, E, H, R, ee, z } from
  // ".../mathml"` with a body still calling `new Add(...)`, `new Mul(...)`,
  // etc. — because `buildMxlweb()` sourced both the import list and the class
  // name it *instantiates* by different means, and one of them silently
  // followed the bundler's renamed classes. Simulating that renaming here
  // must not corrupt the generated source.
  it("generates code that still evaluates after every constructor.name is mangled", () => {
    const mangled = [
      KineticModelBuilder,
      ...Object.values(MATHML),
    ] as unknown as (new (...args: never[]) => unknown)[];
    for (const ctor of mangled) {
      Object.defineProperty(ctor, "name", {
        value: "MANGLED",
        configurable: true,
      });
    }

    const m = new KineticModelBuilder()
      .addParameter("Vmax", { value: 2 })
      .addParameter("Km", { value: 1 })
      .addVariable("S", { value: 1 })
      .addVariable("Ract", { value: 1 })
      .addAssignment("Ract_eq", {
        fn: new Divide([new Name("S"), new Add([new Name("S"), new Num(1)])]),
      })
      .addReaction("v_rate", {
        // A Piecewise/LessThan/Abs/Sqrt/Max mix — every arity category —
        // matching the shape that broke in production.
        fn: new Piecewise([
          new Divide([
            new Abs(new Minus([new Name("Ract_eq"), new Name("Ract")])),
            new Max([new Sqrt(new Name("Km"), new Num(2)), new Num(1e-9)]),
          ]),
          new LessThan([new Name("Ract"), new Name("Ract_eq")]),
          new Mul([new Name("Vmax"), new Name("S")]),
        ]),
        stoichiometry: [{ name: "S", value: new Num(-1) }],
      });

    const src = m.buildMxlweb();

    // The class actually instantiated in the body must be the one imported —
    // this is exactly the invariant that broke (import { e } vs new e()
    // vs. the body's real usage being out of sync with the import list).
    expect(src).toContain("import { KineticModelBuilder }");
    expect(src).toContain("new KineticModelBuilder()");
    for (const name of [
      "Divide",
      "Add",
      "Num",
      "Piecewise",
      "Abs",
      "Minus",
      "Max",
      "Sqrt",
      "LessThan",
      "Mul",
      "Name",
    ]) {
      expect(src, `${name} used in body must also be imported`).toMatch(
        new RegExp(`\\bimport \\{[^}]*\\b${name}\\b[^}]*\\}`, "s"),
      );
    }

    const rebuilt = evalMxlweb(src);
    expect(rebuilt).toBeInstanceOf(KineticModelBuilder);
    expect(rebuilt.buildJs()).toBe(m.buildJs());
  });
});
