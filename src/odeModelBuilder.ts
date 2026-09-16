import { SvelteMap } from "svelte/reactivity";
import { Base, Num } from "./mathml/index.js";
import {
  type Assign,
  defaultTexName,
  type IntermediateDef,
  ModelBuilderBase,
  type MxlEntity,
  type MxlKind,
  type NNBlockConfig,
  nnBlockWeightMatrices,
} from "./modelBuilderBase.js";
import {
  buildNNBlockMxlpySource,
  nnBlockMxlpyImportNames,
  planNNBlockMxlpy,
} from "./nnBlockMxlpy.js";

/**
 * Direct ODE model builder: dx/dt is written explicitly per variable.
 *
 * Unlike the {@link KineticModelBuilder}, there are no reactions or
 * stoichiometries — each state variable's derivative is set directly via
 * {@link setDifferential}. A variable with no differential defaults to
 * dx/dt = 0. The downstream code generation is identical to the kinetic
 * builder's, since both lower into the same shared IR.
 */
export class OdeModelBuilder extends ModelBuilderBase {
  readonly builderType = "OdeModelBuilder";
  differentials: SvelteMap<string, Base> = new SvelteMap();
  /** Report-only quantities computed after simulation finishes — see `ModelBuilderBase.extraReadouts`'s doc comment (mxlweb-core issue #6). */
  readouts: SvelteMap<string, Assign> = new SvelteMap();

  constructor() {
    super();
  }

  clone(): OdeModelBuilder {
    const cl = new OdeModelBuilder();
    cl.parameters = new SvelteMap(this.parameters);
    cl.variables = new SvelteMap(this.variables);
    cl.assignments = new SvelteMap(this.assignments);
    cl.differentials = new SvelteMap(this.differentials);
    cl.readouts = new SvelteMap(this.readouts);
    cl.nnBlocks = new SvelteMap(this.nnBlocks);
    cl.nnWeights = new SvelteMap(this.nnWeights);
    return cl;
  }

  // Readouts
  addReadout(key: string, readout: Assign) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    this.readouts.set(key, readout);
    return this;
  }
  updateReadout(key: string, readout: Assign) {
    this.readouts.set(key, readout);
    return this;
  }
  removeReadout(key: string) {
    this.readouts.delete(key);
    return this;
  }

  protected extraReadouts(): Map<string, IntermediateDef> {
    return new Map(
      [...this.readouts.entries()].map(([key, ro]) => [
        key,
        { fn: ro.fn, displayName: ro.displayName, texName: ro.texName },
      ]),
    );
  }

  // dxdtExpr below is purely mechanistic; ModelBuilderBase.composeNNBlocks
  // handles every variable-mode block, for every builder, at the shared
  // lower() stage instead (see NNBlockConfig.mechanism's doc comment).

  /**
   * A `"reaction"`-targeted block corrects a reaction's rate law
   * (`NNBlockConfig.targetKind`'s doc comment) — there are no reactions
   * here (dx/dt is authored directly, per-equation), so there's no
   * sensible wiring target. Throwing at `addNNBlock` time matches
   * `SteadyStateModelBuilder`'s existing pattern for a wiring request this
   * builder can't satisfy; ode-model.schema.json's `target_kind` enum
   * already restricts a *serialized* block to `"variable"` only, but a
   * hand-built `NNBlockConfig` literal (e.g. from mxlweb-core's own tests)
   * bypasses schema validation entirely, so this is the app-level
   * backstop. A `"variable"`-targeted block still gets the base class's
   * no-op — nothing to wire, `dxdtExpr` above is purely mechanistic.
   */
  protected wireNNBlockOutputs(config: NNBlockConfig): void {
    if (config.targetKind !== "variable") {
      throw new Error(
        `addNNBlock: OdeModelBuilder only supports targetKind "variable" (got "${config.targetKind}") — there are no reactions here for a "reaction"-targeted block to correct`,
      );
    }
  }

  /** Set the dx/dt expression for an existing variable. */
  setDifferential(key: string, fn: Base) {
    if (!this.variables.has(key)) {
      throw new Error(`setDifferential: unknown variable "${key}"`);
    }
    this.differentials.set(key, fn);
    return this;
  }

  removeDifferential(key: string) {
    this.differentials.delete(key);
    return this;
  }

  protected extraIntermediates(): Map<string, IntermediateDef> {
    return new Map();
  }

  protected extraMxlwebChains(collect: (expr: Base) => void): string[] {
    const chains: string[] = [];
    for (const [id, fn] of this.differentials) {
      collect(fn);
      chains.push(`    .setDifferential(${JSON.stringify(id)}, ${fn.toTs()})`);
    }
    for (const [id, ro] of this.readouts) {
      collect(ro.fn);
      chains.push(
        `    .addReadout(${JSON.stringify(id)}, ${this.tsAssign(ro)})`,
      );
    }
    return chains;
  }

  protected dxdtExpr(varName: string): Base {
    return this.differentials.get(varName) ?? new Num(0);
  }

  protected mxlKind(): MxlKind {
    return "ode";
  }

  protected mxlModel(): Record<string, Record<string, MxlEntity>> {
    return {
      variables: this.mxlVariables((id) => ({
        fn: (this.differentials.get(id) ?? new Num(0)).toJson(),
      })),
      parameters: this.mxlParameters(),
      derived: this.mxlDerived(),
      readouts: this.mxlReadouts(),
      nn_blocks: this.mxlNNBlocks(),
    };
  }

  buildTex(): string {
    const texNames: Map<string, string> = new Map();
    for (const [name, variable] of this.variables) {
      if (variable.texName) texNames.set(name, variable.texName);
    }
    for (const [name, parameter] of this.parameters) {
      if (parameter.texName) texNames.set(name, parameter.texName);
    }
    for (const [name, ass] of this.assignments) {
      if (ass.texName) texNames.set(name, ass.texName || defaultTexName(name));
    }

    const rhsString = [...this.variables.keys()]
      .map((name) => {
        // Own hand-authored differential, composed with every targeting NN
        // block's abbreviated term (composeNNBlockTex) — not dxdtExpr()'s
        // fully expanded sum, which is what buildJs()/buildWat() need but is
        // unreadable to render.
        const own = this.differentials.get(name) ?? new Num(0);
        const rhs = this.composeNNBlockTex(name, own.toTex(texNames));
        return `\\frac{d ${texNames.get(name) || name}}{dt} &= ${rhs}`;
      })
      .join(" \\\\ \n  ");

    return String.raw`\begin{align*}
  ${rhsString}
\end{align*}`;
  }

  /**
   * Generate an [mxlpy](https://github.com/Computational-Biology-Aachen/mxlpy)
   * `OdeModelBuilder` module as Python source: a `get_model() ->
   * OdeModelBuilder` factory plus the module-level derived/diff_eq/
   * initial-assignment functions it references.
   *
   * Unlike `KineticModelBuilder.buildMxlpy()`, there is no separate
   * `add_variable` on the Python side — `OdeModelBuilder.add_diff_eq(name,
   * initial_value, fn, args=[...])` declares a variable and its dynamics
   * together (`_ode_builder.py:1317`), so each variable becomes exactly one
   * `add_diff_eq` call instead of a `add_variable`/`add_reaction` pair.
   */
  buildMxlpy(): string {
    const nnPlan = planNNBlockMxlpy(
      this.nnBlocks,
      [...this.variables.keys()],
      undefined,
    );

    const {
      defs,
      body,
      emitFn,
      argList,
      name,
      initialValueSource,
      usesInitial,
    } = this.buildMxlpyPreamble();

    for (const [id, v] of this.variables) {
      const fnName = `_diffeq_${name(id)}`;
      const args = emitFn(fnName, this.differentials.get(id) ?? new Num(0));
      body.push(
        `m.add_diff_eq("${name(id)}", ${initialValueSource(id, v.value)}, ${fnName}, args=[${argList(args)}])`,
      );
    }

    const imports = ["OdeModelBuilder"];
    if (usesInitial()) imports.push("InitialAssignment");
    imports.sort();

    const defsBlock = defs.length > 0 ? `${defs.join("\n\n")}\n\n` : "";
    const factory = ["m = OdeModelBuilder()", ...body, "return m"]
      .map((line) => `    ${line}`)
      .join("\n");

    let jaxImportBlock = "";
    let nnBlock = "";
    if (nnPlan) {
      const matrices = nnBlockWeightMatrices(
        nnPlan.key,
        nnPlan.config,
        this.nnWeights,
      );
      jaxImportBlock = `
import equinox as eqx
import jax
import jax.numpy as jnp

from mxlpy.jax.models import ${nnBlockMxlpyImportNames(nnPlan.kind).join(", ")}
`;
      nnBlock = `\n\n${buildNNBlockMxlpySource(nnPlan, matrices)}`;
    }

    return `import math

import numpy as np

from mxlpy import ${imports.join(", ")}
${jaxImportBlock}
${defsBlock}def get_model() -> OdeModelBuilder:
${factory}
${nnBlock}`;
  }
}
