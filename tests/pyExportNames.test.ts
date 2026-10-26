import {
  KineticModelBuilder,
  OdeModelBuilder,
  SteadyStateModelBuilder,
  additiveMechanism,
  canonicalIdentifier,
  isCanonicalIdentifier,
  softplusActivation,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

// Ids that aren't canonical identifiers (or are reserved by the generated
// code itself) — every Python export must convert these. `time` is missing:
// the builders reject it as an id outright.
const BAD_IDS = [
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
  "Δψ",
  "lambda",
  "None",
  "class",
  "np",
  "math",
  "m",
  "model",
  "variables",
  "derived",
  "get_model",
  "pars",
  "Math",
];

const PY_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertUnique(names: string[]): void {
  expect(new Set(names).size, names.join(", ")).toBe(names.length);
}

function assertCanonical(names: string[]): void {
  for (const n of names)
    expect(isCanonicalIdentifier(n), JSON.stringify(n)).toBe(true);
}

function assertIdentifiers(names: string[]): void {
  for (const n of names) expect(n, JSON.stringify(n)).toMatch(PY_IDENTIFIER);
}

/** Every identifier and model name a `buildMxlpy()` module emits. */
function checkMxlpy(src: string): void {
  const defNames: string[] = [];
  for (const [, fn, params] of src.matchAll(/^def ([^(]+)\(([^)]*)\)/gm)) {
    defNames.push(fn);
    const ps = params === "" ? [] : params.split(", ");
    assertCanonical(ps);
    assertUnique(ps);
  }
  assertIdentifiers(defNames);
  assertUnique(defNames);

  const declared = [...src.matchAll(/m\.add_\w+\(\s*"([^"]*)"/g)].map(
    ([, s]) => s,
  );
  expect(declared.length).toBeGreaterThan(0);
  assertCanonical(declared);
  assertUnique(declared);

  const referenced = [...src.matchAll(/args=\[([^\]]*)\]/g)].flatMap(
    ([, list]) => [...list.matchAll(/"([^"]*)"/g)].map(([, s]) => s),
  );
  assertCanonical(referenced);
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
    assertIdentifiers(bound);
    // `name` is the function itself, not a local — exclude it.
    assertUnique(bound.slice(1));
  }
  const y0 = src.match(/^y0 = \{(.*)\}$/m);
  if (y0) assertCanonical([...y0[1].matchAll(/"([^"]*)"/g)].map(([, s]) => s));
}

// The parameter carries the bad id; every entity also carries it as display
// name, which must reach the export as metadata only.
function kineticNamed(id: string): KineticModelBuilder {
  return new KineticModelBuilder()
    .addParameter(id, { value: 0.5, displayName: id })
    .addVariable("A", { value: 10, displayName: id })
    .addVariable("B", {
      value: new Mul([new Num(2), new Name(id)]),
      displayName: id,
    })
    .addAssignment("tot", {
      fn: new Add([new Name("A"), new Name("B")]),
      displayName: id,
    })
    .addReaction("r", {
      fn: new Mul([new Name(id), new Name("A")]),
      stoichiometry: [
        { name: "A", value: new Num(-1) },
        { name: "B", value: new Name("tot") },
      ],
      displayName: id,
    })
    .addReadout("ro", {
      fn: new Mul([new Name("tot"), new Num(2)]),
      displayName: id,
    });
}

function odeNamed(id: string): OdeModelBuilder {
  return new OdeModelBuilder()
    .addParameter(id, { value: 0.3, displayName: id })
    .addVariable("x", { value: 1, displayName: id })
    .addVariable("y", { value: 2, displayName: id })
    .addAssignment("d", {
      fn: new Mul([new Num(2), new Name("x")]),
      displayName: id,
    })
    .setDifferential("x", new Mul([new Num(-1), new Name(id), new Name("y")]))
    .setDifferential("y", new Name("d"))
    .addReadout("ro", {
      fn: new Add([new Name("d"), new Num(1)]),
      displayName: id,
    });
}

function steadyNamed(id: string): SteadyStateModelBuilder {
  return new SteadyStateModelBuilder()
    .addParameter(id, { value: 1, displayName: id })
    .addParameter("V", { value: 2, displayName: id })
    .addAssignment("v", {
      fn: new Mul([new Name("V"), new Name(id)]),
      displayName: id,
    })
    .addAssignment("w", {
      fn: new Add([new Name("v"), new Num(1)]),
      displayName: id,
    });
}

describe("Python exports: invalid ids become canonical identifiers", () => {
  describe.each(BAD_IDS)("id %j", (id) => {
    it("KineticModelBuilder.buildMxlpy", () => {
      const src = kineticNamed(id).buildMxlpy();
      checkMxlpy(src);
      expect(src).toContain(`m.add_parameter("${canonicalIdentifier(id)}"`);
      expect(src).toContain(`display_name=${JSON.stringify(id)}`);
    });
    it("KineticModelBuilder.buildPython", () => {
      checkPython(kineticNamed(id).buildPython([id], ["tot", "ro"]));
    });
    it("OdeModelBuilder.buildMxlpy", () => {
      checkMxlpy(odeNamed(id).buildMxlpy());
    });
    it("OdeModelBuilder.buildPython", () => {
      checkPython(odeNamed(id).buildPython([id], ["ro"]));
    });
    it("SteadyStateModelBuilder.buildMxlpy", () => {
      checkMxlpy(steadyNamed(id).buildMxlpy());
    });
    it("SteadyStateModelBuilder.buildPython", () => {
      checkPython(steadyNamed(id).buildPython([], ["w"]));
    });
  });
});

describe("Python exports: invalid ids without a display name", () => {
  const model = () =>
    new KineticModelBuilder()
      .addParameter("2k", { value: 0.5 })
      .addVariable("my var", { value: 1 })
      .addVariable("my var-", { value: 2 })
      .addReaction("v 1", {
        fn: new Mul([new Name("2k"), new Name("my var")]),
        stoichiometry: [
          { name: "my var", value: new Num(-1) },
          { name: "my var-", value: new Num(1) },
        ],
      });

  it("buildMxlpy", () => {
    const src = model().buildMxlpy();
    checkMxlpy(src);
    expect(src).toContain('m.add_parameter("_2k", 0.5)');
    expect(src).toContain('m.add_variable("my_var", 1)');
    expect(src).toContain('m.add_variable("my_var_minus", 2)');
    expect(src).toContain('stoichiometry={"my_var": -1, "my_var_minus": 1}');
  });

  it("buildPython", () => {
    const src = model().buildPython(["2k"]);
    checkPython(src);
    expect(src).toContain("_2k: float");
    expect(src).toContain("my_var, my_var_minus = variables");
    expect(src).toContain("v_1 = _2k * my_var");
  });
});

describe("KineticModelBuilder: converted names", () => {
  const model = () =>
    new KineticModelBuilder()
      .addParameter("k1", { value: 0.5, texName: "k_1" })
      .addVariable("Species A", { value: 10, displayName: "A" })
      .addVariable("B-form", {
        value: new Mul([new Num(2), new Name("k1")]),
      })
      .addAssignment("lambda", {
        fn: new Add([new Name("Species A"), new Name("B-form")]),
      })
      .addReaction("first reaction", {
        fn: new Mul([new Name("k1"), new Name("Species A")]),
        stoichiometry: [
          { name: "Species A", value: new Num(-1) },
          { name: "B-form", value: new Name("lambda") },
        ],
        displayName: "Reaction 1",
      })
      .addReadout("my readout", {
        fn: new Mul([new Name("lambda"), new Num(2)]),
      });

  it("buildMxlpy uses them in defs, args, declarations and stoichiometry", () => {
    expect(model().buildMxlpy()).toBe(`import math

import numpy as np

from mxlpy import Derived, InitialAssignment, Model

def _init_B_form(k1):
    return 2 * k1

def _derived_lambda_(Species_A, B_form):
    return Species_A + B_form

def _rate_first_reaction(Species_A, k1):
    return k1 * Species_A

def _stoich_first_reaction_B_form(lambda_):
    return lambda_

def _readout_my_readout(lambda_):
    return lambda_ * 2

def get_model() -> Model:
    m = Model()
    m.add_parameter("k1", 0.5, tex_name="k_1")
    m.add_variable("Species_A", 10, display_name="A")
    m.add_variable("B_form", InitialAssignment(fn=_init_B_form, args=["k1"]))
    m.add_derived("lambda_", _derived_lambda_, args=["Species_A", "B_form"])
    m.add_reaction(
        "first_reaction",
        _rate_first_reaction,
        args=["Species_A", "k1"],
        stoichiometry={"Species_A": -1, "B_form": Derived(fn=_stoich_first_reaction_B_form, args=["lambda_"])},
        display_name="Reaction 1",
    )
    m.add_readout("my_readout", _readout_my_readout, args=["lambda_"])
    return m
`);
  });

  it("buildPython uses them for userParameters/selectedDerived given as ids", () => {
    // Trailing whitespace is a pre-existing irToPython quirk, not under test.
    const py = model()
      .buildPython(["k1"], ["lambda", "my readout"])
      .replace(/[ \t]+$/gm, "");
    expect(py).toBe(`import numpy as np
import math

def model(
    time: float,
    variables: list[float],
      k1: float
):
    Species_A, B_form = variables

    lambda_ = Species_A + B_form
    first_reaction = k1 * Species_A
    dSpecies_Adt = - first_reaction
    dB_formdt = lambda_ * first_reaction
    return [dSpecies_Adt, dB_formdt]

def all_derived(
    time: float,
    variables: list[float],
      k1: float
):
    Species_A, B_form = variables

    lambda_ = Species_A + B_form
    first_reaction = k1 * Species_A
    my_readout = lambda_ * 2
    return [lambda_, first_reaction, my_readout]

def selected_derived(
    time: float,
    variables: list[float],
      k1: float
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
      "k1",
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
      .addParameter("rate const.", { value: 0.3 })
      .addVariable("x pos", { value: 1, displayName: "Position" })
      .addAssignment("2x", {
        fn: new Mul([new Num(2), new Name("x pos")]),
      })
      .setDifferential(
        "x pos",
        new Mul([new Num(-1), new Name("rate const."), new Name("x pos")]),
      )
      .addReadout("def", {
        fn: new Add([new Name("2x"), new Num(1)]),
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
    m.add_diff_eq("x_pos", 1, _diffeq_x_pos, args=["x_pos", "rate_const"], display_name="Position")
    m.add_derived("_2x", _derived__2x, args=["x_pos"])
    m.add_readout("def_", _readout_def_, args=["_2x"])
    return m
`);
  });
});

describe("SteadyStateModelBuilder.buildPython: converted names", () => {
  it("converts parameters and outputs, renaming a shadowed `np`", () => {
    const b = new SteadyStateModelBuilder()
      .addParameter("substrate conc.", { value: 1 })
      .addParameter("np", { value: 2 })
      .addAssignment("flux (v)", {
        fn: new Mul([new Name("np"), new Name("substrate conc.")]),
      });
    expect(b.buildPython()).toBe(`import numpy as np
import math


def model(
    substrate_conc: float = 1,
    np_: float = 2,
):
    flux_v = np_ * substrate_conc
    return flux_v
`);
  });
});

describe("Python exports: collisions", () => {
  it("two ids mapping to the same identifier are an error", () => {
    const b = new KineticModelBuilder()
      .addVariable("a b", { value: 1 })
      .addVariable("a_b", { value: 2 });
    for (const build of [
      () => b.buildMxlpy(),
      () => b.buildPython([]),
      () => b.buildJs(),
      () => b.buildWat(),
    ]) {
      expect(build).toThrow(
        '"a b" and "a_b" both map to the identifier "a_b"; rename one of them',
      );
    }
  });

  it("identical display names don't affect the Python names", () => {
    const b = new KineticModelBuilder()
      .addVariable("x", { value: 1, displayName: "rate" })
      .addVariable("y", { value: 2, displayName: "rate" });
    const src = b.buildMxlpy();
    expect(src).toContain('m.add_variable("x", 1, display_name="rate")');
    expect(src).toContain('m.add_variable("y", 2, display_name="rate")');
  });

  it.each(["np", "math", "m", "get_model", "Math", "pars"])(
    "buildMxlpy renames %j, which the generated code uses itself",
    (id) => {
      const src = new KineticModelBuilder()
        .addParameter(id, { value: 1 })
        .addAssignment("a", { fn: new Mul([new Name(id), new Num(2)]) })
        .buildMxlpy();
      expect(src).toContain(`m.add_parameter("${id}_", 1)`);
      expect(src).toContain(`def _derived_a(${id}_):`);
    },
  );

  it.each(["variables", "model", "derived", "all_derived"])(
    "buildPython renames %j, which the generated module uses itself",
    (id) => {
      const src = new KineticModelBuilder()
        .addParameter(id, { value: 1 })
        .addVariable("x", { value: 1 })
        .buildPython([]);
      expect(src).toContain(`    ${id}_ = 1`);
    },
  );

  it("buildPython's d<x>dt locals never shadow a model name", () => {
    const src = new OdeModelBuilder()
      .addParameter("dxdt", { value: 1 })
      .addVariable("x", { value: 1 })
      .setDifferential("x", new Name("dxdt"))
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
    expect(src).toContain("    my_block_scale = 0.1");
    expect(src).toMatch(/^ {4}my_block_w0_0_0 = /m);
    expect(src).not.toContain("my block");
  });

  it("buildMxlpy converts the scale parameter", () => {
    const src = model().buildMxlpy();
    expect(src).toContain('m.add_parameter("my_block_scale", 0.1, ');
    expect(src).not.toMatch(/m\.add_\w+\("my block/);
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
      .addVariable("x pos", { value: 1, displayName: "Position" })
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

describe("JS/WAT backends: non-canonical ids", () => {
  // `1st param`, `B-form` and `class` aren't valid JS identifiers; every
  // backend must see the canonical names instead of the raw ids.
  const model = () =>
    new KineticModelBuilder()
      .addParameter("1st param", { value: 0.5 })
      .addParameter("class", { value: 2 })
      .addVariable("A+", { value: 10 })
      .addVariable("B-form", {
        value: new Mul([new Num(4), new Name("1st param")]),
      })
      .addAssignment("tot", {
        fn: new Add([new Name("A+"), new Name("B-form")]),
      })
      .addReaction("v 1", {
        fn: new Mul([new Name("1st param"), new Name("class"), new Name("A+")]),
        stoichiometry: [
          { name: "A+", value: new Num(-1) },
          { name: "B-form", value: new Num(1) },
        ],
      })
      .addReadout("ratio (A/B)", {
        fn: new Mul([new Name("A+"), new Name("tot")]),
      });

  it("evaluates expression-valued initial values", () => {
    expect(model().resolveInitialValues()).toEqual([10, 2]);
  });

  it("buildJs compiles and evaluates the right-hand side", () => {
    const rhs = new Function(`return (${model().buildJs()})`)() as (
      t: number,
      y: number[],
      p: number[],
    ) => number[];
    expect(rhs(0, [10, 2], [0.5, 2])).toEqual([-10, 10]);
  });

  it("buildJsDerived selects outputs given as ids", () => {
    const { allDerived, selectDerived } = model().buildJsDerived([
      "ratio (A/B)",
    ]);
    const all = new Function(`return (${allDerived})`)() as (
      t: number,
      y: number[],
      p: number[],
    ) => number[];
    const select = new Function(`return (${selectDerived})`)() as (
      all: number[],
    ) => number[];
    expect(select(all(0, [10, 2], [0.5, 2]))).toEqual([120]);
  });

  it("buildWat and buildWatDerived emit only canonical locals", () => {
    const b = model();
    for (const wat of [b.buildWat(), b.buildWatDerived(["tot"])]) {
      expect(wat).not.toMatch(/\$(1st|B-form|A\+|class\b)/);
    }
  });
});

describe("buildMxlpy: sliders", () => {
  it("emits slider=Slider(...) and imports Slider only when used", () => {
    const withSlider = new KineticModelBuilder()
      .addParameter("k", {
        value: 1,
        slider: { min: "0", max: "2", step: "0.1", desc: "rate" },
      })
      .addVariable("x", { value: 1 })
      .buildMxlpy();
    expect(withSlider).toContain(
      'm.add_parameter("k", 1, slider=Slider(min="0", max="2", step="0.1", desc="rate"))',
    );
    expect(withSlider).toContain("from mxlpy import Model, Slider");

    const without = new KineticModelBuilder()
      .addParameter("k", { value: 1 })
      .buildMxlpy();
    expect(without).not.toContain("Slider");
  });
});
