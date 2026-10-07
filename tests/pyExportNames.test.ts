import {
  KineticModelBuilder,
  OdeModelBuilder,
  SteadyStateModelBuilder,
  additiveMechanism,
  isPyIdentifier,
  softplusActivation,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

// Display names that aren't valid Python identifiers (or are reserved by the
// generated module itself) — every Python export must convert these.
const BAD_NAMES = [
  "Species A",
  "E. coli max. growth rate",
  "1abc",
  "123",
  "k-cat",
  "a.b",
  "f(x)",
  'a"b',
  "a'b",
  "a\tb",
  "a\nb",
  "  padded  ",
  "!!!",
  "🙂",
  "lambda",
  "None",
  "class",
  "time",
  "np",
  "math",
  "m",
  "model",
  "variables",
  "derived",
  "get_model",
];

function assertUnique(names: string[]): void {
  const normalized = names.map((n) => n.normalize("NFKC"));
  expect(new Set(normalized).size, names.join(", ")).toBe(normalized.length);
}

function assertValid(names: string[]): void {
  for (const n of names)
    expect(isPyIdentifier(n), JSON.stringify(n)).toBe(true);
}

/** Every identifier and quoted name a `buildMxlpy()` module emits. */
function checkMxlpy(src: string): void {
  const defNames: string[] = [];
  for (const [, fn, params] of src.matchAll(/^def ([^(]+)\(([^)]*)\)/gm)) {
    defNames.push(fn);
    const ps = params === "" ? [] : params.split(", ");
    assertValid(ps);
    assertUnique(ps);
  }
  assertValid(defNames);
  assertUnique(defNames);

  // Every string literal is a model name (no units in these models).
  const literals = [...src.matchAll(/"([^"]*)"/g)].map(([, s]) => s);
  assertValid(literals);

  const declared = [...src.matchAll(/m\.add_\w+\(\s*"([^"]*)"/g)].map(
    ([, s]) => s,
  );
  expect(declared.length).toBeGreaterThan(0);
  assertUnique(declared);
}

/** Every identifier a `buildPython()` module binds, per function. */
function checkPython(src: string): void {
  for (const fn of src.split(/^def /m).slice(1)) {
    const [, name, params] = fn.match(/^(\w+)\(([^)]*)\)/s)!;
    const bound = [
      name,
      ...[...params.matchAll(/([^\s,]+): /g)].map(([, p]) => p),
    ];
    for (const [, lhs] of fn.matchAll(/^ {4}([^\s:][^:=\n]*?) = /gm)) {
      // Unpacking targets: `a, b`, `x,` (one variable) or `[]` (none).
      if (lhs === "[]") continue;
      bound.push(
        ...lhs
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      );
    }
    assertValid(bound);
    // `name` is the function itself, not a local — exclude it.
    assertUnique(bound.slice(1));
  }
  const y0 = src.match(/^y0 = \{(.*)\}$/m);
  if (y0) assertValid([...y0[1].matchAll(/"([^"]*)"/g)].map(([, s]) => s));
}

// Every entity carries the same display name, so the export must both
// convert it and deduplicate the result.
function kineticNamed(dn: string): KineticModelBuilder {
  return new KineticModelBuilder()
    .addParameter("k", { value: 0.5, displayName: dn })
    .addVariable("A", { value: 10, displayName: dn })
    .addVariable("B", {
      value: new Mul([new Num(2), new Name("k")]),
      displayName: dn,
    })
    .addAssignment("tot", {
      fn: new Add([new Name("A"), new Name("B")]),
      displayName: dn,
    })
    .addReaction("r", {
      fn: new Mul([new Name("k"), new Name("A")]),
      stoichiometry: [
        { name: "A", value: new Num(-1) },
        { name: "B", value: new Name("tot") },
      ],
      displayName: dn,
    })
    .addReadout("ro", {
      fn: new Mul([new Name("tot"), new Num(2)]),
      displayName: dn,
    });
}

function odeNamed(dn: string): OdeModelBuilder {
  return new OdeModelBuilder()
    .addParameter("k", { value: 0.3, displayName: dn })
    .addVariable("x", { value: 1, displayName: dn })
    .addVariable("y", { value: 2, displayName: dn })
    .addAssignment("d", {
      fn: new Mul([new Num(2), new Name("x")]),
      displayName: dn,
    })
    .setDifferential("x", new Mul([new Num(-1), new Name("k"), new Name("y")]))
    .setDifferential("y", new Name("d"))
    .addReadout("ro", {
      fn: new Add([new Name("d"), new Num(1)]),
      displayName: dn,
    });
}

function steadyNamed(dn: string): SteadyStateModelBuilder {
  return new SteadyStateModelBuilder()
    .addParameter("S", { value: 1, displayName: dn })
    .addParameter("V", { value: 2, displayName: dn })
    .addAssignment("v", {
      fn: new Mul([new Name("V"), new Name("S")]),
      displayName: dn,
    })
    .addAssignment("w", {
      fn: new Add([new Name("v"), new Num(1)]),
      displayName: dn,
    });
}

describe("Python exports: invalid display names become unique identifiers", () => {
  describe.each(BAD_NAMES)("display name %j", (dn) => {
    it("KineticModelBuilder.buildMxlpy", () => {
      checkMxlpy(kineticNamed(dn).buildMxlpy());
    });
    it("KineticModelBuilder.buildPython", () => {
      checkPython(kineticNamed(dn).buildPython(["k"], ["tot", "ro"]));
    });
    it("OdeModelBuilder.buildMxlpy", () => {
      checkMxlpy(odeNamed(dn).buildMxlpy());
    });
    it("OdeModelBuilder.buildPython", () => {
      checkPython(odeNamed(dn).buildPython(["k"], ["ro"]));
    });
    it("SteadyStateModelBuilder.buildMxlpy", () => {
      checkMxlpy(steadyNamed(dn).buildMxlpy());
    });
    it("SteadyStateModelBuilder.buildPython", () => {
      checkPython(steadyNamed(dn).buildPython([], ["w"]));
    });
  });
});

describe("Python exports: invalid ids without a display name", () => {
  const model = () =>
    new KineticModelBuilder()
      .addParameter("2k", { value: 0.5 })
      .addVariable("my var", { value: 1 })
      .addVariable("my-var", { value: 2 })
      .addReaction("v 1", {
        fn: new Mul([new Name("2k"), new Name("my var")]),
        stoichiometry: [
          { name: "my var", value: new Num(-1) },
          { name: "my-var", value: new Num(1) },
        ],
      });

  it("buildMxlpy", () => {
    const src = model().buildMxlpy();
    checkMxlpy(src);
    expect(src).toContain('m.add_parameter("_2k", 0.5)');
    expect(src).toContain('m.add_variable("my_var", 1)');
    expect(src).toContain('m.add_variable("my_var_2", 2)');
    expect(src).toContain('stoichiometry={"my_var": -1, "my_var_2": 1}');
  });

  it("buildPython", () => {
    const src = model().buildPython(["2k"]);
    checkPython(src);
    expect(src).toContain("_2k: float");
    expect(src).toContain("my_var, my_var_2 = variables");
    expect(src).toContain("v_1 = _2k * my_var");
  });
});

describe("KineticModelBuilder: converted names", () => {
  const model = () =>
    new KineticModelBuilder()
      .addParameter("k1", { value: 0.5, displayName: "1st param" })
      .addVariable("A", { value: 10, displayName: "Species A" })
      .addVariable("B", {
        value: new Mul([new Num(2), new Name("k1")]),
        displayName: "B-form",
      })
      .addAssignment("tot", {
        fn: new Add([new Name("A"), new Name("B")]),
        displayName: "lambda",
      })
      .addReaction("r1", {
        fn: new Mul([new Name("k1"), new Name("A")]),
        stoichiometry: [
          { name: "A", value: new Num(-1) },
          { name: "B", value: new Name("tot") },
        ],
        displayName: "first reaction",
      })
      .addReadout("ro", {
        fn: new Mul([new Name("tot"), new Num(2)]),
        displayName: "my readout",
      });

  it("buildMxlpy uses them in defs, args, declarations and stoichiometry", () => {
    expect(model().buildMxlpy()).toBe(`import math

import numpy as np

from mxlpy import Derived, InitialAssignment, Model

def _init_B_form(_1st_param):
    return 2 * _1st_param

def _derived_lambda_(Species_A, B_form):
    return Species_A + B_form

def _rate_first_reaction(Species_A, _1st_param):
    return _1st_param * Species_A

def _stoich_first_reaction_B_form(lambda_):
    return lambda_

def _readout_my_readout(lambda_):
    return lambda_ * 2

def get_model() -> Model:
    m = Model()
    m.add_parameter("_1st_param", 0.5)
    m.add_variable("Species_A", 10)
    m.add_variable("B_form", InitialAssignment(_init_B_form, args=["_1st_param"]))
    m.add_derived("lambda_", _derived_lambda_, args=["Species_A", "B_form"])
    m.add_reaction(
        "first_reaction",
        _rate_first_reaction,
        args=["Species_A", "_1st_param"],
        stoichiometry={"Species_A": -1, "B_form": Derived(fn=_stoich_first_reaction_B_form, args=["lambda_"])},
    )
    m.add_readout("my_readout", _readout_my_readout, args=["lambda_"])
    return m
`);
  });

  it("buildPython uses them for userParameters/selectedDerived given as ids", () => {
    // Trailing whitespace is a pre-existing irToPython quirk, not under test.
    const py = model()
      .buildPython(["k1"], ["tot", "ro"])
      .replace(/[ \t]+$/gm, "");
    expect(py).toBe(`import numpy as np
import math

def model(
    time: float,
    variables: list[float],
      _1st_param: float
):
    Species_A, B_form = variables

    lambda_ = Species_A + B_form
    first_reaction = _1st_param * Species_A
    dSpecies_Adt = - first_reaction
    dB_formdt = lambda_ * first_reaction
    return [dSpecies_Adt, dB_formdt]

def all_derived(
    time: float,
    variables: list[float],
      _1st_param: float
):
    Species_A, B_form = variables

    lambda_ = Species_A + B_form
    first_reaction = _1st_param * Species_A
    my_readout = lambda_ * 2
    return [lambda_, first_reaction, my_readout]

def selected_derived(
    time: float,
    variables: list[float],
      _1st_param: float
):
    Species_A, B_form = variables

    lambda_ = Species_A + B_form
    my_readout = lambda_ * 2
    return [lambda_, my_readout]

derived = selected_derived
y0 = {"Species_A": 10, "B_form": 1}
`);
  });

  it("buildMxlpy and buildPython agree on every name", () => {
    const b = model();
    const mxlpy = b.buildMxlpy();
    const py = b.buildPython([]);
    for (const n of [
      "_1st_param",
      "Species_A",
      "B_form",
      "lambda_",
      "first_reaction",
      "my_readout",
    ]) {
      expect(mxlpy).toContain(n);
      expect(py).toContain(n);
    }
  });
});

describe("OdeModelBuilder.buildMxlpy: converted names", () => {
  it("uses them in add_diff_eq/add_derived/add_readout", () => {
    const b = new OdeModelBuilder()
      .addParameter("k", { value: 0.3, displayName: "rate const." })
      .addVariable("x", { value: 1, displayName: "x pos" })
      .addAssignment("d", {
        fn: new Mul([new Num(2), new Name("x")]),
        displayName: "2x",
      })
      .setDifferential(
        "x",
        new Mul([new Num(-1), new Name("k"), new Name("x")]),
      )
      .addReadout("ro", {
        fn: new Add([new Name("d"), new Num(1)]),
        displayName: "def",
      });
    expect(b.buildMxlpy()).toBe(`import math

import numpy as np

from mxlpy import OdeModelBuilder

def _diffeq_x_pos(x_pos, rate_const):
    return -1 * rate_const * x_pos

def _derived__2x(x_pos):
    return 2 * x_pos

def _readout_def_(_2x):
    return _2x + 1

def get_model() -> OdeModelBuilder:
    m = OdeModelBuilder()
    m.add_parameter("rate_const", 0.3)
    m.add_diff_eq("x_pos", 1, _diffeq_x_pos, args=["x_pos", "rate_const"])
    m.add_derived("_2x", _derived__2x, args=["x_pos"])
    m.add_readout("def_", _readout_def_, args=["_2x"])
    return m
`);
  });
});

describe("SteadyStateModelBuilder.buildPython: converted names", () => {
  it("converts parameters and outputs, renaming a shadowed `np`", () => {
    const b = new SteadyStateModelBuilder()
      .addParameter("S", { value: 1, displayName: "substrate conc." })
      .addParameter("V", { value: 2, displayName: "np" })
      .addAssignment("v", {
        fn: new Mul([new Name("V"), new Name("S")]),
        displayName: "flux (v)",
      });
    expect(b.buildPython()).toBe(`import numpy as np
import math


def model(
    substrate_conc: float = 1,
    np_2: float = 2,
):
    flux_v = np_2 * substrate_conc
    return flux_v
`);
  });
});

describe("Python exports: collisions", () => {
  it("a valid name keeps its spelling over one converted to it", () => {
    const b = new KineticModelBuilder()
      .addVariable("p", { value: 1, displayName: "a b" })
      .addVariable("q", { value: 2, displayName: "a_b" });
    const src = b.buildMxlpy();
    expect(src).toContain('m.add_variable("a_b_2", 1)');
    expect(src).toContain('m.add_variable("a_b", 2)');
  });

  it("identical display names are suffixed in declaration order", () => {
    const b = new KineticModelBuilder()
      .addVariable("x", { value: 1, displayName: "rate" })
      .addVariable("y", { value: 2, displayName: "rate" })
      .addParameter("k", { value: 3, displayName: "rate" });
    const src = b.buildMxlpy();
    expect(src).toContain('m.add_variable("rate", 1)');
    expect(src).toContain('m.add_variable("rate_2", 2)');
    expect(src).toContain('m.add_parameter("rate_3", 3)');
  });

  it.each(["time", "np", "math", "m", "get_model"])(
    "buildMxlpy renames %j, which the generated module uses itself",
    (dn) => {
      const src = new KineticModelBuilder()
        .addParameter("k", { value: 1, displayName: dn })
        .addAssignment("a", { fn: new Mul([new Name("k"), new Num(2)]) })
        .buildMxlpy();
      expect(src).toContain(`m.add_parameter("${dn}_2", 1)`);
      expect(src).toContain(`def _derived_a(${dn}_2):`);
    },
  );

  it.each(["variables", "model", "derived", "all_derived", "time"])(
    "buildPython renames %j, which the generated module uses itself",
    (dn) => {
      const src = new KineticModelBuilder()
        .addParameter("k", { value: 1, displayName: dn })
        .addVariable("x", { value: 1 })
        .buildPython([]);
      expect(src).toContain(`    ${dn}_2 = 1`);
    },
  );

  it("buildPython's d<x>dt locals never shadow a model name", () => {
    const src = new OdeModelBuilder()
      .addParameter("k", { value: 1, displayName: "dxdt" })
      .addVariable("x", { value: 1 })
      .setDifferential("x", new Name("k"))
      .buildPython([]);
    checkPython(src);
    expect(src).toContain("    dxdt = 1");
    expect(src).toContain("    dxdt_2 = dxdt");
    expect(src).toContain("    return [dxdt_2]");
  });

  it("buildPython leaves d<x>dt untouched without a collision", () => {
    const src = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .setDifferential("x", new Num(1))
      .buildPython([]);
    expect(src).toContain("    dxdt = 1");
    expect(src).toContain("    return [dxdt]");
  });
});

describe("Python exports: NN block with an invalid key", () => {
  const model = () =>
    new KineticModelBuilder()
      .addVariable("x", { value: 1 })
      .addNNBlock("my block", {
        inputs: ["x"],
        layers: [
          { type: "dense", width: 2, activation: softplusActivation() },
          { type: "dense", width: 1 },
        ],
        seed: 1,
        targetKind: "variable",
        targets: ["x"],
        trained: true,
        scale: 0.1,
        mechanism: additiveMechanism(),
      });

  it("buildPython converts the scale parameter and every weight name", () => {
    const src = model().buildPython([]);
    checkPython(src);
    expect(src).toContain("    my_block_output_scale = 0.1");
    expect(src).toMatch(/^ {4}my_block_w0_0_0 = /m);
    expect(src).not.toContain("my block");
  });

  it("buildMxlpy converts the scale parameter", () => {
    const src = model().buildMxlpy();
    expect(src).toContain('m.add_parameter("my_block_output_scale", 0.1)');
    expect(src).not.toMatch(/"my block/);
  });
});

describe("buildPython: variable unpacking", () => {
  const unpackLines = (src: string) =>
    [...src.matchAll(/^ {4}(.*) = variables$/gm)].map(([, lhs]) => lhs);

  it("unpacks a single variable with a trailing comma", () => {
    const src = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .setDifferential("x", new Num(1))
      .addReadout("ro", { fn: new Name("x") })
      .buildPython([], ["ro"]);
    expect(unpackLines(src)).toEqual(["x,", "x,", "x,"]);
  });

  it("unpacks a single prose-named variable", () => {
    const src = new KineticModelBuilder()
      .addVariable("x", { value: 1, displayName: "x pos" })
      .buildPython([]);
    expect(unpackLines(src)).toEqual(["x_pos,", "x_pos,"]);
  });

  it("unpacks no variables into an empty list target", () => {
    const src = new OdeModelBuilder()
      .addParameter("k", { value: 1 })
      .addAssignment("a", { fn: new Mul([new Num(2), new Name("k")]) })
      .buildPython([]);
    expect(unpackLines(src)).toEqual(["[]", "[]"]);
    checkPython(src);
  });

  it("leaves several variables as a plain tuple target", () => {
    const src = new OdeModelBuilder()
      .addVariable("x", { value: 1 })
      .addVariable("y", { value: 2 })
      .buildPython([]);
    expect(unpackLines(src)).toEqual(["x, y", "x, y"]);
  });
});
