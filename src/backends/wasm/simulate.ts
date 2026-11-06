/**
 * simulate.ts — one simulation on the WASM runtime, independent of how the
 * runtime was loaded: wasmWorker.ts runs it in a browser Worker, nodeLoader.ts
 * makes it usable headless.
 */
import type { SimulationRequest } from "../../index.js";
import type {
  CvodeModule,
  EmscriptenModule,
  Runtime,
  SimulationModule,
} from "./wasmLoader.js";

const WASM_SOLVERS = [
  "radau5",
  "dop853",
  "dopri5",
  "lsoda",
  "cvode_bdf",
  "cvode_adams",
] as const;
type WasmSolver = (typeof WASM_SOLVERS)[number];
/** Solvers that can output exactly the requested `tEval` times. */
const DENSE_SOLVERS: ReadonlySet<WasmSolver> = new Set([
  "radau5",
  "lsoda",
  "cvode_bdf",
  "cvode_adams",
]);

/** The solver a request's `method` picks; anything unknown runs RADAU5. */
export function wasmSolver(method: string): WasmSolver {
  return (WASM_SOLVERS as readonly string[]).includes(method)
    ? (method as WasmSolver)
    : "radau5";
}

/** Which Emscripten runtime (static/wasm/<runtime>.wasm) a method runs in. */
export function runtimeFor(method: string): Runtime {
  return wasmSolver(method).startsWith("cvode_") ? "cvode" : "radau5";
}

type RunFn = (
  n: number,
  tStart: number,
  tEnd: number,
  yPtr: number,
  rparPtr: number,
  rtol: number,
  atol: number,
  hInit: number,
  nmax: number,
) => number;

function runFnFor(mod: SimulationModule, solver: WasmSolver): RunFn {
  if (solver === "cvode_bdf" || solver === "cvode_adams") {
    if (!("_run_cvode" in mod)) {
      throw new Error(`${solver} needs the cvode runtime (loadCvode)`);
    }
    const adams = solver === "cvode_adams" ? 1 : 0;
    return (...args) => (mod as CvodeModule)._run_cvode(...args, adams);
  }
  if (!("_run_radau5" in mod)) {
    throw new Error(`${solver} needs the radau5 runtime (loadRadau)`);
  }
  const radau = mod as EmscriptenModule;
  return {
    radau5: radau._run_radau5,
    dop853: radau._run_dop853,
    dopri5: radau._run_dopri5,
    lsoda: radau._run_lsoda,
  }[solver];
}
type RhsFn = (n: number, t: number, y: number, f: number, p: number) => void;

export const DEFAULT_RTOL = 1e-6;
export const DEFAULT_ATOL = 1e-8;
const DEFAULT_SS_TOL = 1e-6;
const SS_STEP = 100;
const DEFAULT_SS_T_MAX = 1e5;

// Resample irregular time series to nPoints evenly-spaced times
function resampleUniform(
  time: number[],
  y: number[][],
  nPoints: number,
): { time: number[]; y: number[][] } {
  if (time.length === 0 || nPoints <= 0) return { time, y };
  if (time.length === 1) {
    return { time: Array(nPoints).fill(time[0]), y: Array(nPoints).fill(y[0]) };
  }
  const tStart = time[0];
  const tEnd = time[time.length - 1];
  const outTime: number[] = [];
  const outY: number[][] = [];
  for (let k = 0; k < nPoints; k++) {
    const t =
      nPoints === 1 ? tStart : tStart + (k / (nPoints - 1)) * (tEnd - tStart);
    outTime.push(t);
    let lo = 0,
      hi = time.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (time[mid] <= t) lo = mid;
      else hi = mid;
    }
    if (hi === lo || time[hi] === time[lo]) {
      outY.push([...y[lo]]);
    } else {
      const alpha = (t - time[lo]) / (time[hi] - time[lo]);
      outY.push(y[lo].map((v, j) => v + alpha * (y[hi][j] - v)));
    }
  }
  return { time: outTime, y: outY };
}

/** Advances `y` from tStart to tEnd. With `grid`, output is exactly those times. */
function runSegment(
  mod: SimulationModule,
  n: number,
  tStart: number,
  tEnd: number,
  y: Float64Array,
  pars: Float64Array,
  rtol: number,
  atol: number,
  nout: number,
  solver: WasmSolver,
  grid?: number[],
): { time: number[]; y: number[][] } {
  const yPtr = mod._malloc(n * 8);
  const rparPtr = mod._malloc(pars.length * 8);
  const gridPtr = grid ? mod._malloc(Math.max(grid.length, 1) * 8) : 0;
  try {
    mod.HEAPF64.set(y, yPtr / 8);
    mod.HEAPF64.set(pars, rparPtr / 8);
    mod._init_output(Math.max(nout, 1000), n);
    if (grid) {
      mod.HEAPF64.set(grid, gridPtr / 8);
      mod._set_output_grid(gridPtr, grid.length);
    }

    const idid = runFnFor(mod, solver)(
      n,
      tStart,
      tEnd,
      yPtr,
      rparPtr,
      rtol,
      atol,
      0,
      500000,
    );

    if (idid < 0) {
      console.error(
        `[wasm] ${solver.toUpperCase()} IDID=${idid} at t=[${tStart},${tEnd}] n=${n}`,
      );
      throw new Error(
        `${solver.toUpperCase()} failed with IDID=${idid} (t=[${tStart.toFixed(3)},${tEnd.toFixed(3)}])`,
      );
    }

    const outN = mod._get_out_n();
    const tPtr = mod._get_out_t();
    const yOutPtr = mod._get_out_y();

    const time = Array.from(mod.HEAPF64.subarray(tPtr / 8, tPtr / 8 + outN));
    const yOut: number[][] = Array.from({ length: outN }, (_, step) =>
      Array.from(
        mod.HEAPF64.subarray(
          yOutPtr / 8 + step * n,
          yOutPtr / 8 + (step + 1) * n,
        ),
      ),
    );

    // Always read the true endpoint from the heap — the output buffer may not
    // reach tEnd if the solver took more steps than the buffer capacity.
    y.set(mod.HEAPF64.subarray(yPtr / 8, yPtr / 8 + n));

    if (grid) {
      // A grid time rounded just past the solver's final x is still the endpoint.
      for (const t of grid.slice(time.length)) {
        time.push(t);
        yOut.push(Array.from(y));
      }
    } else {
      // Append the true endpoint if the buffer stopped short of tEnd.
      const lastT = time.length > 0 ? time[time.length - 1] : -Infinity;
      if (
        time.length === 0 ||
        Math.abs(lastT - tEnd) > 1e-10 * (1 + Math.abs(tEnd))
      ) {
        time.push(tEnd);
        yOut.push(Array.from(y));
      }
    }

    mod._free_output();
    return { time, y: yOut };
  } finally {
    mod._free(yPtr);
    mod._free(rparPtr);
    if (gridPtr) mod._free(gridPtr);
  }
}

function applySegmentPars(
  seg: Record<string, number>,
  pars: Float64Array,
  parNames: string[] | undefined,
) {
  if (!parNames) return;
  for (const [key, val] of Object.entries(seg)) {
    if (key === "t_end") continue;
    const idx = parNames.indexOf(key);
    if (idx >= 0) pars[idx] = val;
  }
}

/** Calls the compiled RHS directly, outside any integrator. */
function makeRhs(
  mod: SimulationModule,
  rhs: RhsFn,
  n: number,
  pars: Float64Array,
) {
  const yPtr = mod._malloc(n * 8);
  const fPtr = mod._malloc(n * 8);
  const pPtr = mod._malloc(Math.max(pars.length, 1) * 8);
  return {
    eval(t: number, y: ArrayLike<number>, p: ArrayLike<number> = pars) {
      mod.HEAPF64.set(y, yPtr / 8);
      mod.HEAPF64.set(p, pPtr / 8);
      rhs(n, t, yPtr, fPtr, pPtr);
      return Array.from(mod.HEAPF64.subarray(fPtr / 8, fPtr / 8 + n));
    },
    free() {
      mod._free(yPtr);
      mod._free(fPtr);
      mod._free(pPtr);
    },
  };
}

export interface SimulationOutput {
  time: number[];
  values: number[][];
  /** dy/dt per output point, if `returnRhs` was requested. */
  rhs?: number[][];
  /** The state at the end of integration, for chaining runs. */
  finalState: number[];
}

/**
 * Runs one {@link SimulationRequest}. `mod` must be the runtime
 * {@link runtimeFor} names for the request's method. `compile` turns the
 * request's WAT into an instance sharing `mod`'s memory. Throws on solver
 * failure, or if a requested steady state does not converge.
 */
export async function simulate(
  mod: SimulationModule,
  req: SimulationRequest,
  compile: (wat: string) => Promise<WebAssembly.Instance>,
): Promise<SimulationOutput> {
  const {
    rhsWat,
    allDerivedFn,
    selectDerivedFn,
    initialValues,
    tEnd,
    pars,
    parNames,
    nTimePoints,
    method,
    protocol,
    calculateDerived,
    tEval,
    steadyState,
    returnRhs,
  } = req;

  const solver = wasmSolver(method);
  if (tEval && !DENSE_SOLVERS.has(solver)) {
    throw new Error(
      `tEval is only supported by RADAU5, LSODA and CVODE, not ${solver}`,
    );
  }
  if (!rhsWat) throw new Error("rhsWat missing for WASM solver");

  // Compile model WASM and register in function table
  const instance = await compile(rhsWat);
  const fcn = instance.exports.fcn as RhsFn;
  const modelIdx = mod.addFunction(
    fcn as unknown as (...args: unknown[]) => unknown,
    "vidiii",
  );
  mod._set_model_fn(modelIdx);

  const rtol = req.rtol ?? DEFAULT_RTOL;
  const atol = req.atol ?? DEFAULT_ATOL;
  const n = initialValues.length;
  const y = new Float64Array(initialValues);
  const parsArr = new Float64Array(pars);
  const rhs = makeRhs(mod, fcn, n, parsArr);

  let allTime: number[] = [];
  let allY: number[][] = [];
  // Parameters in effect for each output point — protocol segments override
  // params (e.g. PPFD during a saturating pulse), and derived variables must
  // be evaluated with the segment's params, not the base set.
  const allPars: number[][] = [];

  const segment = (from: number, to: number, grid?: number[]) =>
    runSegment(
      mod,
      n,
      from,
      to,
      y,
      parsArr,
      rtol,
      atol,
      nTimePoints,
      solver,
      grid,
    );

  try {
    if (steadyState) {
      // Same criterion as MxlPy's integrate_to_steady_state, so scans agree with
      // it: the state moves by less than `tol` over a whole step of length 100.
      const tol = steadyState.tol ?? DEFAULT_SS_TOL;
      const tMax = steadyState.tMax ?? DEFAULT_SS_T_MAX;
      let t = 0;
      for (;;) {
        if (t >= tMax) {
          throw new Error(`No steady state within t=${tMax} (tol=${tol})`);
        }
        const before = Array.from(y);
        segment(t, t + SS_STEP);
        t += SS_STEP;
        const moved = Math.sqrt(
          before.reduce((sum, v, i) => sum + (y[i] - v) ** 2, 0),
        );
        if (moved < tol) break;
      }
      allTime = [t];
      allY = [Array.from(y)];
      allPars.push(Array.from(parsArr));
    } else if (protocol && protocol.length > 0) {
      let t = 0;
      let gridIdx = 0;
      for (const seg of protocol) {
        applySegmentPars(seg, parsArr, parNames);
        if (tEval) {
          // A boundary time belongs to the segment ending there.
          const end = gridIdx;
          let stop = end;
          while (stop < tEval.length && tEval[stop] <= seg.t_end) stop++;
          const result = segment(t, seg.t_end, tEval.slice(end, stop));
          gridIdx = stop;
          allTime.push(...result.time);
          for (const row of result.y) allY.push(row);
          const segPars = Array.from(parsArr);
          for (let k = 0; k < result.time.length; k++) allPars.push(segPars);
        } else {
          const result = segment(t, seg.t_end);
          // Resample each segment to nTimePoints uniform times, matching Python's t_eval per segment.
          // Skip first point of subsequent segments to avoid duplicates at boundaries.
          const { time: segTime, y: segY } = resampleUniform(
            result.time,
            result.y,
            nTimePoints,
          );
          const skip = allTime.length > 0 ? 1 : 0;
          const addedTime = segTime.slice(skip);
          allTime = allTime.concat(addedTime);
          allY = allY.concat(segY.slice(skip));
          const segPars = Array.from(parsArr);
          for (let k = 0; k < addedTime.length; k++) allPars.push(segPars);
        }
        t = seg.t_end;
      }
    } else {
      const result = tEval ? segment(0, tEnd, tEval) : segment(0, tEnd);
      const out = tEval
        ? result
        : resampleUniform(result.time, result.y, nTimePoints);
      allTime = out.time;
      allY = out.y;
      const segPars = Array.from(parsArr);
      for (let k = 0; k < allTime.length; k++) allPars.push(segPars);
    }

    // Compute derived variables in JS, using the parameters in effect for each
    // output point (so e.g. Fluo at a saturating pulse uses that pulse's PPFD).
    let values: number[][] = allY;
    if (calculateDerived && allDerivedFn) {
      const allDerivedFnEval = eval(`(${allDerivedFn})`);
      const selectDerivedFnEval = eval(`(${selectDerivedFn})`);
      values = allY.map((yRow, i) => {
        const allDerived = allDerivedFnEval(
          allTime[i],
          yRow,
          allPars[i] ?? pars,
        );
        return [...yRow, ...selectDerivedFnEval(allDerived)];
      });
    }

    return {
      time: allTime,
      values,
      finalState: Array.from(y),
      ...(returnRhs
        ? { rhs: allY.map((row, i) => rhs.eval(allTime[i], row, allPars[i])) }
        : {}),
    };
  } finally {
    rhs.free();
    mod.removeFunction(modelIdx);
  }
}
