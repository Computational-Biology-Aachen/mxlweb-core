/**
 * Array-valued intermediates (mxl-schemas ADR 0015).
 *
 * A derived quantity may be a 1-D array that depends on variables and
 * parameters, as long as everything the right-hand side needs is a number.
 * This module holds the array logic every backend shares:
 *
 * - {@link exprLength} / {@link arrayLengths}: shape inference and the ADR's
 *   rules (equal lengths, constant operands, arrays never in scalar slots).
 * - {@link normaliseArrays}: rewrites the array nodes into the few forms the
 *   compiled backends handle — `Simpson` becomes `Sum` with precomputed
 *   weights, `Mean`/`Std` become `Sum` forms, `At` an `Index`, every bound a
 *   non-negative integer.
 * - {@link scheduleArrays}: turns intermediates into steps — scalar
 *   assignments, loops filling a named array, loops reducing an element-wise
 *   expression — whose expressions are scalar trees over {@link ArrayElem}
 *   leaves. JS, Python and WAT each only emit a counted loop.
 * - {@link unrollArrays}: the same, written out as scalars (SBML has no arrays).
 *
 * @module
 */

import type { WatContext } from "./backends/wasm/wat-context.js";
import {
  Add,
  ARRAY_NODE_TYPES,
  Base,
  Divide,
  type GradMap,
  type JsonNode,
  Index,
  Max,
  Min,
  Minus,
  Mul,
  Name,
  Nullary,
  Num,
  Pow,
  Slice,
  Sqrt,
  Sum,
  containsArrayNode,
  evaluate,
  simpson,
} from "./mathml/index.js";
import { mapChildren } from "./modelIr.js";

/** Constant 1-D arrays, by name: model data and arrays derived from it. */
export type ArrayData = ReadonlyMap<string, readonly number[]>;

/** A named expression, as in `ModelIR.intermediates`. */
type Def = { name: string; expr: Base };

function operands(node: Base): Base[] {
  const n = node as unknown as {
    child?: Base;
    base?: Base;
    left?: Base;
    right?: Base;
    children?: Base[];
  };
  return [n.child, n.base, n.left, n.right, ...(n.children ?? [])].filter(
    (c): c is Base => c instanceof Base,
  );
}

function symbols(expr: Base): Set<string> {
  return expr.getSymbols(new Set());
}

/**
 * The value of `expr`, which may reference only data and numbers. Throws,
 * naming `where`, if it references anything else.
 */
export function constantValue(
  expr: Base,
  data: ArrayData,
  where: string,
): number | number[] {
  const others = [...symbols(expr)].filter((s) => !data.has(s));
  if (others.length > 0) {
    throw new Error(
      `${where}: may only reference data and numbers, not ${others.map((s) => `"${s}"`).join(", ")}`,
    );
  }
  // evaluate() never mutates what it resolves, so no copy
  return evaluate(expr, (name) => data.get(name) as number[]);
}

function integer(value: number | number[], what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${what} must be an integer, got ${String(value)}`);
  }
  return value;
}

/** `range(n)[start:stop]` as `[start, stop)`, numpy semantics (negative bounds count from the end). */
function sliceRange(n: number, start: number, stop: number): [number, number] {
  const clamp = (i: number) => Math.min(Math.max(i < 0 ? i + n : i, 0), n);
  const a = clamp(start);
  return [a, Math.max(clamp(stop), a)];
}

/**
 * The length of `expr` if it is an array, `undefined` if it is a number.
 *
 * `lengths` holds every array-valued name (data and array-valued
 * intermediates); `data` the data values, which the operands that have to be
 * constants (`Simpson`'s x, `Index`'s i, `Slice`'s bounds, `At`'s t and times)
 * are evaluated against. Throws, naming `where`, if arrays of unequal lengths
 * combine, a reduction gets a number, or an operand that has to be constant
 * isn't.
 */
export function exprLength(
  expr: Base,
  lengths: ReadonlyMap<string, number>,
  data: ArrayData,
  where: string,
): number | undefined {
  const length = (e: Base): number | undefined => {
    if (e instanceof Name) return lengths.get(e.name);
    if (e instanceof ArrayElem) return undefined;
    if (!ARRAY_NODE_TYPES.has(e.nodeType)) {
      const found = new Set<number>();
      for (const c of operands(e)) {
        const n = length(c);
        if (n !== undefined) found.add(n);
      }
      if (found.size > 1) {
        throw new Error(
          `${where}: arrays of lengths ${[...found].sort((x, y) => x - y).join(", ")} combine in ${e.nodeType}`,
        );
      }
      return found.values().next().value;
    }
    const [a, ...rest] = (e as unknown as { children: Base[] }).children;
    const node = e.nodeType;
    const n = length(a);
    if (n === undefined) {
      throw new Error(`${where}: ${node} needs an array, got a number`);
    }
    for (const r of rest) length(r);
    const c = rest.map((r) => constantValue(r, data, `${where}: ${node}`));
    switch (node) {
      case "Simpson":
        if (typeof c[0] === "number" || c[0].length !== n) {
          throw new Error(
            `${where}: Simpson's x must be an array of length ${n}`,
          );
        }
        return undefined;
      case "Index": {
        const i = integer(c[0], `${where}: Index's index`);
        if (i < -n || i >= n) {
          throw new Error(
            `${where}: Index ${i} is not an element of a length-${n} array`,
          );
        }
        return undefined;
      }
      case "At":
        if (
          typeof c[0] !== "number" ||
          typeof c[1] === "number" ||
          c[1].length !== n
        ) {
          throw new Error(
            `${where}: At needs a number t and times of length ${n}`,
          );
        }
        return undefined;
      case "Slice": {
        const [lo, hi] = sliceRange(
          n,
          integer(c[0], `${where}: Slice's start`),
          integer(c[1], `${where}: Slice's stop`),
        );
        if (hi === lo) {
          throw new Error(
            `${where}: Slice ${String(c[0])}:${String(c[1])} of a length-${n} array is empty`,
          );
        }
        return hi - lo;
      }
      default:
        return undefined;
    }
  };
  return length(expr);
}

/**
 * The lengths of the array-valued `defs`, given in any order (each is
 * classified once the defs it references are). Names in `scalars` (reaction
 * rates, readouts, right-hand sides, ...) must be numbers.
 */
export function arrayLengths(
  defs: readonly Def[],
  data: ArrayData,
  scalars: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const lengths = new Map<string, number>(
    [...data].map(([k, v]) => [k, v.length]),
  );
  const arrays = new Map<string, number>();
  let pending = [...defs];
  while (pending.length > 0) {
    const waiting = new Set(pending.map((d) => d.name));
    const ready = pending.filter((d) =>
      [...symbols(d.expr)].every((s) => s === d.name || !waiting.has(s)),
    );
    if (ready.length === 0) {
      throw new Error(
        `Cyclic dependency between ${pending.map((d) => d.name).join(", ")}`,
      );
    }
    for (const { name, expr } of ready) {
      const n = exprLength(expr, lengths, data, `"${name}"`);
      if (n === undefined) continue;
      if (scalars.has(name)) {
        throw new Error(
          `"${name}": is an array of length ${n}, but must be a number; reduce it (e.g. with Sum or Simpson)`,
        );
      }
      lengths.set(name, n);
      arrays.set(name, n);
    }
    const done = new Set(ready.map((d) => d.name));
    pending = pending.filter((d) => !done.has(d.name));
  }
  return arrays;
}

/** Weights `w` with `simpson(y, x) === Σ w_i y_i` for every `y` (Simpson's rule is linear in `y`). */
export function simpsonWeights(x: readonly number[]): number[] {
  const unit = new Array<number>(x.length).fill(0);
  return x.map((_, i) => {
    unit[i] = 1;
    const w = simpson(unit, x);
    unit[i] = 0;
    return w;
  });
}

/**
 * `expr` with every array subtree over data and numbers replaced by its
 * number: such a subtree is a constant (ADR 0014), computed once instead of
 * on every evaluation. Array subtrees that reference anything else are left
 * for the array-aware code (ADR 0015).
 */
export function foldConstants(
  expr: Base,
  data: ArrayData,
  where: string,
): Base {
  if (data.size === 0) return expr;
  const touchesData = (node: Base) =>
    containsArrayNode(node, ARRAY_NODE_TYPES) ||
    [...node.getSymbols(new Set())].some((s) => data.has(s));
  const fold = (node: Base): Base => {
    if (node instanceof Nullary || !touchesData(node)) return node;
    if (
      ARRAY_NODE_TYPES.has(node.nodeType) &&
      [...node.getSymbols(new Set())].every((s) => data.has(s))
    ) {
      let value: number | number[];
      try {
        value = evaluate(node, (name) => data.get(name) as number[]);
      } catch (e) {
        throw new Error(`${where}: ${(e as Error).message}`, { cause: e });
      }
      if (typeof value === "number") return new Num(value);
    }
    return mapChildren(node, fold);
  };
  return fold(expr);
}

function containsArrayNodes(node: Base): boolean {
  return (
    ARRAY_NODE_TYPES.has(node.nodeType) ||
    operands(node).some(containsArrayNodes)
  );
}

/** Whether any of `exprs` reads an array (data, or an array node). */
export function usesArrays(exprs: Iterable<Base>, data: ArrayData): boolean {
  for (const e of exprs) {
    if (containsArrayNodes(e)) return true;
    for (const s of symbols(e)) if (data.has(s)) return true;
  }
  return false;
}

/**
 * Rewrites the array nodes of `defs` and `outputs` into the forms the compiled
 * backends handle (see the module doc), returning the constant arrays the
 * result reads: the data it uses plus generated weights.
 */
export function normaliseArrays(
  defs: readonly Def[],
  outputs: readonly Def[],
  data: ArrayData,
): { defs: Def[]; outputs: Def[]; data: Map<string, number[]> } {
  const lengths = new Map<string, number>([
    ...[...data].map(([k, v]) => [k, v.length] as [string, number]),
    ...arrayLengths([...defs, ...outputs], data),
  ]);
  const used = new Map<string, number[]>();
  const weights = new Map<string, string>();
  const weightsFor = (x: readonly number[]) => {
    const key = x.join(",");
    let name = weights.get(key);
    if (name === undefined) {
      name = `__w${weights.size}`;
      weights.set(key, name);
      used.set(name, simpsonWeights(x));
    }
    return new Name(name);
  };

  const rewrite = (expr: Base, where: string): Base => {
    const len = (e: Base) => exprLength(e, lengths, data, where)!;
    const num = (e: Base) => constantValue(e, data, where);
    const walk = (e: Base): Base => {
      if (e instanceof Name) {
        const values = data.get(e.name);
        if (values !== undefined) used.set(e.name, [...values]);
        return e;
      }
      if (e instanceof Nullary) return e;
      const c = (e as unknown as { children: Base[] }).children;
      switch (e.nodeType) {
        case "Simpson":
          return new Sum([
            new Mul([weightsFor(num(c[1]) as number[]), walk(c[0])]),
          ]);
        case "Mean":
          return new Divide([new Sum([walk(c[0])]), new Num(len(c[0]))]);
        case "Std": {
          const a = walk(c[0]);
          const n = len(c[0]);
          const mean = new Divide([new Sum([a]), new Num(n)]);
          const ss = new Sum([new Pow(new Minus([a, mean]), new Num(2))]);
          return new Sqrt(new Divide([ss, new Num(n - 1)]), new Num(2));
        }
        case "At": {
          const times = num(c[2]) as number[];
          const t = num(c[1]) as number;
          let best = 0;
          for (let i = 1; i < times.length; i++) {
            if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
          }
          return new Index([walk(c[0]), new Num(best)]);
        }
        case "Index": {
          const n = len(c[0]);
          const i = num(c[1]) as number;
          return new Index([walk(c[0]), new Num(((i % n) + n) % n)]);
        }
        case "Slice": {
          const [lo, hi] = sliceRange(
            len(c[0]),
            num(c[1]) as number,
            num(c[2]) as number,
          );
          return new Slice([walk(c[0]), new Num(lo), new Num(hi)]);
        }
      }
      return mapChildren(e, walk);
    };
    return walk(expr);
  };
  return {
    defs: defs.map((d) => ({ name: d.name, expr: rewrite(d.expr, d.name) })),
    outputs: outputs.map((d) => ({
      name: d.name,
      expr: rewrite(d.expr, d.name),
    })),
    data: used,
  };
}

/**
 * Element `offset` (plus the loop counter if `dynamic`) of the array `name`:
 * the leaf {@link scheduleArrays} leaves in element-wise expressions. Internal
 * to code generation; never serialised to a model file.
 */
export class ArrayElem extends Nullary {
  readonly nodeType = "ArrayElem";
  constructor(
    public name: string,
    public offset: number,
    public dynamic: boolean,
  ) {
    super();
  }
  private index(counter: string): string {
    if (!this.dynamic) return String(this.offset);
    return this.offset === 0 ? counter : `${counter} + ${this.offset}`;
  }
  toJs(): string {
    return `${this.name}[${this.index(LOOP_COUNTER)}]`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `${displayNames.get(this.name) ?? this.name}[${this.index(LOOP_COUNTER)}]`;
  }
  toWat(ctx: WatContext): string {
    const at = ctx.arrays?.get(this.name);
    if (at === undefined) {
      throw new Error(`Unknown array "${this.name}" in WAT codegen`);
    }
    const addr = this.dynamic
      ? `(i32.add (global.get $__arrays) (i32.shl (local.get $__i) (i32.const 3)))`
      : `(global.get $__arrays)`;
    return `(f64.load offset=${at + this.offset * 8} ${addr})`;
  }
  private internal(): never {
    throw new Error(
      "ArrayElem is internal to code generation and has no other form",
    );
  }
  toTex(): string {
    return this.internal();
  }
  toSBML(): string {
    return this.internal();
  }
  toTs(): string {
    return this.internal();
  }
  toJson(): JsonNode {
    return this.internal();
  }
  getSymbols(symbols: Set<string>): Set<string> {
    symbols.add(this.name);
    return symbols;
  }
  pushGradient(_adjoint: Base, _grads: GradMap): void {
    this.internal();
  }
}

/** The loop counter generated JS/Python code uses; `__`-prefixed so it can't collide with a model id. */
export const LOOP_COUNTER = "__i";

/** One statement of a scheduled model (see {@link scheduleArrays}). */
export type Step =
  | { kind: "scalar"; name: string; expr: Base }
  | { kind: "fill"; name: string; length: number; expr: Base }
  | {
      kind: "reduce";
      name: string;
      op: "Sum" | "MaxOf" | "MinOf";
      length: number;
      expr: Base;
    };

/**
 * `defs` (in dependency order) and `outputs` as {@link Step}s, after
 * {@link normaliseArrays}. `lengths` holds every array-valued name (data and
 * array-valued defs). Scalar subexpressions of element-wise expressions are
 * computed before their loop, as their own scalar steps.
 */
export function scheduleArrays(
  defs: readonly Def[],
  outputs: readonly Base[],
  lengths: ReadonlyMap<string, number>,
): { steps: Step[]; outputs: Base[] } {
  const steps: Step[] = [];
  let counter = 0;
  const fresh = () => `__a${counter++}`;
  const memo = new Map<Base, boolean>();
  const isArray = (e: Base): boolean => {
    let r = memo.get(e);
    if (r === undefined) {
      if (e instanceof Name) r = lengths.has(e.name);
      else if (e.nodeType === "Slice") r = true;
      else if (ARRAY_NODE_TYPES.has(e.nodeType)) r = false;
      else r = operands(e).some(isArray);
      memo.set(e, r);
    }
    return r;
  };
  const length = (e: Base): number => {
    if (e instanceof Name) return lengths.get(e.name)!;
    if (e.nodeType === "Slice") {
      const [, lo, hi] = (e as Slice).children as [Base, Num, Num];
      return hi.value - lo.value;
    }
    return length(operands(e).find(isArray)!);
  };

  type At = { dynamic: boolean; offset: number };
  const elem = (e: Base, at?: At): Base => {
    if (at === undefined) {
      const c = (e as unknown as { children?: Base[] }).children;
      switch (e.nodeType) {
        case "Sum":
        case "MaxOf":
        case "MinOf": {
          const expr = elem(c![0], { dynamic: true, offset: 0 });
          const name = fresh();
          steps.push({
            kind: "reduce",
            name,
            op: e.nodeType,
            length: length(c![0]),
            expr,
          });
          return new Name(name);
        }
        case "Index":
          return elem(c![0], {
            dynamic: false,
            offset: (c![1] as Num).value,
          });
      }
      return mapChildren(e, (x) => elem(x));
    }
    if (!isArray(e)) {
      const s = elem(e);
      if (!at.dynamic || s instanceof Nullary) return s;
      const name = fresh();
      steps.push({ kind: "scalar", name, expr: s });
      return new Name(name);
    }
    if (e instanceof Name) return new ArrayElem(e.name, at.offset, at.dynamic);
    if (e.nodeType === "Slice") {
      const [a, lo] = (e as Slice).children as [Base, Num];
      return elem(a, { ...at, offset: at.offset + lo.value });
    }
    return mapChildren(e, (x) => elem(x, at));
  };

  for (const { name, expr } of defs) {
    const n = lengths.get(name);
    if (n === undefined) {
      steps.push({ kind: "scalar", name, expr: elem(expr) });
    } else {
      steps.push({
        kind: "fill",
        name,
        length: n,
        expr: elem(expr, { dynamic: true, offset: 0 }),
      });
    }
  }
  return { steps, outputs: outputs.map((o) => elem(o)) };
}

/**
 * `defs` (in dependency order) and `outputs` with every array written out as
 * scalars, after {@link normaliseArrays}: element `i` of an array-valued def
 * `x` becomes the def `x_i`, of data its value, and a reduction an explicit
 * sum / max / min. For targets without arrays (SBML).
 */
export function unrollArrays(
  defs: readonly Def[],
  outputs: readonly Base[],
  data: ArrayData,
  lengths: ReadonlyMap<string, number>,
): { defs: Def[]; outputs: Base[] } {
  const { steps, outputs: outs } = scheduleArrays(defs, outputs, lengths);
  const elementName = new Map<string, (i: number) => string>();
  const scalarize = (e: Base, i: number): Base => {
    if (e instanceof ArrayElem) {
      const k = e.dynamic ? i + e.offset : e.offset;
      const values = data.get(e.name);
      if (values !== undefined) return new Num(values[k]);
      return new Name(elementName.get(e.name)!(k));
    }
    if (e instanceof Nullary) return e;
    return mapChildren(e, (x) => scalarize(x, i));
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const out: Def[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case "scalar":
        out.push({ name: step.name, expr: scalarize(step.expr, 0) });
        break;
      case "fill":
        elementName.set(step.name, (k) => `${step.name}_${k}`);
        for (const i of range(step.length)) {
          out.push({
            name: `${step.name}_${i}`,
            expr: scalarize(step.expr, i),
          });
        }
        break;
      case "reduce": {
        const terms = range(step.length).map((i) => scalarize(step.expr, i));
        const Ctor = step.op === "Sum" ? Add : step.op === "MaxOf" ? Max : Min;
        out.push({ name: step.name, expr: new Ctor(terms) });
        break;
      }
    }
  }
  return { defs: out, outputs: outs.map((o) => scalarize(o, 0)) };
}
