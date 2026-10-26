import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalIdentifier,
  canonicalIdentifierMap,
  isCanonicalIdentifier,
  RESERVED,
  SYMBOLS,
  TRANSLITERATE,
  uniqueName,
} from "@computational-biology-aachen/mxlweb-core";
import { describe, expect, it } from "vitest";
import fixtures from "./identifiers.fixtures.json" with { type: "json" };

// Canonical mxl-schemas sources (the 0-admin meta-repo checkout); the drift
// checks are skipped when it is not present.
const SCHEMAS_DIR = resolve(process.cwd(), "../../misc/mxl-schemas");

function readCanonical(rel: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(SCHEMAS_DIR, rel), "utf8"));
  } catch {
    return undefined;
  }
}

describe("canonicalIdentifier", () => {
  it.each(fixtures.cases)("$input -> $output", ({ input, output }) => {
    expect(canonicalIdentifier(input)).toBe(output);
    expect(isCanonicalIdentifier(output)).toBe(true);
    expect(canonicalIdentifier(output)).toBe(output);
  });
});

describe("canonicalIdentifierMap", () => {
  it.each(fixtures.map_cases)("$inputs", ({ inputs, outputs }) => {
    const m = canonicalIdentifierMap(inputs.map((raw, i) => [`id${i}`, raw]));
    expect([...m.values()]).toEqual(outputs);
  });

  it.each(fixtures.collisions)("rejects %j", (...names) => {
    expect(() =>
      canonicalIdentifierMap(names.map((raw, i) => [`id${i}`, raw])),
    ).toThrow(/both map to the identifier/);
  });
});

describe("uniqueName", () => {
  it("suffixes _2, _3, ... on collision and claims the result", () => {
    const taken = new Set(["x", "x_2"]);
    expect(uniqueName("x", taken)).toBe("x_3");
    expect(uniqueName("x", taken)).toBe("x_4");
    expect(taken.has("x_4")).toBe(true);
  });
});

describe("vendored identifier rules match canonical mxl-schemas", () => {
  it("reserved names and transliteration table", (ctx) => {
    const spec = readCanonical("v1/identifiers.json") as
      { reserved: string[]; transliterate: Record<string, string> } | undefined;
    if (spec === undefined) return ctx.skip();
    expect(new Set(spec.reserved)).toEqual(RESERVED);
    expect(spec.symbols).toEqual(SYMBOLS);
    expect(spec.transliterate).toEqual(TRANSLITERATE);
  });

  it("fixtures", (ctx) => {
    const canonical = readCanonical("tests/identifiers.fixtures.json");
    if (canonical === undefined) return ctx.skip();
    expect(fixtures).toEqual(canonical);
  });
});
