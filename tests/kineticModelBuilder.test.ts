import {
  KineticModelBuilder,
  renderTerms,
  stoichToTex,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Minus,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

const NO_NAMES = new Map<string, string>();

describe("renderTerms", () => {
  // tex is the reaction rate; value is the stoichiometric coefficient.
  it("non-numeric coefficient keeps the rate term (regression: dropped \\cdot rate)", () => {
    const texNames = new Map([["Beta", "\\beta"]]);
    expect(
      renderTerms([{ tex: "P \\cdot Q", value: new Name("Beta") }], texNames),
    ).toEqual(["\\beta \\cdot P \\cdot Q"]);
  });

  it("negative non-numeric coefficient (unary Minus) keeps the rate term", () => {
    const texNames = new Map([["Beta", "\\beta"]]);
    expect(
      renderTerms(
        [{ tex: "P \\cdot Q", value: new Minus([new Name("Beta")]) }],
        texNames,
      ),
    ).toEqual(["- \\beta \\cdot P \\cdot Q"]);
  });

  it("unit numeric coefficient renders the bare rate", () => {
    expect(renderTerms([{ tex: "P", value: new Num(1) }], NO_NAMES)).toEqual([
      "P",
    ]);
  });

  it("non-unit numeric coefficient prefixes the rate", () => {
    expect(renderTerms([{ tex: "P", value: new Num(2) }], NO_NAMES)).toEqual([
      "2 \\cdot P",
    ]);
  });

  it("negative numeric coefficient renders the sign", () => {
    expect(renderTerms([{ tex: "P", value: new Num(-1) }], NO_NAMES)).toEqual([
      "- P",
    ]);
  });

  it("empty terms render zero", () => {
    expect(renderTerms([], NO_NAMES)).toEqual(["0"]);
  });
});

describe("stoichToTex", () => {
  // Stoichiometric-matrix column: species : coefficient, one species per row.
  const texNames = new Map([
    ["Prey", "Prey"],
    ["Predator", "Predator"],
    ["Beta", "\\beta"],
    ["Delta", "\\delta"],
  ]);

  it("single species renders inline without aligned env", () => {
    expect(stoichToTex([{ name: "Prey", value: new Num(1) }], texNames)).toBe(
      "Prey: 1",
    );
  });

  it("symbolic coefficient renders the expression, not a product", () => {
    // q_p1 style: species p1, coefficient x1 — must not become "x1 \cdot p1".
    expect(
      stoichToTex([{ name: "p1", value: new Name("x1") }], new Map()),
    ).toBe("p1: x1");
  });

  it("multiple species stack in an aligned environment", () => {
    expect(
      stoichToTex(
        [
          { name: "Prey", value: new Minus([new Name("Beta")]) },
          { name: "Predator", value: new Name("Delta") },
        ],
        texNames,
      ),
    ).toBe(
      "\\begin{aligned}&Prey : - \\beta \\\\ &Predator : \\delta\\end{aligned}",
    );
  });

  it("filters zero-valued numeric stoichiometry", () => {
    expect(stoichToTex([{ name: "Prey", value: new Num(0) }], texNames)).toBe(
      "0",
    );
  });
});

describe("KineticModelBuilder.buildMxlpy", () => {
  it("emits every builder type: parameters, variables, assignments, reactions", () => {
    const m = new KineticModelBuilder();
    m.addParameter("k", { value: 0.5 });
    m.addVariable("S", { value: 10 });
    // Expression-valued initial condition -> InitialAssignment.
    m.addVariable("P", { value: new Minus([new Name("k")]) });
    m.addAssignment("total", { fn: new Add([new Name("S"), new Name("P")]) });
    m.addReaction("v", {
      fn: new Mul([new Name("k"), new Name("S")]),
      stoichiometry: [
        { name: "S", value: new Num(-1) },
        { name: "P", value: new Num(1) },
      ],
    });

    expect(m.buildMxlpy()).toBe(`import math

import numpy as np

from mxlpy import InitialAssignment, Model

def _init_P(k):
    return - k

def _derived_total(S, P):
    return S + P

def _rate_v(S, k):
    return k * S

def get_model() -> Model:
    m = Model()
    m.add_parameter("k", 0.5)
    m.add_variable("S", 10)
    m.add_variable("P", InitialAssignment(_init_P, args=["k"]))
    m.add_derived("total", _derived_total, args=["S", "P"])
    m.add_reaction(
        "v",
        _rate_v,
        args=["S", "k"],
        stoichiometry={"S": -1, "P": 1},
    )
    return m
`);
  });

  it("emits a bare factory when no types are present", () => {
    expect(new KineticModelBuilder().buildMxlpy()).toBe(`import math

import numpy as np

from mxlpy import Model

def get_model() -> Model:
    m = Model()
    return m
`);
  });

  it("emits Derived for non-numeric stoichiometry and drops zero coefficients", () => {
    const m = new KineticModelBuilder();
    m.addParameter("n", { value: 2 });
    m.addVariable("A", { value: 1 });
    m.addVariable("B", { value: 0 });
    m.addReaction("v", {
      fn: new Name("A"),
      stoichiometry: [
        { name: "A", value: new Minus([new Name("n")]) },
        { name: "B", value: new Num(0) },
      ],
    });

    expect(m.buildMxlpy()).toBe(`import math

import numpy as np

from mxlpy import Derived, Model

def _rate_v(A):
    return A

def _stoich_v_A(n):
    return - n

def get_model() -> Model:
    m = Model()
    m.add_parameter("n", 2)
    m.add_variable("A", 1)
    m.add_variable("B", 0)
    m.add_reaction(
        "v",
        _rate_v,
        args=["A"],
        stoichiometry={"A": Derived(_stoich_v_A, args=["n"])},
    )
    return m
`);
  });
});
