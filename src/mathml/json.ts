/**
 * Inverse of {@link Base.toJson}: revive an expression-tree node from its
 * serialised mxl-schemas `.mxl.json` form. Dispatch is by the `type`
 * discriminator, mirroring how {@link Base.toJson} tags each node with its class
 * name. The concrete classes carry the actual reconstruction via their inherited
 * static `fromJson`; this module only resolves a type string to its class.
 *
 * @module
 */

import * as baseNodes from "./base.js";
import { Base, type JsonNode, setNodeReviver } from "./base.js";
import * as binaryNodes from "./binary.js";
import * as naryNodes from "./nary.js";
import * as unaryNodes from "./unary.js";
import * as specialNodes from "./unary-special.js";

/** A node class as seen by the reviver: it can rebuild an instance from JSON. */
type NodeClass = { fromJson(json: JsonNode): Base };

/** Abstract bases that share serialisers but are never a concrete node `type`. */
const ABSTRACT = new Set(["Nullary", "Unary", "Binary", "Nary"]);

let registry: Record<string, NodeClass> | null = null;

/**
 * Build (once) the `type` → concrete-class lookup from the node modules. Lazy so
 * the construction runs after every module has finished loading — the reviver
 * and the node classes import each other, and a class binding must not be
 * dereferenced during module evaluation.
 */
function nodeRegistry(): Record<string, NodeClass> {
  if (registry === null) {
    registry = {};
    const modules = [
      baseNodes,
      binaryNodes,
      naryNodes,
      unaryNodes,
      specialNodes,
    ];
    for (const mod of modules) {
      for (const [name, value] of Object.entries(mod)) {
        if (
          typeof value === "function" &&
          !ABSTRACT.has(name) &&
          value.prototype instanceof Base &&
          "fromJson" in value
        ) {
          registry[name] = value as unknown as NodeClass;
        }
      }
    }
  }
  return registry;
}

/**
 * Reconstruct an expression node (and its subtree) from a {@link JsonNode}.
 * Throws on an unknown `type` discriminator.
 */
export function nodeFromJson(json: JsonNode): Base {
  const cls = nodeRegistry()[json.type];
  if (cls === undefined) {
    throw new Error(`unknown math node type: ${json.type}`);
  }
  return cls.fromJson(json);
}

// Wire the reviver into the node classes' static `fromJson` (see base.ts).
setNodeReviver(nodeFromJson);
