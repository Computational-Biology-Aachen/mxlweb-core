import { SvelteMap } from "svelte/reactivity";
import { Add, Base, Num } from "./mathml/index.js";
import {
  defaultTexName,
  type IntermediateDef,
  ModelBuilderBase,
  type MxlEntity,
  type MxlKind,
} from "./modelBuilderBase.js";

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

  constructor() {
    super();
  }

  clone(): OdeModelBuilder {
    const cl = new OdeModelBuilder();
    cl.parameters = new SvelteMap(this.parameters);
    cl.variables = new SvelteMap(this.variables);
    cl.assignments = new SvelteMap(this.assignments);
    cl.differentials = new SvelteMap(this.differentials);
    cl.nnBlocks = new SvelteMap(this.nnBlocks);
    return cl;
  }

  /**
   * No stored wiring needed: unlike `KineticModelBuilder`, there's no
   * reaction/stoichiometry mechanism to reuse, and mutating the stored
   * `differentials` entry directly would make `removeNNBlock` unable to
   * cleanly subtract a block's contribution back out. `dxdtExpr` below sums
   * {@link ModelBuilderBase.nnBlockOutputsByTarget} fresh instead, so adding
   * or removing a block is just adding/removing its `nnBlocks` entry.
   */
  protected wireNNBlockOutputs(): void {}
  protected unwireNNBlockOutputs(): void {}

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
    return chains;
  }

  protected dxdtExpr(varName: string): Base {
    const own = this.differentials.get(varName) ?? new Num(0);
    const blockTerms = this.nnBlockOutputsByTarget().get(varName);
    if (!blockTerms || blockTerms.length === 0) return own;
    return new Add([own, ...blockTerms]);
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
      readouts: {},
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
        const expr = this.dxdtExpr(name);
        return `\\frac{d ${texNames.get(name) || name}}{dt} &= ${expr.toTex(texNames)}`;
      })
      .join(" \\\\ \n  ");

    return String.raw`\begin{align*}
  ${rhsString}
\end{align*}`;
  }
}
