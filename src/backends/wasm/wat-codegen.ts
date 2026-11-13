import { type ArrayData, arrayLengths, scheduleArrays } from "../../arrays.js";
import type { Base } from "../../mathml/base.js";
import type { WatContext } from "./wat-context.js";

const DOUBLE = 8;

/**
 * The body of an exported function: `(local ...)` declarations, the statements
 * computing `intermediates`, and the WAT of each output expression. For a
 * model with arrays (mxl-schemas ADR 0015), `module` holds what the module
 * needs besides: the `$__arrays` global, `arrays_bytes()` and `init(base)`,
 * which `compileModelWith` calls once to place the data in memory.
 */
function watBody(
  outputs: Base[],
  ctx: WatContext,
  intermediates: { name: string; expr: Base }[] = [],
  data?: ArrayData,
): { decls: string; sets: string; outputs: string[]; module: string } {
  // `lower()` only sets data when an array is used
  if (data === undefined || data.size === 0) {
    ctx.localNames = new Set(intermediates.map((l) => l.name));
    return {
      decls: intermediates.map((l) => `    (local $${l.name} f64)\n`).join(""),
      sets: intermediates
        .map((l) => `    (local.set $${l.name} ${l.expr.toWat(ctx)})\n`)
        .join(""),
      outputs: outputs.map((o) => o.toWat(ctx)),
      module: "",
    };
  }
  const lengths = new Map<string, number>([
    ...[...data].map(([k, v]) => [k, v.length] as [string, number]),
    ...arrayLengths(intermediates, data),
  ]);
  const scheduled = scheduleArrays(intermediates, outputs, lengths);
  // Array region: the data, then a buffer per array-valued intermediate.
  const arrays = new Map<string, number>();
  let end = 0;
  for (const [name, n] of lengths) {
    arrays.set(name, end);
    end += n * DOUBLE;
  }
  ctx.arrays = arrays;
  ctx.localNames = new Set(
    scheduled.steps.filter((s) => s.kind !== "fill").map((s) => s.name),
  );
  const decls = ["    (local $__i i32)\n", "    (local $__v f64)\n"];
  const sets: string[] = [];
  const loop = (k: number, n: number, body: string) =>
    `    (local.set $__i (i32.const 0))\n` +
    `    (loop $L${k} ${body} (local.set $__i (i32.add (local.get $__i) (i32.const 1))) (br_if $L${k} (i32.lt_u (local.get $__i) (i32.const ${n}))))\n`;
  scheduled.steps.forEach((step, k) => {
    const expr = step.expr.toWat(ctx);
    if (step.kind === "scalar") {
      decls.push(`    (local $${step.name} f64)\n`);
      sets.push(`    (local.set $${step.name} ${expr})\n`);
    } else if (step.kind === "fill") {
      const addr = `(i32.add (global.get $__arrays) (i32.shl (local.get $__i) (i32.const 3)))`;
      sets.push(
        loop(
          k,
          step.length,
          `(f64.store offset=${arrays.get(step.name)!} ${addr} ${expr})`,
        ),
      );
    } else {
      const acc = `$${step.name}`;
      decls.push(`    (local ${acc} f64)\n`);
      if (step.op === "Sum") {
        sets.push(`    (local.set ${acc} (f64.const 0))\n`);
        sets.push(
          loop(
            k,
            step.length,
            `(local.set ${acc} (f64.add (local.get ${acc}) ${expr}))`,
          ),
        );
      } else {
        // NaN propagates, as in np.max / np.min
        const [start, cmp] =
          step.op === "MaxOf" ? ["-inf", "gt"] : ["inf", "lt"];
        sets.push(`    (local.set ${acc} (f64.const ${start}))\n`);
        sets.push(
          loop(
            k,
            step.length,
            `(local.set $__v ${expr}) (local.set ${acc} (select (local.get $__v) (local.get ${acc}) (i32.or (f64.${cmp} (local.get $__v) (local.get ${acc})) (f64.ne (local.get $__v) (local.get $__v)))))`,
          ),
        );
      }
    }
  });
  const stores: string[] = [];
  for (const [name, values] of data) {
    const at = arrays.get(name);
    if (at === undefined) continue;
    values.forEach((v, i) =>
      stores.push(
        `    (f64.store offset=${at + i * DOUBLE} (local.get 0) ${f64(v)})`,
      ),
    );
  }
  const module = `
  ;; Array region (mxl-schemas ADR 0015): data, then array buffers
  (global $__arrays (mut i32) (i32.const 0))
  (func (export "arrays_bytes") (result i32) (i32.const ${end}))
  (func (export "init") (param i32)
    (global.set $__arrays (local.get 0))
${stores.join("\n")}
  )
`;
  return {
    decls: decls.join(""),
    sets: sets.join(""),
    outputs: scheduled.outputs.map((o) => o.toWat(ctx)),
    module,
  };
}

function f64(v: number): string {
  if (Number.isNaN(v)) return "(f64.const nan)";
  if (!Number.isFinite(v)) return `(f64.const ${v < 0 ? "-" : ""}inf)`;
  return `(f64.const ${v})`;
}

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
  data?: ArrayData,
): string {
  const ctx: WatContext = {
    varIndex: new Map(varNames.map((n, i) => [n, i])),
    parIndex: new Map(parNames.map((n, i) => [n, i])),
    timeVar,
  };
  const body = watBody(
    outputs.map((o) => o.expr),
    ctx,
    intermediates,
    data,
  );
  const localDecls = body.decls;
  const localSets = body.sets;

  const stores = body.outputs
    .map((out, i) => {
      const offset = i * 8;
      return `    (f64.store (i32.add (local.get 3) (i32.const ${offset})) ${out})`;
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

${body.module}  ;; ODE RHS: void(i32 n, f64 t, i32 y_ptr, i32 f_ptr, i32 rpar_ptr)
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
  data?: ArrayData,
): string {
  return buildWatModule(
    equations,
    varNames,
    parNames,
    timeVar,
    intermediates,
    data,
  );
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
  data?: ArrayData,
): string {
  return buildWatModule(
    outputs,
    varNames,
    parNames,
    timeVar,
    intermediates,
    data,
  );
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
  data?: ArrayData,
): string {
  const ctx: WatContext = {
    varIndex: new Map(varNames.map((n, i) => [n, i])),
    parIndex: new Map(parNames.map((n, i) => [n, i])),
    lambdaIndex: new Map(lambdaNames.map((n, i) => [n, i])),
    timeVar,
  };
  const body = watBody(
    [...dlambda.map((o) => o.expr), ...dtheta.map((o) => o.expr)],
    ctx,
    intermediates,
    data,
  );
  const localDecls = body.decls;
  const localSets = body.sets;

  const dlambdaStores = body.outputs
    .slice(0, dlambda.length)
    .map((out, i) => {
      const offset = i * 8;
      return `    (f64.store (i32.add (local.get 5) (i32.const ${offset})) ${out})`;
    })
    .join("\n");

  const dthetaStores = body.outputs
    .slice(dlambda.length)
    .map((out, i) => {
      const offset = i * 8;
      return `    (f64.store (i32.add (local.get 6) (i32.const ${offset})) ${out})`;
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

${body.module}  ;; Adjoint RHS: void(i32 n, f64 t, i32 y_ptr, i32 lambda_ptr, i32 pars_ptr,
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
