import {
  buildAdjointWat,
  buildDerivedWat,
  buildModelWat,
} from "./backends/wasm/wat-codegen.js";
import { Add, Base, type GradMap, Mul, Name, Num } from "./mathml/index.js";

/**
 * Intermediate representation shared by every model builder.
 *
 * Both the kinetic (dx/dt = N·v) and the direct-ODE builders lower into this
 * same structure, after which all numeric code generation (JS / Python / WAT)
 * is identical. The only difference between the builders is how `dxdt` is
 * assembled during lowering; everything downstream operates on the IR alone.
 */
export interface ModelIntermediate {
  name: string;
  expr: Base;
}

export interface ModelIR {
  /** State variable ids, in order (matches y[] / destructuring offsets). */
  varNames: string[];
  /** Parameter ids, in order (matches pars[] offsets). */
  parNames: string[];
  /** Parameter id → numeric value. */
  paramValues: Map<string, number>;
  /** Variable id → initial value (number, or expression to evaluate). */
  initialValues: Map<string, number | Base>;
  /** Assignments (and, for kinetic models, reactions) in topological order. */
  intermediates: ModelIntermediate[];
  /**
   * Report-only quantities, in topological order (mxlweb-core issue #6) —
   * may reference `intermediates`, variables/parameters, or an earlier
   * readout, but nothing in `intermediates`/`dxdt` may ever reference one of
   * these. Never folded into `intermediates`: `irToJs`/`irToWat` (the actual
   * RHS the integrator steps) ignore this field entirely, so a readout is
   * structurally incapable of feeding `dxdt`. Only the "selectable derived
   * output" backends (`irToJsDerived`, `irToWatDerived`, `irToPython`)
   * compute these, after a simulation's variable trajectory already exists.
   */
  readouts: ModelIntermediate[];
  /** Variable id → its dx/dt expression, referencing vars/params/intermediates. */
  dxdt: Map<string, Base>;
  /** Display/python-facing name for every id (falls back to the id). */
  displayNames: Map<string, string>;
}

const ZERO = new Num(0);

function rhsOf(ir: ModelIR, varName: string): Base {
  return ir.dxdt.get(varName) ?? ZERO;
}

export function evalInitialAssignment(
  expr: Base,
  params: Map<string, number>,
): number {
  const names = [...params.keys()];
  const values = [...params.values()];
  try {
    const fn = new Function(...names, `return ${expr.toJs()}`);
    return fn(...values) as number;
  } catch {
    return 0;
  }
}

export function irToJs(ir: ModelIR): string {
  const varDestructure =
    ir.varNames.length > 0
      ? `const [${ir.varNames.join(", ")}] = variables;`
      : "";
  const parDestructure =
    ir.parNames.length > 0 ? `const [${ir.parNames.join(", ")}] = pars;` : "";

  const fns = ir.intermediates
    .map((m) => `  const ${m.name} = ${m.expr.toJs()};`)
    .join("\n");

  const returns = ir.varNames.map((k) => rhsOf(ir, k).toJs()).join(", ");

  return `(time, variables, pars) => {
  ${varDestructure}
  ${parDestructure}
${fns}
  return [${returns}];
}`;
}

export function irToJsDerived(
  ir: ModelIR,
  selectedDerived?: string[],
): { allDerived: string; selectDerived: string } {
  const varDestructure =
    ir.varNames.length > 0
      ? `const [${ir.varNames.join(", ")}] = variables;`
      : "";
  const parDestructure =
    ir.parNames.length > 0 ? `const [${ir.parNames.join(", ")}] = pars;` : "";

  // Readouts appended after intermediates: both lists are already
  // internally topologically ordered, and every readout's dependencies are
  // either an intermediate (computed above) or an earlier readout, never
  // the reverse (ModelIR.readouts's doc comment) — so straight
  // concatenation is a valid evaluation order.
  const allIntermediates = [...ir.intermediates, ...ir.readouts];
  const fns = allIntermediates
    .map((m) => `  const ${m.name} = ${m.expr.toJs()};`)
    .join("\n");

  const order = allIntermediates.map((m) => m.name);

  const allDerived = `(time, variables, pars) => {
  ${varDestructure}
  ${parDestructure}
${fns}
  return [${order.join(", ")}];
}`;

  const selected = selectedDerived ?? order;
  const indices = selected.map((k) => order.indexOf(k)).filter((i) => i >= 0);
  const selectDerived =
    indices.length > 0
      ? `(all) => [${indices.map((i) => `all[${i}]`).join(", ")}]`
      : `(all) => all`;

  return { allDerived, selectDerived };
}

export function irToWat(ir: ModelIR): string {
  const equations = ir.varNames.map((name) => ({
    varName: name,
    expr: rhsOf(ir, name),
  }));
  return buildModelWat(
    equations,
    ir.varNames,
    ir.parNames,
    "time",
    ir.intermediates,
  );
}

/**
 * irToWatDerived — WAT module computing `selectedDerived` (in that exact
 * order) from (t, y, pars). Used by the fit backend (ADR 0004) to evaluate
 * derived-quantity fit targets without leaving WASM during a fit.
 */
export function irToWatDerived(ir: ModelIR, selectedDerived: string[]): string {
  const allIntermediates = [...ir.intermediates, ...ir.readouts];
  const byName = new Map(allIntermediates.map((m) => [m.name, m.expr]));
  for (const key of selectedDerived) {
    if (!byName.has(key)) {
      throw new Error(`irToWatDerived: unknown derived key "${key}"`);
    }
  }
  const needed = transitiveDerivedDeps(allIntermediates, selectedDerived);
  const intermediates = allIntermediates.filter((m) => needed.has(m.name));
  const outputs = selectedDerived.map((key) => ({
    name: key,
    expr: byName.get(key)!,
  }));
  return buildDerivedWat(
    outputs,
    ir.varNames,
    ir.parNames,
    "time",
    intermediates,
  );
}

/**
 * Symbolic name for the adjoint variable λ_i (ADR 0005 §2.3) as a *runtime
 * input* — resolved via `WatContext.lambdaIndex`, not a leaf the forward
 * model owns. Double-underscore prefixed so it can't collide with a real
 * model symbol a user might author (mirrored by `WatContext`'s own doc
 * comment).
 */
export function adjointLambdaName(i: number): string {
  return `__adjoint_lambda_${i}`;
}

function adjointAccumName(intermediateName: string): string {
  return `__adjoint_accum_${intermediateName}`;
}

function sumContributions(contributions: Base[] | undefined): Base {
  if (!contributions || contributions.length === 0) return new Num(0);
  return contributions.length === 1 ? contributions[0] : new Add(contributions);
}

/** Output of {@link buildAdjointGraph} — see `buildAdjointWat`'s doc comment for how the two halves of `intermediates` are told apart. */
export interface AdjointGraph {
  intermediates: ModelIntermediate[];
  dlambda: { varName: string; expr: Base }[];
  dtheta: { thetaName: string; expr: Base }[];
}

/**
 * The graph-level backward-WAT orchestration ADR 0005 §4 flagged as
 * "deliberately deferred past this ADR" — ties the per-node
 * `Base.pushGradient` rules (§2.2) into a full model.
 *
 * The trick: `L = Σ_i λ_i · f_i` (f_i = dx_i/dt) is one scalar expression;
 * seeding its reverse-mode walk with `-1` produces `dλ/dt = -∂L/∂y` and
 * `dθ/dt = -∂L/∂θ` in a *single* backward pass — exactly the vector-Jacobian
 * product the adjoint method needs, with λ playing the role of the seed
 * cotangent. Walking `ir.intermediates` in reverse (mirroring their forward
 * topological order) rather than treating `L` as one flat tree is what
 * makes this cheap rather than naive-symbolic-diff-shaped: each
 * intermediate's accumulated adjoint is computed once, stored as its own
 * named local (`adjointAccumName`), and referenced by `Name` everywhere
 * downstream needs it — the same sharing `wat-codegen.ts` already relies on
 * for the forward pass, not a new mechanism.
 */
export function buildAdjointGraph(
  ir: ModelIR,
  thetaNames: string[],
): AdjointGraph {
  const lambdaNames = ir.varNames.map((_, i) => adjointLambdaName(i));
  const lTerms = ir.varNames.map(
    (name, i) => new Mul([new Name(lambdaNames[i]), rhsOf(ir, name)]),
  );

  const grads: GradMap = new Map();
  for (const term of lTerms) {
    term.pushGradient(new Num(-1), grads);
  }

  const adjointAccum: ModelIntermediate[] = [];
  for (let i = ir.intermediates.length - 1; i >= 0; i--) {
    const { name, expr } = ir.intermediates[i];
    const contributions = grads.get(name);
    if (!contributions || contributions.length === 0) continue;
    const accumName = adjointAccumName(name);
    adjointAccum.push({
      name: accumName,
      expr: sumContributions(contributions),
    });
    // Push the *local reference*, not `contributions` again, so anything
    // further upstream shares this one computed value instead of
    // re-expanding it at every use.
    expr.pushGradient(new Name(accumName), grads);
  }

  return {
    intermediates: [...ir.intermediates, ...adjointAccum],
    dlambda: ir.varNames.map((name) => ({
      varName: name,
      expr: sumContributions(grads.get(name)),
    })),
    dtheta: thetaNames.map((name) => ({
      thetaName: name,
      expr: sumContributions(grads.get(name)),
    })),
  };
}

/**
 * irToAdjointWat — the adjoint RHS WAT module (ADR 0005 §2.3.4's
 * `adjointWat`), generated lazily by callers only when a fit session
 * actually needs the "adjoint" backend — see `buildAdjointGraph`'s doc
 * comment for the algorithm.
 */
export function irToAdjointWat(ir: ModelIR, thetaNames: string[]): string {
  const graph = buildAdjointGraph(ir, thetaNames);
  const lambdaNames = ir.varNames.map((_, i) => adjointLambdaName(i));
  return buildAdjointWat(
    graph.dlambda,
    graph.dtheta,
    ir.varNames,
    ir.parNames,
    lambdaNames,
    "time",
    graph.intermediates,
  );
}

/**
 * Symbolic name for the forward-sensitivity component `∂y_{stateIdx}/∂θ_{thetaIdx}`
 * (a "just another state variable" trick — {@link buildJacobianGraph}'s doc
 * comment). Double-underscore prefixed, same collision-avoidance reasoning as
 * {@link adjointLambdaName}.
 */
export function sensitivityName(thetaIdx: number, stateIdx: number): string {
  return `__sens_${thetaIdx}_${stateIdx}`;
}

/** Output of {@link buildJacobianGraph}: an *extended* model — original state
 * variables plus one sensitivity component per (fit parameter × state) pair —
 * ready to hand to `buildModelWat` unchanged. */
export interface JacobianGraph {
  varNames: string[];
  equations: { varName: string; expr: Base }[];
  intermediates: ModelIntermediate[];
}

/**
 * Forward-sensitivity augmented system for the "lm" backend's analytic
 * Jacobian (grill-me follow-up to ADR 0005 §2.3/§2.4 — that ADR's own
 * reasoning for choosing adjoint+Adam over lmdif+finite-differences was
 * "lmdif needs the full residual Jacobian, which reverse-mode/adjoint isn't
 * cheap for"; forward sensitivity is a *third* option that ADR never
 * considered, cheap exactly when reverse-mode is expensive — few fit
 * parameters, many residuals — the small-NN-block regime this exists for).
 *
 * For sensitivity `s_{k,j} = ∂y_k/∂θ_j`, the variational equation is
 * `ds_{k,j}/dt = Σ_m (∂f_k/∂y_m)·s_{m,j} + ∂f_k/∂θ_j`. Both per-equation
 * partial-derivative rows — `∂f_k/∂y_m` for every m, `∂f_k/∂θ_j` for every j
 * — come from *one* reverse-mode pass over `f_k` (seed `1`, not `n_theta`
 * separate forward-mode passes): reverse-mode gives a full row of partials
 * per output in one sweep, and there are only `n_y` outputs (equations) to
 * differentiate, however large `n_theta` gets — the same "cheap outputs,
 * expensive inputs" shape `buildAdjointGraph` exploits for its own single
 * combined pass, just done once per equation here instead of once total
 * (there's no single scalar loss to combine into, since a Jacobian needs
 * every equation's own row, not one weighted sum of them).
 *
 * Each state k's sensitivity vectors (`s_{k,0..n_theta-1}`) are declared as
 * ordinary *extra state variables* — `Name(sensitivityName(j,k))` resolves
 * through the exact same `varIndex` machinery `y`/`pars` already use
 * (`WatContext`/`Name.toWat`), so the augmented system needs no new WAT
 * plumbing at all (contrast `buildAdjointGraph`, whose backward-integration,
 * separately-signed lambda/theta-gradient output needs `buildAdjointWat`'s
 * own `lambdaIndex`/out-pointer machinery): `buildModelWat` already treats
 * "more state variables, more equations, same y_ptr/f_ptr buffers" as its
 * ordinary case.
 */
export function buildJacobianGraph(
  ir: ModelIR,
  thetaNames: string[],
): JacobianGraph {
  const nY = ir.varNames.length;
  const nTheta = thetaNames.length;

  // One reverse pass per equation k, independent of the others (and of
  // buildAdjointGraph's own pass) — each gets its own accumulator locals
  // (`__jac_${k}_accum_...`) so the n_y passes can't collide while still
  // sharing work *within* a pass the same way buildAdjointGraph does.
  const accum: ModelIntermediate[] = [];
  const dfDy: Base[][] = []; // dfDy[k][m] = ∂f_k/∂y_m
  const dfDTheta: Base[][] = []; // dfDTheta[k][j] = ∂f_k/∂θ_j

  for (let k = 0; k < nY; k++) {
    const fK = rhsOf(ir, ir.varNames[k]);
    const grads: GradMap = new Map();
    fK.pushGradient(new Num(1), grads);

    for (let i = ir.intermediates.length - 1; i >= 0; i--) {
      const { name, expr } = ir.intermediates[i];
      const contributions = grads.get(name);
      if (!contributions || contributions.length === 0) continue;
      const accumName = `__jac_${k}_accum_${name}`;
      accum.push({ name: accumName, expr: sumContributions(contributions) });
      expr.pushGradient(new Name(accumName), grads);
    }

    dfDy.push(ir.varNames.map((name) => sumContributions(grads.get(name))));
    dfDTheta.push(thetaNames.map((name) => sumContributions(grads.get(name))));
  }

  const sensVarNames: string[] = [];
  for (let j = 0; j < nTheta; j++) {
    for (let k = 0; k < nY; k++) sensVarNames.push(sensitivityName(j, k));
  }

  const sensEquations: { varName: string; expr: Base }[] = [];
  for (let j = 0; j < nTheta; j++) {
    for (let k = 0; k < nY; k++) {
      const terms: Base[] = ir.varNames.map(
        (_, m) => new Mul([dfDy[k][m], new Name(sensitivityName(j, m))]),
      );
      terms.push(dfDTheta[k][j]);
      sensEquations.push({
        varName: sensitivityName(j, k),
        expr: new Add(terms),
      });
    }
  }

  return {
    varNames: [...ir.varNames, ...sensVarNames],
    equations: [
      ...ir.varNames.map((name) => ({ varName: name, expr: rhsOf(ir, name) })),
      ...sensEquations,
    ],
    intermediates: [...ir.intermediates, ...accum],
  };
}

/**
 * irToJacobianWat — the forward-sensitivity augmented-system WAT module
 * (`buildJacobianGraph`'s doc comment): `n_y + n_y·n_theta` state variables,
 * generated lazily by callers only when a fit session actually needs the
 * "lm" backend's analytic-Jacobian path (small trained NN block(s)).
 */
export function irToJacobianWat(ir: ModelIR, thetaNames: string[]): string {
  const graph = buildJacobianGraph(ir, thetaNames);
  return buildModelWat(
    graph.equations,
    graph.varNames,
    ir.parNames,
    "time",
    graph.intermediates,
  );
}

function transitiveDerivedDeps(
  intermediates: ModelIntermediate[],
  selectedKeys: string[],
): Set<string> {
  const byName = new Map(intermediates.map((m) => [m.name, m.expr]));
  const needed = new Set<string>();
  const visit = (key: string) => {
    if (needed.has(key) || !byName.has(key)) return;
    needed.add(key);
    for (const sym of byName.get(key)!.getSymbols(new Set())) visit(sym);
  };
  for (const key of selectedKeys) visit(key);
  return needed;
}

export function irToPython(
  ir: ModelIR,
  userParameters: string[],
  selectedDerived?: string[],
): string {
  for (const key of userParameters) {
    if (!ir.paramValues.has(key)) {
      throw new Error(`buildPython: unknown parameter key "${key}"`);
    }
  }
  // `fns` (intermediates only) feeds `def model(...)` below — the actual
  // dxdt RHS, which must never see a readout (ModelIR.readouts's doc
  // comment). `allFns`/`order` fold in readouts too, for `def all_derived`/
  // `selected_derived` — the post-simulation "selectable report output"
  // functions, where a readout is a legal selection.
  const allIntermediates = [...ir.intermediates, ...ir.readouts];
  const order = allIntermediates.map((m) => m.name);
  if (selectedDerived !== undefined) {
    const known = new Set(order);
    for (const key of selectedDerived) {
      if (!known.has(key)) {
        throw new Error(`buildPython: unknown derived key "${key}"`);
      }
    }
  }

  const displayNames = ir.displayNames;
  const Name = (x: string) => displayNames.get(x) ?? x;

  const remove = new Set(userParameters);
  const parameters = [...ir.paramValues.entries()]
    .filter(([name]) => !remove.has(name))
    .map(([name, value]) => `${Name(name)} = ${value}`)
    .join("\n    ");

  const variables = ir.varNames.map(Name).join(", ");
  const dxdt = ir.varNames.map((name) => `d${Name(name)}dt`).join(", ");

  const fns = ir.intermediates
    .map((m) => `${Name(m.name)} = ${m.expr.toPy(displayNames)}`)
    .join("\n    ");

  const allFns = allIntermediates
    .map((m) => `${Name(m.name)} = ${m.expr.toPy(displayNames)}`)
    .join("\n    ");

  const selectedFns = selectedDerived
    ? (() => {
        const needed = transitiveDerivedDeps(allIntermediates, selectedDerived);
        return allIntermediates
          .filter((m) => needed.has(m.name))
          .map((m) => `${Name(m.name)} = ${m.expr.toPy(displayNames)}`)
          .join("\n    ");
      })()
    : null;

  const selectedDerivedSet = selectedDerived ? new Set(selectedDerived) : null;
  const selectedReturn = selectedDerived
    ? order
        .filter((name) => selectedDerivedSet!.has(name))
        .map(Name)
        .join(", ")
    : null;

  const rhsString = ir.varNames
    .map((name) => `d${Name(name)}dt = ${rhsOf(ir, name).toPy(displayNames)}`)
    .join("\n    ");

  const extraArgs = userParameters.map((i) => `${i}: float`).join(",\n    ");

  const y0 = ir.varNames
    .map((name) => {
      const value = ir.initialValues.get(name)!;
      if (value instanceof Base) {
        return `"${Name(name)}": ${evalInitialAssignment(value, ir.paramValues)}`;
      }
      return `"${Name(name)}": ${value}`;
    })
    .join(", ");

  const args = extraArgs.length > 0 ? "\n      " + extraArgs : "";
  const selectedDerivedBlock =
    selectedFns !== null
      ? `
def selected_derived(
    time: float,
    variables: list[float], ${args}
):
    ${variables} = variables
    ${parameters}
    ${selectedFns}
    return [${selectedReturn}]

derived = selected_derived`
      : `
derived = all_derived`;

  return `import numpy as np
import math

def model(
    time: float,
    variables: list[float], ${args}
):
    ${variables} = variables
    ${parameters}
    ${fns}
    ${rhsString}
    return [${dxdt}]

def all_derived(
    time: float,
    variables: list[float], ${args}
):
    ${variables} = variables
    ${parameters}
    ${allFns}
    return [${order.map(Name).join(", ")}]
${selectedDerivedBlock}
y0 = {${y0}}
    `;
}
