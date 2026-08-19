import type { WatContext } from "../backends/wasm/wat-context.js";
import { Base, Binary, E, type GradMap, Name, Num } from "./base.js";
import { mulAdjoint } from "./grad.js";
import { Minus, Mul } from "./nary.js";
import { Log } from "./unary-special.js";

/**
 * Two-operand expression nodes. See {@link Base} for the serialiser contract and
 * `base.ts` for the {@link Binary} superclass.
 *
 * @module
 */

///////////////////////////////////////////////////////////////////////////////
// Binary fns
///////////////////////////////////////////////////////////////////////////////

/** Exponentiation, `left ** right`. */
export class Pow extends Binary {
  readonly nodeType = "Pow";
  constructor(
    public left: Base,
    public right: Base,
  ) {
    super();
  }
  default(): Pow {
    return new Pow(Name.prototype.default(), Name.prototype.default());
  }

  toJs(): string {
    return `(${this.left.toJs()}) ** (${this.right.toJs()})`;
  }

  toPy(displayNames: Map<string, string>): string {
    return `(${this.left.toPy(displayNames)}) ** (${this.right.toPy(displayNames)})`;
  }

  toTex(texNames: Map<string, string>): string {
    return `{${this.left.toTex(texNames)}}^{${this.right.toTex(texNames)}}`;
  }

  toSBML(): string {
    return `<apply><power/>${this.left.toSBML()}${this.right.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_pow ${this.left.toWat(ctx)} ${this.right.toWat(ctx)})`;
  }
  /**
   * d/dleft[left^right] = right · left^(right-1) (ordinary power rule,
   * `right` doesn't need to be constant — each child gets its own
   * independent local-partial contribution regardless). d/dright =
   * left^right · ln(left) (exponential rule) — `ln(left)` is `Log(left,
   * E())` rather than `unary.ts`'s `Ln`, to keep this module out of that
   * one's dependency chain (matching `unary-special.ts`'s own choice, for
   * the same reason).
   */
  pushGradient(adjoint: Base, grads: GradMap): void {
    const leftFactor = new Mul([
      this.right,
      new Pow(this.left, new Minus([this.right, new Num(1)])),
    ]);
    this.left.pushGradient(mulAdjoint(adjoint, leftFactor), grads);

    const rightFactor = new Mul([
      new Pow(this.left, this.right),
      new Log(this.left, new E()),
    ]);
    this.right.pushGradient(mulAdjoint(adjoint, rightFactor), grads);
  }
}

/** Logical implication, `left ⇒ right` (i.e. `!left || right`). */
export class Implies extends Binary {
  readonly nodeType = "Implies";
  constructor(
    public left: Base,
    public right: Base,
  ) {
    super();
  }
  default(): Implies {
    return new Implies(Name.prototype.default(), Name.prototype.default());
  }

  toJs(): string {
    return `(!(${this.left.toJs()}) || (${this.right.toJs()}))`;
  }

  toPy(displayNames: Map<string, string>): string {
    return `((not ${this.left.toPy(displayNames)}) or (${this.right.toPy(displayNames)}))`;
  }

  toTex(texNames: Map<string, string>): string {
    return `${this.left.toTex(texNames)} \\Rightarrow ${this.right.toTex(texNames)}`;
  }

  toSBML(): string {
    return `<apply><implies/>${this.left.toSBML()}${this.right.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(i32.or (i32.eqz ${this.left.toWat(ctx)}) ${this.right.toWat(ctx)})`;
  }
  /** Boolean-valued; a truth value doesn't vary smoothly with its operands (ADR 0005 §2.2.1, same convention as `nary.ts`'s comparison/boolean nodes). */
  pushGradient(_adjoint: Base, _grads: GradMap): void {}
}
