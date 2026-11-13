/**
 * Array-valued intermediates (mxl-schemas ADR 0015) against the shared
 * cross-language fixtures: a model whose light per wavelength depends on its
 * state, reduced before the right-hand side. Every backend has to reproduce
 * the reference right-hand side and exact Jacobians, and every invalid model
 * must be rejected. Skipped outside the 0-admin meta-repo layout, like the
 * expression fixtures.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelBuilderBase } from "@computational-biology-aachen/mxlweb-core";
import { mathImports } from "@computational-biology-aachen/mxlweb-core/backends/wasm";
import { modelToSbml } from "@computational-biology-aachen/mxlweb-core/sbml";
import { evaluate } from "@computational-biology-aachen/mxlweb-core/mathml";
// dist, like the package imports above, so node classes are the same ones
import { unrollArrays } from "../dist/arrays.js";
import { irArrayLengths } from "../dist/modelIr.js";
import type { KineticModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import {
  mxlJsonToModel,
  type MxlJsonDocument,
} from "@computational-biology-aachen/mxlweb-core/mxl";
import wat2wasm from "wat-compiler";
import { beforeAll, describe, expect, it } from "vitest";
import type { MxlDataDocument } from "../src/data.js";
import {
  compileModelNode,
  loadRadauNode,
} from "../src/backends/wasm/nodeLoader.js";
import { simulate } from "../src/backends/wasm/simulate.js";
import type { SimulationModule } from "../src/backends/wasm/wasmLoader.js";

type Point = {
  variables: Record<string, number>;
  derived: Record<string, number>;
  rhs: Record<string, number>;
  dfdy: Record<string, Record<string, number>>;
  dfdp: Record<string, Record<string, number>>;
};
type Fixtures = {
  model: MxlJsonDocument;
  data: MxlDataDocument;
  points: Point[];
  errors: Array<{
    description: string;
    model: MxlJsonDocument;
    data: MxlDataDocument;
  }>;
};

let fixtures: Fixtures | undefined;
try {
  fixtures = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../../misc/mxl-schemas/tests/array-models.fixtures.json",
      ),
      "utf8",
    ),
  );
} catch {
  fixtures = undefined;
}

const REL = 1e-10;
function close(got: number, expected: number, what: string): void {
  expect(
    Math.abs(got - expected),
    `${what}: ${got} vs ${expected}`,
  ).toBeLessThanOrEqual(REL * Math.abs(expected) + 1e-300);
}

/** Compiles a model module in its own memory; arrays go at `ARRAYS`. */
const ARRAYS = 4096;
function instantiate(wat: string): {
  exports: WebAssembly.Exports;
  heap: Float64Array;
} {
  const memory = new WebAssembly.Memory({ initial: 4 });
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(wat2wasm(wat)),
    { env: { memory }, math: mathImports() },
  );
  const init = instance.exports.init as ((base: number) => void) | undefined;
  init?.(ARRAYS);
  return { exports: instance.exports, heap: new Float64Array(memory.buffer) };
}

describe.skipIf(fixtures === undefined)(
  "array-valued intermediates (mxl-schemas fixtures)",
  () => {
    const fx = fixtures ?? ({ points: [], errors: [] } as unknown as Fixtures);
    const model = () => mxlJsonToModel(fx.model, new Map(), fx.data);
    let builder: ModelBuilderBase;
    let varNames: string[];
    let parNames: string[];
    let pars: number[];
    beforeAll(() => {
      builder = model();
      const ir = builder.lower();
      varNames = ir.varNames;
      parNames = ir.parNames;
      pars = parNames.map((p) => ir.paramValues.get(p)!);
    });
    const ys = (p: Point) => varNames.map((v) => p.variables[v]);

    it("lowers to arrays with their data", () => {
      const ir = builder.lower();
      expect([...ir.data!.keys()].sort()).toEqual(
        ["I0", "__w0", "a1", "a2"].sort(),
      );
    });

    it("JS right-hand side", () => {
      const rhs = new Function(`return (${builder.buildJs()})`)();
      for (const p of fx.points) {
        const out = rhs(0, ys(p), pars) as number[];
        varNames.forEach((v, i) => close(out[i], p.rhs[v], v));
      }
    });

    it("JS derived quantities leave the arrays out", () => {
      const { allDerived } = builder.buildJsDerived();
      const fn = new Function(`return (${allDerived})`)();
      const names = builder.derivedNames();
      expect(names).not.toContain("I_loc");
      expect(names).not.toContain("k_att");
      for (const p of fx.points) {
        const out = fn(0, ys(p), pars) as number[];
        expect(out).toHaveLength(names.length);
        for (const [k, expected] of Object.entries(p.derived)) {
          close(out[names.indexOf(k)], expected, k);
        }
      }
    });

    it("WAT right-hand side", () => {
      const { exports, heap } = instantiate(builder.buildWat());
      const fcn = exports.fcn as (...a: number[]) => void;
      for (const p of fx.points) {
        heap.set(ys(p), 0);
        heap.set(pars, 16);
        fcn(varNames.length, 0, 0, 64, 128);
        varNames.forEach((v, i) => close(heap[8 + i], p.rhs[v], v));
      }
    });

    it("WAT derived quantities", () => {
      const keys = Object.keys(fx.points[0].derived);
      const { exports, heap } = instantiate(builder.buildWatDerived(keys));
      const fcn = exports.fcn as (...a: number[]) => void;
      for (const p of fx.points) {
        heap.set(ys(p), 0);
        heap.set(pars, 16);
        fcn(varNames.length, 0, 0, 64, 128);
        keys.forEach((k, i) => close(heap[8 + i], p.derived[k], k));
      }
    });

    it("Jacobian WAT gives the exact dfdy and dfdp", () => {
      const nY = varNames.length;
      const nAug = nY + nY * parNames.length;
      const { exports, heap } = instantiate(builder.buildJacobianWat(parNames));
      const fcn = exports.fcn as (...a: number[]) => void;
      // ds_{k,j}/dt = Σ_m dfdy[k][m] s_{m,j} + dfdp[k][j], s laid out j-major
      const eval_ = (y: number[], s: number[]) => {
        heap.set([...y, ...s], 0);
        heap.set(pars, 200);
        fcn(nAug, 0, 0, 100 * 8, 200 * 8);
        return Array.from(heap.subarray(100 + nY, 100 + nAug));
      };
      for (const p of fx.points) {
        const zero = eval_(ys(p), new Array(nY * parNames.length).fill(0));
        parNames.forEach((par, j) =>
          varNames.forEach((v, k) =>
            close(zero[j * nY + k], p.dfdp[v][par], `d${v}/d${par}`),
          ),
        );
        varNames.forEach((m, mi) => {
          const s = new Array(nY * parNames.length).fill(0);
          s[mi] = 1; // s_{m,0}
          const out = eval_(ys(p), s);
          varNames.forEach((v, k) =>
            close(out[k] - zero[k], p.dfdy[v][m], `d${v}/d${m}`),
          );
        });
      }
    });

    it("adjoint WAT gives -λᵀ dfdy and -λᵀ dfdp", () => {
      const nY = varNames.length;
      const { exports, heap } = instantiate(builder.buildAdjointWat(parNames));
      const fcn = exports.fcn as (...a: number[]) => void;
      for (const p of fx.points) {
        varNames.forEach((v, k) => {
          const lambda = varNames.map((_, i) => (i === k ? 1 : 0));
          heap.set(ys(p), 0);
          heap.set(lambda, 16);
          heap.set(pars, 32);
          fcn(nY, 0, 0, 128, 256, 512, 640);
          varNames.forEach((m, i) =>
            close(-heap[64 + i], p.dfdy[v][m], `d${v}/d${m}`),
          );
          parNames.forEach((par, j) =>
            close(-heap[80 + j], p.dfdp[v][par], `d${v}/d${par}`),
          );
        });
      }
    });

    it("derived-gradient WAT matches finite differences", () => {
      const keys = ["peak", "spread"];
      const nY = varNames.length;
      const { exports, heap } = instantiate(
        builder.buildWatDerivedGrad(keys, parNames),
      );
      const fcn = exports.fcn as (...a: number[]) => void;
      const { allDerived } = builder.buildJsDerived(keys);
      const derived = new Function(`return (${allDerived})`)();
      const names = builder
        .lower()
        .intermediates.map((m) => m.name)
        .filter((n) => n !== "k_att" && n !== "I_loc");
      const value = (y: number[], ps: number[], key: string) =>
        (derived(0, y, ps) as number[])[names.indexOf(key)];
      const p = fx.points[0];
      heap.set(ys(p), 0);
      heap.set(pars, 16);
      fcn(nY, 0, 0, 64, 128);
      const width = nY + parNames.length;
      keys.forEach((key, k) => {
        varNames.forEach((_, m) => {
          const h = 1e-6;
          const up = ys(p).map((x, i) => (i === m ? x + h : x));
          const down = ys(p).map((x, i) => (i === m ? x - h : x));
          const fd = (value(up, pars, key) - value(down, pars, key)) / (2 * h);
          expect(heap[8 + k * width + m]).toBeCloseTo(fd, 4);
        });
      });
    });

    it("Python export runs and matches", () => {
      const python = resolve(process.cwd(), "../../.venv/bin/python");
      if (!existsSync(python)) return;
      const src = builder.buildPython([]);
      const p = fx.points[1];
      const out = execFileSync(
        python,
        [
          "-c",
          `${src}\nprint([float(x) for x in model(0.0, ${JSON.stringify(ys(p))})])`,
        ],
        {
          encoding: "utf8",
        },
      );
      const values = JSON.parse(out.trim()) as number[];
      varNames.forEach((v, i) => close(values[i], p.rhs[v], v));
    });

    it("SBML export writes the arrays out as scalars", () => {
      const sbml = modelToSbml(builder as KineticModelBuilder, "arrays");
      expect(sbml).toContain('variable="I_loc_6"');
      expect(sbml).not.toContain("<ci>a1</ci>"); // data are inlined
      // the unrolled scalar model it is written from gives the same RHS
      const ir = builder.lower();
      const { defs } = unrollArrays(
        ir.intermediates,
        [],
        ir.data!,
        irArrayLengths(ir),
      );
      const p = fx.points[1];
      const values = new Map<string, number>([
        ...Object.entries(p.variables),
        ...ir.paramValues,
      ]);
      for (const d of defs) {
        values.set(d.name, evaluate(d.expr, (n) => values.get(n)!) as number);
      }
      varNames.forEach((v) =>
        close(
          evaluate(ir.dxdt.get(v)!, (n) => values.get(n)!) as number,
          p.rhs[v],
          v,
        ),
      );
    });

    it("rejects every invalid model", () => {
      for (const c of fx.errors) {
        expect(() => {
          mxlJsonToModel(c.model, new Map(), c.data).lower();
        }, c.description).toThrow();
      }
    });

    it("saves spec_version 1.3 and round-trips", () => {
      const doc = JSON.parse(builder.buildMxlJson("m")) as MxlJsonDocument;
      expect(doc.spec_version).toBe("1.3");
      const again = mxlJsonToModel(doc, new Map(), fx.data);
      const rhs = new Function(`return (${again.buildJs()})`)();
      const p = fx.points[0];
      const out = rhs(0, ys(p), pars) as number[];
      varNames.forEach((v, i) => close(out[i], p.rhs[v], v));
    });

    describe("on the WASM runtime", () => {
      let mod: SimulationModule;
      beforeAll(async () => {
        mod = await loadRadauNode();
      });
      it("simulates like the JS right-hand side", async () => {
        const rhs = new Function(`return (${builder.buildJs()})`)();
        // RK4 reference with tiny steps over a short horizon
        let y = ys(fx.points[0]);
        const tEnd = 0.002;
        const steps = 2000;
        const h = tEnd / steps;
        const add = (a: number[], b: number[], s: number) =>
          a.map((x, i) => x + s * b[i]);
        for (let i = 0; i < steps; i++) {
          const k1 = rhs(0, y, pars) as number[];
          const k2 = rhs(0, add(y, k1, h / 2), pars) as number[];
          const k3 = rhs(0, add(y, k2, h / 2), pars) as number[];
          const k4 = rhs(0, add(y, k3, h), pars) as number[];
          y = y.map(
            (x, j) => x + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]),
          );
        }
        const res = await simulate(
          mod,
          {
            requestId: "arrays",
            rhsWat: builder.buildWat(),
            allDerivedFn: "",
            selectDerivedFn: "",
            initialValues: ys(fx.points[0]),
            rhsNames: varNames,
            allDerivedNames: [],
            selectDerivedNames: [],
            tEnd,
            nTimePoints: 5,
            pars,
            parNames,
            method: "radau5",
            calculateDerived: false,
            rtol: 1e-10,
            atol: 1e-12,
          },
          (wat) => compileModelNode(wat, mod),
        );
        res.finalState.forEach((v, i) =>
          expect(Math.abs(v - y[i]) / Math.abs(y[i])).toBeLessThan(1e-7),
        );
      });
    });
  },
);
