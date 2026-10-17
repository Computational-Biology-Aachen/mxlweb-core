// Shared fit-config building, extracted from Fit.svelte (and mirrored,
// near-verbatim, into FitNde.svelte/FitUde.svelte before this module
// existed). Pure functions taking every input explicitly, so the three
// components — and the curriculum runner (./curriculumRunner.ts) — can all
// call into one copy instead of three drifting ones.

import type {
  FitBackend,
  FitExperiment,
  ModelBuilderBase,
  NNBlockConfig,
} from "../index";
import type { ProtocolStep } from "../pam";
import type { ParsedCsv } from "./csvParse";
import type {
  FitConditionMapping,
  FitDataKind,
  FitParameterConfig,
  FitTargetMapping,
} from "./types";

export type BackendChoice = "lm" | "lm-jacobian" | "adjoint";

export type FitTargetEntry = {
  kind: "state" | "derived";
  index: number;
  scale: number;
  values: number[];
};

export type FitConfig = {
  kind: FitDataKind;
  parNames: string[];
  fitIdx: number[];
  nnBlockFitIdx: number[];
  combinedFitIdx: number[];
  logFlags: boolean[];
  /** Per target, `values` is aligned with `sortedT` (time course/protocol)
   * or `conditions` (steady state). NaN marks a missing observation. */
  fitTargetsList: FitTargetEntry[];
  /** Ascending data times; empty for a steady-state fit. */
  sortedT: number[];
  /** `protocol` kind only. */
  protocol?: ProtocolStep[];
  /** `steadyState` kind only: one parameter-override set per CSV row. */
  conditions?: Record<string, number>[];
  ssTol?: number;
  ssTMax?: number;
  nDerived: number;
  rhsWat: string;
  derivedWat?: string;
  y0: number[];
  backend?: FitBackend;
  adjointWat?: string;
  jacobianWat?: string;
  /** Gradient backends with derived targets only (FitInitRequest's doc). */
  derivedGradWat?: string;
  /** The user-facing selection this config was built from — kept around
   * purely for display (the "this fit uses the X backend" note), since
   * the wire-level `backend` field alone can't distinguish "lm" from
   * "lm-jacobian" (both report as plain "lm", FitInitRequest.jacobianWat's
   * doc comment). */
  backendChoice: BackendChoice;
  /** parName -> owning NN block key, for every entry in nnBlockFitIdx —
   * lets the ensemble draw recognize a trained block's own `scale` name
   * (left untouched, ADR 0006 §2.8) versus an ordinary fit-parameter row. */
  nnBlockOwner: Map<string, string>;
  /** Every *trained* block's own architecture config, keyed by block key —
   * lets the ensemble draw re-run `buildNNBlock` with a fresh per-member
   * seed to get that member's own independently Glorot-initialized weights
   * (ADR 0006 §2.8), the same generator `addNNBlock` itself calls. */
  nnBlockConfigs: Map<string, NNBlockConfig>;
};

export function fitTargets(
  model: ModelBuilderBase,
  fitParameters: FitParameterConfig[],
): { fitIdx: number[]; ok: boolean } {
  // getAllAddressableNames(), not getParameterNames(): fitIdx is spliced
  // directly into combinedFitIdx below, which is indexed against the
  // former. fitParameters entries are always ordinary parameter ids
  // (never a weight/scale name — those join separately via
  // nnBlockParamNames), so this doesn't change *which* indices are found,
  // only removes the implicit "getParameterNames() is always a positional
  // prefix of getAllAddressableNames()" assumption the two arrays would
  // otherwise have to agree on silently.
  const parNames = model.getAllAddressableNames();
  const fitIdx = fitParameters
    .filter((p) => p.fit)
    .map((p) => parNames.indexOf(p.id))
    .filter((i) => i >= 0);
  return { fitIdx, ok: fitIdx.length > 0 };
}

/** Everything a fit run needs that does *not* depend on where it starts or
 * which data prefix a curriculum stage truncates it to (ADR 0006 §2.4) —
 * built once and reused by single-model, ensemble, and every curriculum
 * stage's own FitInitRequest. */
export function buildFitConfig(params: {
  model: ModelBuilderBase;
  fitParameters: FitParameterConfig[];
  csv: ParsedCsv | null;
  timeColumn: string | undefined;
  targets: FitTargetMapping[];
  candidateKeys: { key: string; kind: "state" | "derived" }[];
  backendChoice: BackendChoice;
  hasTrainedNNBlock: boolean;
  /** Defaults to "timeCourse". */
  dataKind?: FitDataKind;
  /** Required for the "protocol" kind. */
  protocol?: ProtocolStep[];
  /** "steadyState" kind: columns defining each row's condition. */
  conditionColumns?: FitConditionMapping[];
  ssTol?: number;
  ssTMax?: number;
}): { ok: true; config: FitConfig } | { ok: false; error: string } {
  const {
    model,
    fitParameters,
    csv,
    timeColumn,
    targets,
    candidateKeys,
    backendChoice,
    hasTrainedNNBlock,
    dataKind = "timeCourse",
    protocol,
    conditionColumns = [],
  } = params;
  const isSteadyState = dataKind === "steadyState";

  if (
    !csv ||
    (!isSteadyState && timeColumn === undefined) ||
    targets.length === 0
  ) {
    return {
      ok: false,
      error: "Upload a data file and map at least one column first.",
    };
  }
  const { fitIdx, ok } = fitTargets(model, fitParameters);
  if (!ok && !hasTrainedNNBlock) {
    return {
      ok: false,
      error:
        "Select at least one parameter to fit, or enable training on an NN block.",
    };
  }

  // A mapping can go stale (e.g. the model was reloaded from a new SBML
  // file) without the mapping table being touched — reject rather than
  // let an unresolved key reach the WASM heap as a bogus buffer index.
  const knownKeys = new Set(candidateKeys.map((c) => c.key));
  const staleTarget = targets.find((t) => !knownKeys.has(t.key));
  if (staleTarget) {
    return {
      ok: false,
      error: `"${staleTarget.key}" is no longer a valid target — re-map column "${staleTarget.column}".`,
    };
  }

  // The full flat array the compiled WAT module actually indexes into
  // (ModelBuilderBase.lower()'s ir.parNames === getAllAddressableNames():
  // model.parameters, then model.nnWeights) — not getParameterNames(),
  // which is the UI-facing kinetic-parameters-plus-scale subset. Every
  // index (fitIdx, nnBlockFitIdx, combinedFitIdx) is positional against
  // *this* array.
  const parNames = model.getAllAddressableNames();

  const columns = csv.columns;
  let order: number[];
  let sortedT: number[] = [];
  let conditions: Record<string, number>[] | undefined;
  if (isSteadyState) {
    if (conditionColumns.length === 0) {
      return {
        ok: false,
        error:
          "Map at least one column to a condition parameter — each row is one steady state.",
      };
    }
    for (const c of conditionColumns) {
      if (!parNames.includes(c.parameter)) {
        return {
          ok: false,
          error: `"${c.parameter}" is not a model parameter — re-map column "${c.column}".`,
        };
      }
      if (columns[c.column].some((v) => Number.isNaN(v))) {
        return {
          ok: false,
          error: `Condition column "${c.column}" has a non-numeric value.`,
        };
      }
    }
    order = Array.from({ length: csv.rowCount }, (_, i) => i);
    conditions = order.map((i) =>
      Object.fromEntries(
        conditionColumns.map((c) => [c.parameter, columns[c.column][i]]),
      ),
    );
  } else {
    const dataT = columns[timeColumn!];
    order = dataT.map((t, i) => i).sort((a, b) => dataT[a] - dataT[b]);
    sortedT = order.map((i) => dataT[i]);
    if (sortedT.some((t) => Number.isNaN(t))) {
      return {
        ok: false,
        error: `Column "${timeColumn}" has a non-numeric value.`,
      };
    }
  }
  if (dataKind === "protocol") {
    const error = validateProtocol(protocol, sortedT, parNames);
    if (error) return { ok: false, error };
  }
  // A non-numeric target cell is a missing observation (every C driver
  // skips NaN residuals), but a column with no observations at all is
  // surely a mis-mapping.
  for (const t of targets) {
    const values = order.map((i) => columns[t.column][i]);
    if (values.every((v) => Number.isNaN(v))) {
      return {
        ok: false,
        error: `Column "${t.column}" has a non-numeric value.`,
      };
    }
  }

  const derivedTargets = targets.filter((t) => t.kind === "derived");
  const derivedKeys = derivedTargets.map((t) => t.key);

  let derivedWat: string | undefined;
  try {
    derivedWat =
      derivedKeys.length > 0 ? model.buildWatDerived(derivedKeys) : undefined;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to build the fit model.",
    };
  }

  const fitTargetsList: FitTargetEntry[] = targets.map((t) => {
    const values = order.map((i) => columns[t.column][i]);
    const scale = Math.max(
      ...values.filter((v) => !Number.isNaN(v)).map(Math.abs),
      1e-12,
    );
    return {
      kind: t.kind,
      index:
        t.kind === "state"
          ? model.getNames().indexOf(t.key)
          : derivedKeys.indexOf(t.key),
      scale,
      values,
    };
  });

  // Every weight/bias, and the block's own trainable scale factor, of
  // every *trained* NN block joins the fitted set — always in linear
  // space, never log-space (ADR 0005 §2.1.2). Untrained blocks keep their
  // current weights/scale fixed and are simply left out of fitIdx.
  const nnBlockParamNames: string[] = [];
  const nnBlockOwner = new Map<string, string>();
  const nnBlockConfigs = new Map<string, NNBlockConfig>();
  for (const [key, config] of model.nnBlocks) {
    if (!config.trained) continue;
    nnBlockConfigs.set(key, config);
    const scaleName = `${key}_scale`;
    nnBlockParamNames.push(scaleName);
    nnBlockOwner.set(scaleName, key);
    for (const name of model.nnBlockWeightNames(key)) {
      nnBlockParamNames.push(name);
      nnBlockOwner.set(name, key);
    }
  }
  const nnBlockFitIdx = nnBlockParamNames.map((name) => parNames.indexOf(name));
  const combinedFitIdx = [...fitIdx, ...nnBlockFitIdx];

  // The gradient backends differentiate the RHS with respect to each fitted
  // parameter's *trial* value, which a protocol/condition override replaces
  // (ADR 0009) — reject up front rather than let the C init fail (-4).
  if (backendChoice !== "lm") {
    const fitted = new Set(combinedFitIdx.map((i) => parNames[i]));
    const overridden = overriddenParameters(dataKind, protocol, conditions);
    const clash = overridden.filter((name) => fitted.has(name));
    if (clash.length > 0) {
      return {
        ok: false,
        error: `${clash.join(", ")} ${clash.length === 1 ? "is" : "are"} both fitted and set by the ${isSteadyState ? "conditions" : "protocol"} — the ${backendChoice === "adjoint" ? "adjoint" : "analytic-Jacobian LM"} backend can't differentiate through that. Stop fitting ${clash.length === 1 ? "it" : "them"}, or pick "Levenberg-Marquardt".`,
      };
    }
  }

  const logFlags = [
    ...fitIdx.map(
      (i) => fitParameters.find((p) => p.id === parNames[i])?.logSpace ?? true,
    ),
    ...nnBlockFitIdx.map(() => false),
  ];

  // Wire-level `backend` only ever distinguishes "adjoint" from "lm" —
  // "lm-jacobian" is still reported as plain "lm" with jacobianWat
  // attached (FitInitRequest.jacobianWat's doc comment); undefined
  // defaults to "lm" inside fitWorker.ts either way.
  const backend: FitBackend | undefined =
    backendChoice === "adjoint" ? "adjoint" : undefined;
  let adjointWat: string | undefined;
  let jacobianWat: string | undefined;
  let derivedGradWat: string | undefined;
  if (backendChoice !== "lm" && derivedKeys.length > 0) {
    try {
      derivedGradWat = model.buildWatDerivedGrad(
        derivedKeys,
        combinedFitIdx.map((i) => parNames[i]),
      );
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? e.message
            : "Failed to build the derived-target gradients.",
      };
    }
  }
  if (backendChoice === "adjoint") {
    try {
      adjointWat = model.buildAdjointWat(
        combinedFitIdx.map((i) => parNames[i]),
      );
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error ? e.message : "Failed to build the adjoint model.",
      };
    }
  } else if (backendChoice === "lm-jacobian") {
    try {
      jacobianWat = model.buildJacobianWat(
        combinedFitIdx.map((i) => parNames[i]),
      );
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? e.message
            : "Failed to build the analytic-Jacobian model.",
      };
    }
  }

  return {
    ok: true,
    config: {
      kind: dataKind,
      parNames,
      fitIdx,
      nnBlockFitIdx,
      combinedFitIdx,
      logFlags,
      fitTargetsList,
      sortedT,
      protocol: dataKind === "protocol" ? protocol : undefined,
      conditions,
      ssTol: params.ssTol,
      ssTMax: params.ssTMax,
      nDerived: derivedKeys.length,
      rhsWat: model.buildWat(),
      derivedWat,
      y0: model.resolveInitialValues(),
      backend,
      adjointWat,
      jacobianWat,
      derivedGradWat,
      backendChoice,
      nnBlockOwner,
      nnBlockConfigs,
    },
  };
}

function validateProtocol(
  protocol: ProtocolStep[] | undefined,
  sortedT: number[],
  parNames: string[],
): string | undefined {
  if (!protocol || protocol.length === 0) {
    return "Define a protocol first — a protocol fit needs at least one segment.";
  }
  for (let i = 1; i < protocol.length; i++) {
    if (protocol[i].t_end < protocol[i - 1].t_end) {
      return "Protocol segments must end in ascending order of t_end.";
    }
  }
  const unknown = protocol
    .flatMap((step) => Object.keys(step))
    .filter((k) => k !== "t_end" && !parNames.includes(k));
  if (unknown.length > 0) {
    return `Protocol sets unknown parameter(s): ${[...new Set(unknown)].join(", ")}.`;
  }
  const tLast = protocol[protocol.length - 1].t_end;
  if (sortedT[sortedT.length - 1] > tLast) {
    return `The data extends to t=${sortedT[sortedT.length - 1]}, past the protocol's end (t=${tLast}).`;
  }
  return undefined;
}

/** The prefix of `protocol` covering `[0, tEnd]`, its last segment clipped
 * to end exactly at `tEnd` — a curriculum stage's preview must not simulate
 * past the data the stage has seen (`CurriculumRunHandlers.onProgress`). */
export function truncateProtocol(
  protocol: ProtocolStep[],
  tEnd: number,
): ProtocolStep[] {
  const out: ProtocolStep[] = [];
  for (const step of protocol) {
    if (step.t_end >= tEnd) {
      out.push({ ...step, t_end: tEnd });
      break;
    }
    out.push(step);
  }
  return out;
}

/** Per-kind experiment list for {@link FitInitRequest.experiments}. */
function experimentsOf(config: FitConfig): FitExperiment[] {
  if (config.kind === "steadyState") {
    return (config.conditions ?? []).map((overrides, j) => ({
      kind: "steadyState",
      overrides,
      dataY: config.fitTargetsList.map((t) => t.values[j]),
    }));
  }
  return [
    {
      kind: "timeCourse",
      dataT: config.sortedT,
      dataY: config.fitTargetsList.flatMap((t) => t.values),
      protocol: config.kind === "protocol" ? config.protocol : undefined,
    },
  ];
}

/** Parameters a protocol or the steady-state conditions set (ADR 0009). */
export function overriddenParameters(
  dataKind: FitDataKind,
  protocol: ProtocolStep[] | undefined,
  conditions: Record<string, number>[] | undefined,
): string[] {
  const names = new Set<string>();
  if (dataKind === "protocol") {
    for (const step of protocol ?? [])
      for (const key of Object.keys(step)) if (key !== "t_end") names.add(key);
  } else if (dataKind === "steadyState") {
    for (const c of conditions ?? [])
      for (const key of Object.keys(c)) names.add(key);
  }
  return [...names];
}

/** Reshapes `FitProgress.predictions` (laid out per experiment, see
 * {@link experimentsOf}) to one array per target, aligned with that
 * target's `values` (possibly a curriculum stage's truncated prefix). */
export function predictionsByTarget(
  config: FitConfig,
  predictions: number[],
): number[][] {
  const nTargets = config.fitTargetsList.length;
  const nPoints = predictions.length / Math.max(nTargets, 1);
  return config.fitTargetsList.map((_, k) =>
    Array.from({ length: nPoints }, (_, j) =>
      config.kind === "steadyState"
        ? predictions[j * nTargets + k]
        : predictions[k * nPoints + j],
    ),
  );
}

export function fitInitPayload(
  config: FitConfig,
  pars: number[],
  settings: { targetResidualNorm: number; progressUpdateInterval: number },
) {
  return {
    rhsWat: config.rhsWat,
    derivedWat: config.derivedWat,
    nDerived: config.nDerived,
    y0: config.y0,
    pars,
    fitIdx: config.combinedFitIdx,
    logFlags: config.logFlags,
    targets: config.fitTargetsList.map(({ kind, index, scale }) => ({
      kind,
      index,
      scale,
    })),
    experiments: experimentsOf(config),
    parNames: config.parNames,
    ssTol: config.ssTol,
    ssTMax: config.ssTMax,
    solver: "radau5" as const,
    rtol: 1e-8,
    atol: 1e-10,
    targetResidualNorm: settings.targetResidualNorm,
    backend: config.backend,
    adjointWat: config.adjointWat,
    jacobianWat: config.jacobianWat,
    derivedGradWat: config.derivedGradWat,
    progressUpdateInterval: settings.progressUpdateInterval,
  };
}

/** Same as {@link fitInitPayload}, but truncated to the data points at or
 * before `cutoffT` (at least one point is always kept) — one curriculum
 * stage's own view of `config` (see ./curriculum.ts). `config.sortedT` is
 * ascending (buildFitConfig's own sort), so the truncation is a plain
 * prefix slice, not a filter. */
export function truncatedFitInitPayload(
  config: FitConfig,
  pars: number[],
  settings: { targetResidualNorm: number; progressUpdateInterval: number },
  cutoffT: number,
) {
  // A steady-state fit has no time axis to grow a curriculum along.
  if (config.kind === "steadyState") {
    return fitInitPayload(config, pars, settings);
  }
  const n = Math.max(
    1,
    Math.min(
      config.sortedT.filter((t) => t <= cutoffT).length,
      config.sortedT.length,
    ),
  );
  if (n === config.sortedT.length) {
    return fitInitPayload(config, pars, settings);
  }
  const truncated: FitConfig = {
    ...config,
    sortedT: config.sortedT.slice(0, n),
    fitTargetsList: config.fitTargetsList.map((t) => ({
      ...t,
      values: t.values.slice(0, n),
    })),
  };
  return fitInitPayload(truncated, pars, settings);
}

// Caps a chunk's own maxfev so a fit doesn't overshoot its budget (the
// curriculum stage's own maxIterations, or maxFunctionEvaluations for the
// final stage) by a whole chunk's worth.
export function nextChunkBudget(
  currentNfev: number,
  chunkMaxfev: number,
  budget: number,
): number {
  return Math.min(chunkMaxfev, budget - currentNfev);
}

/** Normalizes a chunk's `residualNorm` to a per-entry (per data point, per
 * target) value, for display on a chart spanning multiple curriculum
 * stages. `residualNorm` is an L2 norm (MINPACK/lmdif convention: sqrt of
 * the sum of squared residuals), not a mean — so it scales with
 * sqrt(vector length), and a stage's own vector length (its data prefix's
 * point count × target count) shrinks with `cutoffT`. Left un-normalized,
 * a chart spanning several stages would show a residual "jump" at every
 * transition that's really just an artifact of suddenly fitting more
 * data, not the fit getting worse — mirrors MosaicML Composer's Sequence
 * Length Warmup, which normalizes loss "per token" for the same reason
 * across its own growing-context curriculum.
 *
 * Display-only: `targetResidualNorm`/plateau and the raw-value text
 * readout keep comparing the un-normalized `residualNorm` throughout,
 * since that's the actual number the stopping criteria (and the user
 * watching them) are reasoning about. */
export function residualPerPoint(
  residualNorm: number,
  cutoffT: number,
  config: FitConfig,
): number {
  const nPoints =
    config.kind === "steadyState"
      ? (config.conditions?.length ?? 0)
      : config.sortedT.filter((t) => t <= cutoffT).length;
  // Missing observations contribute no residual term.
  const nEntries = Math.max(
    1,
    config.fitTargetsList.reduce(
      (n, t) =>
        n + t.values.slice(0, nPoints).filter((v) => !Number.isNaN(v)).length,
      0,
    ),
  );
  return residualNorm / Math.sqrt(nEntries);
}
