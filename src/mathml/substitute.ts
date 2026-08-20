import { Base, Name } from "./base.js";

/** The operand fields any concrete node might expose — the same shapes `toJson()`/`JsonNode` already generalize over, read directly off the live object instead. */
type Operands = {
  child?: Base;
  base?: Base;
  left?: Base;
  right?: Base;
  children?: Base[];
};

/**
 * Replace every `Name` leaf whose value is `name` with `replacement`,
 * everywhere in `expr`'s tree, in a single recursive pass. Used to
 * instantiate the two placeholder-based expression templates mxl-schemas
 * v2 introduced for nn_blocks: an `activation.expression` (placeholder
 * `x`, substituted per pre-activation value in `nnBlock.ts`) and a block's
 * `mechanism` (placeholders `ode`/`nde`, substituted in
 * `modelBuilderBase.ts`'s `composeNNBlocks`).
 *
 * `expr` (the template — an activation or mechanism expression, always
 * small: a handful of nodes) is the only thing this ever recurses into.
 * The moment a matching `Name` leaf is found, `replacement` is returned
 * directly — never walked, never serialized, never reconstructed. This
 * matters because `nnBlock.ts` calls this once per hidden unit per layer,
 * and `replacement` is that layer's pre-activation value: itself built
 * from every unit in the *previous* layer, shared by reference across
 * every unit of the *next* one (an ordinary DAG, the same way
 * `stableSoftplus`'s old direct `new Max([x, ...])` referenced `x` without
 * ever traversing it). Two earlier implementations got this wrong in two
 * different ways, both caught by `nnBlock.test.ts`'s 6×64-block test:
 *  - serializing `replacement` via `toJson()`/reviving a copy at every
 *    substitution site flattens the sharing into a real clone each time —
 *    compounding layer over layer, an exponential *memory* blowup (out of
 *    memory);
 *  - finding each match's id first and substituting via repeated
 *    `Base.replace(id, next)` calls avoids the cloning, but `replace`'s
 *    own recursive descent still has to walk through whatever was already
 *    substituted in by an *earlier* call (to confirm the next id isn't
 *    hiding inside it) — and a naive, non-memoized walk of a densely
 *    shared DAG revisits a shared node once per path into it, not once
 *    per node, an exponential *time* blowup even with zero duplication.
 * A single pass that never recurses into `replacement` at all has neither
 * cost, matching direct construction's zero-traversal behavior exactly.
 *
 * Reconstructs an unmatched internal node via its own constructor (the
 * same `this.constructor as new (...) => this` pattern each concrete
 * class's own `replace()` already uses), dispatching on which operand
 * fields are present rather than `instanceof`, so a future node type needs
 * no update here as long as it uses one of the five existing field names.
 */
export function substituteName(
  expr: Base,
  name: string,
  replacement: Base,
): Base {
  function walk(node: Base): Base {
    if (node instanceof Name && node.name === name) return replacement;

    const operands = node as unknown as Operands;
    if (operands.children !== undefined) {
      const newChildren = operands.children.map(walk);
      const changed = newChildren.some((c, i) => c !== operands.children![i]);
      if (!changed) return node;
      const Constructor = node.constructor as new (children: Base[]) => Base;
      return new Constructor(newChildren);
    }
    if (operands.left !== undefined && operands.right !== undefined) {
      const newLeft = walk(operands.left);
      const newRight = walk(operands.right);
      if (newLeft === operands.left && newRight === operands.right) {
        return node;
      }
      const Constructor = node.constructor as new (
        left: Base,
        right: Base,
      ) => Base;
      return new Constructor(newLeft, newRight);
    }
    if (operands.child !== undefined && operands.base !== undefined) {
      const newChild = walk(operands.child);
      const newBase = walk(operands.base);
      if (newChild === operands.child && newBase === operands.base) {
        return node;
      }
      const Constructor = node.constructor as new (
        child: Base,
        base: Base,
      ) => Base;
      return new Constructor(newChild, newBase);
    }
    if (operands.child !== undefined) {
      const newChild = walk(operands.child);
      if (newChild === operands.child) return node;
      const Constructor = node.constructor as new (child: Base) => Base;
      return new Constructor(newChild);
    }
    // A non-matching leaf (Num/Bool/Pi/E, or a Name with a different name): no operands, nothing to substitute beneath it.
    return node;
  }

  return walk(expr);
}
