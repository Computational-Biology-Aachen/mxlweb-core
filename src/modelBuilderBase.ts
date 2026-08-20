import { SvelteMap } from "svelte/reactivity";
import { Add, Base, Mul, Num, type JsonNode } from "./mathml/index.js";
import {
  evalInitialAssignment,
  irToAdjointWat,
  irToJs,
  irToJsDerived,
  irToPython,
  irToWat,
  irToWatDerived,
  type ModelIR,
} from "./modelIr.js";
import { buildNNBlock } from "./nnBlock.js";

export type SliderArgs = {
  min: string;
  max: string;
  step: string;
  desc?: string;
};

export type Variable = {
  value: number | Base;
  displayName?: string;
  texName?: string;
  slider?: SliderArgs;
};
export type Parameter = {
  value: number;
  displayName?: string;
  texName?: string;
  slider?: SliderArgs;
};
export type Assign = {
  fn: Base;
  displayName?: string;
  texName?: string;
};

/**
 * A UDE/NODE correction term (ADR 0005 in the mxlweb repo, §2.1/§2.1.3).
 * Architecture and identity only — the generated `Parameter` entries
 * (weights/biases) live in {@link ModelBuilderBase.parameters} like any other
 * parameter, and the generated expression is recomputed fresh from this
 * config wherever it's needed rather than stored, since it's a pure function
 * of the architecture (see {@link ModelBuilderBase.composeNNBlocks}).
 */
export type NNBlockConfig = {
  /** Names of existing variables/parameters/derived quantities the block reads. */
  inputs: string[];
  /** Number of hidden layers — see `nnBlock.ts`'s {@link NNBlockSpec.depth}. */
  depth: number;
  /** Uniform hidden-layer width — see `nnBlock.ts`'s {@link NNBlockSpec.width}. */
  width: number;
  /** Seed for reproducible Glorot initialization (used once, at `addNNBlock` time). */
  seed: number;
  /** Which existing variable(s) this block corrects — one per output, so its length *is* the block's output count. */
  targets: string[];
  /** Whether this block's weights (and its `scale`) are included when fitting (ADR 0005 §2.1.3's per-block toggle) — a UI/fit-config concern downstream (`mxl-web`), not interpreted here. */
  trained: boolean;
  /**
   * Initial value for the block's single trainable output-scaling factor —
   * `dx/dt = f(x,p,t) + scale · NN(x,θ)` — shared across all of the block's
   * outputs. Needed in practice, not just cosmetically: a freshly
   * Glorot-initialized network's raw output can be large enough to blow up
   * the very first fit iteration on a bigger block; starting small (default
   * `0.1`, chosen — not derived — as a conservative starting point) and
   * letting the scale itself train fixes that without capping the
   * network's own expressiveness. Like `seed`, this is only the value
   * `addNNBlock` seeds the generated `${key}_scale` Parameter with — from
   * then on the live value in `this.parameters` is authoritative (fitting
   * or a direct edit updates it there, same as any weight/bias).
   */
  scale: number;
  /**
   * How this block's output composes onto its target(s)' mechanistic dx/dt
   * (grill-me follow-up to ADR 0005 §2.1, resolved alongside `scale`):
   * `"additive"` is `dx/dt = f(x,p,t) + scale · NN(x,θ)` (the original,
   * only, behavior); `"multiplicative"` is `dx/dt = f(x,p,t) · (1 + scale ·
   * NN(x,θ))` — a near-zero/untrained network leaves `f` unchanged, so
   * (unlike a bare `f · scale · NN`) it doesn't zero out the mechanistic
   * dynamics *or* the gradient w.r.t. every mechanistic parameter on the
   * first fit iteration. Composed in `ModelBuilderBase.composeNNBlocks`,
   * not by either builder's own `dxdtExpr` — multiplication can't be
   * expressed as one more stoichiometric reaction term, so this can't be
   * "just another reaction" the way an additive `KineticModelBuilder`
   * block used to be; both mechanisms, for both builders, compose at the
   * same shared `lower()` stage instead.
   */
  mechanism: "additive" | "multiplicative";
};

/**
 * Whether `name` is the scale, a weight, or a bias generated for NN block
 * `blockKey` — the generator's naming convention is `${blockKey}_scale`,
 * `${blockKey}_w${layerIdx}_${i}_${j}`, `${blockKey}_b${layerIdx}_${i}`
 * (`nnBlock.ts`), so a bare `startsWith` prefix check is unsafe: a
 * hand-authored parameter like `corr_water_temp` would false-positive match
 * block `"corr"`'s `_w` prefix. Requiring a digit (the layer index)
 * immediately after the weight/bias prefix rules that out, since every real
 * generated name has one there and essentially no hand-typed name does;
 * `_scale` has no such suffix so it's matched exactly instead. Exported so
 * a caller that already has a specific block key in hand (e.g. `Fit.svelte`
 * collecting one *trained* block's fittable parameters) doesn't need its
 * own copy of this check.
 */
export function isNNBlockOwnedParamName(
  name: string,
  blockKey: string,
): boolean {
  if (name === `${blockKey}_scale`) return true;
  for (const infix of ["_w", "_b"]) {
    const prefix = `${blockKey}${infix}`;
    if (name.startsWith(prefix) && /^\d/.test(name.slice(prefix.length))) {
      return true;
    }
  }
  return false;
}

export function defaultValue(a: string | undefined, b: string): string {
  if (a === undefined) return b;
  return a;
}

/**
 * Escapes characters KaTeX treats specially even inside `\text{...}` —
 * contrary to plain LaTeX, KaTeX's text mode does *not* accept a bare `_`
 * literally (`\text{a_b}` throws "Expected 'EOF', got '_'", not a rendered
 * underscore), and likewise for `{`/`}`/`#`/`$`/`%`/`&`/`~`/`^`/`\`. Apply
 * to any arbitrary/user-provided string before it lands inside `\text{}` —
 * every generated `displayName` (e.g. an NN block's weight/bias names,
 * always containing `_`) needs this, not just user-typed ones.
 */
export function texEscape(s: string): string {
  return s.replace(/[\\{}_#$%&~^]/g, (c) => {
    if (c === "\\") return "\\textbackslash{}";
    if (c === "~") return "\\textasciitilde{}";
    if (c === "^") return "\\textasciicircum{}";
    return `\\${c}`;
  });
}

export function defaultTexName(name: string): string {
  return `\\text{${texEscape(name)}}`;
}

/** A derived computation that becomes a named local during code generation. */
export type IntermediateDef = {
  fn: Base;
  displayName?: string;
  texName?: string;
};

/** The model-formulation discriminator written to (and selecting) an `.mxl.json` schema. */
export type MxlKind = "kinetic" | "ode" | "steady-state";

/** One entity (variable/parameter/derived/reaction/nn_block) in the `.mxl.json` model section. */
export type MxlEntity = {
  value?: JsonNode;
  fn?: JsonNode;
  stoichiometry?: Record<string, JsonNode>;
  displayName?: string;
  texName?: string;
  slider?: { min: string; max: string; step: string; desc?: string };
  /** `nn_blocks` entries only — see {@link NNBlockConfig}. */
  inputs?: string[];
  depth?: number;
  width?: number;
  seed?: number;
  targets?: string[];
  trained?: boolean;
  scale?: number;
  mechanism?: "additive" | "multiplicative";
};

/** A complete `.mxl.json` document, as emitted by {@link ModelBuilderBase.buildMxlJson}. */
export type MxlJsonDocument = {
  $schema: string;
  spec_version: "1.0";
  kind: MxlKind;
  model_id: string;
  description?: string;
  model: Record<string, Record<string, MxlEntity>>;
};

/**
 * Shared state and code generation for every model builder.
 *
 * Subclasses differ only in how a variable's right-hand side is formed:
 *  - {@link extraIntermediates} contributes builder-specific named locals
 *    (the kinetic builder exposes its reactions here; the ODE builder none),
 *  - {@link dxdtExpr} returns the lowered dx/dt expression per variable.
 *
 * Everything else — dependency ordering, initial values, and the JS/Python/WAT
 * backends — is computed once from the resulting {@link ModelIR}.
 */
export abstract class ModelBuilderBase {
  /**
   * The `initModel(): X` / `new X()` identifier {@link buildMxlweb} emits.
   * Explicit rather than `this.constructor.name`: consuming sites minify this
   * package's source into their own bundle, and their bundler may rename
   * classes (esbuild does this by default), which would otherwise corrupt the
   * generated code.
   */
  abstract readonly builderType: string;

  parameters: SvelteMap<string, Parameter> = new SvelteMap();
  variables: SvelteMap<string, Variable> = new SvelteMap();
  assignments: SvelteMap<string, Assign> = new SvelteMap();
  nnBlocks: SvelteMap<string, NNBlockConfig> = new SvelteMap();

  /**
   * Builder-specific intermediate computations, beyond assignments, that must
   * be evaluated (and may be exposed as derived quantities). Insertion order is
   * preserved for tie-breaking; topological order is resolved separately.
   */
  protected abstract extraIntermediates(): Map<string, IntermediateDef>;

  /**
   * The *mechanistic* dx/dt expression for a single state variable — never
   * includes any NN block's contribution. `lower()` composes every
   * targeting block on top of this afterward, via {@link composeNNBlocks}
   * — see `NNBlockConfig.mechanism`'s doc comment for why that composition
   * can't happen inside `dxdtExpr` itself (a multiplicative block can't be
   * expressed as one more stoichiometric reaction term the way an additive
   * `KineticModelBuilder` block used to be, so both mechanisms, for both
   * builders, need the same shared post-`dxdtExpr` stage).
   */
  protected abstract dxdtExpr(varName: string): Base;

  /**
   * Builder-specific wiring for a freshly-added NN block's output
   * expressions. Default no-op: neither `KineticModelBuilder` nor
   * `OdeModelBuilder` needs any stored wiring — `composeNNBlocks` handles
   * every block uniformly at `lower()` time instead (this used to have
   * `KineticModelBuilder` add one ordinary reaction per output; retired
   * once a multiplicative block made that impossible to keep doing
   * consistently — see `NNBlockConfig.mechanism`'s doc comment).
   * `SteadyStateModelBuilder` overrides this to throw instead (no dx/dt for
   * a correction term to feed into).
   */
  protected wireNNBlockOutputs(): void {}
  /** Inverse of {@link wireNNBlockOutputs}, called by {@link removeNNBlock}. Default no-op for the same reason. */
  protected unwireNNBlockOutputs(): void {}

  /** Render the model's equations as LaTeX (formulation-specific). */
  abstract buildTex(): string;

  /** A deep copy of the builder, preserving its concrete type. */
  abstract clone(): ModelBuilderBase;

  /** The `.mxl.json` discriminator for this formulation. */
  protected abstract mxlKind(): MxlKind;

  /** Build the formulation-specific `model` section of the `.mxl.json` document. */
  protected abstract mxlModel(): Record<string, Record<string, MxlEntity>>;

  // Variables
  addVariable(key: string, value: Variable) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    this.variables.set(key, value);
    return this;
  }
  updateVariable(key: string, value: Variable) {
    this.variables.set(key, value);
    return this;
  }
  removeVariable(key: string) {
    this.variables.delete(key);
    return this;
  }

  // Parameters
  addParameter(key: string, value: Parameter) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    this.parameters.set(key, value);
    return this;
  }
  updateParameter(key: string, value: Parameter) {
    this.parameters.set(key, value);
    return this;
  }
  removeParameter(key: string) {
    this.parameters.delete(key);
    return this;
  }

  // Assignments
  addAssignment(key: string, assignment: Assign) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    this.assignments.set(key, assignment);
    return this;
  }
  updateAssignment(key: string, assignment: Assign) {
    this.assignments.set(key, assignment);
    return this;
  }
  removeAssignment(key: string) {
    this.assignments.delete(key);
    return this;
  }

  // NN blocks (ADR 0005 §2.1/§2.1.3)
  /**
   * Generates the block via `buildNNBlock` (Glorot-initialized from
   * `config.seed`), adds every resulting weight/bias as an ordinary
   * `Parameter`, records `config` for later re-editing, and wires the
   * outputs in via the builder-specific hook.
   */
  addNNBlock(key: string, config: NNBlockConfig) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    // Only `parameters` is needed here now: `wireNNBlockOutputs` no longer
    // takes the generated output expressions (composeNNBlocks regenerates
    // them fresh at lower() time instead — NNBlockConfig.mechanism's doc
    // comment), so there's nothing left to build for `wireNNBlockOutputs`
    // to consume, only for it to run as a builder-specific validation hook
    // (SteadyStateModelBuilder's throw).
    const { parameters } = buildNNBlock({
      name: key,
      inputs: config.inputs,
      depth: config.depth,
      width: config.width,
      outputs: config.targets.length,
      seed: config.seed,
      scale: config.scale,
    });
    // Wire first, mutate second: SteadyStateModelBuilder's override throws
    // (no dx/dt for a correction term to feed into) — calling it before
    // touching `parameters`/`nnBlocks` means that throw leaves the builder
    // completely untouched instead of half-mutated.
    this.wireNNBlockOutputs();
    for (const [name, p] of parameters) this.addParameter(name, p);
    this.nnBlocks.set(key, config);
    return this;
  }
  /**
   * Re-architects an existing block — equivalent to remove-then-add, so
   * existing weight values are discarded and freshly Glorot-initialized
   * rather than preserved (a changed depth/width/input count generally
   * changes which weight even corresponds to which, so there's nothing
   * meaningful to carry over).
   */
  updateNNBlock(key: string, config: NNBlockConfig) {
    this.removeNNBlock(key);
    return this.addNNBlock(key, config);
  }
  removeNNBlock(key: string) {
    const config = this.nnBlocks.get(key);
    if (!config) return this;
    this.unwireNNBlockOutputs();
    for (const name of this.parameters.keys()) {
      if (isNNBlockOwnedParamName(name, key)) {
        this.removeParameter(name);
      }
    }
    this.nnBlocks.delete(key);
    return this;
  }

  /**
   * Every parameter name owned by some NN block's generated weights/biases
   * (ADR 0005 §2.1.3) — a block is authored/resized as one unit in its own
   * UI, never expanded into individual parameter-table rows, fit checkboxes,
   * scan-target options, or sliders. Every mxl-web surface that lists
   * `parameters` for one of those purposes must exclude this set rather than
   * reimplementing the naming-convention match itself.
   */
  nnBlockOwnedParameterNames(): Set<string> {
    const owned = new Set<string>();
    for (const key of this.nnBlocks.keys()) {
      for (const name of this.parameters.keys()) {
        if (isNNBlockOwnedParamName(name, key)) {
          owned.add(name);
        }
      }
    }
    return owned;
  }

  /**
   * Abbreviated LaTeX for one NN block's contribution to a `buildTex()` row
   * — deliberately not the fully expanded expression tree. A 6×64 block
   * (ADR 0005 §2.1's own cited scale) prints ~20,800 nested `\max`/`\ln`
   * terms, which is unreadable regardless of whether it parses, and isn't
   * how the UDE/Neural-ODE literature notates this term anyway: standard
   * practice (e.g. Rackauckas et al., "Universal Differential Equations for
   * Scientific Machine Learning") writes the mechanistic/learned split as
   * `f(x,p,t) + NN(x,θ)` — one labeled function of the state, not its
   * internals. A block's inputs are always every state variable (no
   * per-block input picker), so `\vec{x}` is exactly accurate, not a
   * simplification. The leading `s_{block} \cdot` mirrors the block's own
   * generated expression (`buildNNBlock` multiplies every output by
   * `${key}_scale`) — showing it here is the whole point of exposing the
   * scale as a trainable, user-facing knob rather than baking it silently
   * into the network.
   */
  protected nnBlockTexTerm(blockKey: string): string {
    const escaped = texEscape(blockKey);
    return `s_{${escaped}} \\cdot NN_{${escaped}}(\\vec{x})`;
  }

  /**
   * Assembles one variable's already-rendered mechanistic tex with every
   * targeting block's abbreviated term (`nnBlockTexTerm`), in the same
   * multiplicative-product-then-additive-sum order as `composeNNBlocks`
   * (`NNBlockConfig.mechanism`'s doc comment) — string-based rather than
   * `Base`-based since `KineticModelBuilder.buildTex`'s mechanistic term is
   * already a rendered (and possibly sign/line-wrapped, via `renderTerms`)
   * string by this point, not a single expression the way `OdeModelBuilder`
   * has one. `mechanisticIsZero` lets a pure-NODE variable (no
   * hand-authored differential/reactions at all) skip a redundant "0 +"
   * prefix — but only when there's no multiplicative factor to apply,
   * since multiplying a genuine zero by anything honestly is zero, and
   * showing that is more informative than hiding a degenerate
   * configuration.
   */
  protected composeNNBlockTex(
    varName: string,
    mechanisticTex: string,
    mechanisticIsZero: boolean,
  ): string {
    const targeting = [...this.nnBlocks.entries()].filter(([, config]) =>
      config.targets.includes(varName),
    );
    if (targeting.length === 0) return mechanisticTex;

    const multiplicativeFactors = targeting
      .filter(([, config]) => config.mechanism === "multiplicative")
      .map(([key]) => `(1 + ${this.nnBlockTexTerm(key)})`);
    const additiveTerms = targeting
      .filter(([, config]) => config.mechanism === "additive")
      .map(([key]) => this.nnBlockTexTerm(key));

    const terms: string[] = [];
    if (!(mechanisticIsZero && multiplicativeFactors.length === 0)) {
      let base = mechanisticTex;
      if (multiplicativeFactors.length > 0) {
        base = `(${base}) \\cdot ${multiplicativeFactors.join(" \\cdot ")}`;
      }
      terms.push(base);
    }
    terms.push(...additiveTerms);

    return terms.length > 0 ? terms.join(" + ") : "0";
  }

  /**
   * Composes every NN block's contribution onto the purely-mechanistic
   * dx/dt `dxdtExpr` computed per variable — shared between both builders
   * (`lower()` calls this once, after building the mechanistic map) since
   * neither has a way to express "multiply this variable's whole dx/dt by
   * a factor" as one more reaction/stoichiometry term (`NNBlockConfig.
   * mechanism`'s doc comment). When a variable has multiple blocks
   * targeting it — the common case, not an edge case, since every block
   * targets every variable and there's no per-block picker — every
   * `"multiplicative"` block combines into a single factor on the
   * mechanistic term first (product across blocks), then every
   * `"additive"` block is summed on top; fixed and independent of
   * insertion order.
   *
   * Recomputes every block's output expressions fresh on every call rather
   * than cached: the expression *shape* is a pure function of each block's
   * config (weight/bias `Name` references, not their current values —
   * those live in `this.parameters` and are what fitting actually
   * mutates), so regenerating is correct, and only runs on structural
   * edits/compiles via `lower()`, not per fit-iteration or per value edit
   * (see ADR 0005 §2.2's note on `buildModelWat`'s structure-only
   * dependency) — fine for the handful of blocks a model realistically
   * has, not optimized further for now.
   */
  protected composeNNBlocks(
    mechanistic: Map<string, Base>,
  ): Map<string, Base> {
    if (this.nnBlocks.size === 0) return mechanistic;

    const outputsByTarget = new Map<
      string,
      { output: Base; mechanism: NNBlockConfig["mechanism"] }[]
    >();
    for (const [key, config] of this.nnBlocks) {
      const { outputs } = buildNNBlock({
        name: key,
        inputs: config.inputs,
        depth: config.depth,
        width: config.width,
        outputs: config.targets.length,
        seed: config.seed,
        scale: config.scale,
      });
      outputs.forEach((output, i) => {
        const target = config.targets[i];
        const entry = { output, mechanism: config.mechanism };
        const existing = outputsByTarget.get(target);
        if (existing) existing.push(entry);
        else outputsByTarget.set(target, [entry]);
      });
    }

    const composed = new Map<string, Base>();
    for (const [name, expr] of mechanistic) {
      const contributions = outputsByTarget.get(name);
      if (!contributions) {
        composed.set(name, expr);
        continue;
      }
      const multiplicativeFactors = contributions
        .filter((c) => c.mechanism === "multiplicative")
        .map((c) => new Add([new Num(1), c.output]));
      const additiveTerms = contributions
        .filter((c) => c.mechanism === "additive")
        .map((c) => c.output);

      let result = expr;
      if (multiplicativeFactors.length > 0) {
        result = new Mul([result, ...multiplicativeFactors]);
      }
      if (additiveTerms.length > 0) {
        result = new Add([result, ...additiveTerms]);
      }
      composed.set(name, result);
    }
    return composed;
  }

  private intermediateDefs(): Map<string, IntermediateDef> {
    return new Map<string, IntermediateDef>([
      ...this.assignments.entries(),
      ...this.extraIntermediates().entries(),
    ]);
  }

  resolveInitialValues(): number[] {
    const paramMap = new Map(
      [...this.parameters.entries()].map(([k, v]) => [k, v.value]),
    );
    return [...this.variables.values()].map((v) => {
      if (v.value instanceof Base) {
        return evalInitialAssignment(v.value, paramMap);
      }
      return v.value;
    });
  }

  // Topologically order the intermediates so each only depends on already
  // available symbols (parameters, variables, earlier intermediates).
  sortDependencies(): string[] {
    const order: string[] = [];
    let available: Set<string> = new Set([
      ...this.parameters.keys(),
      ...this.variables.keys(),
    ]);
    const toSort: Array<{ k: string; args: Set<string> }> = [
      ...this.intermediateDefs()
        .entries()
        .map(([key, val]) => {
          return { k: key, args: val.fn.getSymbols(new Set()) };
        }),
    ];

    const maxIters = toSort.length * toSort.length;

    let lastName = "";
    for (let i = 0; i < maxIters; i++) {
      const el = toSort.shift();

      if (el === undefined) {
        break;
      }
      const { k, args } = el;
      if (args.isSubsetOf(available)) {
        available = available.add(k);
        order.push(k);
      } else {
        if (lastName === k) {
          order.push(lastName);
          break;
        }
        toSort.push(el);
        lastName = k;
      }
    }
    return order;
  }

  getNames(): Array<string> {
    return [...this.variables.keys()];
  }

  getDisplayNames(): Map<string, string> {
    const names: Map<string, string> = new Map();
    for (const [id, variable] of this.variables) {
      names.set(id, variable.displayName || id);
    }
    for (const [id, parameter] of this.parameters) {
      names.set(id, parameter.displayName || id);
    }
    for (const [id, def] of this.intermediateDefs()) {
      names.set(id, def.displayName || id);
    }
    return names;
  }

  getParameterNames(): string[] {
    return [...this.parameters.keys()];
  }

  resolveParameters(): number[] {
    return [...this.parameters.values()].map((p) => p.value);
  }

  /** Lower the builder to the shared IR consumed by all numeric backends. */
  lower(): ModelIR {
    const order = this.sortDependencies();
    const defs = this.intermediateDefs();
    const intermediates = order.map((name) => ({
      name,
      expr: defs.get(name)!.fn,
    }));
    const mechanistic = new Map(
      [...this.variables.keys()].map((name) => [name, this.dxdtExpr(name)]),
    );
    const dxdt = this.composeNNBlocks(mechanistic);
    return {
      varNames: [...this.variables.keys()],
      parNames: [...this.parameters.keys()],
      paramValues: new Map(
        [...this.parameters.entries()].map(([k, v]) => [k, v.value]),
      ),
      initialValues: new Map(
        [...this.variables.entries()].map(([k, v]) => [k, v.value]),
      ),
      intermediates,
      dxdt,
      displayNames: this.getDisplayNames(),
    };
  }

  buildJs(): string {
    return irToJs(this.lower());
  }

  buildJsDerived(selectedDerived?: string[]): {
    allDerived: string;
    selectDerived: string;
  } {
    return irToJsDerived(this.lower(), selectedDerived);
  }

  buildPython(userParameters: string[], selectedDerived?: string[]): string {
    return irToPython(this.lower(), userParameters, selectedDerived);
  }

  buildWat(): string {
    return irToWat(this.lower());
  }

  /**
   * The adjoint RHS WAT module for the given fitted parameter names (ADR
   * 0005 §2.3.4) — call only when actually starting an `"adjoint"` fit
   * session; `wasmWorker.ts` and an `"lm"` fit never call this at all.
   */
  buildAdjointWat(thetaNames: string[]): string {
    return irToAdjointWat(this.lower(), thetaNames);
  }

  /** WAT module computing `selectedDerived` (see ADR 0004 in the mxlweb repo). */
  buildWatDerived(selectedDerived: string[]): string {
    return irToWatDerived(this.lower(), selectedDerived);
  }

  /**
   * Serialise the builder to a `model.ts` source file: an `initModel()` factory
   * that reconstructs this model with the same fluent `addParameter` /
   * `addVariable` / `addAssignment` (and subclass-specific) calls. Mathml
   * expressions are emitted as their constructor source via {@link Base.toTs};
   * imports are derived from the constructors each expression uses.
   */
  buildMxlweb(): string {
    const ctors = new Set<string>();
    const collect = (expr: Base) => {
      expr.getCtors(ctors);
    };

    const chains: string[] = [];
    // NN blocks first, deliberately: addNNBlock always Glorot-reinitializes
    // its weights fresh from `seed`, so it would clobber any fitting-updated
    // values if it ran after the parameter loop below. Emitting it first and
    // letting the parameter loop's .addParameter() calls run second means
    // every parameter — including a block's weights/biases — ends up with
    // whatever value is *actually* in `this.parameters` right now, fitted or
    // not, rather than a freshly-regenerated one.
    for (const [id, b] of this.nnBlocks) {
      chains.push(
        `    .addNNBlock(${JSON.stringify(id)}, ${this.tsNNBlock(b)})`,
      );
    }
    for (const [id, p] of this.parameters) {
      chains.push(
        `    .addParameter(${JSON.stringify(id)}, ${this.tsParameter(p)})`,
      );
    }
    for (const [id, v] of this.variables) {
      if (v.value instanceof Base) collect(v.value);
      chains.push(
        `    .addVariable(${JSON.stringify(id)}, ${this.tsVariable(v)})`,
      );
    }
    for (const [id, a] of this.assignments) {
      collect(a.fn);
      chains.push(
        `    .addAssignment(${JSON.stringify(id)}, ${this.tsAssign(a)})`,
      );
    }
    chains.push(...this.extraMxlwebChains(collect));

    const className = this.builderType;
    const mathmlNames = [...ctors].sort();
    const mathmlImport =
      mathmlNames.length > 0
        ? `import {\n${mathmlNames
            .map((n) => `  ${n},`)
            .join(
              "\n",
            )}\n} from "@computational-biology-aachen/mxlweb-core/mathml";\n`
        : "";

    return `import { ${className} } from "@computational-biology-aachen/mxlweb-core";
${mathmlImport}
export function initModel(): ${className} {
  return new ${className}()
${chains.join("\n")};
}
`;
  }

  /**
   * Subclass-specific fluent calls appended after parameters/variables/
   * assignments (the ODE builder's `setDifferential`, the kinetic builder's
   * `addReaction`). `collect` must be called on every emitted expression so its
   * constructors are imported. Default: none.
   */
  protected extraMxlwebChains(_collect: (expr: Base) => void): string[] {
    return [];
  }

  /**
   * Serialise the builder to the shared mxl-schemas `.mxl.json` format: a
   * version-controllable, schema-validated data file describing the model as
   * trees of math nodes (see {@link MxlJsonDocument}). The `kind` discriminator
   * and `model` section are formulation-specific ({@link mxlKind} /
   * {@link mxlModel}); everything else is the common envelope. `modelId` is
   * required (the schema mandates it); `description` is omitted when absent.
   */
  buildMxlJson(modelId: string, description?: string): string {
    const kind = this.mxlKind();
    const doc: MxlJsonDocument = {
      $schema: `https://raw.githubusercontent.com/Computational-Biology-Aachen/mxl-schemas/main/v1/${kind}-model.schema.json`,
      spec_version: "1.0",
      kind,
      model_id: modelId,
      ...(description !== undefined ? { description } : {}),
      model: this.mxlModel(),
    };
    return JSON.stringify(doc, null, 2);
  }

  /** Serialise an initial/parameter value to a node: a bare number becomes a `Num` node. */
  protected mxlValueNode(value: number | Base): JsonNode {
    return value instanceof Base ? value.toJson() : { type: "Num", value };
  }

  /** Attach the optional presentation fields (display/LaTeX names, slider) to an entity. */
  protected mxlApplyMeta(
    entry: MxlEntity,
    displayName: string | undefined,
    texName: string | undefined,
    slider?: SliderArgs,
  ): void {
    if (displayName !== undefined) entry.displayName = displayName;
    if (texName !== undefined) entry.texName = texName;
    if (slider !== undefined) {
      entry.slider = { min: slider.min, max: slider.max, step: slider.step };
      if (slider.desc !== undefined) entry.slider.desc = slider.desc;
    }
  }

  /**
   * Serialise the state variables. `extra` contributes formulation-specific
   * fields per variable (the ODE builder adds its `fn` derivative); it is
   * applied after `value` and before the presentation metadata.
   */
  protected mxlVariables(
    extra?: (id: string, v: Variable) => Partial<MxlEntity>,
  ): Record<string, MxlEntity> {
    const out: Record<string, MxlEntity> = {};
    for (const [id, v] of this.variables) {
      const entry: MxlEntity = { value: this.mxlValueNode(v.value) };
      if (extra !== undefined) Object.assign(entry, extra(id, v));
      this.mxlApplyMeta(entry, v.displayName, v.texName, v.slider);
      out[id] = entry;
    }
    return out;
  }

  /** Serialise the constant parameters. */
  protected mxlParameters(): Record<string, MxlEntity> {
    const out: Record<string, MxlEntity> = {};
    for (const [id, p] of this.parameters) {
      const entry: MxlEntity = { value: { type: "Num", value: p.value } };
      this.mxlApplyMeta(entry, p.displayName, p.texName, p.slider);
      out[id] = entry;
    }
    return out;
  }

  /** Serialise the assignments as the `derived` section. */
  protected mxlDerived(): Record<string, MxlEntity> {
    const out: Record<string, MxlEntity> = {};
    for (const [id, a] of this.assignments) {
      const entry: MxlEntity = { fn: a.fn.toJson() };
      this.mxlApplyMeta(entry, a.displayName, a.texName);
      out[id] = entry;
    }
    return out;
  }

  /**
   * Serialise `nnBlocks` as the `nn_blocks` section (architecture only — the
   * weight/bias values round-trip as ordinary entries in `parameters`,
   * already covered by {@link mxlParameters}). Not called by
   * `SteadyStateModelBuilder`, whose schema has no `nn_blocks` section.
   *
   * Deliberately additive, not a replacement: `KineticModelBuilder.
   * mxlReactions` still serialises a block's wired reaction(s) in full,
   * literal expression tree and all — unlike `buildMxlweb`'s TS source
   * (only ever consumed by this package, where re-deriving the reaction via
   * `addNNBlock` makes the literal tree pure waste), `.mxl.json` is a
   * cross-tool-family interchange format. A consumer that doesn't
   * understand `nn_blocks` at all (e.g. a version of MxlPy predating this
   * section) must still be able to simulate the model faithfully from the
   * ordinary `reactions`/`parameters` sections alone.
   */
  protected mxlNNBlocks(): Record<string, MxlEntity> {
    const out: Record<string, MxlEntity> = {};
    for (const [id, b] of this.nnBlocks) {
      out[id] = {
        inputs: b.inputs,
        depth: b.depth,
        width: b.width,
        seed: b.seed,
        targets: b.targets,
        trained: b.trained,
        scale: b.scale,
        mechanism: b.mechanism,
      };
    }
    return out;
  }

  protected tsSlider(s: SliderArgs): string {
    const parts = [
      `min: ${JSON.stringify(s.min)}`,
      `max: ${JSON.stringify(s.max)}`,
      `step: ${JSON.stringify(s.step)}`,
    ];
    if (s.desc !== undefined) parts.push(`desc: ${JSON.stringify(s.desc)}`);
    return `{ ${parts.join(", ")} }`;
  }

  protected tsFields(entries: Array<[string, string | undefined]>): string {
    const parts = entries
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${v}`);
    return `{ ${parts.join(", ")} }`;
  }

  private tsParameter(p: Parameter): string {
    return this.tsFields([
      ["value", `${p.value}`],
      ["displayName", this.tsString(p.displayName)],
      ["texName", this.tsString(p.texName)],
      ["slider", p.slider !== undefined ? this.tsSlider(p.slider) : undefined],
    ]);
  }

  private tsVariable(v: Variable): string {
    return this.tsFields([
      ["value", v.value instanceof Base ? v.value.toTs() : `${v.value}`],
      ["displayName", this.tsString(v.displayName)],
      ["texName", this.tsString(v.texName)],
      ["slider", v.slider !== undefined ? this.tsSlider(v.slider) : undefined],
    ]);
  }

  protected tsAssign(a: Assign): string {
    return this.tsFields([
      ["fn", a.fn.toTs()],
      ["displayName", this.tsString(a.displayName)],
      ["texName", this.tsString(a.texName)],
    ]);
  }

  protected tsString(value: string | undefined): string | undefined {
    return value !== undefined ? JSON.stringify(value) : undefined;
  }

  private tsNNBlock(b: NNBlockConfig): string {
    return this.tsFields([
      ["inputs", JSON.stringify(b.inputs)],
      ["depth", `${b.depth}`],
      ["width", `${b.width}`],
      ["seed", `${b.seed}`],
      ["targets", JSON.stringify(b.targets)],
      ["trained", `${b.trained}`],
      ["scale", `${b.scale}`],
      ["mechanism", JSON.stringify(b.mechanism)],
    ]);
  }
}
