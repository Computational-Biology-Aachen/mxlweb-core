# ADR 0004: Three Compute Backends — JS, WASM, Pyodide

**Status:** Implemented
**Scope:** `src/backends/js/`, `src/backends/wasm/`, `src/backends/py/`

---

## 1. Context

Three compute backends ship: pure-JS integrators (Euler, RK2, RK45, BOSH3, Tsit5,
backward Euler, Kvaerno45), a custom WASM backend (Radau5, DOP853, DOPRI5 compiled from
C — see [ADR 0005](0005-vendored-hairer-solvers.md)), and a Pyodide backend running real
NumPy/SciPy in-browser. `tests/equivalence.test.ts` cross-checks results between them.

## 2. Decision and History

Keep all three, but they are **not three equally-weighted user-facing choices** — they
occupy different roles today, reflecting how the system evolved:

- **Pyodide was the original, genuine production backend**, before the WASM backend
  existed.
- **The WASM backend (Radau5 et al.) is now the preferred backend** for real use —
  compiled numerics are roughly **50x faster** than Pyodide's interpreted Python, and
  Radau5 specifically offers robust stiff-system support the pure-JS methods don't
  match.
- **Pyodide is retained** for specific debugging value, not as the default path anymore.
- **The pure-JS backend now mainly serves as an easy-to-debug reference** for
  integration logic during development — debugging the compiled WASM backend directly
  is considerably harder ("hairy"), so new/changed integration logic is easier to
  reason about first in plain JS.

## 3. Rationale

This ordering (JS for debugging integration logic → Pyodide as the original
ground-truth/production backend → WASM as the current production default) is a genuine
evolution, not a designed-upfront three-way split. `equivalence.test.ts` exists because
having three independent implementations of "integrate this ODE" is only safe if they're
continuously checked against each other.

## 4. Consequences

- Don't assume all three backends are on equal footing when reasoning about "the"
  compute path — WASM is the default/preferred for production use today.
- New integrator work should still land in the JS backend first for ease of debugging,
  even if the eventual target is the WASM backend.
- If Pyodide's debugging value disappears entirely, revisit whether it's still worth
  the maintenance cost — but that's a call for whoever inherits this, not a foregone
  conclusion recorded here.
