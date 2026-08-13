# ADR 0002: Three Model Builder Classes, One Shared IR

**Status:** Implemented
**Scope:** `src/modelBuilderBase.ts`, `src/kineticModelBuilder.ts`,
`src/odeModelBuilder.ts`, `src/steadyStateModelBuilder.ts`, `src/modelIr.ts`

---

## 1. Context

Three concrete builder classes — `KineticModelBuilder`, `OdeModelBuilder`,
`SteadyStateModelBuilder` — all extend abstract `ModelBuilderBase` and all lower into
the same `ModelIR`. Per `modelIr.ts`'s own doc comment: "the only difference between the
builders is how `dxdt` is assembled during lowering; everything downstream operates on
the IR alone."

Unlike mxlpy's single `Model` class (used by Python-literate scientists who don't need
guardrails around modeling paradigm), these builders are the direct edit surface behind
browser UIs used by a broader audience, including students and non-programmers.

## 2. Decision

Keep three separate builder classes rather than one configurable builder with a `kind`
flag, but converge everything downstream (codegen, evaluation, serialization) onto one
shared `ModelIR`.

Note the three are **not** three equal siblings:

- `KineticModelBuilder` and `OdeModelBuilder` are two different **authoring styles for
  the same category** of model — a genuinely time-dynamic ODE system — described either
  via reactions + stoichiometry (`dx/dt = N·v`) or via direct derivatives
  (`setDifferential()`).
- `SteadyStateModelBuilder` is structurally different, not just a third authoring
  style: it has no state variables, no differential equations, and no time integration
  at all — it's an algebraic system whose assignments _are_ the outputs. It reuses the
  same base class and IR machinery for convenience (shared derived-quantity codegen via
  `ModelBuilderBase.buildJsDerived`), not because it's conceptually a third kind of
  dynamic model.

## 3. Rationale

Each builder class encodes a distinct authoring mental model and lets the UI — and
TypeScript's type checker — statically know which affordances apply, rather than one
class exposing a superset of methods where some are nonsensical depending on a runtime
`kind` flag. The `.mxl.json` `MxlKind` discriminator ("kinetic"/"ode"/"steady-state") is
the serialized fingerprint of this same choice (see
[ADR 0006](0006-mxl-json-schema-vendoring.md)).

Converging on one shared `ModelIR` for everything downstream means all numeric code
generation (JS/Python/WAT/LaTeX) is written once, against the IR, regardless of which
builder produced it — the per-builder logic is confined entirely to the lowering step.

## 4. Consequences

- A new model-authoring paradigm should be evaluated against this split: is it a new
  way to _author_ a time-dynamic ODE system (extend the kinetic/ODE distinction), or
  is it a structurally different modeling category like steady-state (its own builder,
  reusing IR machinery where it fits)?
- Don't assume all three builders are conceptually equivalent when reasoning about the
  system — `SteadyStateModelBuilder`'s absence of a time axis is a structural
  difference, not a configuration option.
