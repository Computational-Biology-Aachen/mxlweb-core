/**
 * Regression tests for time-dependent intermediates.
 *
 * `sortDependencies()` used to omit `time` from its available symbols, so any
 * reaction/assignment referencing `time` never resolved; with two or more of
 * them, `topoSort` silently dropped all of them, and `Name.toWat` compiled the
 * dangling references to `(f64.const 0)`. The WASM backend then simulated a
 * different model with no error (Li 2021: `v_CBB` and `v_pmf_protons_activity`
 * were zero; Fuente 2024: everything downstream of `osc_light`).
 */
import { KineticModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import {
  Add,
  Mul,
  Name,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wat2wasm from "wat-compiler";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(__dirname, "..", "static", "wasm");

// Two time-dependent reactions (the minimal shape that made the old topoSort
// drop both) plus an assignment downstream of one of them.
// dx/dt = k * time, dy/dt = time  =>  x(t) = k t^2 / 2, y(t) = t^2 / 2
function timeModel(): KineticModelBuilder {
  return new KineticModelBuilder()
    .addParameter("k", { value: 2 })
    .addVariable("x", { value: 0 })
    .addVariable("y", { value: 0 })
    .addReaction("v_kt", {
      fn: new Mul([new Name("k"), new Name("time")]),
      stoichiometry: [{ name: "x", value: new Name("one") }],
    })
    .addReaction("v_t", {
      fn: new Name("time"),
      stoichiometry: [{ name: "y", value: new Name("one") }],
    })
    .addAssignment("v_sum", {
      fn: new Add([new Name("v_kt"), new Name("v_t")]),
    })
    .addParameter("one", { value: 1 });
}

describe("sortDependencies with time", () => {
  it("resolves every time-dependent intermediate and its dependants", () => {
    const order = timeModel().sortDependencies();
    expect(new Set(order)).toEqual(new Set(["v_kt", "v_t", "v_sum"]));
    expect(order.indexOf("v_sum")).toBeGreaterThan(order.indexOf("v_kt"));
    expect(order.indexOf("v_sum")).toBeGreaterThan(order.indexOf("v_t"));
  });

  it("throws on an unknown symbol, naming it", () => {
    const m = timeModel().addAssignment("bad", {
      fn: new Mul([new Name("k"), new Name("undefined_thing")]),
    });
    expect(() => m.sortDependencies()).toThrow(/bad \(needs undefined_thing\)/);
  });

  it("throws on a dependency cycle", () => {
    const m = new KineticModelBuilder()
      .addParameter("k", { value: 1 })
      .addAssignment("a", { fn: new Mul([new Name("k"), new Name("b")]) })
      .addAssignment("b", { fn: new Mul([new Name("k"), new Name("a")]) });
    expect(() => m.sortDependencies()).toThrow(/Unresolvable dependencies/);
  });
});

describe("WAT codegen with time", () => {
  it("reads time from the fcn time param", () => {
    const wat = timeModel().buildWat();
    expect(wat).toContain("(local.set $v_kt");
    expect(wat).toContain("(local.set $v_t");
    expect(wat).toContain("(local.get 1)");
  });

  it("throws on an unknown symbol instead of compiling it to 0", () => {
    expect(() =>
      new Name("nope").toWat({ varIndex: new Map(), parIndex: new Map() }),
    ).toThrow(/Unknown symbol "nope"/);
  });
});

interface RadauModule {
  addFunction(fn: (...args: unknown[]) => unknown, sig: string): number;
  removeFunction(idx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _set_model_fn(idx: number): void;
  _init_output(capacity: number, dim: number): void;
  _free_output(): void;
  _run_radau5(...args: number[]): number;
  HEAPF64: Float64Array;
  wasmMemory: WebAssembly.Memory;
}

describe("WASM RADAU5 with time-dependent reactions", () => {
  let mod: RadauModule;

  beforeAll(async () => {
    // Same glue-loading workaround as fit.test.ts.
    const js = fs.readFileSync(path.join(wasmDir, "radau5.js"), "utf8");
    const cjsPath = path.join(
      os.tmpdir(),
      "mxlweb-core-radau5-glue-time.generated.cjs",
    );
    fs.writeFileSync(cjsPath, js + "\nmodule.exports = RadauModule;\n");
    const require = createRequire(import.meta.url);
    const factory = require(cjsPath) as (opts: {
      locateFile: (f: string) => string;
    }) => Promise<RadauModule>;
    mod = await factory({ locateFile: (f) => path.join(wasmDir, f) });
  });

  it("matches the analytic solution", () => {
    const model = timeModel();
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(wat2wasm(model.buildWat())),
      {
        env: { memory: mod.wasmMemory },
        math: mathImports() as WebAssembly.ModuleImports,
      },
    );
    const idx = mod.addFunction(
      instance.exports.fcn as (...args: unknown[]) => unknown,
      "vidiii",
    );
    const y0 = model.resolveInitialValues();
    const pars = model.resolveParameters();
    const yPtr = mod._malloc(y0.length * 8);
    const pPtr = mod._malloc(pars.length * 8);
    try {
      mod.HEAPF64.set(y0, yPtr / 8);
      mod.HEAPF64.set(pars, pPtr / 8);
      mod._set_model_fn(idx);
      mod._init_output(1000, y0.length);
      const tEnd = 3;
      const idid = mod._run_radau5(
        y0.length,
        0,
        tEnd,
        yPtr,
        pPtr,
        1e-10,
        1e-12,
        0,
        500000,
      );
      expect(idid).toBeGreaterThan(0);
      const [x, y] = mod.HEAPF64.subarray(yPtr / 8, yPtr / 8 + 2);
      expect(x).toBeCloseTo((2 * tEnd ** 2) / 2, 8);
      expect(y).toBeCloseTo(tEnd ** 2 / 2, 8);
    } finally {
      mod._free_output();
      mod._free(yPtr);
      mod._free(pPtr);
      mod.removeFunction(idx);
    }
  });
});
