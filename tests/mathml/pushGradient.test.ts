/**
 * Finite-difference verification of every concrete node type's
 * {@link Base.pushGradient} (ADR 0005, mxlweb repo, §2.2/§2.2.1) via
 * `gradient()`'s single-expression-tree utility (`grad.ts`).
 *
 * Smooth node types: build the expression, get its symbolic gradient,
 * evaluate both the gradient and a central finite difference of the original
 * expression at the same point (numerically, via `toJs()` — reusing existing
 * codegen rather than a separate evaluator), and assert they agree. Test
 * points are chosen inside each function's real-valued domain, away from
 * poles/branch points.
 *
 * Documented-zero node types (ADR 0005 §2.2.1: `Floor`/`Ceiling`/
 * `Factorial`/`RateOf`/`IntDivide`/every comparison and boolean node):
 * asserted structurally (`Num(0)`) rather than via finite differences —
 * these are genuinely non-differentiable, so a finite difference taken away
 * from a jump would just show the *local* slope, not confirm the
 * implementation actually chose the documented-zero convention over
 * (incorrectly) trying to compute a real local derivative.
 */
import type { Base } from "@computational-biology-aachen/mxlweb-core/mathml";
import {
  Abs,
  Acos,
  Acot,
  Add,
  And,
  ArcCosh,
  ArcCoth,
  ArcCsc,
  ArcCsch,
  ArcSec,
  ArcSech,
  ArcSinh,
  ArcTanh,
  Asin,
  Atan,
  Ceiling,
  Cos,
  Cosh,
  Cot,
  Coth,
  Csc,
  Csch,
  Divide,
  Eq,
  Exp,
  Factorial,
  Floor,
  gradient,
  GreaterEqual,
  GreaterThan,
  Implies,
  IntDivide,
  LessEqual,
  LessThan,
  Ln,
  Log,
  Max,
  Min,
  Minus,
  Mul,
  Name,
  Not,
  NotEqual,
  Num,
  Or,
  Piecewise,
  Pow,
  RateOf,
  Rem,
  Sec,
  Sech,
  Sin,
  Sinh,
  Sqrt,
  Tan,
  Tanh,
  Xor,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

function evalExpr(expr: Base, env: Record<string, number>): number {
  const names = Object.keys(env);
  const fn = new Function(...names, `return ${expr.toJs()};`) as (
    ...args: number[]
  ) => number;
  return fn(...names.map((n) => env[n]));
}

function centralDiff(
  expr: Base,
  env: Record<string, number>,
  wrt: string,
  h = 1e-4,
): number {
  const plus = { ...env, [wrt]: env[wrt] + h };
  const minus = { ...env, [wrt]: env[wrt] - h };
  return (evalExpr(expr, plus) - evalExpr(expr, minus)) / (2 * h);
}

/** Asserts the symbolic gradient of `expr` w.r.t. every name in `env` matches a central finite difference at that point. */
function checkGradient(expr: Base, env: Record<string, number>): void {
  const names = Object.keys(env);
  const grads = gradient(expr, names);
  for (const name of names) {
    const symbolic = evalExpr(grads.get(name)!, env);
    const numeric = centralDiff(expr, env, name);
    expect(symbolic).toBeCloseTo(numeric, 3);
  }
}

/** Asserts `expr`'s gradient w.r.t. `name` is the documented literal zero, not merely numerically small. */
function checkZeroGradient(expr: Base, name: string): void {
  const g = gradient(expr, [name]).get(name)!;
  expect(g).toBeInstanceOf(Num);
  expect((g as Num).value).toBe(0);
}

describe("unary smooth node types (finite-difference verified)", () => {
  const cases: [name: string, Ctor: new (child: Base) => Base, points: number[]][] =
    [
      ["Abs", Abs, [1.5, -2.3, 4.1]],
      ["Exp", Exp, [-1, 0.5, 2]],
      ["Ln", Ln, [0.5, 1.7, 3.2]],
      ["Sin", Sin, [-1.3, 0.7, 2.1]],
      ["Cos", Cos, [-1.3, 0.7, 2.1]],
      ["Tan", Tan, [0.4, 0.9, -0.6]],
      ["Sec", Sec, [0.4, 0.9, -0.6]],
      ["Csc", Csc, [0.4, 0.9, -0.6]],
      ["Cot", Cot, [0.4, 0.9, -0.6]],
      ["Asin", Asin, [-0.6, 0.2, 0.75]],
      ["Acos", Acos, [-0.6, 0.2, 0.75]],
      ["Atan", Atan, [-1.4, 0.5, 2.3]],
      ["Acot", Acot, [-1.4, 0.5, 2.3]],
      ["ArcSec", ArcSec, [1.5, -2.2, 3.1]],
      ["ArcCsc", ArcCsc, [1.5, -2.2, 3.1]],
      ["Sinh", Sinh, [-1.3, 0.7, 2.1]],
      ["Cosh", Cosh, [-1.3, 0.7, 2.1]],
      ["Tanh", Tanh, [-1.3, 0.7, 2.1]],
      ["Sech", Sech, [-1.3, 0.7, 2.1]],
      ["Csch", Csch, [-1.3, 0.7, 2.1]],
      ["Coth", Coth, [-1.3, 0.7, 2.1]],
      ["ArcSinh", ArcSinh, [-1.3, 0.7, 2.1]],
      ["ArcCosh", ArcCosh, [1.5, 2.8, 4.0]],
      ["ArcTanh", ArcTanh, [-0.6, 0.2, 0.75]],
      ["ArcCsch", ArcCsch, [-1.5, 0.8, 2.2]],
      ["ArcSech", ArcSech, [0.3, 0.6, 0.85]],
      ["ArcCoth", ArcCoth, [1.5, -2.3, 3.0]],
    ];

  it.each(cases)("%s", (_name, Ctor, points) => {
    for (const x of points) {
      checkGradient(new Ctor(new Name("x")), { x });
    }
  });
});

describe("unary documented-zero node types", () => {
  const cases: [name: string, Ctor: new (child: Base) => Base][] = [
    ["Ceiling", Ceiling],
    ["Floor", Floor],
    ["Factorial", Factorial],
    ["RateOf", RateOf],
  ];

  it.each(cases)("%s", (_name, Ctor) => {
    checkZeroGradient(new Ctor(new Name("x")), "x");
  });
});

describe("Log/Sqrt (base.ts-independent two-operand unary-special nodes)", () => {
  it("Log(child, base)", () => {
    for (const [child, base] of [
      [2, 10],
      [5, 3],
      [1.5, 7],
    ]) {
      checkGradient(new Log(new Name("c"), new Name("b")), { c: child, b: base });
    }
  });

  it("Sqrt(child, base)", () => {
    for (const [child, base] of [
      [4, 2],
      [9, 3],
      [2.5, 2.7],
    ]) {
      checkGradient(new Sqrt(new Name("c"), new Name("b")), { c: child, b: base });
    }
  });
});

describe("binary node types", () => {
  it("Pow(left, right)", () => {
    for (const [left, right] of [
      [2, 3],
      [1.5, 2.2],
      [3, 0.5],
    ]) {
      checkGradient(new Pow(new Name("a"), new Name("b")), { a: left, b: right });
    }
  });

  it("Implies — boolean-valued, zero for both operands", () => {
    const expr = new Implies(new Name("a"), new Name("b"));
    checkZeroGradient(expr, "a");
    checkZeroGradient(expr, "b");
  });
});

describe("n-ary arithmetic node types", () => {
  const env = { a: 1.5, b: -2, c: 3.7 };

  it("Add", () => {
    checkGradient(new Add([new Name("a"), new Name("b"), new Name("c")]), env);
  });

  it("Minus — negation (single child)", () => {
    checkGradient(new Minus([new Name("a")]), env);
  });

  it("Minus — subtraction (multiple children)", () => {
    checkGradient(new Minus([new Name("a"), new Name("b"), new Name("c")]), env);
  });

  it("Mul", () => {
    checkGradient(new Mul([new Name("a"), new Name("b"), new Name("c")]), env);
  });

  it("Divide — two children", () => {
    checkGradient(new Divide([new Name("a"), new Name("b")]), env);
  });

  it("Divide — three children", () => {
    checkGradient(new Divide([new Name("a"), new Name("b"), new Name("c")]), {
      a: 5,
      b: 2,
      c: -1.5,
    });
  });

  it("Rem — two children", () => {
    // 7.3 % 3 = 1.3, well clear of the jump at the next multiple of 3.
    checkGradient(new Rem([new Name("a"), new Name("b")]), { a: 7.3, b: 3 });
  });

  it("Rem — three children (folded)", () => {
    checkGradient(new Rem([new Name("a"), new Name("b"), new Name("c")]), {
      a: 17.3,
      b: 5,
      c: 3,
    });
  });

  it("IntDivide — piecewise-constant, documented zero", () => {
    const expr = new IntDivide([new Name("a"), new Name("b")]);
    checkZeroGradient(expr, "a");
    checkZeroGradient(expr, "b");
  });
});

describe("Max/Min — branch-selection gradient", () => {
  const env = { a: 1.5, b: 3.2, c: 2.1 }; // b is the max, a is the min — no ties.

  it("Max routes the gradient only to the winning child", () => {
    checkGradient(new Max([new Name("a"), new Name("b"), new Name("c")]), env);
  });

  it("Min routes the gradient only to the winning child", () => {
    checkGradient(new Min([new Name("a"), new Name("b"), new Name("c")]), env);
  });
});

describe("Piecewise — gradient follows the taken branch only", () => {
  function buildExpr(): Base {
    // a > 0 ? 2a : 3a — condition and both branches all reference `a`, so
    // this exercises both the branch-gating and the "condition gets no
    // gradient" convention at once.
    return new Piecewise([
      new Mul([new Num(2), new Name("a")]),
      new GreaterThan([new Name("a"), new Num(0)]),
      new Mul([new Num(3), new Name("a")]),
    ]);
  }

  it("takes the first branch when its condition holds", () => {
    checkGradient(buildExpr(), { a: 2 });
  });

  it("takes the otherwise branch when the condition doesn't hold", () => {
    checkGradient(buildExpr(), { a: -2 });
  });
});

describe("comparison/boolean node types — all documented zero", () => {
  const cases: [name: string, expr: Base][] = [
    ["And", new And([new Name("a"), new Name("b")])],
    ["Not", new Not([new Name("a")])],
    ["Or", new Or([new Name("a"), new Name("b")])],
    ["Xor", new Xor([new Name("a"), new Name("b")])],
    ["Eq", new Eq([new Name("a"), new Name("b")])],
    ["GreaterEqual", new GreaterEqual([new Name("a"), new Name("b")])],
    ["GreaterThan", new GreaterThan([new Name("a"), new Name("b")])],
    ["LessEqual", new LessEqual([new Name("a"), new Name("b")])],
    ["LessThan", new LessThan([new Name("a"), new Name("b")])],
    ["NotEqual", new NotEqual([new Name("a"), new Name("b")])],
  ];

  it.each(cases)("%s", (_name, expr) => {
    checkZeroGradient(expr, "a");
    checkZeroGradient(expr, "b");
  });
});

describe("Name/Num/Pi/E/Bool — leaf accumulation and constants", () => {
  it("Name accumulates every contribution that reaches it", () => {
    // x + x: two separate contributions to the same symbol must sum to 2.
    const expr = new Add([new Name("x"), new Name("x")]);
    checkGradient(expr, { x: 3 });
  });

  it("constants contribute nothing", () => {
    checkZeroGradient(new Num(5), "x");
  });
});
