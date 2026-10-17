import { describe, expect, it } from "vitest";
import {
  flattenExperiments,
  plainTimeCourse,
} from "../../src/backends/wasm/fitExperiments";
import type { FitInitRequest } from "../../src/index";

function request(
  experiments: FitInitRequest["experiments"],
  parNames = ["k", "u", "v"],
): FitInitRequest {
  return {
    requestId: "r",
    rhsWat: "(module)",
    nDerived: 0,
    y0: [0],
    pars: [1, 1, 1],
    parNames,
    fitIdx: [0],
    logFlags: [true],
    targets: [{ kind: "state", index: 0, scale: 1 }],
    experiments,
    solver: "radau5",
    rtol: 1e-8,
    atol: 1e-10,
  };
}

describe("flattenExperiments", () => {
  it("lays out protocol segments and steady-state conditions for fit_init", () => {
    const flat = flattenExperiments(
      request([
        {
          kind: "timeCourse",
          dataT: [0, 1, 2],
          dataY: [3, 4, 5],
          protocol: [
            { t_end: 1, u: 2 },
            { t_end: 2, v: 7 },
          ],
        },
        { kind: "steadyState", overrides: { v: 9 }, dataY: [6] },
      ]),
    );
    if (typeof flat === "string") throw new Error(flat);
    // Override columns in first-seen order: u, then v.
    expect(flat.ovrIdx).toEqual([1, 2]);
    expect(flat.expKind).toEqual([0, 1]);
    expect(flat.expNSeg).toEqual([2, 1]);
    expect(flat.expNPoints).toEqual([3, 1]);
    expect(flat.segTEnd).toEqual([1, 2, 0]);
    // A key a segment doesn't set is NaN (keep the trial value).
    expect(flat.segOvr).toEqual([2, NaN, NaN, 7, NaN, 9]);
    expect(flat.dataT).toEqual([0, 1, 2, 0]);
    expect(flat.dataY).toEqual([3, 4, 5, 6]);
  });

  it("gives a plain time course one override-free segment to its last point", () => {
    const flat = flattenExperiments(
      request([{ kind: "timeCourse", dataT: [0, 4], dataY: [1, 2] }]),
    );
    if (typeof flat === "string") throw new Error(flat);
    expect(flat.ovrIdx).toEqual([]);
    expect(flat.segTEnd).toEqual([4]);
  });

  it("rejects overrides of unknown parameters", () => {
    expect(
      flattenExperiments(
        request([{ kind: "steadyState", overrides: { nope: 1 }, dataY: [1] }]),
      ),
    ).toMatch(/nope/);
  });
});

describe("plainTimeCourse", () => {
  it("accepts exactly one protocol-free time course", () => {
    expect(
      plainTimeCourse(
        request([{ kind: "timeCourse", dataT: [0, 3], dataY: [1, 2] }]),
      ),
    ).toEqual({ dataT: [0, 3], dataY: [1, 2], tEnd: 3 });
  });

  it("rejects protocols and steady states", () => {
    expect(
      typeof plainTimeCourse(
        request([
          {
            kind: "timeCourse",
            dataT: [0],
            dataY: [1],
            protocol: [{ t_end: 1, u: 1 }],
          },
        ]),
      ),
    ).toBe("string");
    expect(
      typeof plainTimeCourse(
        request([{ kind: "steadyState", overrides: {}, dataY: [1] }]),
      ),
    ).toBe("string");
  });
});
