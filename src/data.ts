/**
 * Model data (mxl-schemas ADR 0014): named 1-D arrays, such as spectra, that a
 * model's math reaches only through array nodes (`Simpson`, `Sum`, …).
 *
 * An array subtree in a model may reference only data and numbers, so it is a
 * constant: {@link foldData} evaluates it once and replaces it by a `Num`.
 * Every numeric backend (JS, WAT, Python, gradients) then sees an ordinary
 * scalar model; changing the data means lowering the model again.
 *
 * @module
 */

import {
  ARRAY_NODE_TYPES,
  type Base,
  Name,
  Num,
  containsArrayNode,
  evaluate,
} from "./mathml/index.js";
import { mapChildren } from "./modelIr.js";
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
 * `expr` with every array subtree evaluated against `data` and replaced by its
 * number. Throws, naming `where`, if an array subtree references anything but
 * data, if it evaluates to an array, or if data is used outside one.
 */
export function foldData(
  expr: Base,
  data: ReadonlyMap<string, DataSet>,
  where: string,
): Base {
  if (data.size === 0) return expr;
  const touchesData = (node: Base) =>
    containsArrayNode(node, ARRAY_NODE_TYPES) ||
    [...node.getSymbols(new Set())].some((s) => data.has(s));

  const fold = (node: Base): Base => {
    if (!touchesData(node)) return node;
    if (ARRAY_NODE_TYPES.has(node.nodeType)) {
      for (const s of node.getSymbols(new Set())) {
        if (!data.has(s)) {
          throw new Error(
            `${where}: ${node.nodeType} may only reference data and numbers, not "${s}"`,
          );
        }
      }
      const value = evaluate(node, (name) => data.get(name)!.values);
      if (typeof value !== "number") {
        throw new Error(
          `${where}: ${node.nodeType} gives an array; reduce it to a number (e.g. with Sum or Simpson)`,
        );
      }
      return new Num(value);
    }
    if (node instanceof Name) {
      throw new Error(
        `${where}: data "${node.name}" is an array; reduce it to a number (e.g. with Sum or Simpson) before using it`,
      );
    }
    return mapChildren(node, fold);
  };
  return fold(expr);
}
