/**
 * Tests for the UDE/NODE correction-term generator (ADR 0005 §2.1, `nnBlock.ts`).
 */
import type { Base } from "@computational-biology-aachen/mxlweb-core/mathml";
import { gradient, Name } from "@computational-biology-aachen/mxlweb-core/mathml";
import { buildNNBlock, type NNBlockSpec } from "@computational-biology-aachen/mxlweb-core";
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

describe("buildNNBlock: architecture", () => {
  const spec: NNBlockSpec = {
    name: "corr",
    inputs: ["a", "b"],
    depth: 2,
    width: 3,
    outputs: 1,
    seed: 42,
  };

  it("produces the expected parameter count", () => {
    // layer0 (2 in -> 3 out): 3*2 + 3 = 9
    // layer1 hidden->hidden (3 -> 3): 3*3 + 3 = 12
    // output layer (3 -> 1): 1*3 + 1 = 4
    const { parameters } = buildNNBlock(spec);
    expect(parameters.size).toBe(9 + 12 + 4);
  });

  it("produces one output expression", () => {
    const { outputs } = buildNNBlock(spec);
    expect(outputs).toHaveLength(1);
  });

  it("names every parameter under the block's namespace, with no collisions", () => {
    const { parameters } = buildNNBlock(spec);
    for (const name of parameters.keys()) {
      expect(name.startsWith("corr_")).toBe(true);
    }
    expect(new Set(parameters.keys()).size).toBe(parameters.size);
  });

  it("initializes every bias to exactly zero", () => {
    const { parameters } = buildNNBlock(spec);
    for (const [name, p] of parameters) {
      if (name.includes("_b")) expect(p.value).toBe(0);
    }
  });

  it("gives every parameter its own texName, not just a displayName", () => {
    // Generated names have multiple underscores (${key}_w${layer}_${i}_${j});
    // Name.toTex falls back to the raw identifier whenever no texName is
    // registered, and KaTeX parses two bare underscores as a "Double
    // subscript" error. Every generated weight/bias needs a safe texName
    // from the moment it's created — not only once some UI layer gets
    // around to synthesizing one, since the live "Generated LaTeX" preview
    // renders straight from this generator before any such pass ever runs.
    const { parameters } = buildNNBlock(spec);
    for (const [name, p] of parameters) {
      expect(p.texName, `${name} has no texName`).toBeTruthy();
      expect(p.texName!.startsWith("\\text{")).toBe(true);
    }
  });

  it("scales parameter count with depth and width (6x64-style block stays tractable to build)", () => {
    const big = buildNNBlock({
      name: "flux",
      inputs: ["x"],
      depth: 6,
      width: 64,
      outputs: 1,
      seed: 1,
    });
    // layer0: 64*1+64=128; 5x hidden->hidden: 5*(64*64+64)=20800; output: 1*64+1=65
    expect(big.parameters.size).toBe(128 + 20800 + 65);
  });
});

describe("buildNNBlock: reproducibility", () => {
  const spec: NNBlockSpec = {
    name: "corr",
    inputs: ["a"],
    depth: 1,
    width: 4,
    outputs: 1,
    seed: 7,
  };

  it("the same seed produces identical weights", () => {
    const first = buildNNBlock(spec);
    const second = buildNNBlock(spec);
    for (const [name, p] of first.parameters) {
      expect(second.parameters.get(name)?.value).toBe(p.value);
    }
  });

  it("a different seed produces different weights", () => {
    const first = buildNNBlock(spec);
    const second = buildNNBlock({ ...spec, seed: 8 });
    const anyDiffers = [...first.parameters.entries()].some(
      ([name, p]) => second.parameters.get(name)?.value !== p.value,
    );
    expect(anyDiffers).toBe(true);
  });
});

describe("buildNNBlock: softplus numerical stability (ADR 0005 §2.1.1)", () => {
  it("stays finite for a large-magnitude input, unlike naive ln(1+exp(x))", () => {
    // A single-input, single-hidden-unit, linear-output block with weight 1
    // and bias 0 reduces to exactly softplus(input) at the hidden unit, fed
    // through a (likely nonzero) linear output weight — either way, no
    // Infinity/NaN should appear even for an extreme input.
    const { parameters, outputs } = buildNNBlock({
      name: "s",
      inputs: ["x"],
      depth: 1,
      width: 1,
      outputs: 1,
      seed: 3,
    });
    // Force the hidden unit's weight/bias to the identity (weight=1, bias=0)
    // so the hidden pre-activation is exactly `x`, isolating softplus itself.
    // Force the output layer to the identity too (weight=1, bias=0), so the
    // final value is exactly softplus(x) — otherwise the finite output
    // weight would already keep the result bounded/finite on its own,
    // regardless of whether softplus itself overflowed internally.
    parameters.set("s_w0_0_0", { value: 1 });
    parameters.set("s_b0_0", { value: 0 });
    parameters.set("s_w1_0_0", { value: 1 });
    parameters.set("s_b1_0", { value: 0 });
    const env: Record<string, number> = { x: 1000 };
    for (const [name, p] of parameters) env[name] = p.value;
    const value = evalExpr(outputs[0], env);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeCloseTo(1000, 3); // softplus(1000) ≈ 1000, not Infinity
  });
});

describe("buildNNBlock: generated output is a valid, differentiable expression", () => {
  it("gradient w.r.t. an input and w.r.t. a generated weight both match finite differences", () => {
    // Integration test tying nnBlock.ts to the pushGradient work: the whole
    // point of ADR 0005 §2.1 is that a generated block needs no NN-specific
    // differentiation code — it should differentiate correctly using only
    // the per-node backward rules already implemented for Add/Mul/Name/
    // Max/Abs/Exp/Ln (stableSoftplus's primitives).
    const { parameters, outputs } = buildNNBlock({
      name: "n",
      inputs: ["x"],
      depth: 2,
      width: 3,
      outputs: 1,
      seed: 11,
    });
    const expr = outputs[0];

    const env: Record<string, number> = { x: 0.6 };
    for (const [name, p] of parameters) env[name] = p.value;

    // Checking every parameter's gradient would be slow and redundant (the
    // per-node rules are already exhaustively tested); spot-check the input
    // plus a couple of representative weights from different layers.
    const wrt = ["x", "n_w0_0_0", "n_w1_1_2", "n_w2_0_1"];
    const grads = gradient(expr, wrt);
    for (const name of wrt) {
      const symbolic = evalExpr(grads.get(name)!, env);
      const numeric = centralDiff(expr, env, name);
      expect(symbolic).toBeCloseTo(numeric, 3);
    }
  });
});

describe("buildNNBlock: input wiring", () => {
  it("references each named input via Name, not a copy of its value", () => {
    const { outputs } = buildNNBlock({
      name: "n",
      inputs: ["conc"],
      depth: 1,
      width: 2,
      outputs: 1,
      seed: 5,
    });
    const symbols = outputs[0].getSymbols(new Set<string>());
    expect(symbols.has("conc")).toBe(true);
    // Sanity: Name("conc") really does appear as a leaf, not just textually.
    expect(new Name("conc").getSymbols(new Set())).toEqual(new Set(["conc"]));
  });
});
