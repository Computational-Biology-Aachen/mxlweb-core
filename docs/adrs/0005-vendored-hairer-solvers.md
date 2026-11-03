# ADR 0005: Vendor Hairer's Fortran Solvers (via C, via Emscripten) — Not Rust, Not New Numerics

**Status:** Implemented
**Scope:** `src-c/` (vendored from mxl-solvers, see §5), `src/backends/wasm/`, `npm run build:wasm`

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

## 5. Update (2026-11): solvers live in mxl-solvers

MxlPy's `Native` integrator compiles the same Hairer solvers, and its hand copy drifted
from `src-c/` once (the `radau5.c` fixes landed in MxlPy first). The Fortran originals
and the f2c'd solvers now live in
[mxl-solvers](https://github.com/Computational-Biology-Aachen/mxl-solvers), which both
repos vendor from:

- `src-fortran/` was removed; the originals are in mxl-solvers' `fortran/`.
- `radau5.c`, `dc_decsol.c`, `decsol.c`, `dop853.c`, `dopri5.c`, `f2c.h` and
  `libf2c_stubs.c` in `src-c/` are copied by mxl-solvers' `scripts/vendor.sh`, which
  writes `src-c/VENDORED`. `tests/vendoredSolvers.test.ts` checks those hashes, so fix
  solvers in mxl-solvers and re-vendor them instead of editing them here.
- The wrappers (`*_wrapper.c`), `fit_experiments.*` and `minpack/` stay in this repo.

mxl-solvers also carries SciPy's C LSODA (`lsoda.c`, with `mxs_lapack.c` standing in
for BLAS/LAPACK), vendored into `src-c/` too. Unlike the Hairer solvers it isn't f2c
output, but it follows the same rule: an established reference implementation, here the
exact code `scipy.integrate` runs, rather than new numerics. `run_lsoda`
(`radau5_wrapper.c`) has `run_radau5`'s contract, including `set_output_grid`, so
`method: "lsoda"` supports `tEval`, protocols, steady states and fits (`FitSolver`).
