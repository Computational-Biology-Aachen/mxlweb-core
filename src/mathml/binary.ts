import type { WatContext } from "../backends/wasm/wat-context.js";
import { Base, Binary, Name } from "./base.js";

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
}
