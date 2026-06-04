import { SvelteMap } from "svelte/reactivity";
import { Base } from "./mathml/index.js";
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
  return `\\text\{${name}\}`;
}

/** A derived computation that becomes a named local during code generation. */
export type IntermediateDef = {
  fn: Base;
  displayName?: string;
  texName?: string;
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

  // Variables
  addVariable(key: string, value: Variable) {
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
    let order: string[] = [];
    let available: Set<string> = new Set([
      ...this.parameters.keys(),
      ...this.variables.keys(),
    ]);
    let toSort: Array<{ k: string; args: Set<string> }> = [
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
}
