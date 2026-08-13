# ADR 0001: mxlweb-core Does Not Depend on mxlpy at Runtime

**Status:** Implemented
**Scope:** whole package — most concretely `src/sbml.ts`, `src/backends/py/pyWorker.ts`,
and every codegen path in `src/mathml/`

---

## 1. Context

`mxlweb-core` reimplements, in TypeScript, a substantial subset of what `mxlpy` already
does in Python: a model builder, an expression representation, SBML import/export, and
ODE integration. Nothing here imports `mxlpy` or `pysbml` at runtime.

## 2. Decision

Keep the two implementations independent. `mxlweb-core` never ships or invokes actual
`mxlpy`/`pysbml` Python code as its primary runtime path. Where behavioral alignment
with `mxlpy`/`pysbml` matters (most concretely SBML import/export), it is achieved by
**convention and cross-checking during development**, not by sharing code or by
depending on a Python runtime in the browser.

A Pyodide (Python-in-WASM) backend does exist (`backends/py/pyWorker.ts`) and does run
real Python/NumPy/SciPy client-side — but it is a secondary/debugging backend today, not
the primary path, and it does not import `mxlpy` itself (it runs its own `main.py`,
vendored in `mxlweb-core`'s own `static/`). See
[ADR 0004](0004-three-backends-evolution.md) for why.

## 3. Rationale

**Performance.** This is the dominant reason, not just bundle size: interpreted Python
running inside Pyodide's WASM sandbox is roughly **50x slower** than the compiled
WASM/C solvers (see [ADR 0004](0004-three-backends-evolution.md),
[ADR 0005](0005-vendored-hairer-solvers.md)). Shipping `mxlpy` itself, or leaning on
Pyodide as the default execution path, would make every model interaction in these
browser tools an order of magnitude slower than it needs to be.

**Deployment shape.** All three consumer sites (MxlWeb, ComPhot, GreenSloth) are
static, client-side-only SvelteKit sites with no server component. Depending on a
Python runtime at all (even via Pyodide) as the _default_ path would work against fast,
cold-start-free page loads.

**Correctness assurance without code sharing.** For SBML specifically, `sbml.ts`'s
round-trip behavior was developed with `pysbml`'s behavior in mind as a reference, but
alignment is by convention — verified via this package's own SBML/MathML test suite
(essentially the standard SBML test corpus plus additional cases), not via a parity
check that runs both implementations against each other.

## 4. Consequences

- Don't propose "just import mxlpy via Pyodide" as a way to reduce duplicate
  implementation effort — it would regress the ~50x performance gap and the
  no-server-dependency deployment model this package exists to provide.
- If `sbml.ts` and `pysbml` behavior drift apart on some edge case, there is no
  automated parity check to catch it — only the shared test-suite coverage. A future
  maintainer who wants stronger guarantees here would need to build that check
  deliberately (mirroring the `.mxl.json` schema-drift test in
  [ADR 0006](0006-mxl-json-schema-vendoring.md)).
- The mxlpy side does still _reach into_ this world — mxlpy's `meta/` codegen can
  _export_ to mxlweb's format via metaprogramming (generating the MxlWeb TypeScript AST
  from an mxlpy `Model`). That is a one-way, build/authoring-time bridge, not a runtime
  dependency, and does not contradict this ADR.
