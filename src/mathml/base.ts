import type { WatContext } from "../backends/wasm/wat-context.js";

/**
 * Mathematical expression AST shared across the kinetic/ODE model builders.
 *
 * Each node type subclasses {@link Base} and knows how to serialise itself to
 * every target the library supports: JavaScript ({@link Base.toJs}), Python /
 * NumPy ({@link Base.toPy}), LaTeX ({@link Base.toTex}), SBML MathML
 * ({@link Base.toSBML}) and WebAssembly Text ({@link Base.toWat}). Trees are
 * immutable: structural edits go through {@link Base.replace}, which clones the
 * affected path and preserves node {@link Base.id}s for stable identity.
 *
 * Concrete node classes live in `binary.ts`, `unary.ts`, `unary-special.ts` and
 * `nary.ts`; this module defines the base classes plus the two nullary leaves
 * {@link Name} (a variable/parameter reference) and {@link Num} (a literal).
 *
 * @module
 */

let idCounter = 0;

/**
 * Serialised form of an expression node — the `node` shape of the shared
 * mxl-schemas `.mxl.json` format. The `type` discriminator is the node's class
 * name; which operand fields are present depends on the node's arity (`value`
 * for leaves, `child`/`base` for {@link Log}/{@link Sqrt}, `left`/`right` for
 * {@link Binary}, `children` for {@link Nary}).
 */
export type JsonNode = {
  type: string;
  value?: number | string | boolean;
  child?: JsonNode;
  base?: JsonNode;
  left?: JsonNode;
  right?: JsonNode;
  children?: JsonNode[];
};

/**
 * Common ancestor for every expression-tree node.
 *
 * Subclasses implement the serialisers and tree operations below. Each instance
 * gets a process-unique {@link Base.id} on construction, used to target nodes in
 * {@link Base.replace}.
 */
export abstract class Base {
  /** Process-unique identifier, assigned on construction. */
  id: number;
  /** Serialise to a JavaScript expression string. */
  abstract toJs(): string;
  /** Serialise to a Python/NumPy expression; `displayNames` maps internal symbol names to their Python identifiers. */
  abstract toPy(displayNames: Map<string, string>): string;
  /** Serialise to a LaTeX expression; `texNames` maps internal symbol names to their LaTeX rendering. */
  abstract toTex(texNames: Map<string, string>): string;
  /** Serialise to an SBML MathML fragment. */
  abstract toSBML(): string;
  /** Serialise to a WebAssembly Text (WAT) expression, using `ctx` to resolve variable/parameter memory layout. */
  abstract toWat(ctx: WatContext): string;
  /** Collect every variable/parameter symbol referenced in this subtree into `symbols`. */
  abstract getSymbols(symbols: Set<string>): Set<string>;
  /** Serialise to a TypeScript constructor expression that rebuilds this subtree (e.g. `new Mul([new Name("x"), new Num(2)])`). */
  abstract toTs(): string;
  /** Serialise to the shared mxl-schemas `.mxl.json` node tree (see {@link JsonNode}). */
  abstract toJson(): JsonNode;
  /** Collect the mathml constructor class names used in this subtree into `ctors` (for import generation). */
  abstract getCtors(ctors: Set<string>): Set<string>;
  // abstract default(): Base;
  /**
   * Return a copy of this subtree with the node whose id is `id` replaced by
   * `next`. `changed` reports whether a replacement occurred; the original tree
   * is left untouched (only the path to the replaced node is cloned).
   */
  abstract replace(id: number, next: Base): { node: Base; changed: boolean };

  constructor() {
    this.id = ++idCounter;
  }
}

// Other base classes to reduce code churn, grouped by arity
// (https://en.wikipedia.org/wiki/Arity).

/** Leaf node with no children (e.g. {@link Name}, {@link Num}). */
export abstract class Nullary extends Base {
  replace(id: number, next: Base): { node: Base; changed: boolean } {
    if (this.id === id) {
      return { node: next, changed: true };
    }
    return { node: this, changed: false };
  }

  getCtors(ctors: Set<string>): Set<string> {
    ctors.add(this.constructor.name);
    return ctors;
  }

  toJson(): JsonNode {
    return { type: this.constructor.name };
  }
}

/** Node with a single operand `child` (e.g. negation, `sin`). Provides shared `replace`/`getSymbols` over that child. */
export abstract class Unary extends Base {
  abstract child: Base;

  // default(): Base {
  //   const Constructor = this.constructor as new (child: Base) => this;
  //   return new Constructor(Name.prototype.default());
  // }

  replace(id: number, next: Base): { node: Base; changed: boolean } {
    if (this.id === id) {
      return { node: next, changed: true };
    }

    const { node, changed } = this.child.replace(id, next);
    if (changed) {
      const Constructor = this.constructor as new (child: Base) => this;
      const cloned = new Constructor(node);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }
    return { node: this, changed: false };
  }

  getSymbols(symbols: Set<string>): Set<string> {
    return this.child.getSymbols(symbols);
  }

  toTs(): string {
    return `new ${this.constructor.name}(${this.child.toTs()})`;
  }

  toJson(): JsonNode {
    return { type: this.constructor.name, child: this.child.toJson() };
  }

  getCtors(ctors: Set<string>): Set<string> {
    ctors.add(this.constructor.name);
    return this.child.getCtors(ctors);
  }
}

/** Node with two operands `left` and `right` (e.g. {@link Pow}). Provides shared `replace`/`getSymbols` over both. */
export abstract class Binary extends Base {
  abstract left: Base;
  abstract right: Base;

  // default(): Base {
  //   const Constructor = this.constructor as new (
  //     left: Base,
  //     right: Base,
  //   ) => this;
  //   return new Constructor(Name.prototype.default(), Name.prototype.default());
  // }

  replace(id: number, next: Base): { node: Base; changed: boolean } {
    if (this.id === id) {
      return { node: next, changed: true };
    }

    const { node: left, changed: changedLeft } = this.left.replace(id, next);
    if (changedLeft) {
      const Constructor = this.constructor as new (
        left: Base,
        right: Base,
      ) => this;
      const cloned = new Constructor(left, this.right);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }

    const { node: right, changed: changedRight } = this.right.replace(id, next);
    if (changedRight) {
      const Constructor = this.constructor as new (
        left: Base,
        right: Base,
      ) => this;
      const cloned = new Constructor(this.left, right);
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }

    return { node: this, changed: false };
  }
  getSymbols(symbols: Set<string>): Set<string> {
    this.left.getSymbols(symbols);
    this.right.getSymbols(symbols);
    return symbols;
  }

  toTs(): string {
    return `new ${this.constructor.name}(${this.left.toTs()}, ${this.right.toTs()})`;
  }

  toJson(): JsonNode {
    return {
      type: this.constructor.name,
      left: this.left.toJson(),
      right: this.right.toJson(),
    };
  }

  getCtors(ctors: Set<string>): Set<string> {
    ctors.add(this.constructor.name);
    this.left.getCtors(ctors);
    this.right.getCtors(ctors);
    return ctors;
  }
}

/** Node with an arbitrary number of operands `children` (e.g. sums, products, `min`/`max`). Provides shared `replace`/`getSymbols` over all children. */
export abstract class Nary extends Base {
  abstract children: Base[];

  // default(): Base {
  //   const Constructor = this.constructor as new (children: Base[]) => this;
  //   return new Constructor([
  //     Name.prototype.default(),
  //     Name.prototype.default(),
  //   ]);
  // }

  replace(id: number, next: Base): { node: Base; changed: boolean } {
    if (this.id === id) {
      return { node: next, changed: true };
    }

    // Check all children
    const children = this.children.map((child) => {
      return child.replace(id, next);
    });

    if (children.some(({ changed }) => changed)) {
      const Constructor = this.constructor as new (children: Base[]) => this;
      const cloned = new Constructor(children.map(({ node }) => node));
      cloned.id = this.id;
      return { node: cloned, changed: true };
    }
    return { node: this, changed: false };
  }

  getSymbols(symbols: Set<string>): Set<string> {
    for (const child of this.children) {
      child.getSymbols(symbols);
    }
    return symbols;
  }

  toTs(): string {
    return `new ${this.constructor.name}([${this.children
      .map((child) => child.toTs())
      .join(", ")}])`;
  }

  toJson(): JsonNode {
    return {
      type: this.constructor.name,
      children: this.children.map((child) => child.toJson()),
    };
  }

  getCtors(ctors: Set<string>): Set<string> {
    ctors.add(this.constructor.name);
    for (const child of this.children) {
      child.getCtors(ctors);
    }
    return ctors;
  }
}

///////////////////////////////////////////////////////////////////////////////
// Nullary fns
// Also didn't belive that is the term, but check it
// https://en.wikipedia.org/wiki/Arity
///////////////////////////////////////////////////////////////////////////////

/**
 * A reference to a named symbol — a model variable, parameter or the time
 * variable. In WAT it resolves to a local, a load from the variable array, or a
 * load from the parameter array depending on the {@link WatContext}.
 */
export class Name extends Nullary {
  constructor(public name: string) {
    super();
  }

  default(): Name {
    return new Name("default");
  }
  update(name: string): Base {
    return new Name(name);
  }
  toJs(): string {
    return this.name;
  }
  toPy(displayNames: Map<string, string>): string {
    return displayNames.get(this.name) || this.name;
  }
  toTex(texNames: Map<string, string>): string {
    return texNames.get(this.name) || this.name;
  }
  toSBML(): string {
    return `<ci>${this.name}</ci>`;
  }
  toTs(): string {
    return `new Name(${JSON.stringify(this.name)})`;
  }
  toJson(): JsonNode {
    return { type: "Name", value: this.name };
  }
  toWat(ctx: WatContext): string {
    if (ctx.timeVar && this.name === ctx.timeVar) {
      return `(local.get 1)`;
    }
    if (ctx.localNames?.has(this.name)) {
      return `(local.get $${this.name})`;
    }
    const vi = ctx.varIndex.get(this.name);
    if (vi !== undefined) {
      return `(f64.load (i32.add (local.get 2) (i32.const ${vi * 8})))`;
    }
    const pi = ctx.parIndex.get(this.name);
    if (pi !== undefined) {
      return `(f64.load (i32.add (local.get 4) (i32.const ${pi * 8})))`;
    }
    return `(f64.const 0)`;
  }
  getSymbols(symbols: Set<string>): Set<string> {
    symbols.add(this.name);
    return symbols;
  }
}

/** A numeric literal constant. */
export class Num extends Nullary {
  constructor(public value: number) {
    super();
  }
  default(): Num {
    return new Num(1.0);
  }
  update(value: number): Base {
    return new Num(value);
  }
  toJs(): string {
    return `${this.value}`;
  }
  toPy(_displayNames: Map<string, string>): string {
    return `${this.value}`;
  }
  toTex(_texNames: Map<string, string>): string {
    return `${this.value}`;
  }
  toSBML(): string {
    return `<cn>${this.value}</cn>`;
  }
  toTs(): string {
    return `new Num(${this.value})`;
  }
  toJson(): JsonNode {
    return { type: "Num", value: this.value };
  }
  toWat(_ctx: WatContext): string {
    return `(f64.const ${this.value})`;
  }
  getSymbols(symbols: Set<string>): Set<string> {
    return symbols;
  }
}

/** The mathematical constant π (MathML `<pi/>`). */
export class Pi extends Nullary {
  toJs(): string {
    return `Math.PI`;
  }
  toPy(_displayNames: Map<string, string>): string {
    return `np.pi`;
  }
  toTex(_texNames: Map<string, string>): string {
    return `\\pi`;
  }
  toSBML(): string {
    return `<pi/>`;
  }
  toTs(): string {
    return `new Pi()`;
  }
  toWat(_ctx: WatContext): string {
    return `(f64.const ${Math.PI})`;
  }
  getSymbols(symbols: Set<string>): Set<string> {
    return symbols;
  }
}

/** Euler's number e (MathML `<exponentiale/>`). */
export class E extends Nullary {
  toJs(): string {
    return `Math.E`;
  }
  toPy(_displayNames: Map<string, string>): string {
    return `np.e`;
  }
  toTex(_texNames: Map<string, string>): string {
    return `e`;
  }
  toSBML(): string {
    return `<exponentiale/>`;
  }
  toTs(): string {
    return `new E()`;
  }
  toWat(_ctx: WatContext): string {
    return `(f64.const ${Math.E})`;
  }
  getSymbols(symbols: Set<string>): Set<string> {
    return symbols;
  }
}

/** A boolean literal, `true` or `false` (MathML `<true/>` / `<false/>`). In WAT it is the i32 `1`/`0` the logical/relational nodes operate on. */
export class Bool extends Nullary {
  constructor(public value: boolean) {
    super();
  }
  default(): Bool {
    return new Bool(true);
  }
  update(value: boolean): Base {
    return new Bool(value);
  }
  toJs(): string {
    return `${this.value}`;
  }
  toPy(_displayNames: Map<string, string>): string {
    return this.value ? `True` : `False`;
  }
  toTex(_texNames: Map<string, string>): string {
    return this.value ? `\\text{true}` : `\\text{false}`;
  }
  toSBML(): string {
    return this.value ? `<true/>` : `<false/>`;
  }
  toTs(): string {
    return `new Bool(${this.value})`;
  }
  toJson(): JsonNode {
    return { type: "Bool", value: this.value };
  }
  toWat(_ctx: WatContext): string {
    return `(i32.const ${this.value ? 1 : 0})`;
  }
  getSymbols(symbols: Set<string>): Set<string> {
    return symbols;
  }
}
