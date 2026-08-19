import { Base, type GradMap, Num } from "./base.js";
import { Add, Minus, Mul } from "./nary.js";

/**
 * Reverse-mode sensitivity (ADR 0005, mxlweb repo, §2.2/§2.2.1). Every concrete
 * node type implements {@link Base.pushGradient}: given the symbolic adjoint
 * expression flowing *into* this node (i.e. d(loss)/d(this node's value), as a
 * `Base` expression — not a number, since this builds a derivative *AST*, the
 * same shape any other codegen target already builds), it pushes the
 * correspondingly chain-rule-transformed adjoint into each child it structurally
 * depends on. `Name` is where accumulation actually lands, via `grads`.
 *
 * This is a two-pass graph walk exactly like PyTorch/JAX's internal autodiff —
 * not textual symbolic differentiation — so it needs no simplifier/CSE pass:
 * `mulAdjoint`/`negAdjoint` below fold away the handful of trivial identities
 * (`× 1`, `× 0`, `- (- x)`) that would otherwise clutter generated expressions,
 * but nothing more elaborate than that.
 *
 * This module and `nary.ts` import each other (`nary.ts`'s node classes need
 * `mulAdjoint`/`negAdjoint` to build their own `pushGradient` rules; this
 * module needs `Add`/`Minus`/`Mul`/`Num` to build gradient expressions at
 * all). That's a genuine ES module cycle, not an oversight — and a safe one:
 * every reference on both sides is inside a function/method body, never at
 * module top-level, so by the time any of this code actually *runs* the
 * whole module graph has finished loading and every class is defined. Only
 * top-level circular references (e.g. a class field initializer referencing
 * the other module) would be unsafe here; nothing in either module does that.
 *
 * `gradient()` is a single-expression-tree utility for testing `pushGradient`
 * against finite differences in isolation — *not* the full multi-equation,
 * intermediate-sharing graph orchestration a real model's adjoint WAT needs
 * (topological walk across a whole system of reactions/derived quantities,
 * shared via named intermediates like `wat-codegen.ts` already does for the
 * forward pass). That orchestration is deliberately out of scope here; see
 * ADR 0005 §4.
 */

/**
 * `adjoint * factor`, folding away the identities that come up constantly in
 * chain-rule application: `factor` of `1` (the overwhelming majority of
 * `Add`'s children, `Divide`'s first child, ...) returns `adjoint` unchanged
 * instead of wrapping it in a no-op `Mul`; `factor` of `0` (documented-zero
 * rules, §2.2.1) short-circuits to `Num(0)` without even walking `adjoint`.
 */
export function mulAdjoint(adjoint: Base, factor: Base): Base {
  if (factor instanceof Num) {
    if (factor.value === 1) return adjoint;
    if (factor.value === 0) return new Num(0);
    if (factor.value === -1) return negAdjoint(adjoint);
  }
  return new Mul([adjoint, factor]);
}

/** `-adjoint`, collapsing double negation (`negAdjoint` composed with itself). */
export function negAdjoint(adjoint: Base): Base {
  if (adjoint instanceof Minus && adjoint.children.length === 1) {
    return adjoint.children[0];
  }
  if (adjoint instanceof Num) return new Num(-adjoint.value);
  return new Minus([adjoint]);
}

/**
 * Gradient of a single expression tree `expr` with respect to each name in
 * `wrt`, as symbolic `Base` expressions (one `Add` of every contribution that
 * reached that name, or a literal `Num(0)` if none did). Seeds the backward
 * pass with `d(expr)/d(expr) = 1`.
 *
 * Testing utility only — see this module's doc comment.
 */
export function gradient(expr: Base, wrt: string[]): Map<string, Base> {
  const grads: GradMap = new Map();
  expr.pushGradient(new Num(1), grads);

  const result = new Map<string, Base>();
  for (const name of wrt) {
    const contributions = grads.get(name);
    if (!contributions || contributions.length === 0) {
      result.set(name, new Num(0));
    } else if (contributions.length === 1) {
      result.set(name, contributions[0]);
    } else {
      result.set(name, new Add(contributions));
    }
  }
  return result;
}
