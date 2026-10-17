import { KineticModelBuilder } from "@computational-biology-aachen/mxlweb-core";
import {
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { describe, expect, it } from "vitest";
import type { ParsedCsv } from "../../src/fit/csvParse";
import {
  buildFitConfig,
  fitInitPayload,
  predictionsByTarget,
  residualPerPoint,
  truncateProtocol,
  truncatedFitInitPayload,
  type FitConfig,
} from "../../src/fit/fitConfig";

function makeConfig(sortedT: number[], nTargets: number): FitConfig {
  return {
    kind: "timeCourse",
    parNames: ["k"],
    fitIdx: [0],
    nnBlockFitIdx: [],
    combinedFitIdx: [0],
    logFlags: [true],
    fitTargetsList: Array.from({ length: nTargets }, () => ({
      kind: "state" as const,
      index: 0,
      scale: 1,
      values: sortedT.map(() => 0),
    })),
    sortedT,
    nDerived: 0,
    rhsWat: "(module)",
    derivedWat: undefined,
    y0: [1],
    backend: undefined,
    adjointWat: undefined,
    jacobianWat: undefined,
    backendChoice: "lm",
    nnBlockOwner: new Map(),
    nnBlockConfigs: new Map(),
  };
}

describe("residualPerPoint", () => {
  it("divides by sqrt(points in the stage's own prefix × target count)", () => {
    const config = makeConfig([0, 1, 2, 3, 4], 2); // 5 points, 2 targets
    // cutoffT = 2 keeps only t <= 2 -> 3 points -> 3 * 2 = 6 entries
    expect(residualPerPoint(6, 2, config)).toBeCloseTo(6 / Math.sqrt(6));
  });

  it("uses the *stage's* prefix, not the full dataset, so an early stage's raw residualNorm doesn't read as artificially tiny", () => {
    const config = makeConfig([0, 1, 2, 3, 4], 1);
    // A stage fitting only the first 2 points has a smaller denominator
    // than one fitting all 5 — so an equal raw residualNorm normalizes to
    // a *larger* per-point value for the shorter prefix, not a smaller
    // one, correcting for the fact fewer residual terms were summed.
    const early = residualPerPoint(1, 1, config); // t <= 1 -> 2 points
    const late = residualPerPoint(1, 4, config); // t <= 4 -> 5 points
    expect(early).toBeGreaterThan(late);
  });

  it("never divides by zero when the prefix is empty", () => {
    const config = makeConfig([0, 1, 2, 3, 4], 1);
    expect(Number.isFinite(residualPerPoint(1, -1, config))).toBe(true);
  });
});

// dY/dt = u - k*Y
function drivenModel(): KineticModelBuilder {
  return new KineticModelBuilder()
    .addParameter("k", { value: 0.5 })
    .addParameter("u", { value: 1 })
    .addVariable("Y", { value: 0 })
    .addReaction("influx", {
      fn: new Name("u"),
      stoichiometry: [{ name: "Y", value: new Num(1) }],
    })
    .addReaction("decay", {
      fn: new Mul([new Name("k"), new Name("Y")]),
      stoichiometry: [{ name: "Y", value: new Num(-1) }],
    });
}

function csvOf(columns: Record<string, number[]>): ParsedCsv {
  const headers = Object.keys(columns);
  return { headers, columns, rowCount: columns[headers[0]].length };
}

function build(
  overrides: Partial<Parameters<typeof buildFitConfig>[0]> = {},
): ReturnType<typeof buildFitConfig> {
  const model = drivenModel();
  return buildFitConfig({
    model,
    fitParameters: [{ id: "k", fit: true, logSpace: true }],
    csv: csvOf({ time: [0, 1, 2], Y: [0, 0.5, 0.8] }),
    timeColumn: "time",
    targets: [{ column: "Y", key: "Y", kind: "state" }],
    candidateKeys: [{ key: "Y", kind: "state" }],
    backendChoice: "lm",
    hasTrainedNNBlock: false,
    ...overrides,
  });
}

const steadyStateCsv = csvOf({
  u: [1, 2, 5],
  Y_ss: [2, NaN, 10],
});
const steadyStateArgs = {
  dataKind: "steadyState" as const,
  csv: steadyStateCsv,
  timeColumn: undefined,
  targets: [{ column: "Y_ss", key: "Y", kind: "state" as const }],
  conditionColumns: [{ column: "u", parameter: "u" }],
};

describe("buildFitConfig: steady states", () => {
  it("turns each row into one condition, keeping NaN observations as missing", () => {
    const result = build(steadyStateArgs);
    if (!result.ok) throw new Error(result.error);
    expect(result.config.conditions).toEqual([{ u: 1 }, { u: 2 }, { u: 5 }]);
    expect(result.config.sortedT).toEqual([]);
    const payload = fitInitPayload(result.config, [0.5, 1], {
      targetResidualNorm: 0,
      progressUpdateInterval: 0,
    });
    expect(payload.experiments).toEqual([
      { kind: "steadyState", overrides: { u: 1 }, dataY: [2] },
      { kind: "steadyState", overrides: { u: 2 }, dataY: [NaN] },
      { kind: "steadyState", overrides: { u: 5 }, dataY: [10] },
    ]);
    // Scale ignores the missing cell.
    expect(result.config.fitTargetsList[0].scale).toBe(10);
  });

  it("rejects a non-numeric condition cell", () => {
    const result = build({
      ...steadyStateArgs,
      csv: csvOf({ u: [1, NaN], Y_ss: [2, 4] }),
    });
    expect(result.ok).toBe(false);
  });

  it("requires a condition column and a known parameter", () => {
    expect(build({ ...steadyStateArgs, conditionColumns: [] }).ok).toBe(false);
    expect(
      build({
        ...steadyStateArgs,
        conditionColumns: [{ column: "u", parameter: "nope" }],
      }).ok,
    ).toBe(false);
  });

  it("is never truncated by a curriculum cutoff", () => {
    const result = build(steadyStateArgs);
    if (!result.ok) throw new Error(result.error);
    const settings = { targetResidualNorm: 0, progressUpdateInterval: 0 };
    expect(
      truncatedFitInitPayload(result.config, [0.5, 1], settings, 0).experiments,
    ).toHaveLength(3);
  });

  it("normalizes the residual by the observed (non-NaN) entries", () => {
    const result = build(steadyStateArgs);
    if (!result.ok) throw new Error(result.error);
    expect(residualPerPoint(2, Infinity, result.config)).toBeCloseTo(
      2 / Math.sqrt(2),
    );
  });

  it("reshapes per-experiment predictions to per-target arrays", () => {
    const result = build({
      ...steadyStateArgs,
      csv: csvOf({ u: [1, 2], Y_ss: [2, 4], Y2: [1, 1] }),
      targets: [
        { column: "Y_ss", key: "Y", kind: "state" },
        { column: "Y2", key: "Y", kind: "state" },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    // Experiment-major: [cond0 target0, cond0 target1, cond1 target0, ...]
    expect(predictionsByTarget(result.config, [1, 2, 3, 4])).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });
});

describe("buildFitConfig: protocols", () => {
  const protocol = [
    { t_end: 1, u: 1 },
    { t_end: 3, u: 2 },
  ];

  it("attaches the protocol to the time-course experiment", () => {
    const result = build({ dataKind: "protocol", protocol });
    if (!result.ok) throw new Error(result.error);
    const payload = fitInitPayload(result.config, [0.5, 1], {
      targetResidualNorm: 0,
      progressUpdateInterval: 0,
    });
    expect(payload.experiments).toEqual([
      { kind: "timeCourse", dataT: [0, 1, 2], dataY: [0, 0.5, 0.8], protocol },
    ]);
    expect(payload.parNames).toEqual(["k", "u"]);
  });

  it("rejects data past the protocol's end, unknown keys, and a missing protocol", () => {
    expect(
      build({ dataKind: "protocol", protocol: [{ t_end: 1, u: 1 }] }).ok,
    ).toBe(false);
    expect(
      build({ dataKind: "protocol", protocol: [{ t_end: 5, nope: 1 }] }).ok,
    ).toBe(false);
    expect(build({ dataKind: "protocol" }).ok).toBe(false);
  });

  it("only allows the finite-difference LM backend", () => {
    for (const backendChoice of ["lm-jacobian", "adjoint"] as const) {
      expect(build({ dataKind: "protocol", protocol, backendChoice }).ok).toBe(
        false,
      );
      expect(build({ ...steadyStateArgs, backendChoice }).ok).toBe(false);
    }
  });
});

describe("buildFitConfig: missing time-course observations", () => {
  it("allows NaN target cells under lm, but not under adjoint", () => {
    const csv = csvOf({ time: [0, 1, 2], Y: [0, NaN, 0.8] });
    expect(build({ csv }).ok).toBe(true);
    expect(build({ csv, backendChoice: "adjoint" }).ok).toBe(false);
  });
});

describe("truncateProtocol", () => {
  const protocol = [
    { t_end: 1, u: 1 },
    { t_end: 3, u: 2 },
    { t_end: 6, u: 3 },
  ];
  it("clips the segment containing tEnd and drops the rest", () => {
    expect(truncateProtocol(protocol, 2)).toEqual([
      { t_end: 1, u: 1 },
      { t_end: 2, u: 2 },
    ]);
  });
  it("keeps the whole protocol when tEnd is at or past its end", () => {
    expect(truncateProtocol(protocol, 6)).toEqual(protocol);
    expect(truncateProtocol(protocol, 10)).toEqual(protocol);
  });
});
