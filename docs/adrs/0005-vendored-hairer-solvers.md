# ADR 0005: Vendor Hairer's Fortran Solvers (via C, via Emscripten) — Not Rust, Not New Numerics

**Status:** Implemented
**Scope:** `src-fortran/`, `src-c/`, `src/backends/wasm/`, `npm run build:wasm`

---

## 1. Context

The WASM backend's Radau5, DOP853, and DOPRI5 solvers originate as Fortran source
(`src-fortran/`, Hairer & Wanner's reference implementations), translated to C
(`src-c/`, via an `f2c`-style toolchain — `f2c.h`/`libf2c_stubs.c` are present), and
compiled to WebAssembly via Emscripten (`emcc`, see the `build:wasm` npm script). Both
`src-fortran/` and `src-c/` were added in a single initial commit — they are vendored,
not authored in this repo.

The meta-repo's top-level documentation previously (incorrectly) described this as a
"TypeScript/Rust" integrator tree; there is no Rust anywhere in this codebase. That
claim has been corrected (see `/home/marvin/git/0-mxl-meta/CLAUDE.md`).

## 2. Decision

Vendor and compile the existing, battle-tested Fortran solvers rather than writing new
WASM-native (Rust or otherwise) integrators from scratch.

## 3. Rationale

Radau5/DOP853/DOPRI5 are the canonical reference solvers cited throughout the
numerical-ODE literature — the implementations other solvers get validated against,
especially for Radau5's stiff-system handling, which is genuinely hard to get right from
scratch. Decades of battle-testing outweigh the appeal of a from-scratch rewrite in a
"more modern" language. `f2c` + Emscripten was the pragmatic path to get that exact,
trusted numerics running in a browser — the priority was preserving the numerics, not a
language choice; Rust specifically was never part of this design.

## 4. Consequences

- Don't propose rewriting the WASM solvers in Rust (or any other language) as a
  modernization project without a concrete numerical or maintainability problem driving
  it — the current approach exists specifically to avoid re-deriving Hairer's numerics.
- Any future contributor extending the WASM backend with a new solver should default to
  vendoring another established reference implementation via the same
  Fortran/C-to-Emscripten path, consistent with this precedent, rather than writing new
  numerics.
- Keep the meta-repo's cross-repo documentation (`CLAUDE.md`) in sync if this backend's
  implementation language ever changes — it was already found stale once.
