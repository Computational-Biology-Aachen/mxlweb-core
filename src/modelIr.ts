import {
  buildAdjointWat,
  buildDerivedWat,
  buildModelWat,
} from "./backends/wasm/wat-codegen.js";
import {
  Add,
  Base,
  Binary,
  type GradMap,
  Log,
  Mul,
  Name,
  Nary,
  Nullary,
  Num,
  Sqrt,
  Unary,
  nameRenamer,
} from "./mathml/index.js";
import { RESERVED, uniqueName } from "./identifiers.js";

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

/**
 * `ir` with every id (and every `Name` in its expressions) renamed through
 * `names`; ids not in `names` are kept. The renamed IR carries no display
 * names: its ids are already what the code backends emit.
 */
export function renameIR(
  ir: ModelIR,
  names: ReadonlyMap<string, string>,
): ModelIR {
  const id = (k: string) => names.get(k) ?? k;
  const rename = nameRenamer(names);
  const intermediate = (m: ModelIntermediate) => ({
    name: id(m.name),
    expr: rename(m.expr),
  });
  return {
    varNames: ir.varNames.map(id),
    parNames: ir.parNames.map(id),
    paramValues: new Map([...ir.paramValues].map(([k, v]) => [id(k), v])),
    initialValues: new Map(
      [...ir.initialValues].map(([k, v]) => [
        id(k),
        v instanceof Base ? rename(v) : v,
      ]),
    ),
    intermediates: ir.intermediates.map(intermediate),
    readouts: ir.readouts.map(intermediate),
    dxdt: new Map([...ir.dxdt].map(([k, e]) => [id(k), rename(e)])),
    displayNames: new Map(),
  };
}

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
 * Reverse-mode gradients of the derived fit targets `selectedDerived` — the
 * `derivedGradWat` the gradient fit backends need for derived targets (ADR
 * 0009): for each key, `∂d/∂y_m` for every state variable then `∂d/∂θ_j`
 * for every fitted parameter, in that order. One reverse pass per key,
 * seeded with 1 on the key itself and walking its (pruned) dependencies in
 * reverse topological order with per-key accumulator locals — the same
 * pattern {@link buildJacobianGraph} uses per equation.
 */
export function buildDerivedGradGraph(
  modelIr: ModelIR,
  selectedDerived: string[],
  thetaNames: string[],
): { outputs: ModelIntermediate[]; intermediates: ModelIntermediate[] } {
  const ir = liftSubexpressions(modelIr);
  const allIntermediates = [...ir.intermediates, ...ir.readouts];
  const known = new Set(allIntermediates.map((m) => m.name));
  for (const key of selectedDerived) {
    if (!known.has(key)) {
      throw new Error(`buildDerivedGradGraph: unknown derived key "${key}"`);
    }
  }
  const needed = transitiveDerivedDeps(allIntermediates, selectedDerived);
  const deps = allIntermediates.filter((m) => needed.has(m.name));

  const accum: ModelIntermediate[] = [];
  const outputs: ModelIntermediate[] = [];
  selectedDerived.forEach((key, k) => {
    const grads: GradMap = new Map();
    new Name(key).pushGradient(new Num(1), grads);
    for (let i = deps.length - 1; i >= 0; i--) {
      const { name, expr } = deps[i];
      const contributions = grads.get(name);
      if (!contributions || contributions.length === 0) continue;
      const accumName = `__dgrad_${k}_accum_${name}`;
      accum.push({ name: accumName, expr: sumContributions(contributions) });
      expr.pushGradient(new Name(accumName), grads);
    }
    ir.varNames.forEach((name, m) =>
      outputs.push({
        name: `__dgrad_${k}_y_${m}`,
        expr: sumContributions(grads.get(name)),
      }),
    );
    thetaNames.forEach((name, j) =>
      outputs.push({
        name: `__dgrad_${k}_theta_${j}`,
        expr: sumContributions(grads.get(name)),
      }),
    );
  });
  return { outputs, intermediates: [...deps, ...accum] };
}

/** irToDerivedGradWat — {@link buildDerivedGradGraph} as a derived-shaped
 * WAT module (`buildDerivedWat`, registered via `set_derived_grad_fn`). */
export function irToDerivedGradWat(
  ir: ModelIR,
  selectedDerived: string[],
  thetaNames: string[],
): string {
  const graph = buildDerivedGradGraph(ir, selectedDerived, thetaNames);
  return buildDerivedWat(
    graph.outputs,
    ir.varNames,
    ir.parNames,
    "time",
    graph.intermediates,
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

/** Rebuilds `expr` with every child mapped through `f` (children only, not
 * `expr` itself); leaves and unknown node types come back unchanged. */
function mapChildren(expr: Base, f: (child: Base) => Base): Base {
  if (expr instanceof Unary) {
    const Ctor = expr.constructor as new (child: Base) => Base;
    return new Ctor(f(expr.child));
  }
  if (expr instanceof Binary) {
    const Ctor = expr.constructor as new (left: Base, right: Base) => Base;
    return new Ctor(f(expr.left), f(expr.right));
  }
  if (expr instanceof Nary) {
    const Ctor = expr.constructor as new (children: Base[]) => Base;
    return new Ctor(expr.children.map(f));
  }
  if (expr instanceof Log || expr instanceof Sqrt) {
    const Ctor = expr.constructor as new (child: Base, base: Base) => Base;
    return new Ctor(f(expr.child), f(expr.base));
  }
  return expr;
}

const BOOLEAN_NODES = new Set([
  "And",
  "Or",
  "Xor",
  "Not",
  "Implies",
  "Eq",
  "NotEqual",
  "GreaterThan",
  "GreaterEqual",
  "LessThan",
  "LessEqual",
]);

/**
 * The same model with every non-leaf numeric subexpression bound to its own named
 * intermediate (A-normal form) — for the gradient graphs only. A reverse
 * pass over one big inline expression copies the forward subtree below
 * each node into that node's local derivative (`Exp(x)` into the gradient
 * of `x`, the denominator into a quotient's, ...), so nested expressions
 * blow up super-linearly: the NPQ model's 15 KB RHS gave a ~700 KB
 * Jacobian module, beyond what `wat-compiler` can encode. With every node
 * named, each local derivative only references names, and the graph stays
 * linear in the model's size. Lifted temporaries of `intermediates`/`dxdt`
 * join `intermediates` and those of `readouts` join `readouts`, each right
 * before its first user, preserving topological order. Evaluating a lifted
 * `Piecewise` branch eagerly is harmless: f64 arithmetic never traps, and
 * an untaken branch's value is never selected.
 */
function liftSubexpressions(ir: ModelIR): ModelIR {
  let counter = 0;
  const lifter = (out: ModelIntermediate[], seen: Map<Base, Name>) => {
    const lift = (child: Base): Base => {
      if (child instanceof Nullary) return child;
      // Conditions compile to i32 in WAT, never to an f64 local — keep them
      // inline, lifting only their (numeric) operands.
      if (BOOLEAN_NODES.has(child.nodeType)) return mapChildren(child, lift);
      const known = seen.get(child);
      if (known) return known;
      const rebuilt = mapChildren(child, lift);
      const name = new Name(`__lift_${counter++}`);
      out.push({ name: name.name, expr: rebuilt });
      seen.set(child, name);
      return name;
    };
    return (expr: Base) => mapChildren(expr, lift);
  };

  const intermediates: ModelIntermediate[] = [];
  const seen = new Map<Base, Name>();
  const liftForward = lifter(intermediates, seen);
  for (const m of ir.intermediates) {
    intermediates.push({ name: m.name, expr: liftForward(m.expr) });
  }
  const dxdt = new Map<string, Base>();
  for (const [name, expr] of ir.dxdt) dxdt.set(name, liftForward(expr));

  const readouts: ModelIntermediate[] = [];
  const liftReadout = lifter(readouts, new Map(seen));
  for (const m of ir.readouts) {
    readouts.push({ name: m.name, expr: liftReadout(m.expr) });
  }
  return { ...ir, intermediates, dxdt, readouts };
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
  modelIr: ModelIR,
  thetaNames: string[],
): AdjointGraph {
  const ir = liftSubexpressions(modelIr);
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
  modelIr: ModelIR,
  thetaNames: string[],
): JacobianGraph {
  const ir = liftSubexpressions(modelIr);
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

    // dfDy[k][m] gets embedded in *every* j's sensitivity equation for this
    // k (n_theta times over — the sensitivity ODE's own coupling term,
    // ∂f_k/∂y_m, doesn't depend on which fit parameter j the equation is
    // for). Bind each one to a named intermediate here, exactly like the
    // per-node accumulators above, so the WAT codegen (which shares an
    // expression only when it's a `Name` reference to something already
    // computed, same as `ir.intermediates` generally) computes it once and
    // references it — not re-serializes the whole (potentially large, e.g.
    // an NN block's reverse-mode expansion) expression n_theta times.
    // Without this, a modest model (2 states, ~25 fit params, one small NN
    // block) generated >1MB of WAT text with ~90k nodes, deep enough to
    // stack-overflow the (separately recursive, non-tail-call) wat-compiler
    // encoder — not from nesting depth (only ~30 levels) but from sheer
    // duplicated node count. dfDTheta[k][j] doesn't need this: each entry
    // is used exactly once (one equation per (j,k) pair), so there's
    // nothing to share.
    const dfDyRow: Base[] = [];
    for (let m = 0; m < nY; m++) {
      const dfdyName = `__jac_${k}_dfdy_${m}`;
      accum.push({
        name: dfdyName,
        expr: sumContributions(grads.get(ir.varNames[m])),
      });
      dfDyRow.push(new Name(dfdyName));
    }
    dfDy.push(dfDyRow);
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

  // Python unpacking: `x, = variables` for one variable (a bare `x =` would
  // bind the whole list), `[] = variables` for none.
  const variables =
    ir.varNames.length === 0
      ? "[]"
      : ir.varNames.length === 1
        ? `${Name(ir.varNames[0])},`
        : ir.varNames.map(Name).join(", ");
  // `d<x>dt` locals must not shadow a model name (e.g. a parameter `dxdt`).
  const taken = new Set(
    [
      ...ir.varNames,
      ...ir.paramValues.keys(),
      ...allIntermediates.map((m) => m.name),
    ].map(Name),
  );
  for (const r of RESERVED) taken.add(r);
  const dName = new Map(
    ir.varNames.map((name) => [name, uniqueName(`d${Name(name)}dt`, taken)]),
  );
  const dxdt = ir.varNames.map((name) => dName.get(name)!).join(", ");

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
    .map(
      (name) => `${dName.get(name)!} = ${rhsOf(ir, name).toPy(displayNames)}`,
    )
    .join("\n    ");

  const extraArgs = userParameters
    .map((i) => `${Name(i)}: float`)
    .join(",\n    ");

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
