import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The solvers in src-c are vendored from mxl-solvers by its scripts/vendor.sh, which
// records a sha256 per file in src-c/VENDORED. Fix solvers in
// https://github.com/Computational-Biology-Aachen/mxl-solvers and re-vendor them,
// rather than editing the copies here.
const SRC_C = resolve(process.cwd(), "src-c");
/** The only files in src-c that belong to mxlweb-core rather than mxl-solvers. */
const LOCAL = new Set(["VENDORED", "cvode_wrapper.c"]);

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(resolve(dir, e.name))
      : [relative(SRC_C, resolve(dir, e.name))],
  );

describe("vendored solvers", () => {
  it("are unmodified copies from mxl-solvers", () => {
    const entries = readFileSync(resolve(SRC_C, "VENDORED"), "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/));
    expect(entries.length).toBeGreaterThan(0);
    for (const [digest, name] of entries) {
      const actual = createHash("sha256")
        .update(readFileSync(resolve(SRC_C, name)))
        .digest("hex");
      expect(actual, `${name} differs from mxl-solvers`).toBe(digest);
    }
  });

  it("are exactly the files VENDORED lists, plus the local ones", () => {
    // Like mxlpy-native's test_vendor.py: a file dropped in by hand (or left
    // behind when mxl-solvers removes one) fails here.
    const listed = readFileSync(resolve(SRC_C, "VENDORED"), "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/)[1]);
    const present = listFiles(SRC_C).filter((f) => !LOCAL.has(f));
    expect(present.sort()).toEqual([...listed].sort());
  });
});
