import {
  renderTerms,
  stoichToTex,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Minus,
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
