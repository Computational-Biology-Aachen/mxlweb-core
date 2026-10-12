/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPyodide } from "pyodide";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KineticModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import { mxlJsonToModel } from "@computational-biology-aachen/mxlweb-core/mxl";
import { Name, Num } from "@computational-biology-aachen/mxlweb-core/mathml";
import { modelToSbml } from "@computational-biology-aachen/mxlweb-core/sbml";
import {
  type CustomUnit,
  parseUnit,
  Unit,
  type UnitJson,
  unitRegistry,
} from "@computational-biology-aachen/mxlweb-core/units";

type Fixture = {
  name: string;
  unit: UnitJson;
  units?: Record<string, CustomUnit>;
  sympy: string | null;
};

const FIXTURES: { cases: Fixture[] } = JSON.parse(
  readFileSync(resolve(__dirname, "assets/units.fixtures.json"), "utf8"),
);
const customsOf = (f: Fixture) => new Map(Object.entries(f.units ?? {}));

// Canonical mxl-schemas sources (the 0-admin meta-repo checkout); skipped when
// absent, same as schemaDrift.test.ts.
const SCHEMAS_DIR = resolve(process.cwd(), "../../misc/mxl-schemas");

describe("vendored unit registry and fixtures match mxl-schemas", () => {
  it.each([
    ["v1/units.json", unitRegistry],
    ["tests/units.fixtures.json", FIXTURES],
  ])("%s is up to date", (file, vendored, ctx) => {
    let canonical: unknown;
    try {
      canonical = JSON.parse(readFileSync(resolve(SCHEMAS_DIR, file), "utf8"));
    } catch {
      ctx.skip();
      return;
    }
    expect(vendored).toEqual(canonical);
  });
});

describe("Unit", () => {
  it("normalises order, merges kinds and drops zero exponents", () => {
    const u = new Unit([
      { kind: "second", exponent: -1 },
      { kind: "mole", prefix: "milli", exponent: 1 },
      { kind: "second", exponent: 1 },
      { kind: "second", exponent: -1 },
      { kind: "litre", exponent: 1 },
      { kind: "litre", exponent: -1 },
    ]);
    expect(u.toJson()).toEqual({
      factors: [
        { kind: "mole", prefix: "milli", exponent: 1 },
        { kind: "second", exponent: -1 },
      ],
    });
  });

  it("folds mixed prefixes of one kind into a prefix or the multiplier", () => {
    // 1e-9 mol² — no prefix squared gives 1e-9, so the rest is a multiplier
    expect(parseUnit("mmol*µmol").toJson()).toEqual({
      factors: [{ kind: "mole", prefix: "milli", exponent: 2 }],
      multiplier: 0.001,
    });
    expect(parseUnit("kmol*mmol").toJson()).toEqual({
      factors: [{ kind: "mole", exponent: 2 }],
    });
    expect(parseUnit("mmol/µmol").toJson()).toEqual({
      factors: [],
      multiplier: 1000,
    });
  });

  it("equals compares kinds and total scale, not spelling", () => {
    expect(parseUnit("mol/l/s").equals(parseUnit("mol/(l*s)"))).toBe(true);
    expect(
      parseUnit("mmol").equals(new Unit([{ kind: "mole", exponent: 1 }], 1e-3)),
    ).toBe(true);
    expect(parseUnit("mmol").equals(parseUnit("mol"))).toBe(false);
    expect(parseUnit("mmol").equals(parseUnit("mmol/s"))).toBe(false);
  });

  it.each(FIXTURES.cases.map((f) => [f.name, f] as const))(
    "%s round-trips through JSON",
    (_, f) => {
      const u = Unit.fromJson(f.unit).validate(customsOf(f));
      expect(u.toJson()).toEqual(f.unit);
      expect(Unit.fromJson(u.toJson()).equals(u)).toBe(true);
    },
  );

  it("validate rejects undeclared kinds", () => {
    const u = Unit.of("OD600");
    expect(() => u.validate()).toThrow(/unknown unit kind "OD600"/);
    expect(u.validate(new Map([["OD600", {}]]))).toBe(u);
  });

  it("rejects non-integer exponents and invalid multipliers", () => {
    expect(() => Unit.of("metre", undefined, 0.5)).toThrow(/integer/);
    expect(() => new Unit([], 0)).toThrow(/positive/);
  });

  it("renders display text and LaTeX", () => {
    const ppfd = parseUnit("µmol m^-2 s^-1");
    expect(ppfd.toDisplay()).toBe("µmol·m⁻²·s⁻¹");
    expect(ppfd.toTex()).toBe(
      "{\\mu\\mathrm{mol}} \\cdot \\mathrm{m}^{-2} \\cdot \\mathrm{s}^{-1}",
    );
    expect(Unit.dimensionless.toDisplay()).toBe("1");
    expect(`${parseUnit("mM")}`).toBe("mmol·L⁻¹");
  });

  it("renders SBML unit definitions", () => {
    expect(parseUnit("1/min").toSBML("u")).toContain(
      '<unit kind="second" exponent="-1" scale="0" multiplier="60"/>',
    );
    expect(parseUnit("mol_chl").toSBML("u")).toContain(
      '<!-- "mol_chl" has no SBML equivalent -->',
    );
  });
});

describe("parseUnit", () => {
  it.each([
    ["mmol/s", "mmol·s⁻¹"],
    ["µmol·m⁻²·s⁻¹", "µmol·m⁻²·s⁻¹"],
    ["μmol/m^2/s", "µmol·m⁻²·s⁻¹"],
    ["umol m^-2 s^-1", "µmol·m⁻²·s⁻¹"],
    ["umol m-2 s-1", "µmol·m⁻²·s⁻¹"],
    ["M", "mol·L⁻¹"],
    ["mM", "mmol·L⁻¹"],
    ["1/s", "s⁻¹"],
    ["s^-1", "s⁻¹"],
    ["s**-1", "s⁻¹"],
    ["min", "min"],
    ["m", "m"],
    ["mol/l/s", "mol·L⁻¹·s⁻¹"],
    ["mol/(l*s)", "mol·L⁻¹·s⁻¹"],
    ["kg m/s^2", "kg·m·s⁻²"],
    ["m2", "m²"],
    ["millimole", "mmol"],
    ["°C", "°C"],
    ["mmol/mol_chl", "mmol·(mol Chl)⁻¹"],
    ["%", "0.01"],
    ["1", "1"],
    ["dimensionless", "1"],
  ])("%j -> %s", (text, display) => {
    expect(parseUnit(text).toDisplay()).toBe(display);
  });

  it("resolves declared custom units, including ones that look like exponents", () => {
    const customs = new Map([["OD600", {}]]);
    expect(parseUnit("OD600/h", customs).toJson()).toEqual({
      factors: [
        { kind: "OD600", exponent: 1 },
        { kind: "hour", exponent: -1 },
      ],
    });
  });

  it.each([
    ["OD600", /unknown unit symbol "OD600"/],
    ["µE", /unknown unit symbol "µE"/],
    ["a.u.", /unexpected/],
    ["", /empty/],
    ["mol/", /unexpected end/],
    ["(mol", /expected "\)"/],
    ["2 mol", /numbers other than 1/],
  ])("rejects %j", (text, error) => {
    expect(() => parseUnit(text)).toThrow(error);
  });
});

describe("builder units", () => {
  it("custom units round-trip through .mxl.json", () => {
    const m = new KineticModelBuilder()
      .addCustomUnit("OD600", {
        symbol: "OD₆₀₀",
        description: "optical density",
      })
      .addVariable("x", { value: 1, unit: "OD600" })
      .addParameter("k", { value: 2, unit: "1/h" })
      .addReaction("v", {
        fn: new Name("k"),
        stoichiometry: [{ name: "x", value: new Num(1) }],
        unit: "OD600/h",
      })
      .addReadout("r", { fn: new Name("x"), unit: "OD600" });
    const json = m.buildMxlJson("m");
    const doc = JSON.parse(json);
    expect(doc.model.units).toEqual({
      OD600: { symbol: "OD₆₀₀", description: "optical density" },
    });
    expect(doc.model.readouts.r.unit).toEqual({
      factors: [{ kind: "OD600", exponent: 1 }],
    });

    const back = mxlJsonToModel(json) as KineticModelBuilder;
    expect(back.customUnits.get("OD600")?.symbol).toBe("OD₆₀₀");
    expect(back.variables.get("x")?.unit?.toDisplay(back.customUnits)).toBe(
      "OD₆₀₀",
    );
    expect(
      back.reactions
        .get("v")
        ?.unit?.equals(parseUnit("OD600/h", back.customUnits)),
    ).toBe(true);
    expect(back.readouts.get("r")?.unit).toBeDefined();
    expect(back.buildMxlJson("m")).toBe(json);
  });

  it("rejects a document using an undeclared custom kind", () => {
    const doc = JSON.parse(
      new KineticModelBuilder()
        .addCustomUnit("OD600")
        .addParameter("k", { value: 1, unit: "OD600" })
        .buildMxlJson("m"),
    );
    delete doc.model.units;
    expect(() => mxlJsonToModel(doc)).toThrow(/unknown unit kind "OD600"/);
  });

  it("guards custom unit ids and removal", () => {
    const m = new KineticModelBuilder();
    expect(() => m.addCustomUnit("mole")).toThrow(/shadow/);
    expect(() => m.addCustomUnit("not valid")).toThrow(/invalid/);
    m.addCustomUnit("cells").addParameter("n", { value: 1, unit: "cells" });
    expect(() => m.removeCustomUnit("cells")).toThrow(/still used/);
    m.removeParameter("n").removeCustomUnit("cells");
    expect(m.customUnits.size).toBe(0);
  });

  it("buildMxlweb emits Unit reconstructors and custom units first", () => {
    const src = new KineticModelBuilder()
      .addCustomUnit("cells")
      .addParameter("k", { value: 1, unit: "cells/mL" })
      .addVariable("x", { value: 1 })
      .buildMxlweb();
    expect(src).toContain(
      'import { KineticModelBuilder, Unit } from "@computational-biology-aachen/mxlweb-core";',
    );
    expect(src).toContain(
      '    .addCustomUnit("cells", {})\n    .addParameter(',
    );
    expect(src).toContain(
      'unit: Unit.fromJson({"factors":[{"kind":"cells","exponent":1},{"kind":"litre","prefix":"milli","exponent":-1}]})',
    );
    // A parameter without a unit must not emit `unit: undefined`.
    expect(
      new KineticModelBuilder().addParameter("k", { value: 1 }).buildMxlweb(),
    ).not.toContain("unit");
  });

  // Export only: sbmlToModel needs a DOMParser, which this test environment
  // doesn't provide.
  it("exports parameter units as deduplicated SBML unit definitions", () => {
    const m = new KineticModelBuilder()
      .addParameter("k", { value: 1, unit: "1/min" })
      .addParameter("vmax", { value: 2, unit: "mmol/s" })
      .addParameter("kcat", { value: 3, unit: "min^-1" })
      .addParameter("n", { value: 4 })
      .addVariable("x", { value: 1 });
    const xml = modelToSbml(m, "m");
    expect(xml.match(/<unitDefinition /g)).toHaveLength(2);
    expect(xml.indexOf("<listOfUnitDefinitions>")).toBeLessThan(
      xml.indexOf("<listOfCompartments>"),
    );
    expect(xml).toContain('id="k" name="k" value="1" units="unit_1"');
    expect(xml).toContain('id="kcat" name="kcat" value="3" units="unit_1"');
    expect(xml).toContain('id="vmax" name="vmax" value="2" units="unit_2"');
    expect(xml).toContain('id="n" name="n" value="4" constant="true"');
    expect(xml).toContain(
      '<unit kind="mole" exponent="1" scale="-3" multiplier="1"/>',
    );
  });
});

describe("toPy matches the shared sympy fixtures", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pyodide: any;

  beforeAll(async () => {
    pyodide = await loadPyodide();
    await pyodide.loadPackage(["sympy"]);
    pyodide.runPython(`
import sympy
import sympy.physics.units as su
from sympy.physics.units.prefixes import Prefix
from sympy.physics.units.quantities import Quantity

def _strip(e):
    return e.subs({p: p.scale_factor for p in e.atoms(Prefix)})

def same_unit(a, b):
    if a is None or b is None:
        return a is b
    return sympy.simplify(_strip(sympy.sympify(a)) / _strip(sympy.sympify(b))) == 1
`);
  }, 120_000);

  afterAll(() => {
    pyodide = undefined;
  });

  it.each(FIXTURES.cases.map((f) => [f.name, f] as const))("%s", (_, f) => {
    const py = Unit.fromJson(f.unit).toPy();
    const expected = f.sympy ?? "None";
    expect(
      pyodide.runPython(`same_unit(${py}, ${expected})`),
      `${py} vs ${expected}`,
    ).toBe(true);
  });
});
