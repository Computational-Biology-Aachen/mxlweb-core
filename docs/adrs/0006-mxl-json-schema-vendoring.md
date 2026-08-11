# ADR 0006: `.mxl.json` Native Format, with Vendored + Drift-Tested Schemas

**Status:** Implemented
**Scope:** `src/mxl.ts`, `src/mxl/schemas.ts`, `tests/schemaDrift.test.ts`

---

## 1. Context

`.mxl.json` is a native serialization format for models (`MxlKind` discriminator:
`"kinetic"` / `"ode"` / `"steady-state"`, see
[ADR 0002](0002-three-builders-shared-ir.md)), validated on import via Ajv against JSON
Schemas defined in `src/mxl/schemas.ts`. Those schemas are a **vendored copy** of the
canonical schemas from the separate `mxl-schemas` repo, not a runtime dependency on that
repo/package. `tests/schemaDrift.test.ts` fetches the canonical upstream files at test
time and fails if the local vendored copy has diverged.

## 2. Decision

- Maintain `.mxl.json` as a lightweight, native interchange format for this tool family,
  rather than routing all model interchange through SBML.
- Vendor a copy of the `mxl-schemas` JSON Schemas into this package and validate against
  the local copy at runtime; keep them honest via a CI drift test against the canonical
  source, rather than depending on `mxl-schemas` as a runtime package.

## 3. Rationale

**Why a native format at all:** `.mxl.json` is the shared interchange format across the
tool family (mxlpy can export to it via metaprogramming; it moves between the browser
sites), matching this ecosystem's own IR (MathML nodes, the `MxlKind` variants) more
directly and lightly than SBML's heavier ceremony would for this purpose. SBML support
is kept for genuine interoperability with the broader systems-biology tooling
ecosystem; `.mxl.json` is for interoperability within this tool family.

**Why vendor instead of depending on `mxl-schemas` at runtime:** consistent with
[ADR 0001](0001-independence-from-mxlpy-runtime.md)'s "no server, no runtime network
dependency, fast client-side load" philosophy — schema validation during model parsing
must not require a network fetch. Vendoring also pins this package's schema version
independent of whatever `mxl-schemas` currently publishes, while the drift test keeps
that pin from silently going stale.

## 4. Consequences

- Never hand-edit `src/mxl/schemas.ts` — regenerate the vendored copy from
  `mxl-schemas` and let the drift test confirm alignment.
- If `mxl-schemas` ships a breaking schema change, `schemaDrift.test.ts` is the signal
  to update the vendored copy deliberately, not something to silence.
