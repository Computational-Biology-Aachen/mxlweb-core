import type { FitDistribution } from "./random";

export type FitTargetMapping = {
  /** CSV column header this target reads from. */
  column: string;
  /** Model state-variable id or derived-quantity id this column is fit against. */
  key: string;
  kind: "state" | "derived";
};

export type FitParameterConfig = {
  id: string;
  fit: boolean;
  /** Fit in log-space (guarantees positivity) — requires the parameter's
   * current value to be > 0. */
  logSpace: boolean;
  /** Single-model mode: starting value the fit runs from — undefined falls
   * back to the model's current live parameter value. */
  initialGuess?: number;
  /** Ensemble mode: the per-member starting-point distribution this row
   * draws from — undefined falls back to a default normal distribution
   * around the model's current live parameter value (ADR 0006 §2.1). Kept
   * on the same row as `initialGuess`/`logSpace` rather than a parallel
   * array so switching the mode selector doesn't lose which parameters are
   * marked "fit" (ADR 0006 §2.9). */
  distribution?: FitDistribution;
};

/** What kind of data a fit compares against (ADR 0009):
 * - `timeCourse`: one CSV row per time point, parameters constant.
 * - `protocol`: the same, under a piecewise-constant parameter protocol
 *   (e.g. a PAM/NPQ light protocol).
 * - `steadyState`: one CSV row per condition — some columns set
 *   parameters, the rest are observed steady-state values. */
export type FitDataKind = "timeCourse" | "protocol" | "steadyState";

/** Steady-state mode: a CSV column whose per-row values override a model
 * parameter, defining that row's condition. */
export type FitConditionMapping = {
  column: string;
  parameter: string;
};
