import type { WatContext } from "../backends/wasm/wat-context.js";
import { Base, type GradMap, Nary, Num } from "./base.js";
import { mulAdjoint, negAdjoint } from "./grad.js";

/**
 * Variadic operator nodes: arithmetic (`+`, `-`, `*`, `/`, integer division,
 * remainder), comparisons (`=`, `<`, `>`, `≤`, `≥`, `≠`), logical connectives
 * (`and`, `or`, `not`, `xor`, `implies`), `min`/`max`, and SBML `piecewise`.
 * Each holds a `children` array; the serialisers fold over it (chained
 * comparisons expand to pairwise conjunctions). See {@link Base} for the
 * serialiser contract.
 *
 * @module
 */

///////////////////////////////////////////////////////////////////////////////
// n-ary fns
///////////////////////////////////////////////////////////////////////////////

/** Maximum of all children (empty ⇒ -∞). */
export class Max extends Nary {
  readonly nodeType = "Max";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    return `Math.max(${this.children.map((c) => c.toJs()).join(", ")})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `max(${this.children.map((c) => c.toPy(displayNames)).join(", ")})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\max(${this.children.map((c) => c.toTex(texNames)).join(", ")})`;
  }
  toSBML(): string {
    return `<apply><max/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const -inf)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(call $math_max ${a} ${b})`);
  }
  pushGradient(adjoint: Base, grads: GradMap): void {
    // Route the adjoint only to whichever child(ren) actually achieved the
    // max — the standard lax.cond/jnp.where-style subgradient rule. Built as
    // a runtime-evaluated indicator (Piecewise), since which child wins
    // depends on values only known when the model is actually solved, not
    // at codegen time. Ties get credit on every side that's tied, not just
    // the first — a defensible, simpler convention than picking one.
    for (let i = 0; i < this.children.length; i++) {
      const others = this.children.filter((_, j) => j !== i);
      const isMax = new And(
        others.map((o) => new GreaterEqual([this.children[i], o])),
      );
      const indicator = new Piecewise([new Num(1), isMax, new Num(0)]);
      this.children[i].pushGradient(mulAdjoint(adjoint, indicator), grads);
    }
  }
}

/** Minimum of all children (empty ⇒ +∞). */
export class Min extends Nary {
  readonly nodeType = "Min";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    return `Math.min(${this.children.map((c) => c.toJs()).join(", ")})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `min(${this.children.map((c) => c.toPy(displayNames)).join(", ")})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\min(${this.children.map((c) => c.toTex(texNames)).join(", ")})`;
  }
  toSBML(): string {
    return `<apply><min/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const inf)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(call $math_min ${a} ${b})`);
  }
  /** Mirror of {@link Max.pushGradient} with the comparison direction flipped. */
  pushGradient(adjoint: Base, grads: GradMap): void {
    for (let i = 0; i < this.children.length; i++) {
      const others = this.children.filter((_, j) => j !== i);
      const isMin = new And(
        others.map((o) => new LessEqual([this.children[i], o])),
      );
      const indicator = new Piecewise([new Num(1), isMin, new Num(0)]);
      this.children[i].pushGradient(mulAdjoint(adjoint, indicator), grads);
    }
  }
}

/**
 * SBML piecewise expression. Children alternate `value, condition, value,
 * condition, …` with an optional trailing `value` as the otherwise-case; the
 * result is the first value whose condition holds.
 */
export class Piecewise extends Nary {
  readonly nodeType = "Piecewise";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    const otherwise =
      this.children.length % 2 === 1
        ? this.children[this.children.length - 1].toJs()
        : "NaN";
    let result = otherwise;
    for (
      let i = this.children.length - (this.children.length % 2 === 1 ? 3 : 2);
      i >= 0;
      i -= 2
    ) {
      const val = this.children[i].toJs();
      const cond = this.children[i + 1].toJs();
      result = `(${cond} ? ${val} : ${result})`;
    }
    return result;
  }
  toPy(displayNames: Map<string, string>): string {
    const parts: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i += 2) {
      parts.push(
        `${this.children[i].toPy(displayNames)} if ${this.children[i + 1].toPy(displayNames)}`,
      );
    }
    const otherwise =
      this.children.length % 2 === 1
        ? this.children[this.children.length - 1].toPy(displayNames)
        : "float('nan')";
    const expr =
      parts.join(" else ") +
      (parts.length > 0 ? ` else ${otherwise}` : otherwise);
    return `(${expr})`;
  }
  toTex(texNames: Map<string, string>): string {
    const parts: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i += 2) {
      parts.push(
        `${this.children[i].toTex(texNames)} & ${this.children[i + 1].toTex(texNames)}`,
      );
    }
    if (this.children.length % 2 === 1) {
      parts.push(
        `${this.children[this.children.length - 1].toTex(texNames)} & \\text{else}`,
      );
    }
    return `\\begin{cases}${parts.join(" \\\\ ")}\\end{cases}`;
  }
  toSBML(): string {
    const parts: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i += 2) {
      parts.push(
        `<piece>${this.children[i].toSBML()}${this.children[i + 1].toSBML()}</piece>`,
      );
    }
    if (this.children.length % 2 === 1) {
      parts.push(
        `<otherwise>${this.children[this.children.length - 1].toSBML()}</otherwise>`,
      );
    }
    return `<piecewise>${parts.join("")}</piecewise>`;
  }
  toWat(ctx: WatContext): string {
    const otherwise =
      this.children.length % 2 === 1
        ? this.children[this.children.length - 1].toWat(ctx)
        : `(f64.const 0)`;
    let result = otherwise;
    const lastPair =
      this.children.length % 2 === 1
        ? this.children.length - 3
        : this.children.length - 2;
    for (let i = lastPair; i >= 0; i -= 2) {
      const val = this.children[i].toWat(ctx);
      const cond = this.children[i + 1].toWat(ctx);
      result = `(if (result f64) ${cond} (then ${val}) (else ${result}))`;
    }
    return result;
  }
  pushGradient(adjoint: Base, grads: GradMap): void {
    // Gate the adjoint by "was this branch actually the one taken" (its own
    // condition true AND every earlier condition false, matching toWat's
    // first-true-wins evaluation order). Condition children get no gradient
    // at all — booleans aren't a differentiable quantity, ADR 0005 §2.2.1 —
    // so only value children are visited.
    const pairCount = Math.floor(this.children.length / 2);
    const notEarlier: Base[] = [];
    for (let i = 0; i < pairCount; i++) {
      const value = this.children[2 * i];
      const cond = this.children[2 * i + 1];
      const taken =
        notEarlier.length === 0 ? cond : new And([cond, ...notEarlier]);
      const gated = mulAdjoint(
        adjoint,
        new Piecewise([new Num(1), taken, new Num(0)]),
      );
      value.pushGradient(gated, grads);
      notEarlier.push(new Not([cond]));
    }
    if (this.children.length % 2 === 1) {
      const otherwise = this.children[this.children.length - 1];
      const gated =
        notEarlier.length === 0
          ? adjoint
          : mulAdjoint(
              adjoint,
              new Piecewise([new Num(1), new And(notEarlier), new Num(0)]),
            );
      otherwise.pushGradient(gated, grads);
    }
  }
}

/** Remainder (modulo), folded left-to-right across children. */
export class Rem extends Nary {
  readonly nodeType = "Rem";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toJs())
      .reduce((acc, cur) => `(${acc}) % (${cur})`);
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toPy(displayNames))
      .reduce((acc, cur) => `math.fmod(${acc}, ${cur})`);
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toTex(texNames))
      .reduce((acc, cur) => `(${acc}) \\bmod (${cur})`);
  }
  toSBML(): string {
    return `<apply><rem/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const 0)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(call $math_rem ${a} ${b})`);
  }
  pushGradient(adjoint: Base, grads: GradMap): void {
    // rem(a,b) = a - floor(a/b)*b is piecewise-linear with jumps at
    // multiples of b; away from those (measure-zero) jumps, d/da = 1 and
    // d/db = -floor(a/b) — the standard "almost everywhere" AD convention,
    // same spirit as Floor/Ceiling's documented zero (ADR 0005 §2.2.1).
    // -floor(a/b) = (rem(a,b) - a) / b, which avoids depending on Floor
    // itself: reuse a clone of the fold-so-far instead. The "a" branch of
    // every fold step carries a ×1 factor, so it passes through unchanged
    // all the way back to children[0] regardless of how many steps there
    // are — only each divisor needs an actual per-step contribution.
    const n = this.children.length;
    if (n === 0) return;
    if (n === 1) {
      this.children[0].pushGradient(adjoint, grads);
      return;
    }
    for (let k = n - 1; k >= 1; k--) {
      const prefix =
        k === 1 ? this.children[0] : new Rem(this.children.slice(0, k));
      const divisor = this.children[k];
      const thisStep = new Rem([prefix, divisor]);
      const negFloor = new Divide([new Minus([thisStep, prefix]), divisor]);
      divisor.pushGradient(mulAdjoint(adjoint, negFloor), grads);
    }
    this.children[0].pushGradient(adjoint, grads);
  }
}

/** Logical conjunction of all children (empty ⇒ true). */
export class And extends Nary {
  readonly nodeType = "And";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    return this.children.map((c) => c.toJs()).join(" && ");
  }
  toPy(displayNames: Map<string, string>): string {
    return this.children.map((c) => c.toPy(displayNames)).join(" and ");
  }
  toTex(texNames: Map<string, string>): string {
    return this.children.map((c) => c.toTex(texNames)).join(" \\land ");
  }
  toSBML(): string {
    return `<apply><and/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(i32.const 1)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(i32.and ${a} ${b})`);
  }
  /** Boolean-valued; a truth value doesn't vary smoothly with its operands (ADR 0005 §2.2.1). No gradient flows through. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Logical negation (of the single child, or of the conjunction of several). */
export class Not extends Nary {
  readonly nodeType = "Not";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "!false";
    if (this.children.length === 1) return `!(${this.children[0].toJs()})`;
    return `!(${this.children.map((c) => c.toJs()).join(" && ")})`;
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "not False";
    if (this.children.length === 1)
      return `not (${this.children[0].toPy(displayNames)})`;
    return `not (${this.children.map((c) => c.toPy(displayNames)).join(" and ")})`;
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\neg \\text{false}";
    if (this.children.length === 1)
      return `\\neg (${this.children[0].toTex(texNames)})`;
    return `\\neg (${this.children.map((c) => c.toTex(texNames)).join(" \\land ")})`;
  }
  toSBML(): string {
    return `<apply><not/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(i32.const 1)`;
    const inner =
      this.children.length === 1
        ? this.children[0].toWat(ctx)
        : this.children
            .map((c) => c.toWat(ctx))
            .reduce((a, b) => `(i32.and ${a} ${b})`);
    return `(i32.eqz ${inner})`;
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Logical disjunction of all children (empty ⇒ false). */
export class Or extends Nary {
  readonly nodeType = "Or";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    return this.children.map((c) => c.toJs()).join(" || ");
  }
  toPy(displayNames: Map<string, string>): string {
    return this.children.map((c) => c.toPy(displayNames)).join(" or ");
  }
  toTex(texNames: Map<string, string>): string {
    return this.children.map((c) => c.toTex(texNames)).join(" \\lor ");
  }
  toSBML(): string {
    return `<apply><or/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(i32.const 0)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(i32.or ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Exclusive-or of all children (empty ⇒ 0). */
export class Xor extends Nary {
  readonly nodeType = "Xor";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "0";
    return this.children.map((c) => `(${c.toJs()})`).join(" ^ ");
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children.map((c) => `(${c.toPy(displayNames)})`).join(" ^ ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children.map((c) => `(${c.toTex(texNames)})`).join(" \\oplus ");
  }
  toSBML(): string {
    return `<apply><xor/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(i32.const 0)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(i32.xor ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Equality across all children (pairwise `===`, all must match). */
export class Eq extends Nary {
  readonly nodeType = "Eq";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "true";
    return this.children
      .map((c) => c.toJs())
      .slice(1)
      .reduce(
        (acc, cur, idx) =>
          `(${acc}) && (${this.children[idx].toJs()} === ${cur})`,
        "true",
      );
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "True";
    return this.children.map((c) => c.toPy(displayNames)).join(" == ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\text{true}";
    return this.children.map((c) => c.toTex(texNames)).join(" = ");
  }
  toSBML(): string {
    return `<apply><eq/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length < 2) return `(i32.const 1)`;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i++) {
      pairs.push(
        `(f64.eq ${this.children[i].toWat(ctx)} ${this.children[i + 1].toWat(ctx)})`,
      );
    }
    return pairs.reduce((a, b) => `(i32.and ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Chained `≥` comparison across consecutive children. */
export class GreaterEqual extends Nary {
  readonly nodeType = "GreaterEqual";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "true";
    return this.children
      .map((c) => c.toJs())
      .slice(1)
      .reduce(
        (acc, cur, idx) =>
          `(${acc}) && (${this.children[idx].toJs()} >= ${cur})`,
        "true",
      );
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "True";
    return this.children.map((c) => c.toPy(displayNames)).join(" >= ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\text{true}";
    return this.children.map((c) => c.toTex(texNames)).join(" \\geq ");
  }
  toSBML(): string {
    return `<apply><geq/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length < 2) return `(i32.const 1)`;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i++) {
      pairs.push(
        `(f64.ge ${this.children[i].toWat(ctx)} ${this.children[i + 1].toWat(ctx)})`,
      );
    }
    return pairs.reduce((a, b) => `(i32.and ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Chained `>` comparison across consecutive children. */
export class GreaterThan extends Nary {
  readonly nodeType = "GreaterThan";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "true";
    return this.children
      .map((c) => c.toJs())
      .slice(1)
      .reduce(
        (acc, cur, idx) =>
          `(${acc}) && (${this.children[idx].toJs()} > ${cur})`,
        "true",
      );
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "True";
    return this.children.map((c) => c.toPy(displayNames)).join(" > ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\text{true}";
    return this.children.map((c) => c.toTex(texNames)).join(" > ");
  }
  toSBML(): string {
    return `<apply><gt/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length < 2) return `(i32.const 1)`;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i++) {
      pairs.push(
        `(f64.gt ${this.children[i].toWat(ctx)} ${this.children[i + 1].toWat(ctx)})`,
      );
    }
    return pairs.reduce((a, b) => `(i32.and ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Chained `≤` comparison across consecutive children. */
export class LessEqual extends Nary {
  readonly nodeType = "LessEqual";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "true";
    return this.children
      .map((c) => c.toJs())
      .slice(1)
      .reduce(
        (acc, cur, idx) =>
          `(${acc}) && (${this.children[idx].toJs()} <= ${cur})`,
        "true",
      );
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "True";
    return this.children.map((c) => c.toPy(displayNames)).join(" <= ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\text{true}";
    return this.children.map((c) => c.toTex(texNames)).join(" \\leq ");
  }
  toSBML(): string {
    return `<apply><leq/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length < 2) return `(i32.const 1)`;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i++) {
      pairs.push(
        `(f64.le ${this.children[i].toWat(ctx)} ${this.children[i + 1].toWat(ctx)})`,
      );
    }
    return pairs.reduce((a, b) => `(i32.and ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Chained `<` comparison across consecutive children. */
export class LessThan extends Nary {
  readonly nodeType = "LessThan";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "true";
    return this.children
      .map((c) => c.toJs())
      .slice(1)
      .reduce(
        (acc, cur, idx) =>
          `(${acc}) && (${this.children[idx].toJs()} < ${cur})`,
        "true",
      );
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "True";
    return this.children.map((c) => c.toPy(displayNames)).join(" < ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\text{true}";
    return this.children.map((c) => c.toTex(texNames)).join(" < ");
  }
  toSBML(): string {
    return `<apply><lt/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length < 2) return `(i32.const 1)`;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i++) {
      pairs.push(
        `(f64.lt ${this.children[i].toWat(ctx)} ${this.children[i + 1].toWat(ctx)})`,
      );
    }
    return pairs.reduce((a, b) => `(i32.and ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Inequality — true if any consecutive pair differs. */
export class NotEqual extends Nary {
  readonly nodeType = "NotEqual";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "false";
    return this.children
      .map((c) => c.toJs())
      .slice(1)
      .reduce(
        (acc, cur, idx) =>
          `(${acc}) || (${this.children[idx].toJs()} !== ${cur})`,
        "false",
      );
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "False";
    return this.children.map((c) => c.toPy(displayNames)).join(" != ");
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "\\text{false}";
    return this.children.map((c) => c.toTex(texNames)).join(" \\neq ");
  }
  toSBML(): string {
    return `<apply><neq/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length < 2) return `(i32.const 0)`;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < this.children.length; i++) {
      pairs.push(
        `(f64.ne ${this.children[i].toWat(ctx)} ${this.children[i + 1].toWat(ctx)})`,
      );
    }
    return pairs.reduce((a, b) => `(i32.or ${a} ${b})`);
  }
  /** Boolean-valued; see {@link And.pushGradient}. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}

/** Sum of all children (empty ⇒ 0). In TeX, a unary {@link Minus} child renders as subtraction. */
export class Add extends Nary {
  readonly nodeType = "Add";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    return this.children.map((c) => c.toJs()).join(" + ");
  }
  toPy(displayNames: Map<string, string>): string {
    return this.children.map((c) => c.toPy(displayNames)).join(" + ");
  }
  toTex(texNames: Map<string, string>): string {
    return this.children
      .map((c, i) => {
        if (i === 0) return c.toTex(texNames);
        if (c instanceof Minus && c.children.length === 1)
          return `- ${c.children[0].toTex(texNames)}`;
        return `+ ${c.toTex(texNames)}`;
      })
      .join(" ");
  }
  toSBML(): string {
    return `<apply><plus/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const 0)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(f64.add ${a} ${b})`);
  }
  /** d(sum)/d(child_i) = 1 for every child — the adjoint passes through unchanged to all of them. */
  pushGradient(adjoint: Base, grads: GradMap): void {
    for (const child of this.children) child.pushGradient(adjoint, grads);
  }
}

/** Subtraction, or unary negation when given a single child. */
export class Minus extends Nary {
  readonly nodeType = "Minus";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 1) {
      return `- ${this.children[0].toJs()}`;
    }
    return this.children
      .map((c) => c.toJs())
      .reduce((acc, cur) => `(${acc}) - (${cur})`);
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 1) {
      return `- ${this.children[0].toPy(displayNames)}`;
    }
    return this.children
      .map((c) => c.toPy(displayNames))
      .reduce((acc, cur) => `(${acc}) - (${cur})`);
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 1) {
      return `- ${this.children[0].toTex(texNames)}`;
    }
    return this.children.map((c) => c.toTex(texNames)).join(" - ");
  }
  toSBML(): string {
    return `<apply><minus/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const 0)`;
    if (this.children.length === 1)
      return `(f64.neg ${this.children[0].toWat(ctx)})`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(f64.sub ${a} ${b})`);
  }
  /**
   * `length === 1` is unary negation (d/dchild = -1); `length ≥ 2` is
   * left-folded subtraction `c0 - c1 - c2 - ...`, which — regardless of fold
   * grouping — has a closed-form gradient: +1 to the first child, -1 to
   * every other one (subtraction distributes: `c0-c1-c2 ≡ c0-(c1+c2)` for
   * this purpose even though the generated WAT folds pairwise).
   */
  pushGradient(adjoint: Base, grads: GradMap): void {
    if (this.children.length === 0) return;
    if (this.children.length === 1) {
      this.children[0].pushGradient(negAdjoint(adjoint), grads);
      return;
    }
    this.children[0].pushGradient(adjoint, grads);
    const negated = negAdjoint(adjoint);
    for (let i = 1; i < this.children.length; i++) {
      this.children[i].pushGradient(negated, grads);
    }
  }
}

/** Product of all children (empty ⇒ 1). Sum/difference children are parenthesised. */
export class Mul extends Nary {
  readonly nodeType = "Mul";
  public constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    return this.children
      .map((c) => {
        const s = c.toJs();
        return c instanceof Add || c instanceof Minus ? `(${s})` : s;
      })
      .join(" * ");
  }
  toPy(displayNames: Map<string, string>): string {
    return this.children
      .map((c) => {
        const s = c.toPy(displayNames);
        return c instanceof Add || c instanceof Minus ? `(${s})` : s;
      })
      .join(" * ");
  }
  toTex(texNames: Map<string, string>): string {
    return this.children
      .map((c) => {
        const s = c.toTex(texNames);
        return c instanceof Add || c instanceof Minus ? `(${s})` : s;
      })
      .join(" \\cdot ");
  }
  toSBML(): string {
    return `<apply><times/>${this.children.map((c) => c.toSBML()).join("")}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const 1)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(f64.mul ${a} ${b})`);
  }
  /** Standard product rule: d(product)/d(child_i) = product of every *other* child (`1` if there are none, matching an empty product). */
  pushGradient(adjoint: Base, grads: GradMap): void {
    for (let i = 0; i < this.children.length; i++) {
      const others = this.children.filter((_, j) => j !== i);
      const factor =
        others.length === 0
          ? new Num(1)
          : others.length === 1
            ? others[0]
            : new Mul(others);
      this.children[i].pushGradient(mulAdjoint(adjoint, factor), grads);
    }
  }
}

/** Division, folded left-to-right across children (empty ⇒ 0). */
export class Divide extends Nary {
  readonly nodeType = "Divide";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toJs())
      .reduce((acc, cur) => `(${acc}) / (${cur})`);
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toPy(displayNames))
      .reduce((acc, cur) => `(${acc}) / (${cur})`);
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toTex(texNames))
      .reduce((acc, cur) => `\\frac{${acc}}{${cur}}`);
  }
  toSBML(): string {
    if (this.children.length === 0) return "<cn>0</cn>";
    return this.children
      .map((c) => c.toSBML())
      .reduce((acc, cur) => `<apply><divide/>${acc}${cur}</apply>`);
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const 0)`;
    return this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(f64.div ${a} ${b})`);
  }
  /**
   * Left-folded division `c0/c1/c2/.../cn` equals `c0/(c1·c2·...·cn)`
   * regardless of fold grouping (a true algebraic identity), so: d/dc0 =
   * `1/(c1·...·cn)`, and d/dc_i (i≥1) = `-whole/c_i` (quotient rule). `whole`
   * is a fresh clone of this entire expression — a bounded, local
   * recomputation (this one node's own forward value, not a repeated deep
   * subtree), not the unbounded blowup naive symbolic diff risks.
   */
  pushGradient(adjoint: Base, grads: GradMap): void {
    const n = this.children.length;
    if (n === 0) return;
    if (n === 1) {
      this.children[0].pushGradient(adjoint, grads);
      return;
    }
    const rest = this.children.slice(1);
    const denom = rest.length === 1 ? rest[0] : new Mul(rest);
    this.children[0].pushGradient(
      mulAdjoint(adjoint, new Divide([new Num(1), denom])),
      grads,
    );
    const whole = new Divide(this.children);
    for (let i = 1; i < n; i++) {
      const factor = negAdjoint(new Divide([whole, this.children[i]]));
      this.children[i].pushGradient(mulAdjoint(adjoint, factor), grads);
    }
  }
}

/** Integer (truncating/floor) division, folded left-to-right across children. */
export class IntDivide extends Nary {
  readonly nodeType = "IntDivide";
  constructor(public children: Base[]) {
    super();
  }
  toJs(): string {
    if (this.children.length === 0) return "0";
    const expr = this.children
      .map((c) => c.toJs())
      .reduce((acc, cur) => `(${acc}) / (${cur})`);
    return `Math.trunc(${expr})`;
  }
  toPy(displayNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toPy(displayNames))
      .reduce((acc, cur) => `math.trunc((${acc}) / (${cur}))`);
  }
  toTex(texNames: Map<string, string>): string {
    if (this.children.length === 0) return "0";
    return this.children
      .map((c) => c.toTex(texNames))
      .reduce(
        (acc, cur) => `\\left\\lfloor\\frac{${acc}}{${cur}}\\right\\rfloor`,
      );
  }
  toSBML(): string {
    if (this.children.length === 0) return "<cn>0</cn>";
    const divided = this.children
      .map((c) => c.toSBML())
      .reduce((acc, cur) => `<apply><divide/>${acc}${cur}</apply>`);
    return `<apply><floor/>${divided}</apply>`;
  }
  toWat(ctx: WatContext): string {
    if (this.children.length === 0) return `(f64.const 0)`;
    const divided = this.children
      .map((c) => c.toWat(ctx))
      .reduce((a, b) => `(f64.div ${a} ${b})`);
    return `(f64.trunc ${divided})`;
  }
  /** Piecewise-constant (truncated), same convention as Floor/Ceiling (ADR 0005 §2.2.1): zero almost everywhere, undefined only at the measure-zero jump points. */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}
