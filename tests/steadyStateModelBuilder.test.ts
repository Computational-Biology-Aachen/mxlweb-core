import { SteadyStateModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Divide,
  Min,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

// Michaelis-Menten: v = Vmax * S / (Km + S), swept over S.
function mmModel(): SteadyStateModelBuilder {
  return new SteadyStateModelBuilder()
    .addParameter("S", { value: 1, texName: "S" })
    .addParameter("Vmax", { value: 2, texName: "V_{max}" })
    .addParameter("Km", { value: 0.5, texName: "K_m" })
    .addAssignment("v", {
      fn: new Divide([
        new Mul([new Name("Vmax"), new Name("S")]),
        new Add([new Name("Km"), new Name("S")]),
      ]),
      texName: "v",
    });
}

describe("SteadyStateModelBuilder", () => {
  it("has no state variables", () => {
    expect(mmModel().variables.size).toBe(0);
  });

  it("evaluates assignments via the derived code generation", () => {
    const { allDerived } = mmModel().buildJsDerived();
    const fn = new Function(`return ${allDerived}`)() as (
      time: number,
      variables: number[],
      pars: number[],
    ) => number[];
    // pars in insertion order: [S, Vmax, Km]
    const v = fn(0, [], [1, 2, 0.5])[0];
    expect(v).toBeCloseTo((2 * 1) / (0.5 + 1));
  });

  it("renders the algebraic system as LaTeX (no derivatives)", () => {
    const tex = mmModel().buildTex();
    expect(tex).toContain("v &=");
    expect(tex).not.toContain("\\frac{d");
  });

  it("exports a pure Python function of all parameters", () => {
    const py = mmModel().buildPython();
    expect(py).toContain("def model(");
    expect(py).toContain("S: float = 1");
    expect(py).toContain("v = ");
    expect(py).toContain("return v");
    expect(py).not.toContain("dt");
  });

  it("clones preserving its concrete type", () => {
    const cl = mmModel().clone();
    expect(cl).toBeInstanceOf(SteadyStateModelBuilder);
    expect(cl.assignments.has("v")).toBe(true);
  });

  it("supports min() across outputs for FvCB-style limiting rates", () => {
    const m = new SteadyStateModelBuilder()
      .addParameter("Ci", { value: 5 })
      .addAssignment("wc", { fn: new Mul([new Name("Ci"), new Num(2)]) })
      .addAssignment("wj", { fn: new Num(7) })
      .addAssignment("an", { fn: new Min([new Name("wc"), new Name("wj")]) });
    const { allDerived } = m.buildJsDerived();
    const fn = new Function(`return ${allDerived}`)() as (
      time: number,
      variables: number[],
      pars: number[],
    ) => number[];
    // outputs in topological order: [wc, wj, an], wc = 2*Ci, wj = 7, an = min(wc, wj)
    expect(fn(0, [], [2])).toEqual([4, 7, 4]);
    expect(fn(0, [], [5])).toEqual([10, 7, 7]);
  });
});
