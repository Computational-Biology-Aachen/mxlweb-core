# ADR 0003: MathML as the Universal Expression AST

**Status:** Implemented
**Scope:** `src/mathml/` (`base.ts`, `binary.ts`, `unary.ts`, `unary-special.ts`,
`nary.ts`, `json.ts`)

---

## 1. Context

Every expression in the system (reaction rates, derived assignments, differentials) is
represented as a tree of typed nodes (`Num`, `Name`, `Add`, `Mul`, `Pow`, `Fn`, ...)
subclassing `Base`. Each node knows how to serialize itself to JavaScript (`toJs`),
Python/NumPy (`toPy`), LaTeX (`toTex`), SBML MathML (`toSBML`), and WebAssembly Text
(`toWat`).

## 2. Decision

Use SBML's Content MathML as the canonical expression representation and reuse it as
the _single_ internal AST for everything, rather than inventing a separate internal
representation and converting to MathML only at SBML-export time.

Additionally, trees are **immutable**: structural edits go through `Base.replace()`,
which clones the affected path and preserves each node's process-unique `id`. This is a
deliberate difference from mxlpy's sympy-based expressions, which have no equivalent
stable node identity.

## 3. Rationale

**Why MathML specifically:** SBML round-tripping was a core requirement from the start,
and SBML mandates Content MathML for its math elements. Adopting that representation as
the AST directly — rather than a bespoke internal format converted to MathML only for
export — means there's one node type hierarchy to maintain, and SBML fidelity is a
property of the representation itself rather than a separate conversion layer that
could drift.

**Why immutable trees with stable node ids:** this is built for interactive UI editing
— a live equation editor needs to reliably refer to "this specific node" across an
edit, e.g. for click targets or incremental re-rendering. Immutability plus id-stable
`replace()` gives that without the UI layer having to reimplement structural diffing
against a mutable tree.

## 4. Consequences

- Any new expression capability (a new function, a new operator) is added once as a
  `Base` subclass and automatically gains every target serializer — don't add
  target-specific expression representations elsewhere.
- UI code that needs to target a specific subexpression should rely on node `id`
  stability via `replace()`, not on structural position, which can shift.
