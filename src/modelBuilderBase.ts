import { SvelteMap } from "svelte/reactivity";
import { Base, substituteName, type JsonNode } from "./mathml/index.js";
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
import {
  buildNNBlock,
  type NNBlockActivation,
  type NNBlockLayer,
} from "./nnBlock.js";

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
 * A UDE/NODE correction term (ADR 0005 in the mxlweb repo, §2.1/§2.1.3;
 * mxl-schemas nn_blocks v2 redesign). Architecture and identity only — the
 * generated weight/bias values live in {@link ModelBuilderBase.nnWeights},
 * structurally separate from {@link ModelBuilderBase.parameters} (they carry
 * no biological/kinetic meaning the way a real parameter does); only the
 * block's own `scale` remains an ordinary `Parameter`. The generated
 * expression is recomputed fresh from this config wherever it's needed
 * rather than stored, since it's a pure function of the architecture (see
 * {@link ModelBuilderBase.composeNNBlocks}).
 */
export type NNBlockConfig = {
  /** Names of existing variables/parameters/derived quantities the block reads. */
  inputs: string[];
  /** Layer stack, input-to-output order — see `nnBlock.ts`'s {@link NNBlockSpec.layers}. */
  layers: NNBlockLayer[];
  /** Seed for reproducible Glorot initialization (used once, at `addNNBlock` time, and whenever the block has no trained weights to load instead). */
  seed: number;
  /** Which existing variable(s) this block corrects — one per output, so its length *is* the block's output count. */
  targets: string[];
  /** Whether this block's weights (and its `scale`) are included when fitting (ADR 0005 §2.1.3's per-block toggle) — a UI/fit-config concern downstream (`mxl-web`), not interpreted here. */
  trained: boolean;
  /**
   * Initial value for the block's single trainable output-scaling factor —
   * referenced as `nde` inside `mechanism` after being applied: `dx/dt =
   * mechanism(f(x,p,t), scale · NN(x,θ))` — shared across all of the
   * block's outputs. Needed in practice, not just cosmetically: a freshly
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
   * How this block's (scaled) output composes onto its target(s)'
   * mechanistic dx/dt (grill-me follow-up to ADR 0005 §2.1, generalized
   * from a closed enum to an arbitrary expression in the nn_blocks v2
   * redesign): an expression over exactly two placeholders, `ode` (the
   * pre-existing dx/dt term) and `nde` (this block's scaled network
   * output). E.g. additive is `Add(ode, nde)`; relative_multiply is
   * `Mul(ode, Add(1, nde))` — a near-zero/untrained network leaves `ode`
   * unchanged; multiply is `Mul(ode, nde)` — a bare product with no such
   * safeguard, offered anyway for cases where that's the intended model,
   * not an initialization hazard. These three are common presets, not the
   * only legal values — see `nnBlock.ts`'s preset factories.
   *
   * Composed in `ModelBuilderBase.composeNNBlocks`, not by either builder's
   * own `dxdtExpr` — an arbitrary `mechanism` can't be expressed as one
   * more stoichiometric reaction term, so this can't be "just another
   * reaction" the way an additive `KineticModelBuilder` block used to be;
   * every mechanism, for both builders, composes at the same shared
   * `lower()` stage instead. When a variable has multiple blocks, they
   * compose sequentially in insertion order — the first block's mechanism
   * takes the purely mechanistic term as `ode`, each subsequent block's
   * mechanism takes the *previous* block's already-composed result as its
   * `ode` (see `composeNNBlocks`'s doc comment for why this, not the old
   * enum's type-grouped ordering, is the only well-defined generalization).
   */
  mechanism: Base;
  /** Elementwise activation applied after every layer except the last — see `nnBlock.ts`'s {@link NNBlockSpec.activation}. */
  activation: NNBlockActivation;
};

/**
 * Whether `name` is a weight or bias generated for NN block `blockKey` —
 * the generator's naming convention is `${blockKey}_w${layerIdx}_${i}_${j}`,
 * `${blockKey}_b${layerIdx}_${i}` (`nnBlock.ts`), so a bare `startsWith`
 * prefix check is unsafe: a hand-authored name like `corr_water_temp`
 * would false-positive match block `"corr"`'s `_w` prefix. Requiring a
 * digit (the layer index) immediately after the weight/bias prefix rules
 * that out, since every real generated name has one there and essentially
 * no hand-typed name does. Checked against `ModelBuilderBase.nnWeights`
 * only — unlike the pre-v2 version of this function, `scale` is never
 * ambiguous (it is the *only* nn_block-generated entry left in
 * `parameters`, under its own exact `${blockKey}_scale` name) so it needs
 * no pattern match. Exported so a caller that already has a specific block
 * key in hand (e.g. `Fit.svelte` collecting one *trained* block's fittable
 * weights) doesn't need its own copy of this check.
 */
export function isNNBlockOwnedWeightName(
  name: string,
  blockKey: string,
): boolean {
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
  layers?: NNBlockLayer[];
  seed?: number;
  targets?: string[];
  trained?: boolean;
  weights_ref?: string;
  scale?: number;
  mechanism?: JsonNode;
  activation?: { name: string; expression: JsonNode };
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
   * Every NN block's generated weight/bias values, keyed by the generator's
   * naming convention (`nnBlock.ts`). Deliberately not `parameters`: a
   * weight carries no biological/kinetic meaning the way a real parameter
   * does (mxl-schemas nn_blocks v2), so it must never appear in the
   * parameter table, the ordinary fit picker, or `mxlParameters()`'s
   * `.mxl.json` output. Still `Name`-addressable for codegen exactly like a
   * parameter — {@link lower} merges this into `ModelIR.parNames`/
   * `paramValues` alongside `parameters`, which is what makes a weight
   * differentiable/fittable at all (`modelIr.ts`'s WAT/adjoint backends
   * resolve every `Name` against that merged, flat array).
   */
  nnWeights: SvelteMap<string, number> = new SvelteMap();

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

  // NN blocks (ADR 0005 §2.1/§2.1.3; mxl-schemas nn_blocks v2)
  /**
   * Generates the block's architecture via `buildNNBlock` (Glorot-
   * initialized from `config.seed`), stores every resulting weight/bias in
   * {@link nnWeights} (never `parameters`), adds the block's own `scale` as
   * an ordinary `Parameter`, records `config` for later re-editing, and
   * wires the outputs in via the builder-specific hook.
   *
   * `trainedWeights`, when given, overrides the freshly Glorot-initialized
   * values with already-trained ones (e.g. loaded from a `.mxl.json`'s
   * `weights_ref` sidecar) — its key set must exactly match the
   * architecture's generated weight names, since `buildNNBlock` is still
   * run first (unconditionally) to determine that expected shape and to
   * build the block's output expressions either way.
   */
  addNNBlock(
    key: string,
    config: NNBlockConfig,
    trainedWeights?: Map<string, number>,
  ) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    // Only the generated shape is needed here now: `wireNNBlockOutputs` no
    // longer takes the generated output expressions (composeNNBlocks
    // regenerates them fresh at lower() time instead — NNBlockConfig.
    // mechanism's doc comment), so there's nothing left to build for
    // `wireNNBlockOutputs` to consume, only for it to run as a
    // builder-specific validation hook (SteadyStateModelBuilder's throw).
    const { weights, scale } = buildNNBlock({
      name: key,
      inputs: config.inputs,
      layers: config.layers,
      seed: config.seed,
      scale: config.scale,
      activation: config.activation,
    });
    if (trainedWeights !== undefined) {
      const expected = new Set(weights.keys());
      const provided = new Set(trainedWeights.keys());
      const mismatched =
        expected.size !== provided.size ||
        ![...expected].every((name) => provided.has(name));
      if (mismatched) {
        throw new Error(
          `addNNBlock: trained weights for "${key}" don't match its architecture`,
        );
      }
    }
    // Wire first, mutate second: SteadyStateModelBuilder's override throws
    // (no dx/dt for a correction term to feed into) — calling it before
    // touching `nnWeights`/`parameters`/`nnBlocks` means that throw leaves
    // the builder completely untouched instead of half-mutated.
    this.wireNNBlockOutputs();
    for (const [name, value] of trainedWeights ?? weights) {
      this.nnWeights.set(name, value);
    }
    this.addParameter(`${key}_scale`, scale);
    this.nnBlocks.set(key, config);
    return this;
  }
  /**
   * Re-architects an existing block — equivalent to remove-then-add, so
   * existing weight values are discarded and freshly Glorot-initialized
   * rather than preserved (a changed layer stack/input count generally
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
    for (const name of this.nnWeights.keys()) {
      if (isNNBlockOwnedWeightName(name, key)) {
        this.nnWeights.delete(name);
      }
    }
    this.removeParameter(`${key}_scale`);
    this.nnBlocks.delete(key);
    return this;
  }

  /**
   * Every NN block's own `scale` parameter name (ADR 0005 §2.1.3) — a block
   * is authored/resized as one unit in its own UI, never expanded into
   * individual parameter-table rows, fit checkboxes, scan-target options, or
   * sliders, and `scale` is no exception even though (unlike weights/biases)
   * it does remain an ordinary `Parameter`. Every mxl-web surface that lists
   * `parameters` for one of those purposes must exclude this set rather than
   * reimplementing the naming-convention match itself.
   */
  nnBlockScaleParameterNames(): Set<string> {
    return new Set([...this.nnBlocks.keys()].map((key) => `${key}_scale`));
  }

  /** Every current {@link nnWeights} name generated by NN block `key` — a thin, memoized-nothing convenience over {@link isNNBlockOwnedWeightName} for callers (e.g. `Fit.svelte`) that need a trained block's full fittable weight set. */
  nnBlockWeightNames(key: string): Set<string> {
    const owned = new Set<string>();
    for (const name of this.nnWeights.keys()) {
      if (isNNBlockOwnedWeightName(name, key)) owned.add(name);
    }
    return owned;
  }

  /**
   * Every `Name`-addressable numeric symbol, in the exact order `lower()`
   * uses for `ModelIR.parNames` — `parameters` first, then `nnWeights`.
   * Unlike {@link getParameterNames} (kinetic parameters + every block's
   * `scale`, the UI-facing set), this is the full flat array layout the
   * WAT/adjoint backends compile against (`modelIr.ts`), so a caller
   * building a fit session's `pars`/`fitIdx` (e.g. `Fit.svelte`) must index
   * against *this*, not `getParameterNames()`, once any block has weights.
   */
  getAllAddressableNames(): string[] {
    return [...this.parameters.keys(), ...this.nnWeights.keys()];
  }
  /** Values matching {@link getAllAddressableNames}, same order. */
  resolveAllAddressableValues(): number[] {
    return [
      ...[...this.parameters.values()].map((p) => p.value),
      ...this.nnWeights.values(),
    ];
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
   * targeting block's contribution, folded sequentially in the same
   * insertion order as `composeNNBlocks` (`NNBlockConfig.mechanism`'s doc
   * comment on why sequential threading, not the old enum's type-grouped
   * ordering, is what generalizes to an arbitrary mechanism). Each step
   * renders `config.mechanism.toTex` with `ode` bound to the running tex so
   * far and `nde` bound to that block's abbreviated term
   * (`nnBlockTexTerm`) — reusing `Base.toTex`'s existing symbol-substitution
   * contract rather than hand-formatting per mechanism shape, so this
   * renders any legal `mechanism`, not just the three presets.
   *
   * Both substitutions are unconditionally parenthesized. `Base.toTex`
   * decides per-child parenthesization (e.g. `Mul`'s "wrap this child if
   * it's an `Add`") by inspecting the *AST* before substitution — but `ode`
   * and `nde` are plain `Name` leaves there, never `instanceof Add`, no
   * matter how compound the string substituted in for them turns out to
   * be. Skipping the parens would render `k \cdot x` embedded under a
   * `Mul` mechanism correctly only by coincidence (multiplication is
   * associative); for a mechanism mixing precedences — a future
   * subtraction-shaped one, say — it would be silently wrong. This drops
   * the old enum-based version's "omit a redundant `0 +` prefix for a
   * pure-NODE variable" cosmetic, which relied on structurally recognizing
   * "no mechanistic term, no product factor" — not something an arbitrary
   * `mechanism` can be classified into any more (same reasoning as
   * `composeNNBlocks`'s move to sequential threading).
   */
  protected composeNNBlockTex(varName: string, mechanisticTex: string): string {
    const targeting = [...this.nnBlocks.entries()].filter(([, config]) =>
      config.targets.includes(varName),
    );
    if (targeting.length === 0) return mechanisticTex;

    let running = mechanisticTex;
    for (const [key, config] of targeting) {
      running = config.mechanism.toTex(
        new Map([
          ["ode", `(${running})`],
          ["nde", `(${this.nnBlockTexTerm(key)})`],
        ]),
      );
    }
    return running;
  }

  /**
   * Composes every NN block's contribution onto the purely-mechanistic
   * dx/dt `dxdtExpr` computed per variable — shared between both builders
   * (`lower()` calls this once, after building the mechanistic map) since
   * neither has a way to express an arbitrary `mechanism` as one more
   * reaction/stoichiometry term (`NNBlockConfig.mechanism`'s doc comment).
   *
   * When a variable has multiple blocks targeting it — the common case, not
   * an edge case, since every block targets every variable and there's no
   * per-block picker — they compose *sequentially in insertion order*: the
   * first block's `mechanism` takes the purely mechanistic `dxdtExpr` as
   * `ode`; each later block's `mechanism` takes the *previous* block's
   * already-composed result as its `ode`. This is a deliberate departure
   * from the pre-v2 enum's order-independent "all multiplicative first,
   * then additive" grouping: that grouping only worked because the enum had
   * exactly three known algebraic categories to sort blocks into, and
   * there's no way to classify an arbitrary `mechanism` expression that
   * way. Sequential threading is the simplest generalization that's
   * well-defined for *any* mechanism, and is provably equivalent to the old
   * grouping for a same-typed sequence of blocks — but for a mix of
   * multiplicative- and additive-shaped mechanisms, block order is now
   * numerically significant in a way it wasn't before.
   *
   * `Name` substitution (`substituteName`) instantiates each `mechanism`'s
   * `ode`/`nde` placeholders — see mxl-schemas' `nnBlock.mechanism` for the
   * schema-level contract this implements.
   *
   * Recomputes every block's output expressions fresh on every call rather
   * than cached: the expression *shape* is a pure function of each block's
   * config (weight/bias `Name` references, not their current values —
   * those live in `this.nnWeights` and are what fitting actually mutates),
   * so regenerating is correct, and only runs on structural edits/compiles
   * via `lower()`, not per fit-iteration or per value edit (see ADR 0005
   * §2.2's note on `buildModelWat`'s structure-only dependency) — fine for
   * the handful of blocks a model realistically has, not optimized further
   * for now.
   */
  protected composeNNBlocks(mechanistic: Map<string, Base>): Map<string, Base> {
    if (this.nnBlocks.size === 0) return mechanistic;

    const outputsByTarget = new Map<
      string,
      { output: Base; mechanism: Base }[]
    >();
    for (const [key, config] of this.nnBlocks) {
      const { outputs } = buildNNBlock({
        name: key,
        inputs: config.inputs,
        layers: config.layers,
        seed: config.seed,
        scale: config.scale,
        activation: config.activation,
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
      let result = expr;
      for (const { output, mechanism } of contributions) {
        result = substituteName(
          substituteName(mechanism, "ode", result),
          "nde",
          output,
        );
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
      // `parameters` first, then `nnWeights` — every WAT/adjoint `Name`
      // resolution (`modelIr.ts`) is positional against this array, and
      // `getAllAddressableNames()`/`resolveAllAddressableValues()` must
      // stay in exact lockstep with it for a caller (e.g. `Fit.svelte`)
      // building a fit session against the compiled WAT module.
      parNames: this.getAllAddressableNames(),
      paramValues: new Map<string, number>([
        ...[...this.parameters.entries()].map(
          ([k, v]) => [k, v.value] as const,
        ),
        ...this.nnWeights.entries(),
      ]),
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
    // its weights fresh from `seed` unless given an explicit trained-weights
    // map — passed here from `this.nnWeights`' *current* live values, so a
    // block's weights come out correct immediately rather than depending on
    // a later overwrite. `scale` still relies on the parameter loop below
    // running second: it's emitted here as only `config.scale`'s *initial*
    // value (like `seed`, not necessarily its current, possibly
    // fitting-updated one — NNBlockConfig.scale's doc comment), and
    // `addNNBlock` always adds it as an ordinary `${id}_scale` `Parameter`,
    // so the parameter loop's `.addParameter()` call for that same key
    // overwrites it back to the live value afterward.
    for (const [id, b] of this.nnBlocks) {
      chains.push(
        `    .addNNBlock(${JSON.stringify(id)}, ${this.tsNNBlock(b, collect)}, ${this.tsNNBlockWeights(id)})`,
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
   * Serialise `nnBlocks` as the `nn_blocks` section — architecture and
   * composition only. Weight/bias *values* never round-trip here or in
   * `parameters` (mxl-schemas nn_blocks v2): a trained block's `weights_ref`
   * names an external sidecar file (`${id}.weights.json`), whose content
   * {@link buildNNWeightsFile} produces — the caller (e.g. a "download"
   * button) is responsible for writing it out alongside the `.mxl.json`
   * this method contributes to; an untrained block has no `weights_ref` at
   * all (mxl-schemas' `trained`/`weights_ref` invariant), and a consumer
   * initializes it from `seed` instead. Not called by
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
      const entry: MxlEntity = {
        inputs: b.inputs,
        layers: b.layers,
        seed: b.seed,
        targets: b.targets,
        trained: b.trained,
        scale: b.scale,
        mechanism: b.mechanism.toJson(),
        activation: {
          name: b.activation.name,
          expression: b.activation.expression.toJson(),
        },
      };
      if (b.trained) entry.weights_ref = `${id}.weights.json`;
      out[id] = entry;
    }
    return out;
  }

  /**
   * The content of `key`'s external weights sidecar file (mxl-schemas
   * nn-weights.schema.json): `${key}`'s current live weight/bias values
   * (fitted or not), reshaped from `nnWeights`' flat `Name`-addressable
   * naming into the schema's nested per-layer matrices — `w{n}`/`b{n}`,
   * 1-indexed, matrix shape `[out_features, in_features]`
   * (PyTorch/equinox-native). Call only for a block whose `.mxl.json`
   * `weights_ref` was actually written (`mxlNNBlocks` only sets it when
   * `trained` is true) — the caller pairs this with `buildMxlJson()`'s
   * output to produce the full multi-file export.
   */
  buildNNWeightsFile(key: string): string {
    const config = this.nnBlocks.get(key);
    if (!config) {
      throw new Error(`buildNNWeightsFile: no such NN block "${key}"`);
    }
    const out: Record<string, number[][] | number[]> = {};
    let fanIn = config.inputs.length;
    config.layers.forEach((layer, layerIdx) => {
      const fanOut = layer.width;
      const w: number[][] = [];
      const b: number[] = [];
      for (let i = 0; i < fanOut; i++) {
        b.push(this.nnWeights.get(`${key}_b${layerIdx}_${i}`) ?? 0);
        const row: number[] = [];
        for (let j = 0; j < fanIn; j++) {
          row.push(this.nnWeights.get(`${key}_w${layerIdx}_${i}_${j}`) ?? 0);
        }
        w.push(row);
      }
      out[`w${layerIdx + 1}`] = w;
      out[`b${layerIdx + 1}`] = b;
      fanIn = fanOut;
    });
    return JSON.stringify(out, null, 2);
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

  /** `collect` must see `mechanism`/`activation.expression` so their constructors are imported — same contract as every other `Base`-emitting `ts*` helper. */
  private tsNNBlock(b: NNBlockConfig, collect: (expr: Base) => void): string {
    collect(b.mechanism);
    collect(b.activation.expression);
    return this.tsFields([
      ["inputs", JSON.stringify(b.inputs)],
      ["layers", JSON.stringify(b.layers)],
      ["seed", `${b.seed}`],
      ["targets", JSON.stringify(b.targets)],
      ["trained", `${b.trained}`],
      ["scale", `${b.scale}`],
      ["mechanism", b.mechanism.toTs()],
      [
        "activation",
        `{ name: ${JSON.stringify(b.activation.name)}, expression: ${b.activation.expression.toTs()} }`,
      ],
    ]);
  }

  /** `key`'s current live weight/bias values as a TS `Map` literal — the third `addNNBlock` argument `buildMxlweb` emits, so the regenerated source reconstructs the block with its actual (possibly fitting-updated) weights rather than a fresh Glorot reinitialization. */
  private tsNNBlockWeights(key: string): string {
    const entries = [...this.nnBlockWeightNames(key)]
      .map((name) => `[${JSON.stringify(name)}, ${this.nnWeights.get(name)}]`)
      .join(", ");
    return `new Map([${entries}])`;
  }
}
