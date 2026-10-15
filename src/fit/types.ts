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
