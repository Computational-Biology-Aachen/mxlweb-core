# ADR 0009: Fit Experiments — Time Courses, Protocols, Steady States

**Status:** Implemented
**Scope:** `src-c/fit_wrapper.c` (`fit_init`, `compute_residuals`,
`fit_get_predictions`); `src-c/radau5_wrapper.c` (`record_point`, `eval_rhs`);
`src/index.ts` (`FitExperiment`, `FitInitRequest.experiments`,
`FitProgress.predictions`); `src/backends/wasm/{fitExperiments,fitWorker}.ts`;
`src/fit/{fitConfig.ts,Fit.svelte,FitProtocolEditor.svelte}`

---

## 1. Context

The fit pipeline (mxlweb ADR 0004) could only fit one kind of data: a time series
from a single integration over `0 → t_end` with constant parameters. Two further
kinds of measurement are routine for the photosynthesis models this package
serves, and MxlPy already fits both (`fit.steady_state`/`group_steady_state`,
`fit.protocol_time_course`):

- **Steady states under several conditions** — e.g. a light-response curve: one
  observation per condition, each condition setting some parameters (PPFD).
- **Protocol time courses** — a time series under piecewise-constant parameter
  changes at control points, e.g. a PAM/NPQ measurement (actinic light plus
  saturating pulses).

## 2. Decision

### 2.1 One residual over a list of experiments

`fit_init` takes a list of **experiments** whose residual blocks are concatenated
into one least-squares problem. Every experiment starts from the same `y0`:

| kind          | segments                                  | points               |
| ------------- | ----------------------------------------- | -------------------- |
| `timeCourse`  | ≥ 1 (`t_end` + parameter overrides each)  | ascending data times |
| `steadyState` | exactly 1 (its overrides = the condition) | one                  |

A plain time course is the one-segment, no-override special case — the original
behavior is not a second code path. Overrides are one shared list of parameter
indices plus one value row per segment (NaN = keep the trial value), and they
**replace a fitted parameter's trial value**, the same as MxlPy; the UI warns when
a fitted parameter is also overridden, since the fit can then never move it.

NaN observations are missing data and contribute a zero residual, so a
multi-condition table may have gaps.

### 2.2 Protocol semantics match the simulation workers

Segments are integrated in order, carrying the state across boundaries. A data
point at `t` belongs to the segment with `t_prev < t ≤ t_end` (a boundary point
belongs to the _earlier_ segment — the simulation workers drop each later
segment's first sample, so previews and the fit agree), and derived targets are
evaluated with that segment's parameters (`wasmWorker.ts`'s per-point `allPars`).
Integration stops after the segment containing the last data point; data past the
protocol's end is rejected at `fit_init` (`-3`) and, earlier, by `buildFitConfig`.

### 2.3 Steady state by integrating to convergence

Each condition is integrated in growing windows ending at `t = 1, 10, 100, …`
(capped at `ssTMax`, default 1e6), checking `‖dy/dt‖₂ / max(‖y‖₂, 1) < ssTol`
(default 1e-6) after each via `eval_rhs`. A condition whose integration fails or
never converges gets the same finite penalty residual as a failed time course,
so LM's trust region backs away rather than the fit aborting. Newton on
`f(y) = 0` was rejected: it needs a Jacobian, ignores conserved moieties (a
singular system for most of these models), and can converge to unstable or
non-physical roots.

### 2.4 Finite-difference LM only

Only `fit_wrapper.c`'s `lmdif` path handles the new kinds. The analytic-Jacobian
(`lm-jacobian`) and adjoint backends would need sensitivities through segment
boundaries and the implicit-function sensitivity at a steady state; both stay
restricted to a single plain time course (`plainTimeCourse`), and
`buildFitConfig`/the UI only offer `"lm"` for the new kinds.

### 2.5 Predictions for display

`fit_get_predictions` re-evaluates the residual at the current estimate and
returns the model value behind every residual entry (NaN for a penalized
experiment). The worker attaches it to every chunk-end `FitProgress` (and
`FitInitResult.initialPredictions`). The steady-state chart plots these directly
— there is no trajectory to preview — so it shows exactly what the optimizer
compared against the data.

### 2.6 Output buffer growth

The integrators' step buffer used to drop steps silently beyond its initial
capacity (2000). Long protocols exceed that easily, so `record_point` now doubles
the buffer instead; `init_output(0, dim)` disables recording for callers that
only need the final state (the steady-state windows).

## 3. Consequences

- Protocol and steady-state fits run entirely in WASM, like time-course fits —
  e.g. recovering one NPQ-model parameter from a 31-segment, 241-point
  fluorescence trace takes well under a second.
- Fitting NPQ _values_ directly is out of scope: NPQ is a whole-trace transform
  (`computeNpq` over the Fm′ peaks). Fit the fluorescence trace instead.
- The C layer already supports several time-course experiments (e.g. replicate
  protocols); the UI exposes one CSV, so only one per fit for now.
- Curriculum stages truncate time-course and protocol data by time as before; a
  steady-state fit always runs as a single stage.
