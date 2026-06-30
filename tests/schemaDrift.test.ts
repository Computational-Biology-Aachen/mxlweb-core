import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  kineticSchema,
  odeSchema,
  steadyStateSchema,
} from "../src/mxl/schemas.js";
import { describe, expect, it } from "vitest";

// Guards the vendored copies in `src/mxl/schemas.ts` against the canonical
// mxl-schemas source. The copy lets the parser validate offline/in-browser;
// this test fails if it drifts. The canonical source is the sibling
// `mxl-schemas` repo, checked out as a submodule next to this package in the
// meta-repo. When it is not present (e.g. the standalone mxlweb-core checkout)
// the comparison is skipped rather than failing the suite.
const SCHEMA_DIR = resolve(process.cwd(), "../mxl-schemas/v1");

const CASES: Array<[string, string, Record<string, unknown>]> = [
  ["kinetic", "kinetic-model.schema.json", kineticSchema],
  ["ode", "ode-model.schema.json", odeSchema],
  ["steady-state", "steady-state-model.schema.json", steadyStateSchema],
];

describe("vendored schemas match canonical mxl-schemas", () => {
  for (const [kind, file, vendored] of CASES) {
    it(`${kind} schema is up to date`, (ctx) => {
      let canonical: unknown;
      try {
        canonical = JSON.parse(readFileSync(resolve(SCHEMA_DIR, file), "utf8"));
      } catch {
        ctx.skip();
        return;
      }
      expect(vendored).toEqual(canonical);
    });
  }
});
