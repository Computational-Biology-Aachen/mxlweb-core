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
  Base,
  Bool,
  Ceiling,
  Cos,
  Cosh,
  Cot,
  Coth,
  Csc,
  Csch,
  Divide,
  E,
  Eq,
  Exp,
  Factorial,
  Floor,
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
  Pi,
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

/**
 * A production build minifies/mangles class names (esbuild's default minifier
 * renames classes unless `keepNames` is set). `Base.toTs`/`toJson`/`getCtors`
 * must therefore never depend on `this.constructor.name` — the emitted
 * identifiers have to survive whatever the consuming site's bundler does to
 * the class's runtime `.name`. This file simulates that by renaming every
 * node constructor before exercising it.
 */
function mangle(ctor: new (...args: never[]) => unknown): void {
  Object.defineProperty(ctor, "name", { value: "MANGLED", configurable: true });
}

const leaf = new Name("x");

type Case = [name: string, ctor: new (...args: never[]) => Base];

const NULLARY_NO_ARGS: Case[] = [
  ["Pi", Pi],
  ["E", E],
];
const NULLARY_WITH_ARGS: [
  name: string,
  node: Base,
  ctor: new (...args: never[]) => Base,
][] = [
  ["Name", new Name("x"), Name],
  ["Num", new Num(1), Num],
  ["Bool", new Bool(true), Bool],
];
const UNARY: Case[] = [
  ["Abs", Abs],
  ["Ceiling", Ceiling],
  ["Exp", Exp],
  ["Factorial", Factorial],
  ["Floor", Floor],
  ["Ln", Ln],
  ["Sin", Sin],
  ["Cos", Cos],
  ["Tan", Tan],
  ["Sec", Sec],
  ["Csc", Csc],
  ["Cot", Cot],
  ["Asin", Asin],
  ["Acos", Acos],
  ["Atan", Atan],
  ["Acot", Acot],
  ["ArcSec", ArcSec],
  ["ArcCsc", ArcCsc],
  ["Sinh", Sinh],
  ["Cosh", Cosh],
  ["Tanh", Tanh],
  ["Sech", Sech],
  ["Csch", Csch],
  ["Coth", Coth],
  ["ArcSinh", ArcSinh],
  ["ArcCosh", ArcCosh],
  ["ArcTanh", ArcTanh],
  ["ArcCsch", ArcCsch],
  ["ArcSech", ArcSech],
  ["ArcCoth", ArcCoth],
  ["RateOf", RateOf],
];
const BINARY: Case[] = [
  ["Pow", Pow],
  ["Implies", Implies],
];
const NARY: Case[] = [
  ["Max", Max],
  ["Min", Min],
  ["Piecewise", Piecewise],
  ["Rem", Rem],
  ["And", And],
  ["Not", Not],
  ["Or", Or],
  ["Xor", Xor],
  ["Eq", Eq],
  ["GreaterEqual", GreaterEqual],
  ["GreaterThan", GreaterThan],
  ["LessEqual", LessEqual],
  ["LessThan", LessThan],
  ["NotEqual", NotEqual],
  ["Add", Add],
  ["Minus", Minus],
  ["Mul", Mul],
  ["Divide", Divide],
  ["IntDivide", IntDivide],
];

describe("node identity survives constructor-name mangling", () => {
  it.each(NULLARY_NO_ARGS)("%s (nullary, no args)", (name, Ctor) => {
    mangle(Ctor);
    const node = new Ctor();
    expect(node.toTs()).toBe(`new ${name}()`);
    expect(node.toJson()).toEqual({ type: name });
    expect(node.getCtors(new Set())).toEqual(new Set([name]));
  });

  it.each(NULLARY_WITH_ARGS)("%s (nullary, with args)", (name, node, Ctor) => {
    mangle(Ctor);
    expect(node.getCtors(new Set())).toEqual(new Set([name]));
    expect((node.toJson() as { type: string }).type).toBe(name);
  });

  it.each(UNARY)("%s (unary)", (name, Ctor) => {
    mangle(Ctor);
    const node = new Ctor(leaf);
    expect(node.toTs()).toBe(`new ${name}(new Name("x"))`);
    expect(node.toJson()).toEqual({
      type: name,
      child: { type: "Name", value: "x" },
    });
    expect(node.getCtors(new Set())).toEqual(new Set([name, "Name"]));
  });

  it.each(BINARY)("%s (binary)", (name, Ctor) => {
    mangle(Ctor);
    const node = new Ctor(leaf, new Num(2));
    expect(node.toTs()).toBe(`new ${name}(new Name("x"), new Num(2))`);
    expect(node.toJson()).toEqual({
      type: name,
      left: { type: "Name", value: "x" },
      right: { type: "Num", value: 2 },
    });
    expect(node.getCtors(new Set())).toEqual(new Set([name, "Name", "Num"]));
  });

  it.each(NARY)("%s (n-ary)", (name, Ctor) => {
    mangle(Ctor);
    const node = new Ctor([leaf]);
    expect(node.toTs()).toBe(`new ${name}([new Name("x")])`);
    expect(node.toJson()).toEqual({
      type: name,
      children: [{ type: "Name", value: "x" }],
    });
    expect(node.getCtors(new Set())).toEqual(new Set([name, "Name"]));
  });

  it("Log (child, base)", () => {
    mangle(Log);
    const node = new Log(leaf, new Num(10));
    expect(node.toTs()).toBe(`new Log(new Name("x"), new Num(10))`);
    expect(node.toJson()).toEqual({
      type: "Log",
      child: { type: "Name", value: "x" },
      base: { type: "Num", value: 10 },
    });
    expect(node.getCtors(new Set())).toEqual(new Set(["Log", "Name", "Num"]));
  });

  it("Sqrt (child, base)", () => {
    mangle(Sqrt);
    const node = new Sqrt(leaf, new Num(2));
    expect(node.toTs()).toBe(`new Sqrt(new Name("x"), new Num(2))`);
    expect(node.toJson()).toEqual({
      type: "Sqrt",
      child: { type: "Name", value: "x" },
      base: { type: "Num", value: 2 },
    });
    expect(node.getCtors(new Set())).toEqual(new Set(["Sqrt", "Name", "Num"]));
  });
});
