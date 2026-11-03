import type { WatContext } from "../backends/wasm/wat-context.js";
import { Base, type GradMap, Nary } from "./base.js";

/**
 * Array nodes (mxl-schemas ADR 0014): the operations that reduce a 1-D array
 * to a number or select from it. Every other node broadcasts element-wise
 * over arrays when evaluated by {@link evaluate}; these are the only ones that
 * need an array. Operands are `children`, in the order each class documents.
 *
 * In a model, an array subtree may only reference data and numbers, so it is
 * a constant that {@link ModelBuilderBase.lower} folds to a {@link Num} before
 * any backend sees the model: the JS/WAT/SBML serialisers and gradients below
 * are never reached for a lowered model and throw if they are. `toPy` (the
 * mxlpy export) and `toTex` do emit them.
 *
 * @module
 */

function folded(node: string): Error {
  return new Error(
    `${node} is an array node: it must be folded to a number (model) or evaluated with evaluate() (analysis) before code generation`,
  );
}

/** Shared serialisers; subclasses only name themselves and render Python/LaTeX. */
abstract class ArrayNode extends Nary {
  toJs(): string {
    throw folded(this.nodeType);
  }
  toSBML(): string {
    throw folded(this.nodeType);
  }
  toWat(_ctx: WatContext): string {
    throw folded(this.nodeType);
  }
  pushGradient(_adjoint: Base, _grads: GradMap): void {
    throw folded(this.nodeType);
  }
  protected py(displayNames: Map<string, string>): string[] {
    return this.children.map((c) => c.toPy(displayNames));
  }
  protected tex(texNames: Map<string, string>): string[] {
    return this.children.map((c) => c.toTex(texNames));
  }
}

/** `[a]`: sum of all elements (`np.sum`). */
export class Sum extends ArrayNode {
  readonly nodeType = "Sum";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.sum(${this.py(displayNames)[0]})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\sum ${this.tex(texNames)[0]}`;
  }
}

/** `[a]`: arithmetic mean (`np.mean`). */
export class Mean extends ArrayNode {
  readonly nodeType = "Mean";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.mean(${this.py(displayNames)[0]})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\operatorname{mean}\\left(${this.tex(texNames)[0]}\\right)`;
  }
}

/** `[a]`: sample standard deviation (`np.std(a, ddof=1)`). */
export class Std extends ArrayNode {
  readonly nodeType = "Std";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.std(${this.py(displayNames)[0]}, ddof=1)`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\operatorname{std}\\left(${this.tex(texNames)[0]}\\right)`;
  }
}

/** `[a]`: largest element (`np.max`). */
export class MaxOf extends ArrayNode {
  readonly nodeType = "MaxOf";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.max(${this.py(displayNames)[0]})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\max\\left(${this.tex(texNames)[0]}\\right)`;
  }
}

/** `[a]`: smallest element (`np.min`). */
export class MinOf extends ArrayNode {
  readonly nodeType = "MinOf";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.min(${this.py(displayNames)[0]})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\min\\left(${this.tex(texNames)[0]}\\right)`;
  }
}

/** `[a, i]`: element `i` (0-based, negative counts from the end). */
export class Index extends ArrayNode {
  readonly nodeType = "Index";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    const [a, i] = this.py(displayNames);
    return `np.asarray(${a})[int(${i})]`;
  }
  toTex(texNames: Map<string, string>): string {
    const [a, i] = this.tex(texNames);
    return `{${a}}_{${i}}`;
  }
}

/** `[a, start, stop]`: elements `start` up to (excluding) `stop`. */
export class Slice extends ArrayNode {
  readonly nodeType = "Slice";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    const [a, start, stop] = this.py(displayNames);
    return `np.asarray(${a})[int(${start}):int(${stop})]`;
  }
  toTex(texNames: Map<string, string>): string {
    const [a, start, stop] = this.tex(texNames);
    return `{${a}}_{${start}:${stop}}`;
  }
}

/** `[a, t, times]`: the element of `a` at the sample of `times` nearest `t`. */
export class At extends ArrayNode {
  readonly nodeType = "At";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    const [a, t, times] = this.py(displayNames);
    return `np.asarray(${a})[np.argmin(np.abs(np.asarray(${times}) - ${t}))]`;
  }
  toTex(texNames: Map<string, string>): string {
    const [a, t, times] = this.tex(texNames);
    return `\\left.${a}\\right|_{${times} = ${t}}`;
  }
}

/** `[y, x]`: integral of `y` over `x` by Simpson's rule (`scipy.integrate.simpson(y, x=x)`). */
export class Simpson extends ArrayNode {
  readonly nodeType = "Simpson";
  constructor(public children: Base[]) {
    super();
  }
  toPy(displayNames: Map<string, string>): string {
    const [y, x] = this.py(displayNames);
    return `simpson(${y}, x=${x})`;
  }
  toTex(texNames: Map<string, string>): string {
    const [y, x] = this.tex(texNames);
    return `\\int ${y} \\, \\mathrm{d}${x}`;
  }
}

/** Every array node type name, for callers that classify a tree (e.g. folding in `lower`). */
export const ARRAY_NODE_TYPES: ReadonlySet<string> = new Set([
  "Sum",
  "Mean",
  "Std",
  "MaxOf",
  "MinOf",
  "Index",
  "Slice",
  "At",
  "Simpson",
]);
