import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The solvers in src-c are vendored from mxl-solvers by its scripts/vendor.sh, which
// records a sha256 per file in src-c/VENDORED. Fix solvers in
// https://github.com/Computational-Biology-Aachen/mxl-solvers and re-vendor them,
// rather than editing the copies here.
const SRC_C = resolve(process.cwd(), "src-c");

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
});
