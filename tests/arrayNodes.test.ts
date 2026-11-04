import { KineticModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import { mxlJsonToModel } from "@computational-biology-aachen/mxlweb-core/mxl";
import {
  Add,
  Mul,
  Name,
  Num,
  Simpson,
  Sum,
  evaluate,
  nodeFromJson,
  parseExpression,
  simpson,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

const wavelength = Array.from({ length: 301 }, (_, i) => 400 + i);
const peak = wavelength.map((w) => Math.exp(-((w - 550) ** 2) / 800));

describe("simpson matches scipy.integrate.simpson(y, x=x)", () => {
  // Reference values from SciPy 1.18.1.
  it("odd number of samples (uneven spacing)", () => {
    expect(simpson([1, 3, 2, 5, 4], [0, 1, 2.5, 3, 4.2])).toBeCloseTo(
      14.91916666666667,
      12,
    );
  });
  it("even number of samples (Cartwright correction)", () => {
    expect(simpson([1, 3, 2, 5, 4, -1], [0, 1, 2.5, 3, 4.2, 6])).toBeCloseTo(
      18.249166666666667,
      12,
    );
  });
  it("two samples (trapezoid)", () => {
    expect(simpson([1, 2], [0, 3])).toBe(4.5);
  });
  it("a 301-point spectrum", () => {
    expect(simpson(peak, wavelength)).toBeCloseTo(50.132565492616806, 10);
  });
});

describe("evaluate broadcasts and reduces", () => {
  const values: Record<string, number | number[]> = {
    a: [1, 2, 3],
    k: 2,
    t: [0, 1, 2],
  };
  const resolve = (name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`unknown ${name}`);
    return v;
  };
  const cases: Array<[string, number | number[]]> = [
    ["a * k + 1", [3, 5, 7]],
    ["a - a", [0, 0, 0]],
    ["-a", [-1, -2, -3]],
    ["sum(a) / std(a)", 6],
    ["max(a) - min(a)", 2],
    ["first(a) + last(a)", 4],
    ["nth(a, 1)", 2],
    ["slice(a, 1, 3)", [2, 3]],
    ["at(a, 1.2, t)", 2],
    ["ifgt(k, 1, a, 0)", [1, 2, 3]],
    ["log10(100) + sqrt(k ^ 2)", 4],
  ];
  for (const [src, expected] of cases) {
    it(src, () => {
      expect(evaluate(parseExpression(src), resolve)).toEqual(expected);
    });
  }

  it("rejects arrays of different lengths", () => {
    expect(() =>
      evaluate(new Add([new Name("a"), new Name("t2")]), (n) =>
        n === "a" ? [1, 2] : [1, 2, 3],
      ),
    ).toThrow(/length mismatch/);
  });

  it("parse errors", () => {
    for (const src of ["a +", "nope(a)", "(a", "a b", "a $ b", "nth(a)"]) {
      expect(() => parseExpression(src)).toThrow();
    }
  });

  it("trees survive a JSON round trip", () => {
    const tree = parseExpression(
      "ifgt(max(a), 0, sum(slice(a, 0, 2)), at(a, 1, t))",
    );
    const revived = nodeFromJson(JSON.parse(JSON.stringify(tree.toJson())));
    expect(revived.toJson()).toEqual(tree.toJson());
    expect(evaluate(revived, resolve)).toBe(3);
  });
});

function spectralModel(): KineticModelBuilder {
  return new KineticModelBuilder()
    .addData("wavelength", { values: wavelength })
    .addData("light", { values: peak })
    .addParameter("k", { value: 2 })
    .addVariable("x", { value: 1 })
    .addAssignment("absorbed", {
      fn: new Mul([
        new Name("k"),
        new Simpson([new Name("light"), new Name("wavelength")]),
      ]),
    })
    .addReaction("v", {
      fn: new Mul([new Name("absorbed"), new Name("x")]),
      stoichiometry: [{ name: "x", value: new Num(-1) }],
    });
}

describe("model data", () => {
  it("lower() folds data-only array subtrees to numbers", () => {
    const ir = spectralModel().lower();
    const absorbed = ir.intermediates.find((m) => m.name === "absorbed")!;
    expect(absorbed.expr.toJson()).toEqual({
      type: "Mul",
      children: [
        { type: "Name", value: "k" },
        { type: "Num", value: simpson(peak, wavelength) },
      ],
    });
    // No backend sees data: the WAT/JS build succeeds.
    expect(() => spectralModel().buildWat()).not.toThrow();
    expect(() => spectralModel().buildJs()).not.toThrow();
  });

  it("an array node may only reference data", () => {
    const model = spectralModel().updateAssignment("absorbed", {
      fn: new Simpson([
        new Mul([new Name("light"), new Name("x")]),
        new Name("wavelength"),
      ]),
    });
    expect(() => model.lower()).toThrow(
      /may only reference data and numbers, not "x"/,
    );
  });

  it("data must be reduced before use", () => {
    const model = spectralModel().updateAssignment("absorbed", {
      fn: new Add([new Name("light"), new Num(1)]),
    });
    expect(() => model.lower()).toThrow(/data "light" is an array/);
  });

  it("an array node must reduce to a number", () => {
    const model = spectralModel().updateAssignment("absorbed", {
      fn: new Sum([new Name("light")]),
    });
    expect(() => model.lower()).not.toThrow();
  });

  it("clone() keeps data, independently of the original", () => {
    const model = spectralModel();
    const cl = model.clone();
    expect(() => cl.lower()).not.toThrow();
    cl.updateData("light", { values: peak.map((v) => 2 * v) });
    expect(model.data.get("light")!.values).toEqual(peak);
  });

  it("initial values see folded data", () => {
    const model = spectralModel().updateVariable("x", {
      value: new Name("absorbed"),
    });
    expect(model.resolveInitialValues()).toEqual([
      2 * simpson(peak, wavelength),
    ]);
  });

  it("round-trips through .mxl.json + data sidecar and model.ts", () => {
    const model = spectralModel();
    const json = JSON.parse(model.buildMxlJson("spectral"));
    expect(json.data_ref).toBe("model.data.json");
    const data = JSON.parse(model.buildDataFile()!);
    expect(Object.keys(data)).toEqual(["wavelength", "light"]);
    const revived = mxlJsonToModel(json, new Map(), data);
    expect(revived.buildMxlJson("spectral")).toEqual(
      model.buildMxlJson("spectral"),
    );
    expect(revived.buildDataFile()).toEqual(model.buildDataFile());
    expect(revived.resolveInitialValues()).toEqual(
      model.resolveInitialValues(),
    );

    const ts = model.buildMxlweb();
    expect(ts).toContain('import data from "./model.data.json";');
    expect(ts).toContain('.addData("light", data["light"])');
    expect(ts).toContain("Simpson");

    expect(() => mxlJsonToModel(json)).toThrow(/no data file supplied/);
  });

  it("exports data to mxlpy", () => {
    const py = spectralModel().buildMxlpy();
    expect(py).toContain("from scipy.integrate import simpson");
    expect(py).toContain('m.add_data("light", pd.Series([');
    expect(py).toContain("simpson(light, x=wavelength)");
  });
});
