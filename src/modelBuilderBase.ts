import { SvelteMap } from "svelte/reactivity";
import { Base, type JsonNode } from "./mathml/index.js";
import {
  evalInitialAssignment,
  irToJs,
  irToJsDerived,
  irToPython,
  irToWat,
  type ModelIR,
} from "./modelIr.js";

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

export function defaultValue(a: string | undefined, b: string): string {
  if (a === undefined) return b;
  return a;
}

export function defaultTexName(name: string): string {
  return `\\text{${name}}`;
}

/** A derived computation that becomes a named local during code generation. */
export type IntermediateDef = {
  fn: Base;
  displayName?: string;
  texName?: string;
};

/** The model-formulation discriminator written to (and selecting) an `.mxl.json` schema. */
export type MxlKind = "kinetic" | "ode" | "steady-state";

/** One entity (variable/parameter/derived/reaction) in the `.mxl.json` model section. */
export type MxlEntity = {
  value?: JsonNode;
  fn?: JsonNode;
  stoichiometry?: Record<string, JsonNode>;
  displayName?: string;
  texName?: string;
  slider?: { min: string; max: string; step: string; desc?: string };
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

  /**
   * Builder-specific intermediate computations, beyond assignments, that must
   * be evaluated (and may be exposed as derived quantities). Insertion order is
   * preserved for tie-breaking; topological order is resolved separately.
   */
  protected abstract extraIntermediates(): Map<string, IntermediateDef>;

  /** The fully lowered dx/dt expression for a single state variable. */
  protected abstract dxdtExpr(varName: string): Base;

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
    const dxdt = new Map(
      [...this.variables.keys()].map((name) => [name, this.dxdtExpr(name)]),
    );
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
}
