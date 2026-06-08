# @computational-biology-aachen/mxlweb-core

Shared core for the MxlWeb browser-side ODE/kinetic model toolkit. Holds the model builders, the intermediate representation, the MathML → WAT pipeline, and the three compute backends — so that every site that runs models client-side builds on the same engine instead of re-implementing it.

All compute is client-side: there is no server component.

## What it ships

Subpath exports (consume via `@computational-biology-aachen/mxlweb-core/...`):

| Export                       | Contents                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                          | Model builders (`KineticModelBuilder`, `OdeModelBuilder`), model IR, JS integrators, and the `SimulationRequest` / `SimulationResult` / `SimulationError` types |
| `./mathml`                   | MathML AST → MathML rendering **and** WAT (WebAssembly Text) codegen                                                                                            |
| `./sbml`                     | SBML import/export                                                                                                                                              |
| `./pam`                      | PAM fluorescence model                                                                                                                                          |
| `./backends/js`              | Pure-JS integrators — explicit (Euler, RK2, RK45, BOSH3, Tsit5) and implicit (backward Euler, Kvaerno45)                                                        |
| `./backends/py`              | Pyodide (Python-in-WASM) worker                                                                                                                                 |
| `./backends/wasm`            | Custom WASM backend built from C via Emscripten (Radau5, DOP853, DOPRI5) + WAT codegen/context                                                                  |
| `./backends/js/jsWorker`     | JS compute web worker                                                                                                                                           |
| `./backends/py/pyWorker`     | Pyodide compute web worker                                                                                                                                      |
| `./backends/wasm/wasmWorker` | WASM compute web worker                                                                                                                                         |

## Used by

These sites in the [web-meta](https://github.com/Computational-Biology-Aachen) repo depend on `mxlweb-core` (each pulls it in via `github:Computational-Biology-Aachen/mxlweb-core`):

- [MxlWeb](https://github.com/Computational-Biology-Aachen/mxl-web) — browser-side ODE model explorer (`pages/mxlweb`)
- [ComPhot](https://github.com/Computational-Biology-Aachen/comphot) — educational photosynthesis site (`pages/comphot`)
- [GreenSloth](https://github.com/Computational-Biology-Aachen/green-sloth) — interactive simulation site (`pages/greensloth`)

## Tool family 🏠

`mxlweb-core` is part of a larger ecosystem:

- [MxlPy](https://github.com/Computational-Biology-Aachen/MxlPy) — Python package for mechanistic learning
- [MxlBricks](https://github.com/Computational-Biology-Aachen/mxl-bricks) — pre-defined reaction bricks on top of MxlPy
- [MxlModels](https://github.com/Computational-Biology-Aachen/mxl-models) — flat single-file model versions for easy inspection
- [pysbml](https://github.com/Computational-Biology-Aachen/pysbml) — SBML import/export for MxlPy
- [Parameteriser](https://gitlab.com/marvin.vanaalst/parameteriser) — kinetic parameter lookup from BRENDA and other databases

## Dev

```bash
npm install
npm run dev          # tsx watch on src/index.ts
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run build:wasm   # emcc → static/wasm/radau5.js (requires Emscripten)
```

Consumers import the `svelte` export condition (`src/`) at build time but resolve to `dist/` at runtime, so **run `npm run build` after editing `src/`** — `vitest` and dependent sites pick up `dist/`, not `src/`.

Requires Node `>=20`.
