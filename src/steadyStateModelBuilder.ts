import { SvelteMap } from "svelte/reactivity";
import { Base, Num } from "./mathml/index.js";
import {
  defaultTexName,
  type IntermediateDef,
  ModelBuilderBase,
  type MxlEntity,
  type MxlKind,
} from "./modelBuilderBase.js";

/**
 * Algebraic (steady-state) model builder: outputs are closed-form functions of
 * the model's parameters, with no differential equations and no time
 * integration.
 *
 * Unlike the {@link OdeModelBuilder}, there are no state variables. The model is
 * just parameters and {@link ModelBuilderBase.addAssignment | assignments}; the
 * assignments are the outputs. A "sweep" picks one parameter as the independent
 * axis and evaluates the assignments across a range of its values — that range
 * lives in the analysis, not the model, so any parameter can be swept.
 *
 * Evaluation reuses the shared derived-quantity code generation
 * ({@link ModelBuilderBase.buildJsDerived}): the emitted
 * `(time, variables, pars) => [...]` is exactly the algebraic system, evaluated
 * with `variables = []`.
 */
export class SteadyStateModelBuilder extends ModelBuilderBase {
  constructor() {
    super();
  }

  clone(): SteadyStateModelBuilder {
    const cl = new SteadyStateModelBuilder();
    cl.parameters = new SvelteMap(this.parameters);
    cl.variables = new SvelteMap(this.variables);
    cl.assignments = new SvelteMap(this.assignments);
    return cl;
  }

  protected extraIntermediates(): Map<string, IntermediateDef> {
    return new Map();
  }

  // No state variables exist, so this is never reached during lowering; it only
  // satisfies the base contract.
  protected dxdtExpr(): Base {
    return new Num(0);
  }

  protected mxlKind(): MxlKind {
    return "steady-state";
  }

  protected mxlModel(): Record<string, Record<string, MxlEntity>> {
    return {
      parameters: this.mxlParameters(),
      derived: this.mxlDerived(),
    };
  }

  /**
   * Pure algebraic Python export: a function of all parameters returning the
   * outputs (assignments). Every parameter becomes a keyword argument defaulting
   * to its current value, so a caller sweeps an axis by varying one argument.
   */
  buildPython(
    _userParameters: string[] = [],
    selectedDerived?: string[],
  ): string {
    const ir = this.lower();
    const displayNames = ir.displayNames;
    const Name = (x: string) => displayNames.get(x) ?? x;

    const order = ir.intermediates.map((m) => m.name);
    if (selectedDerived !== undefined) {
      const known = new Set(order);
      for (const key of selectedDerived) {
        if (!known.has(key)) {
          throw new Error(`buildPython: unknown output key "${key}"`);
        }
      }
    }
    const outputs = selectedDerived ?? order;

    const argList = [...ir.paramValues.entries()]
      .map(([name, value]) => `    ${Name(name)}: float = ${value},`)
      .join("\n");
    const args = argList.length > 0 ? `\n${argList}\n` : "";

    const body = ir.intermediates
      .map((m) => `    ${Name(m.name)} = ${m.expr.toPy(displayNames)}`)
      .join("\n");

    const ret = outputs.map(Name).join(", ");

    return `import numpy as np
import math


def model(${args}):
${body.length > 0 ? body + "\n" : ""}    return ${ret.length > 0 ? ret : "()"}
`;
  }

  buildTex(): string {
    const texNames: Map<string, string> = new Map();
    for (const [name, parameter] of this.parameters) {
      if (parameter.texName) texNames.set(name, parameter.texName);
    }
    for (const [name, ass] of this.assignments) {
      if (ass.texName) texNames.set(name, ass.texName || defaultTexName(name));
    }

    const rhsString = this.sortDependencies()
      .map((name) => {
        const ass = this.assignments.get(name);
        if (ass === undefined) return undefined;
        return `${texNames.get(name) || name} &= ${ass.fn.toTex(texNames)}`;
      })
      .filter((line) => line !== undefined)
      .join(" \\\\ \n  ");

    return String.raw`\begin{align*}
  ${rhsString}
\end{align*}`;
  }

  /**
   * Generate an [mxlpy](https://github.com/Computational-Biology-Aachen/mxlpy)
   * model module as Python source: a `get_model() -> Model` factory plus the
   * module-level rate/derived/initial-assignment functions it references.
   *
   * Each reaction, assignment and expression-valued initial value becomes its
   * own generated `def` (body `return <expr>`); the factory then wires them up
   * via `add_parameter` / `add_variable` / `add_derived` / `add_reaction`.
   * Numeric stoichiometry coefficients are emitted as floats; non-numeric ones
   * become `Derived` entries. Function arguments follow model declaration order
   * (variables, parameters, derived, reactions), with mxlpy's reserved `time`
   * argument placed first.
   */
  buildMxlpy(): string {
    const displayNames = this.getDisplayNames();
    const name = (id: string) => displayNames.get(id) ?? id;

    // Declaration-order index, used to order generated-function arguments.
    const declOrder = new Map<string, number>();
    for (const id of [...this.parameters.keys(), ...this.assignments.keys()]) {
      declOrder.set(id, declOrder.size);
    }

    const orderArgs = (expr: Base): string[] => {
      const symbols = [...expr.getSymbols(new Set<string>())];
      const known = symbols
        .filter((s) => s !== "time")
        .sort(
          (a, b) =>
            (declOrder.get(a) ?? Infinity) - (declOrder.get(b) ?? Infinity),
        );
      return symbols.includes("time") ? ["time", ...known] : known;
    };

    const argList = (args: string[]) =>
      args.map((a) => `"${name(a)}"`).join(", ");

    const defs: string[] = [];
    // Emit a module-level `def <fnName>(...): return <expr>` and return the
    // ordered arg ids so the call site can build a matching `args=[...]`.
    const emitFn = (fnName: string, expr: Base): string[] => {
      const args = orderArgs(expr);
      const params = args.map(name).join(", ");
      defs.push(
        `def ${fnName}(${params}):\n    return ${expr.toPy(displayNames)}`,
      );
      return args;
    };

    let usesInitial = false;
    let usesDerived = false;
    const body: string[] = [];

    for (const [id, p] of this.parameters) {
      body.push(`m.add_parameter("${name(id)}", ${p.value})`);
    }

    for (const [id, v] of this.variables) {
      if (v.value instanceof Base) {
        usesInitial = true;
        const fnName = `_init_${name(id)}`;
        const args = emitFn(fnName, v.value);
        body.push(
          `m.add_variable("${name(id)}", InitialAssignment(${fnName}, args=[${argList(args)}]))`,
        );
      } else {
        body.push(`m.add_variable("${name(id)}", ${v.value})`);
      }
    }

    for (const [id, ass] of this.assignments) {
      const fnName = `_derived_${name(id)}`;
      const args = emitFn(fnName, ass.fn);
      body.push(
        `m.add_derived("${name(id)}", ${fnName}, args=[${argList(args)}])`,
      );
    }

    const imports = ["Model"];
    if (usesDerived) imports.push("Derived");
    if (usesInitial) imports.push("InitialAssignment");
    imports.sort();

    const defsBlock = defs.length > 0 ? `${defs.join("\n\n")}\n\n` : "";
    const factory = ["m = SteadyStateModelBuilder()", ...body, "return m"]
      .map((line) => `    ${line}`)
      .join("\n");

    return `import math

import numpy as np

from mxlpy import ${imports.join(", ")}

${defsBlock}def get_model() -> SteadyStateModelBuilder:
${factory}
`;
  }
}
