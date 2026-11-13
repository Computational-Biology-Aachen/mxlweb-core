/**
 * Model data (mxl-schemas ADR 0014): named 1-D arrays, such as spectra, that a
 * model's math reaches only through array nodes (`Simpson`, `Sum`, …).
 *
 * An array subtree over data and numbers is a constant: {@link foldData}
 * evaluates it once and replaces it by a `Num`. Arrays that depend on
 * variables or parameters (ADR 0015) stay and are compiled to loops
 * (`arrays.ts`); changing the data means lowering the model again.
 *
 * @module
 */

import { type ArrayData, foldConstants } from "./arrays.js";
import type { Base } from "./mathml/index.js";
import type { Unit } from "./units/index.js";

/** One data set: its values, plus optional presentation metadata. */
export type DataSet = {
  values: number[];
  unit?: Unit;
  description?: string;
  displayName?: string;
  texName?: string;
};

/** The data sidecar file (mxl-schemas `model-data.schema.json`): data sets keyed by id. */
export type MxlDataDocument = Record<
  string,
  { values: number[]; unit?: unknown; description?: string }
>;

/**
 * `expr` with every array subtree over data and numbers evaluated against
 * `data` and replaced by its number (ADR 0014). Subtrees that depend on
 * anything else stay (ADR 0015); `lower` checks their rules. `where` names
 * the owner in errors.
 */
export function foldData(
  expr: Base,
  data: ReadonlyMap<string, DataSet>,
  where: string,
): Base {
  if (data.size === 0) return expr;
  // A view, not a copy: this runs once per expression on every lower().
  const values = {
    size: data.size,
    has: (k: string) => data.has(k),
    get: (k: string) => data.get(k)?.values,
  } as unknown as ArrayData;
  return foldConstants(expr, values, where);
}
