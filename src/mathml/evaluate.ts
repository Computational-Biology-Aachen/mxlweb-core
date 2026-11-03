import { Base } from "./base.js";
import type { Bool, Name, Num } from "./base.js";
import type { Log, Sqrt } from "./unary-special.js";
import {
  arrayIndex,
  arrayMax,
  arrayMean,
  arrayMin,
  arraySlice,
  arrayStd,
  arraySum,
  nearestIndex,
  simpson,
} from "./arrayOps.js";

/**
 * Tree-walking evaluator over values that are numbers or 1-D arrays
 * (mxl-schemas ADR 0014): the one evaluator behind both analysis expressions
 * and the constant folding of model data.
 *
 * Every scalar node broadcasts element-wise: a number combines with every
 * element of an array, two arrays combine element by element and must have
 * the same length. The array nodes (`array.ts`) reduce or select. Booleans
 * (comparisons, logic) evaluate to 1 / 0.
 *
 * @module
 */

export type Value = number | number[];

/** Maps a `Name` to its value; throw for an unknown name. */
export type Resolve = (name: string) => Value;

const UNARY: Record<string, (x: number) => number> = {
  Abs: Math.abs,
  Ceiling: Math.ceil,
  Exp: Math.exp,
  Floor: Math.floor,
  Ln: Math.log,
  Sin: Math.sin,
  Cos: Math.cos,
  Tan: Math.tan,
  Sec: (x) => 1 / Math.cos(x),
  Csc: (x) => 1 / Math.sin(x),
  Cot: (x) => 1 / Math.tan(x),
  Asin: Math.asin,
  Acos: Math.acos,
  Atan: Math.atan,
  Acot: (x) => Math.atan(1 / x),
  ArcSec: (x) => Math.acos(1 / x),
  ArcCsc: (x) => Math.asin(1 / x),
  Sinh: Math.sinh,
  Cosh: Math.cosh,
  Tanh: Math.tanh,
  Sech: (x) => 1 / Math.cosh(x),
  Csch: (x) => 1 / Math.sinh(x),
  Coth: (x) => 1 / Math.tanh(x),
  ArcSinh: Math.asinh,
  ArcCosh: Math.acosh,
  ArcTanh: Math.atanh,
  ArcCsch: (x) => Math.asinh(1 / x),
  ArcSech: (x) => Math.acosh(1 / x),
  ArcCoth: (x) => Math.atanh(1 / x),
};

const b = (x: boolean) => (x ? 1 : 0);

/** Left fold of the children (`a - b - c`, `a / b / c`, …). */
const FOLD: Record<string, (x: number, y: number) => number> = {
  Add: (x, y) => x + y,
  Mul: (x, y) => x * y,
  Minus: (x, y) => x - y,
  Divide: (x, y) => x / y,
  IntDivide: (x, y) => Math.trunc(x / y),
  Rem: (x, y) => x % y,
  Max: (x, y) => Math.max(x, y),
  Min: (x, y) => Math.min(x, y),
  And: (x, y) => b(x !== 0 && y !== 0),
  Or: (x, y) => b(x !== 0 || y !== 0),
  Xor: (x, y) => b((x !== 0) !== (y !== 0)),
};

/** Chained comparisons: `a < b < c` holds if every adjacent pair does. */
const COMPARE: Record<string, (x: number, y: number) => boolean> = {
  Eq: (x, y) => x === y,
  NotEqual: (x, y) => x !== y,
  GreaterThan: (x, y) => x > y,
  GreaterEqual: (x, y) => x >= y,
  LessThan: (x, y) => x < y,
  LessEqual: (x, y) => x <= y,
};

/** `f` applied element-wise across `values`, broadcasting numbers against arrays. */
export function broadcast(
  values: readonly Value[],
  f: (...xs: number[]) => number,
): Value {
  let length: number | undefined;
  for (const v of values) {
    if (typeof v === "number") continue;
    if (length !== undefined && v.length !== length) {
      throw new Error(`Array length mismatch: ${length} vs ${v.length}`);
    }
    length = v.length;
  }
  if (length === undefined) return f(...(values as number[]));
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    out[i] = f(...values.map((v) => (typeof v === "number" ? v : v[i])));
  }
  return out;
}

function array(v: Value, node: string): number[] {
  if (typeof v === "number") throw new Error(`${node} needs an array`);
  return v;
}

function scalar(v: Value, node: string): number {
  if (typeof v !== "number") throw new Error(`${node} needs a number`);
  return v;
}

function piecewise(children: readonly Base[], ev: (n: Base) => Value): Value {
  // value, condition, value, condition, …, [otherwise]
  const pairs: Array<[Value, Value]> = [];
  for (let i = 0; i + 1 < children.length; i += 2) {
    pairs.push([ev(children[i]), ev(children[i + 1])]);
  }
  const otherwise =
    children.length % 2 === 1 ? ev(children[children.length - 1]) : NaN;
  // Scalar conditions select a whole branch (which may be an array) …
  if (pairs.every(([, c]) => typeof c === "number")) {
    for (const [value, cond] of pairs) if (cond !== 0) return value;
    return otherwise;
  }
  // … array conditions select element by element.
  const flat = pairs.flat();
  return broadcast([...flat, otherwise], (...xs) => {
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (xs[i + 1] !== 0) return xs[i];
    return xs[xs.length - 1];
  });
}

/**
 * Evaluate the expression tree `node`, resolving every `Name` through
 * `resolve`. Throws on a node type it cannot evaluate (e.g. `RateOf`, which
 * needs a model's right-hand side).
 */
export function evaluate(node: Base, resolve: Resolve): Value {
  const ev = (n: Base) => evaluate(n, resolve);
  const t = node.nodeType;
  const children = (node as { children?: Base[] }).children;

  switch (t) {
    case "Num":
      return (node as Num).value;
    case "Bool":
      return b((node as Bool).value);
    case "Name":
      return resolve((node as Name).name);
    case "Pi":
      return Math.PI;
    case "E":
      return Math.E;
    case "Pow": {
      const { left, right } = node as unknown as { left: Base; right: Base };
      return broadcast([ev(left), ev(right)], (x, y) => x ** y);
    }
    case "Implies": {
      const { left, right } = node as unknown as { left: Base; right: Base };
      return broadcast([ev(left), ev(right)], (x, y) => b(x === 0 || y !== 0));
    }
    case "Log": {
      const { child, base } = node as Log;
      // Exact for the common bases (Math.log(1000) / Math.LN10 is 2.9999…).
      return broadcast([ev(child), ev(base)], (x, y) =>
        y === 10
          ? Math.log10(x)
          : y === 2
            ? Math.log2(x)
            : Math.log(x) / Math.log(y),
      );
    }
    case "Sqrt": {
      const { child, base } = node as Sqrt;
      return broadcast([ev(child), ev(base)], (x, y) =>
        y === 2 ? Math.sqrt(x) : x ** (1 / y),
      );
    }
    case "Factorial":
      return broadcast(
        [ev((node as unknown as { child: Base }).child)],
        (n) => {
          let r = 1;
          for (let i = 2; i <= Math.round(n); i++) r *= i;
          return r;
        },
      );
    case "Not":
      return broadcast([ev(children![0])], (x) => b(x === 0));
    case "Piecewise":
      return piecewise(children!, ev);

    // Array nodes
    case "Sum":
      return arraySum(array(ev(children![0]), t));
    case "Mean":
      return arrayMean(array(ev(children![0]), t));
    case "Std":
      return arrayStd(array(ev(children![0]), t));
    case "MaxOf":
      return arrayMax(array(ev(children![0]), t));
    case "MinOf":
      return arrayMin(array(ev(children![0]), t));
    case "Index":
      return arrayIndex(
        array(ev(children![0]), t),
        scalar(ev(children![1]), t),
      );
    case "Slice":
      return arraySlice(
        array(ev(children![0]), t),
        scalar(ev(children![1]), t),
        scalar(ev(children![2]), t),
      );
    case "At": {
      const [a, at, times] = children!.map(ev);
      return array(a, t)[nearestIndex(array(times, t), scalar(at, t))];
    }
    case "Simpson":
      return simpson(array(ev(children![0]), t), array(ev(children![1]), t));
  }

  const unary = UNARY[t];
  if (unary !== undefined) {
    return broadcast([ev((node as unknown as { child: Base }).child)], unary);
  }
  const fold = FOLD[t];
  if (fold !== undefined) {
    const values = children!.map(ev);
    if (t === "Minus" && values.length === 1) {
      return broadcast(values, (x) => -x);
    }
    return broadcast(values, (...xs) => xs.reduce(fold));
  }
  const compare = COMPARE[t];
  if (compare !== undefined) {
    return broadcast(children!.map(ev), (...xs) => {
      for (let i = 0; i + 1 < xs.length; i++) {
        if (!compare(xs[i], xs[i + 1])) return 0;
      }
      return 1;
    });
  }
  throw new Error(`Cannot evaluate a ${t} node`);
}

/** Whether `node`'s subtree contains an array node (it reduces or selects from an array). */
export function containsArrayNode(
  node: Base,
  arrayTypes: ReadonlySet<string>,
): boolean {
  if (arrayTypes.has(node.nodeType)) return true;
  const n = node as unknown as {
    child?: Base;
    base?: Base;
    left?: Base;
    right?: Base;
    children?: Base[];
  };
  return [n.child, n.base, n.left, n.right, ...(n.children ?? [])].some(
    (c) => c instanceof Base && containsArrayNode(c, arrayTypes),
  );
}
