import { type Base, Name, Num } from "./base.js";
import {
  At,
  Index,
  MaxOf,
  Mean,
  MinOf,
  Simpson,
  Slice,
  Std,
  Sum,
} from "./array.js";
import { Add, Divide, GreaterThan, Minus, Mul, Piecewise } from "./nary.js";
import { Pow } from "./binary.js";
import { Abs, Exp, Ln, Sin } from "./unary.js";
import { Log, Sqrt } from "./unary-special.js";

/**
 * The expression string syntax (mxl-schemas ADR 0014): a short, hand-written
 * form of a node tree, as used in analyses (`wt.NPQ - npq4.NPQ`,
 * `-log10(H_lumen * 1e-6)`). This is the reference parser; files store the
 * resulting trees, so other consumers only need to evaluate them.
 *
 * - numbers, `+ - * / ^` (`^` is right-associative and binds tighter than
 *   unary minus: `-k ^ 2` is `-(k^2)`), parentheses
 * - references, dotted (`wt.NPQ`, `param.k`), become a `Name` of the whole path
 * - `log10 log2 ln exp sqrt abs sin`, element-wise
 * - `mean sum min max first last std` (reductions; `std` uses ddof = 1),
 *   `nth(a, i)`, `slice(a, from, to)`, `at(a, t, times)`, `simpson(y, x)`,
 *   `ifgt(a, b, x, y)`
 *
 * @module
 */

type Builder = (args: Base[]) => Base;

const FUNCTIONS: Record<string, { arity: number; build: Builder }> = {
  log10: { arity: 1, build: ([x]) => new Log(x, new Num(10)) },
  log2: { arity: 1, build: ([x]) => new Log(x, new Num(2)) },
  ln: { arity: 1, build: ([x]) => new Ln(x) },
  exp: { arity: 1, build: ([x]) => new Exp(x) },
  sqrt: { arity: 1, build: ([x]) => new Sqrt(x, new Num(2)) },
  abs: { arity: 1, build: ([x]) => new Abs(x) },
  sin: { arity: 1, build: ([x]) => new Sin(x) },
  mean: { arity: 1, build: (a) => new Mean(a) },
  sum: { arity: 1, build: (a) => new Sum(a) },
  min: { arity: 1, build: (a) => new MinOf(a) },
  max: { arity: 1, build: (a) => new MaxOf(a) },
  std: { arity: 1, build: (a) => new Std(a) },
  first: { arity: 1, build: ([a]) => new Index([a, new Num(0)]) },
  last: { arity: 1, build: ([a]) => new Index([a, new Num(-1)]) },
  nth: { arity: 2, build: (a) => new Index(a) },
  slice: { arity: 3, build: (a) => new Slice(a) },
  at: { arity: 3, build: (a) => new At(a) },
  simpson: { arity: 2, build: (a) => new Simpson(a) },
  ifgt: {
    arity: 4,
    build: ([a, b, x, y]) => new Piecewise([x, new GreaterThan([a, b]), y]),
  },
};

/** The function names the syntax knows. */
export const EXPRESSION_FUNCTIONS: ReadonlySet<string> = new Set(
  Object.keys(FUNCTIONS),
);

const TOKEN =
  /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|([-+*/^(),]))/y;

type Token = { num: number } | { name: string } | { sym: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (src.slice(TOKEN.lastIndex).trim() === "") break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Unexpected "${src.slice(at)}" in "${src}"`);
    if (m[1] !== undefined) out.push({ num: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ name: m[2] });
    else out.push({ sym: m[3] });
  }
  return out;
}

/** Parse an expression string to its node tree; throws on a syntax error or an unknown function. */
export function parseExpression(src: string): Base {
  const tokens = tokenize(src);
  let i = 0;
  const isSym = (s: string) => {
    const t = tokens[i];
    return t !== undefined && "sym" in t && t.sym === s;
  };
  const expect = (s: string) => {
    if (!isSym(s)) throw new Error(`Expected "${s}" in "${src}"`);
    i++;
  };

  function additive(): Base {
    let l = multiplicative();
    while (isSym("+") || isSym("-")) {
      const plus = isSym("+");
      i++;
      const r = multiplicative();
      l = plus ? new Add([l, r]) : new Minus([l, r]);
    }
    return l;
  }
  function multiplicative(): Base {
    let l = unary();
    while (isSym("*") || isSym("/")) {
      const times = isSym("*");
      i++;
      const r = unary();
      l = times ? new Mul([l, r]) : new Divide([l, r]);
    }
    return l;
  }
  // Binds looser than `^`, as in Python: -2^2 is -(2^2).
  function unary(): Base {
    if (isSym("-")) {
      i++;
      return new Minus([unary()]);
    }
    return power();
  }
  function power(): Base {
    const l = atom();
    if (isSym("^")) {
      i++;
      return new Pow(l, unary());
    }
    return l;
  }
  function atom(): Base {
    const t = tokens[i];
    if (t === undefined) throw new Error(`Unexpected end of "${src}"`);
    if ("num" in t) {
      i++;
      return new Num(t.num);
    }
    if ("name" in t) {
      i++;
      if (!isSym("(")) return new Name(t.name);
      const fn = FUNCTIONS[t.name];
      if (fn === undefined) {
        throw new Error(`Unknown function "${t.name}" in "${src}"`);
      }
      i++;
      const args = [additive()];
      while (isSym(",")) {
        i++;
        args.push(additive());
      }
      expect(")");
      if (args.length !== fn.arity) {
        throw new Error(
          `${t.name}() takes ${fn.arity} argument(s), got ${args.length} in "${src}"`,
        );
      }
      return fn.build(args);
    }
    if (isSym("(")) {
      i++;
      const inner = additive();
      expect(")");
      return inner;
    }
    throw new Error(`Unexpected token in "${src}"`);
  }

  const out = additive();
  if (i !== tokens.length) throw new Error(`Trailing input in "${src}"`);
  return out;
}
