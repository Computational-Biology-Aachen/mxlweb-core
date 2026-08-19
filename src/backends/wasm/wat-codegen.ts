import type { Base } from "../../mathml/base.js";
import type { WatContext } from "./wat-context.js";

/**
 * buildWatModule — generate a complete WAT module exporting a single "fcn"
 * function of shape void(i32 n, f64 t, i32 y_ptr, i32 out_ptr, i32 pars_ptr),
 * writing `outputs` (in order) as consecutive f64s starting at out_ptr.
 *
 * This shape is generic: it backs both the ODE RHS (outputs = d/dt per state
 * variable, writing into dydt) and derived-quantity evaluation (outputs =
 * selected derived expressions, writing into a derived-value buffer) — see
 * buildModelWat / buildDerivedWat below. Each caller compiles to its own
 * WebAssembly.Instance, so both can export under the same "fcn" name.
 */
function buildWatModule(
  outputs: { expr: Base }[],
  varNames: string[],
  parNames: string[],
  timeVar = "time",
  intermediates?: { name: string; expr: Base }[],
): string {
  const localNames = intermediates
    ? new Set(intermediates.map((l) => l.name))
    : undefined;

  const ctx: WatContext = {
    varIndex: new Map(varNames.map((n, i) => [n, i])),
    parIndex: new Map(parNames.map((n, i) => [n, i])),
    timeVar,
    localNames,
  };

  const localDecls = intermediates
    ? intermediates.map((l) => `    (local $${l.name} f64)`).join("\n") + "\n"
    : "";

  const localSets = intermediates
    ? intermediates
        .map((l) => `    (local.set $${l.name} ${l.expr.toWat(ctx)})`)
        .join("\n") + "\n"
    : "";

  const stores = outputs
    .map((out, i) => {
      const offset = i * 8;
      return `    (f64.store (i32.add (local.get 3) (i32.const ${offset})) ${out.expr.toWat(ctx)})`;
    })
    .join("\n");

  return `(module
  ;; Shared memory from Emscripten runtime
  (import "env" "memory" (memory 1))

  ;; Single-argument math imports
  (import "math" "exp"       (func $math_exp       (param f64) (result f64)))
  (import "math" "log"       (func $math_log       (param f64) (result f64)))
  (import "math" "sin"       (func $math_sin       (param f64) (result f64)))
  (import "math" "cos"       (func $math_cos       (param f64) (result f64)))
  (import "math" "tan"       (func $math_tan       (param f64) (result f64)))
  (import "math" "asin"      (func $math_asin      (param f64) (result f64)))
  (import "math" "acos"      (func $math_acos      (param f64) (result f64)))
  (import "math" "atan"      (func $math_atan      (param f64) (result f64)))
  (import "math" "sinh"      (func $math_sinh      (param f64) (result f64)))
  (import "math" "cosh"      (func $math_cosh      (param f64) (result f64)))
  (import "math" "tanh"      (func $math_tanh      (param f64) (result f64)))
  (import "math" "asinh"     (func $math_asinh     (param f64) (result f64)))
  (import "math" "acosh"     (func $math_acosh     (param f64) (result f64)))
  (import "math" "atanh"     (func $math_atanh     (param f64) (result f64)))
  (import "math" "factorial" (func $math_factorial (param f64) (result f64)))

  ;; Two-argument math imports
  (import "math" "pow" (func $math_pow (param f64 f64) (result f64)))
  (import "math" "max" (func $math_max (param f64 f64) (result f64)))
  (import "math" "min" (func $math_min (param f64 f64) (result f64)))
  (import "math" "rem" (func $math_rem (param f64 f64) (result f64)))

  ;; ODE RHS: void(i32 n, f64 t, i32 y_ptr, i32 f_ptr, i32 rpar_ptr)
  ;; Param locals: 0=n, 1=t, 2=y_ptr, 3=f_ptr, 4=rpar_ptr
  (func (export "fcn") (param i32) (param f64) (param i32) (param i32) (param i32)
${localDecls}${localSets}${stores}
  )
)`;
}

/**
 * buildModelWat — generate a complete WAT module for the ODE RHS.
 *
 * Exported function signature (matches fcn_dispatch in radau5_wrapper.c):
 *   void model_fn(int n, double t, double* y, double* dydt, double* pars)
 * Emscripten addFunction type string: "vidiii"
 *
 * @param equations     One entry per state variable: the AST for its d/dt expression.
 * @param varNames      State variable names in order (index matches y[] offset).
 * @param parNames      Parameter names in order (index matches pars[] offset).
 * @param timeVar       Optional name used as the time variable (default "time").
 * @param intermediates Reactions/assignments that become named WAT locals, in topological order.
 */
export function buildModelWat(
  equations: { varName: string; expr: Base }[],
  varNames: string[],
  parNames: string[],
  timeVar = "time",
  intermediates?: { name: string; expr: Base }[],
): string {
  return buildWatModule(equations, varNames, parNames, timeVar, intermediates);
}

/**
 * buildDerivedWat — generate a complete WAT module computing selected derived
 * quantities from (t, y, pars), for use as a fit target (see ADR 0004 in the
 * mxlweb repo). Same signature shape as buildModelWat, registered separately
 * via set_derived_fn (fit_wrapper.c) rather than set_model_fn.
 *
 * @param outputs       One entry per requested derived quantity, in the order
 *                      they'll be written to the output buffer.
 * @param varNames      State variable names in order (index matches y[] offset).
 * @param parNames      Parameter names in order (index matches pars[] offset).
 * @param timeVar       Optional name used as the time variable (default "time").
 * @param intermediates Pruned, topologically-sorted dependencies of `outputs`
 *                      (see transitiveDerivedDeps in modelIr.ts).
 */
export function buildDerivedWat(
  outputs: { name: string; expr: Base }[],
  varNames: string[],
  parNames: string[],
  timeVar = "time",
  intermediates?: { name: string; expr: Base }[],
): string {
  return buildWatModule(outputs, varNames, parNames, timeVar, intermediates);
}

/**
 * buildAdjointWat — generate a complete WAT module exporting a single "fcn"
 * function of shape
 *   void(i32 n, f64 t, i32 y_ptr, i32 lambda_ptr, i32 pars_ptr,
 *        i32 out_dlambda_ptr, i32 out_dtheta_ptr)
 * computing the continuous adjoint's right-hand side (ADR 0005 §2.3/§4):
 * `dlambda[i] = -d(lambda^T f)/dy_i` and `dtheta[k] = -d(lambda^T f)/dtheta_k`,
 * i.e. the augmented backward ODE a C-side integrator solves alongside the
 * (Hermite-interpolated, not re-integrated — ADR 0005 §2.3.1) forward
 * trajectory.
 *
 * `lambda` is a *runtime* input here (the current numeric adjoint state,
 * supplied by the backward integrator each step) — symbolically it's just
 * `n` more named leaves, resolved via `WatContext.lambdaIndex` exactly like
 * `y`/`pars` resolve via `varIndex`/`parIndex` (see `Name.toWat`).
 *
 * `dlambda`/`dtheta` must already be the *summed* final gradient expression
 * per output (i.e. built by walking `intermediates` in reverse — see
 * `modelIr.ts`'s `buildAdjointGraph`) — this function only lays out the WAT
 * module and its locals, the same way `buildModelWat` doesn't itself compute
 * dx/dt, only emits what it's given. `intermediates` here is expected to be
 * the forward pass's own list (recomputed fresh, same as `buildDerivedWat`
 * already does for a separately-compiled function) *followed by* the
 * adjoint-accumulator locals `buildAdjointGraph` produces — one combined
 * locals-in-dependency-order list, forward values and backward
 * accumulations resolved identically via `Name` + `ctx.localNames`.
 */
export function buildAdjointWat(
  dlambda: { varName: string; expr: Base }[],
  dtheta: { thetaName: string; expr: Base }[],
  varNames: string[],
  parNames: string[],
  lambdaNames: string[],
  timeVar = "time",
  intermediates?: { name: string; expr: Base }[],
): string {
  const localNames = intermediates
    ? new Set(intermediates.map((l) => l.name))
    : undefined;

  const ctx: WatContext = {
    varIndex: new Map(varNames.map((n, i) => [n, i])),
    parIndex: new Map(parNames.map((n, i) => [n, i])),
    lambdaIndex: new Map(lambdaNames.map((n, i) => [n, i])),
    timeVar,
    localNames,
  };

  const localDecls = intermediates
    ? intermediates.map((l) => `    (local $${l.name} f64)`).join("\n") + "\n"
    : "";

  const localSets = intermediates
    ? intermediates
        .map((l) => `    (local.set $${l.name} ${l.expr.toWat(ctx)})`)
        .join("\n") + "\n"
    : "";

  const dlambdaStores = dlambda
    .map((out, i) => {
      const offset = i * 8;
      return `    (f64.store (i32.add (local.get 5) (i32.const ${offset})) ${out.expr.toWat(ctx)})`;
    })
    .join("\n");

  const dthetaStores = dtheta
    .map((out, i) => {
      const offset = i * 8;
      return `    (f64.store (i32.add (local.get 6) (i32.const ${offset})) ${out.expr.toWat(ctx)})`;
    })
    .join("\n");

  return `(module
  ;; Shared memory from Emscripten runtime
  (import "env" "memory" (memory 1))

  ;; Single-argument math imports
  (import "math" "exp"       (func $math_exp       (param f64) (result f64)))
  (import "math" "log"       (func $math_log       (param f64) (result f64)))
  (import "math" "sin"       (func $math_sin       (param f64) (result f64)))
  (import "math" "cos"       (func $math_cos       (param f64) (result f64)))
  (import "math" "tan"       (func $math_tan       (param f64) (result f64)))
  (import "math" "asin"      (func $math_asin      (param f64) (result f64)))
  (import "math" "acos"      (func $math_acos      (param f64) (result f64)))
  (import "math" "atan"      (func $math_atan      (param f64) (result f64)))
  (import "math" "sinh"      (func $math_sinh      (param f64) (result f64)))
  (import "math" "cosh"      (func $math_cosh      (param f64) (result f64)))
  (import "math" "tanh"      (func $math_tanh      (param f64) (result f64)))
  (import "math" "asinh"     (func $math_asinh     (param f64) (result f64)))
  (import "math" "acosh"     (func $math_acosh     (param f64) (result f64)))
  (import "math" "atanh"     (func $math_atanh     (param f64) (result f64)))
  (import "math" "factorial" (func $math_factorial (param f64) (result f64)))

  ;; Two-argument math imports
  (import "math" "pow" (func $math_pow (param f64 f64) (result f64)))
  (import "math" "max" (func $math_max (param f64 f64) (result f64)))
  (import "math" "min" (func $math_min (param f64 f64) (result f64)))
  (import "math" "rem" (func $math_rem (param f64 f64) (result f64)))

  ;; Adjoint RHS: void(i32 n, f64 t, i32 y_ptr, i32 lambda_ptr, i32 pars_ptr,
  ;;                    i32 out_dlambda_ptr, i32 out_dtheta_ptr)
  ;; Param locals: 0=n, 1=t, 2=y_ptr, 3=lambda_ptr, 4=pars_ptr,
  ;;               5=out_dlambda_ptr, 6=out_dtheta_ptr
  (func (export "fcn") (param i32) (param f64) (param i32) (param i32) (param i32) (param i32) (param i32)
${localDecls}${localSets}${dlambdaStores}
${dthetaStores}
  )
)`;
}

/**
 * mathImports — JS imports object for instantiating a model WASM module.
 * Provide as the "math" namespace in WebAssembly.instantiate imports.
 */
export function mathImports(): Record<string, (...args: number[]) => number> {
  return {
    exp: Math.exp,
    log: Math.log,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    asinh: Math.asinh,
    acosh: Math.acosh,
    atanh: Math.atanh,
    factorial: (n: number) => {
      let r = 1;
      for (let i = 2; i <= Math.round(n); i++) r *= i;
      return r;
    },
    pow: Math.pow,
    max: Math.max,
    min: Math.min,
    rem: (a: number, b: number) => a % b,
  };
}
