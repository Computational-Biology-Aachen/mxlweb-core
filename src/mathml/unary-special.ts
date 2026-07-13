import type { WatContext } from "../backends/wasm/wat-context.js";
import { Base, type JsonNode, Name, Num, reviveNode } from "./base.js";

/**
 * Unary functions that also carry a second, base/degree operand and therefore
 * extend {@link Base} directly rather than the single-child `Unary` class. See
 * {@link Base} for the serialiser contract.
 *
 * @module
 */

///////////////////////////////////////////////////////////////////////////////
// Special unary fns
///////////////////////////////////////////////////////////////////////////////

/** Logarithm of `child` to an arbitrary `base` (defaults to base 10). */
export class Log extends Base {
  readonly nodeType = "Log";
  constructor(
    public child: Base,
    public base: Base,
  ) {
    super();
  }
  default(): Log {
    return new Log(Name.prototype.default(), new Num(10));
  }
  replace(id: number, next: Base): { node: Base; changed: boolean } {
    if (this.id === id) {
      return { node: next, changed: true };
    }

    const { node: child, changed: changedChild } = this.child.replace(id, next);
    if (changedChild) {
      const cloned = new Log(child, this.base);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }

    const { node: base, changed: changedBase } = this.base.replace(id, next);
    if (changedBase) {
      const cloned = new Log(this.child, base);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }
    return { node: this, changed: false };
  }

  toJs(): string {
    return `(Math.log(${this.child.toJs()}) / Math.log(${this.base.toJs()}))`;
  }

  toPy(displayNames: Map<string, string>): string {
    return `np.log(${this.child.toPy(displayNames)}) / np.log(${this.base.toPy(displayNames)})`;
  }

  toTex(texNames: Map<string, string>): string {
    return `\\log_{${this.base.toTex(texNames)}}(${this.child.toTex(texNames)})`;
  }

  toSBML(): string {
    return `<apply><log/><logbase>${this.base.toSBML()}</logbase>${this.child.toSBML()}</apply>`;
  }
  toTs(): string {
    return `new Log(${this.child.toTs()}, ${this.base.toTs()})`;
  }
  toJson(): JsonNode {
    return {
      type: "Log",
      child: this.child.toJson(),
      base: this.base.toJson(),
    };
  }
  static fromJson(json: JsonNode): Log {
    return new Log(reviveNode(json.child!), reviveNode(json.base!));
  }
  getCtors(ctors: Set<string>): Set<string> {
    ctors.add("Log");
    this.child.getCtors(ctors);
    this.base.getCtors(ctors);
    return ctors;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (call $math_log ${this.child.toWat(ctx)}) (call $math_log ${this.base.toWat(ctx)}))`;
  }

  getSymbols(symbols: Set<string>): Set<string> {
    this.child.getSymbols(symbols);
    this.base.getSymbols(symbols);
    return symbols;
  }
}

/** The `base`-th root of `child`, i.e. `child ** (1 / base)` (defaults to square root). */
export class Sqrt extends Base {
  readonly nodeType = "Sqrt";
  constructor(
    public child: Base,
    public base: Base,
  ) {
    super();
  }
  default(): Sqrt {
    return new Sqrt(Name.prototype.default(), new Num(2));
  }
  replace(id: number, next: Base): { node: Base; changed: boolean } {
    if (this.id === id) {
      return { node: next, changed: true };
    }

    const { node: child, changed: changedChild } = this.child.replace(id, next);
    if (changedChild) {
      const cloned = new Sqrt(child, this.base);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }

    const { node: base, changed: changedBase } = this.base.replace(id, next);
    if (changedBase) {
      const cloned = new Sqrt(this.child, base);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }
    return { node: this, changed: false };
  }

  toJs(): string {
    return `Math.pow(${this.child.toJs()}, 1 / ${this.base.toJs()})`;
  }

  toPy(displayNames: Map<string, string>): string {
    return `np.pow(${this.child.toPy(displayNames)}, 1 / ${this.base.toPy(displayNames)})`;
  }

  toTex(texNames: Map<string, string>): string {
    return `\\sqrt[${this.base.toTex(texNames)}]{${this.child.toTex(texNames)}}`;
  }

  toSBML(): string {
    return `<apply><root/><degree>${this.base.toSBML()}</degree>${this.child.toSBML()}</apply>`;
  }
  toTs(): string {
    return `new Sqrt(${this.child.toTs()}, ${this.base.toTs()})`;
  }
  toJson(): JsonNode {
    return {
      type: "Sqrt",
      child: this.child.toJson(),
      base: this.base.toJson(),
    };
  }
  static fromJson(json: JsonNode): Sqrt {
    return new Sqrt(reviveNode(json.child!), reviveNode(json.base!));
  }
  getCtors(ctors: Set<string>): Set<string> {
    ctors.add("Sqrt");
    this.child.getCtors(ctors);
    this.base.getCtors(ctors);
    return ctors;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_pow ${this.child.toWat(ctx)} (f64.div (f64.const 1) ${this.base.toWat(ctx)}))`;
  }

  getSymbols(symbols: Set<string>): Set<string> {
    this.child.getSymbols(symbols);
    this.base.getSymbols(symbols);
    return symbols;
  }
}
