import {
  KineticModelBuilder,
  OdeModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Add,
  Minus,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import wat2wasm from "wat-compiler";
import { describe, expect, it } from "vitest";

// ── Numeric harnesses ─────────────────────────────────────────────────────────
// Both builders emit textually different code (kinetic computes reaction locals
// then sums stoich·rate; ODE inlines one expression per variable), so we prove
// equivalence by evaluating the generated rhs numerically.

type RhsFn = (t: number, vars: number[], pars: number[]) => number[];

function compileJsRhs(src: string): RhsFn {
  // src is an arrow-function expression: "(time, variables, pars) => {...}"
  return new Function(`return (${src});`)() as RhsFn;
}

function compileWatRhs(
  wat: string,
  nVars: number,
  nPars: number,
): RhsFn {
  const bytes = wat2wasm(wat);
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { memory },
    math: mathImports(),
  });
  const fcn = instance.exports.fcn as (
    n: number,
    t: number,
    y: number,
    f: number,
    p: number,
  ) => void;
  const heap = new Float64Array(memory.buffer);
  // Disjoint regions in the shared memory: y | dydt | pars.
  const yByte = 0;
  const outByte = nVars * 8;
  const parByte = 2 * nVars * 8;
  return (t, vars, pars) => {
    for (let i = 0; i < nVars; i++) heap[i] = vars[i];
    for (let i = 0; i < nPars; i++) heap[2 * nVars + i] = pars[i];
    fcn(nVars, t, yByte, outByte, parByte);
    return Array.from({ length: nVars }, (_, i) => heap[nVars + i]);
  };
}

function project(names: string[], point: Map<string, number>): number[] {
  return names.map((n) => point.get(n)!);
}

function randomPoint(names: string[]): Map<string, number> {
  // Strictly positive values keep these polynomial models well-defined.
  return new Map(names.map((n) => [n, 0.1 + Math.random() * 2]));
}

function assertRhsEquivalent(
  kinetic: KineticModelBuilder,
  ode: OdeModelBuilder,
): void {
  const varNames = kinetic.getNames();
  const parNames = kinetic.getParameterNames();
  // Authoring order must agree so a projected point means the same thing.
  expect(ode.getNames()).toEqual(varNames);
  expect(ode.getParameterNames()).toEqual(parNames);

  const kinJs = compileJsRhs(kinetic.buildJs());
  const odeJs = compileJsRhs(ode.buildJs());
  const kinWat = compileWatRhs(
    kinetic.buildWat(),
    varNames.length,
    parNames.length,
  );
  const odeWat = compileWatRhs(
    ode.buildWat(),
    varNames.length,
    parNames.length,
  );

  for (let trial = 0; trial < 100; trial++) {
    const point = randomPoint([...varNames, ...parNames]);
    const t = Math.random() * 10;
    const vars = project(varNames, point);
    const pars = project(parNames, point);

    const kJs = kinJs(t, vars, pars);
    const oJs = odeJs(t, vars, pars);
    const kWat = kinWat(t, vars, pars);
    const oWat = odeWat(t, vars, pars);

    for (let i = 0; i < varNames.length; i++) {
      // kinetic ≡ ode on each backend …
      expect(oJs[i]).toBeCloseTo(kJs[i], 12);
      expect(oWat[i]).toBeCloseTo(kWat[i], 12);
      // … and JS ≡ WAT (sanity that the backends themselves agree).
      expect(kWat[i]).toBeCloseTo(kJs[i], 9);
    }
  }

  // Initial values are part of the generated model and must match too.
  expect(ode.resolveInitialValues()).toEqual(kinetic.resolveInitialValues());
}

// ── Fixtures: the same model authored both ways ───────────────────────────────

function lotkaVolterraKinetic(): KineticModelBuilder {
  return new KineticModelBuilder()
    .addParameter("Alpha", { value: 0.1 })
    .addParameter("Beta", { value: 0.02 })
    .addParameter("Gamma", { value: 0.4 })
    .addParameter("Delta", { value: 0.02 })
    .addVariable("Prey", { value: 10 })
    .addVariable("Predator", { value: 10 })
    .addReaction("prey_growth", {
      fn: new Mul([new Name("Alpha"), new Name("Prey")]),
      stoichiometry: [{ name: "Prey", value: new Num(1) }],
    })
    .addReaction("predation", {
      fn: new Mul([new Name("Predator"), new Name("Prey")]),
      stoichiometry: [
        { name: "Prey", value: new Minus([new Name("Beta")]) },
        { name: "Predator", value: new Name("Delta") },
      ],
    })
    .addReaction("predator_death", {
      fn: new Mul([new Name("Gamma"), new Name("Predator")]),
      stoichiometry: [{ name: "Predator", value: new Num(-1) }],
    });
}

function lotkaVolterraOde(): OdeModelBuilder {
  const predation = new Mul([new Name("Predator"), new Name("Prey")]);
  return new OdeModelBuilder()
    .addParameter("Alpha", { value: 0.1 })
    .addParameter("Beta", { value: 0.02 })
    .addParameter("Gamma", { value: 0.4 })
    .addParameter("Delta", { value: 0.02 })
    .addVariable("Prey", { value: 10 })
    .addVariable("Predator", { value: 10 })
    .setDifferential(
      "Prey",
      new Add([
        new Mul([new Name("Alpha"), new Name("Prey")]),
        new Minus([new Mul([new Name("Beta"), predation])]),
      ]),
    )
    .setDifferential(
      "Predator",
      new Add([
        new Mul([new Name("Delta"), predation]),
        new Minus([new Mul([new Name("Gamma"), new Name("Predator")])]),
      ]),
    );
}

// Exercises a shared assignment (derived intermediate) and a non-unit numeric
// stoichiometric coefficient.
function dimerKinetic(): KineticModelBuilder {
  const b = new KineticModelBuilder()
    .addParameter("k", { value: 0.3 })
    .addVariable("A", { value: 5 })
    .addVariable("B", { value: 1 });
  b.addAssignment("total", { fn: new Add([new Name("A"), new Name("B")]) });
  return b.addReaction("r", {
    fn: new Mul([new Name("k"), new Name("total")]),
    stoichiometry: [
      { name: "A", value: new Num(-2) },
      { name: "B", value: new Num(1) },
    ],
  });
}

function dimerOde(): OdeModelBuilder {
  const rate = new Mul([new Name("k"), new Name("total")]);
  const b = new OdeModelBuilder()
    .addParameter("k", { value: 0.3 })
    .addVariable("A", { value: 5 })
    .addVariable("B", { value: 1 });
  b.addAssignment("total", { fn: new Add([new Name("A"), new Name("B")]) });
  return b
    .setDifferential("A", new Mul([new Num(-2), rate]))
    .setDifferential("B", rate);
}

describe("kinetic ↔ ode builder equivalence", () => {
  it("Lotka-Volterra: ±1 and symbolic ± coefficients", () => {
    assertRhsEquivalent(lotkaVolterraKinetic(), lotkaVolterraOde());
  });

  it("Dimerization: shared assignment + non-unit numeric stoichiometry", () => {
    assertRhsEquivalent(dimerKinetic(), dimerOde());
  });
});

describe("OdeModelBuilder", () => {
  it("defaults an unset differential to dx/dt = 0", () => {
    const b = new OdeModelBuilder().addVariable("X", { value: 1 });
    const rhs = compileJsRhs(b.buildJs());
    expect(rhs(0, [42], [])).toEqual([0]);
  });

  it("throws when setting a differential for an unknown variable", () => {
    const b = new OdeModelBuilder();
    expect(() => b.setDifferential("Nope", new Num(1))).toThrow(/unknown/);
  });
});
