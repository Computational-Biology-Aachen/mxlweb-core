import type { WatContext } from "../backends/wasm/wat-context.js";
import { Base, Unary } from "./base.js";

/**
 * Single-operand function nodes (absolute value, rounding, exponential,
 * logarithm, and the trigonometric / hyperbolic families plus their inverses).
 * Each wraps one `child` expression. See {@link Base} for the serialiser
 * contract; reciprocal/inverse forms are expressed in terms of the primitives
 * the runtime exposes (`Math.*`, `np.*`, the `$math_*` WAT imports).
 *
 * @module
 */

///////////////////////////////////////////////////////////////////////////////
// Unary fns
///////////////////////////////////////////////////////////////////////////////

/** Absolute value, `|child|`. */
export class Abs extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.abs(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `abs(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `abs(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><abs/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.abs ${this.child.toWat(ctx)})`;
  }
}

/** Round up to the nearest integer, `⌈child⌉`. */
export class Ceiling extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.ceil(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `math.ceil(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\lceil ${this.child.toTex(texNames)} \\rceil`;
  }
  toSBML(): string {
    return `<apply><ceiling/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.ceil ${this.child.toWat(ctx)})`;
  }
}

/** Natural exponential, `e^child`. */
export class Exp extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.exp(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.exp(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `e^{${this.child.toTex(texNames)}}`;
  }
  toSBML(): string {
    return `<apply><exp/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_exp ${this.child.toWat(ctx)})`;
  }
}

/** Factorial of the rounded operand, `round(child)!`. */
export class Factorial extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    const n = this.child.toJs();
    return `((n => { let r = 1; for (let i = 2; i <= Math.round(n); i++) r *= i; return r; })(${n}))`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `math.factorial(int(round(${this.child.toPy(displayNames)})))`;
  }
  toTex(texNames: Map<string, string>): string {
    return `${this.child.toTex(texNames)}!`;
  }
  toSBML(): string {
    return `<apply><factorial/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_factorial ${this.child.toWat(ctx)})`;
  }
}

/** Round down to the nearest integer, `⌊child⌋`. */
export class Floor extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.floor(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.floor(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\lfloor ${this.child.toTex(texNames)} \\rfloor`;
  }
  toSBML(): string {
    return `<apply><floor/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.floor ${this.child.toWat(ctx)})`;
  }
}

/** Natural logarithm, `ln(child)`. The WAT form clamps the argument to ≥1e-30 so transient negative states during implicit solves don't produce NaNs. */
export class Ln extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.log(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.log(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\ln(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><ln/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    // Clamp to 1e-30 before log: RADAU5 Newton iterations can temporarily
    // drive state variables negative; log(<=0) = NaN cascades through all
    // derivatives. 1e-30 keeps pH_lu ≈ 30 (finite, bounded f64 downstream).
    return `(call $math_log (f64.max ${this.child.toWat(ctx)} (f64.const 1e-30)))`;
  }
}

/** Sine. */
export class Sin extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.sin(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.sin(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\sin(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><sin/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_sin ${this.child.toWat(ctx)})`;
  }
}

/** Cosine. */
export class Cos extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.cos(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.cos(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\cos(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><cos/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_cos ${this.child.toWat(ctx)})`;
  }
}

/** Tangent. */
export class Tan extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.tan(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.tan(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\tan(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><tan/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_tan ${this.child.toWat(ctx)})`;
  }
}

/** Secant, `1 / cos(child)`. */
export class Sec extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `1 / Math.cos(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `1 / np.cos(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\sec(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><sec/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (f64.const 1) (call $math_cos ${this.child.toWat(ctx)}))`;
  }
}

/** Cosecant, `1 / sin(child)`. */
export class Csc extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `1 / Math.sin(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `1 / np.sin(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\csc(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><csc/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (f64.const 1) (call $math_sin ${this.child.toWat(ctx)}))`;
  }
}

/** Cotangent, `1 / tan(child)`. */
export class Cot extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `1 / Math.tan(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `1 / np.tan(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\cot(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><cot/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (f64.const 1) (call $math_tan ${this.child.toWat(ctx)}))`;
  }
}

/** Inverse sine, `arcsin(child)`. */
export class Asin extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.asin(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.asin(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\arcsin(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arcsin/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_asin ${this.child.toWat(ctx)})`;
  }
}

/** Inverse cosine, `arccos(child)`. */
export class Acos extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.acos(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.acos(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\arccos(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arccos/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_acos ${this.child.toWat(ctx)})`;
  }
}

/** Inverse tangent, `arctan(child)`. */
export class Atan extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.atan(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.atan(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\arctan(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arctan/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_atan ${this.child.toWat(ctx)})`;
  }
}

/** Inverse cotangent, `arctan(1 / child)`. */
export class Acot extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.atan(1 / ${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.atan(1 / ${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arccot}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arccot/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_atan (f64.div (f64.const 1) ${this.child.toWat(ctx)}))`;
  }
}

/** Inverse secant, `arccos(1 / child)`. */
export class ArcSec extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.acos(1 / ${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.acos(1 / ${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arcsec}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arcsec/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_acos (f64.div (f64.const 1) ${this.child.toWat(ctx)}))`;
  }
}

/** Inverse cosecant, `arcsin(1 / child)`. */
export class ArcCsc extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.asin(1 / ${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.asin(1 / ${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arccsc}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arccsc/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_asin (f64.div (f64.const 1) ${this.child.toWat(ctx)}))`;
  }
}

/** Hyperbolic sine. */
export class Sinh extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.sinh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.sinh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\sinh(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><sinh/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_sinh ${this.child.toWat(ctx)})`;
  }
}

/** Hyperbolic cosine. */
export class Cosh extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.cosh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.cosh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\cosh(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><cosh/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_cosh ${this.child.toWat(ctx)})`;
  }
}

/** Hyperbolic tangent. */
export class Tanh extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.tanh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.tanh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\tanh(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><tanh/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_tanh ${this.child.toWat(ctx)})`;
  }
}

/** Hyperbolic secant, `1 / cosh(child)`. */
export class Sech extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `1 / Math.cosh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `1 / np.cosh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{sech}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><sech/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (f64.const 1) (call $math_cosh ${this.child.toWat(ctx)}))`;
  }
}

/** Hyperbolic cosecant, `1 / sinh(child)`. */
export class Csch extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `1 / Math.sinh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `1 / np.sinh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{csch}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><csch/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (f64.const 1) (call $math_sinh ${this.child.toWat(ctx)}))`;
  }
}

/** Hyperbolic cotangent, `1 / tanh(child)`. */
export class Coth extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `1 / Math.tanh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `1 / np.tanh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\coth(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><coth/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.div (f64.const 1) (call $math_tanh ${this.child.toWat(ctx)}))`;
  }
}

/** Inverse hyperbolic sine, `arcsinh(child)`. */
export class ArcSinh extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.asinh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.asinh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arcsinh}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arcsinh/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_asinh ${this.child.toWat(ctx)})`;
  }
}

/** Inverse hyperbolic cosine, `arccosh(child)`. */
export class ArcCosh extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.acosh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.acosh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arccosh}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arccosh/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_acosh ${this.child.toWat(ctx)})`;
  }
}

/** Inverse hyperbolic tangent, `arctanh(child)`. */
export class ArcTanh extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.atanh(${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.atanh(${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arctanh}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arctanh/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_atanh ${this.child.toWat(ctx)})`;
  }
}

/** Inverse hyperbolic cosecant, `arcsinh(1 / child)`. */
export class ArcCsch extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.asinh(1 / ${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.asinh(1 / ${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arccsch}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arccsch/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_asinh (f64.div (f64.const 1) ${this.child.toWat(ctx)}))`;
  }
}

/** Inverse hyperbolic secant, `arccosh(1 / child)`. */
export class ArcSech extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.acosh(1 / ${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.acosh(1 / ${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arcsech}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arcsech/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_acosh (f64.div (f64.const 1) ${this.child.toWat(ctx)}))`;
  }
}

/** Inverse hyperbolic cotangent, `arctanh(1 / child)`. */
export class ArcCoth extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `Math.atanh(1 / ${this.child.toJs()})`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `np.atanh(1 / ${this.child.toPy(displayNames)})`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\text{arccoth}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><arccoth/>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(call $math_atanh (f64.div (f64.const 1) ${this.child.toWat(ctx)}))`;
  }
}

/**
 * The SBML `rateOf` operator, `d(child)/dt`. Only TeX and SBML render it
 * meaningfully; the JS/Python/WAT targets emit `0` (rates are not available in
 * those evaluation contexts).
 */
export class RateOf extends Unary {
  constructor(public child: Base) {
    super();
  }
  toJs(): string {
    return `0`;
  }
  toPy(displayNames: Map<string, string>): string {
    return `0`;
  }
  toTex(texNames: Map<string, string>): string {
    return `\\frac{d}{dt}(${this.child.toTex(texNames)})`;
  }
  toSBML(): string {
    return `<apply><csymbol definitionURL="http://www.sbml.org/sbml/symbols/rateOf">rateOf</csymbol>${this.child.toSBML()}</apply>`;
  }
  toWat(ctx: WatContext): string {
    return `(f64.const 0)`;
  }
}
