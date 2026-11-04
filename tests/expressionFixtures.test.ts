import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluate,
  type JsonNode,
  nodeFromJson,
  parseExpression,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";

// The cross-language expression cases of mxl-schemas (ADR 0014): the string
// syntax parses to `tree`, and `tree` evaluates to `value`. Skipped outside
// the 0-admin meta-repo layout, like the schema drift test.
type Value = number | number[];
type Fixtures = {
  columns: Record<string, Value>;
  cases: Array<{ src: string; tree: JsonNode; value: Value }>;
  errors: string[];
};

let fixtures: Fixtures | undefined;
try {
  fixtures = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../../misc/mxl-schemas/tests/expressions.fixtures.json",
      ),
      "utf8",
    ),
  );
} catch {
  fixtures = undefined;
}

function close(actual: Value, expected: Value): void {
  const a = typeof actual === "number" ? [actual] : actual;
  const e = typeof expected === "number" ? [expected] : expected;
  expect(typeof actual).toBe(typeof expected);
  expect(a.length).toBe(e.length);
  a.forEach((x, i) => {
    expect(Math.abs(x - e[i])).toBeLessThanOrEqual(1e-12 * Math.abs(e[i]));
  });
}

describe.skipIf(fixtures === undefined)(
  "mxl-schemas expression fixtures",
  () => {
    // vitest still runs a skipped suite's factory to collect its tests, so
    // it must not touch the missing fixtures.
    const { columns, cases, errors } = fixtures ?? {
      columns: {},
      cases: [],
      errors: [],
    };
    const resolveName = (name: string) => {
      const v = columns[name];
      if (v === undefined) throw new Error(`unknown reference ${name}`);
      return v;
    };
    for (const c of cases) {
      it(c.src, () => {
        expect(parseExpression(c.src).toJson()).toEqual(c.tree);
        close(evaluate(nodeFromJson(c.tree), resolveName), c.value);
      });
    }
    for (const src of errors) {
      it(`rejects ${src}`, () => {
        expect(() => parseExpression(src)).toThrow();
      });
    }
  },
);
