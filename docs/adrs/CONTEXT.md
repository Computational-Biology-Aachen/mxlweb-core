# mxlweb-core: Architecture Context

This is the entry point for understanding _why_ `mxlweb-core` is shaped the way it is —
written down ahead of a maintainer handoff, alongside the equivalent
`docs/adrs/CONTEXT.md` in the sibling `mxlpy` repo. See that repo's ADRs for the Python
side of this tool family; this page covers the independent TypeScript implementation.

## Independence Is the Central Fact

`mxlweb-core` deliberately does not depend on `mxlpy`/`pysbml` at runtime — that single
decision shapes almost everything else here: why SBML is reimplemented from scratch, why
compute backends favor compiled WASM over interpreted Python, why the package has no
server component.

→ [ADR 0001 — Does not depend on mxlpy at runtime](0001-independence-from-mxlpy-runtime.md)

## One Model, One IR, Many Targets

Structurally the same idea as mxlpy's `meta/` codegen (one definition, many
projections), arrived at independently in TypeScript:

→ [ADR 0002 — Three model builder classes, one shared IR](0002-three-builders-shared-ir.md)
→ [ADR 0003 — MathML as the universal expression AST](0003-mathml-as-universal-ast.md)
→ [ADR 0006 — `.mxl.json` native format, vendored + drift-tested schemas](0006-mxl-json-schema-vendoring.md)

## Compute Backends

→ [ADR 0004 — Three compute backends: JS, WASM, Pyodide (an evolution, not a design)](0004-three-backends-evolution.md)
→ [ADR 0005 — Vendored Hairer Fortran solvers via C/Emscripten, not Rust](0005-vendored-hairer-solvers.md)

## Framework Commitment

→ [ADR 0007 — Svelte-native core, not framework-agnostic](0007-svelte-native-core.md)

## Threads That Cross Multiple ADRs

- **Performance is a first-class driver, not an afterthought.** The ~50x gap between
  compiled WASM and interpreted Pyodide (0001, 0004) explains both the independence
  decision and the backend evolution — this isn't a philosophical purity stance, it's
  measured.
- **Vendor trusted implementations rather than rewrite them.** Both the Hairer
  Fortran/C solvers (0005) and the `mxl-schemas` JSON Schemas (0006) are vendored
  copies of an external source of truth, kept honest by a build step or CI check
  rather than a runtime dependency. This is the same pattern applied twice, for
  different reasons (numerics correctness vs. no-network-at-runtime).
- **Evolution, not top-down design.** The three-backend split (0004) reflects a real
  history (Pyodide first, WASM later) more than an upfront plan — a pattern also seen
  in mxlpy's `jax/` subsystem (see mxlpy ADR 0005), where "just add another backend"
  grew into something structurally different over time.

## See Also

- `mxlpy`'s `docs/adrs/CONTEXT.md` — the Python side of this tool family, including the
  `meta/` codegen that can _export into_ `mxlweb-core`'s TypeScript AST/`.mxl.json`
  format (a one-way, build-time bridge, not a runtime dependency).
- The consumer sites' own `docs/adrs/` (`mxlweb`, `greensloth`) for how this engine is
  actually deployed and used.
