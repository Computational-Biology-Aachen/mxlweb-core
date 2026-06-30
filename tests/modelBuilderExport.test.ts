import {
  KineticModelBuilder,
  type ModelBuilderBase,
  OdeModelBuilder,
  SteadyStateModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Divide,
  LessEqual,
  Log,
  Min,
  Minus,
  Mul,
  Name,
  Num,
  Piecewise,
  Sqrt,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

const MATHML = {
  Add,
  Divide,
  LessEqual,
  Log,
  Min,
  Minus,
  Mul,
  Name,
  Num,
  Piecewise,
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
