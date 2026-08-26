# ADR 0008: Neural Network Blocks and Adjoint-Based Fitting

**Status:** Implemented
**Scope:** `src/nnBlock.ts`; `src/mathml/{grad,nary,binary,unary-special}.ts`;
`src/modelIr.ts` (`buildAdjointGraph`, `irToAdjointWat`, `adjointLambdaName`);
`src/backends/wasm/wat-codegen.ts` (`buildAdjointWat`); `src/backends/wasm/fitWorker.ts`;
`src-c/adjoint_wrapper.c`; `src/index.ts` (`FitInitRequest`/`FitProgress`/
`FitStopReason`)

---

## 1. Context

This ADR was originally written and implemented as `mxl-web`'s own ADR 0005
("Neural Network Corrections and Adjoint-Based Fitting"). On review, nearly every
piece of that design turned out to physically live in this repo, not `mxl-web`: the
`pushGradient` AST machinery, the NN-block generator, the entire continuous-adjoint
algorithm (`src-c/adjoint_wrapper.c`), the WAT codegen for it, and even the
`fitWorker.ts` dispatch that chooses between the `"lm"` and `"adjoint"` backends. Only
the block-authoring UI, the `logSpace` fitting default, the backend-selection trigger,
and stopping-criteria display are genuinely `mxl-web`-side. This ADR extracts and
supersedes the algorithmic content of `mxl-web`'s ADR 0005 (§2.1/2.1.1, §2.2/2.2.1,
§2.3–2.3.4) into the repo that actually owns it; `mxl-web`'s ADR 0005 has been trimmed
to the UI-facing decisions and now points here for the rest.

The original motivating problem, unchanged: users want to augment an otherwise-
mechanistic model with a small neural-network correction term (a universal differential
equation, UDE) — most concretely for PETC (photosynthetic electron transport chain)
models under PAM protocols, which are stiff. ADR 0004 established fitting via
cminpack's `lmdif`, which needs the full Jacobian of the residual vector via
forward-difference — intractable once the parameter count reaches NN scale (a 6×64
block is ≈20,800 weights). Two constraints rule out the standard neural-ODE playbook:

- **Stiffness rules out backsolve.** The classical Neural-ODE continuous adjoint
  ("`BacksolveAdjoint`" in SciMLSensitivity/diffrax terms — reconstruct the forward
  trajectory by re-integrating the vector field backward in time, alongside the adjoint
  variable) is documented as unstable on stiff problems by both ecosystems: a
  forward-dissipative vector field is an *expanding*, error-amplifying process when run
  backward, which corrupts the coupled adjoint variable regardless of its own dynamics.
- **An opaque solver rules out discrete adjoint.** diffrax's own preferred default
  (`RecursiveCheckpointAdjoint`) differentiates the solver's step function directly —
  infeasible here because Radau5/DOP853/DOPRI5 are opaque compiled
  Fortran→C→Emscripten (vendored-hairer-solvers, this repo's ADR 0005), not
  JAX. No JS/WASM ML library changes this; none can differentiate through opaque
  compiled machine code.

The reframe that unblocks both: the adjoint method doesn't require differentiating the
*solver*, only computing vector-Jacobian products of the RHS — and the RHS is already a
`mathml` AST, a closed set of ~48 node types evaluated through a shared visitor pattern
(`toWat`/`toJs`/`toPy`/`toTex`/`toSBML`). A VJP for that graph is one more visitor
method, generated once at compile time.

## 2. Decision

### 2.1 NN blocks are generated expressions — zero new `mathml` node types

A UDE correction term needs no new AST node type. `KineticModelBuilder`'s existing
`reactionTerm()` precedent (a reaction's rate law is `Mul`/`Add`/`Num`/`Name` composed
at generation time, not its own node type) extends directly: an NN block's affine layer
is `Add` of `Mul(Name(weight), Name(input))` terms plus a bias, wrapped in an activation
built from existing primitives. `nnBlock.ts`'s generator takes an architecture spec (n
inputs → depth × width hidden layers → m outputs) and produces new `Parameter` entries
for every weight/bias plus the nested expression per output, generated once when a block
is authored or resized — never hand-typed. Depth is arbitrary from v1 (real prior work
needed up to 6 layers × 64 width, ≈20,800 parameters — capping at one hidden layer would
be unable to reproduce work already done).

The generator is builder-agnostic: `KineticModelBuilder` wires its output in as an
ordinary reaction (stoichiometry `{ variable: 1 }`); `OdeModelBuilder` adds it directly
into a differential via `setDifferential(key, new Add([currentExpr, nnBlockExpr]))`.
Neither builder needs a new concept — a UDE correction term is just a reaction, or a
differential term, that happens to be machine-generated.

**Activation is softplus**, not tanh or ReLU, generated in its numerically-stable form
`max(x, 0) + ln(1 + exp(-|x|))` (`Max`/`Abs`/`Add`/`Exp`/`Ln`/`Minus` — all existing
nodes), never the naive `ln(1+exp(x))` (overflows to `Infinity` for large `x` instead of
the correct asymptotic value of `x`). Smoothness (C^∞) matters more here than in
ordinary deep learning: a kink in the vector field gives Radau5/DOP853's adaptive
step-size control a hidden quasi-event to repeatedly shrink around, and violates the
smoothness the adjoint method's own derivation assumes.

### 2.2 Reverse-mode sensitivity as one more `Base` visitor method — no CAS

`Base` gains one more abstract method, `pushGradient`, implemented once per concrete
node class using that node's own known local derivative rule — the same two-pass graph
walk PyTorch/JAX use internally (forward pass records structure, one backward pass
accumulates one adjoint per node in reverse topological order), not textual symbolic
differentiation. Critically, `pushGradient` builds a *symbolic* adjoint — another
`Base` expression tree, not a runtime number — because this needs to run live in the
browser (`ModelEditor.svelte` recompiles the AST on every structural edit) with no CAS
or `simplify()`/CSE pass available. Because the node-type set is closed and the graph
has no control flow, mutation, or aliasing, none is needed: `mulAdjoint`/`negAdjoint`
(`mathml/grad.ts`) fold away the handful of trivial identities (`× 1`, `× 0`, `−(−x)`)
that would otherwise clutter generated expressions, and nothing more elaborate is
required.

Both forward and backward codegen depend only on model *structure* — `buildModelWat`'s
signature (`equations`, `varNames`, `parNames`) never bakes in values, including weight
values during fitting, which flow in separately at runtime via `y_ptr`/`rpar_ptr`. So
differentiating a 20,800-parameter block is paid once per deliberate architecture
decision (adding a reaction, resizing a block), never per fit-iteration or per
keystroke.

#### 2.2.1 Non-smooth node types: zero gradient by convention, documented at each site

Most node types are ordinary calculus with no design decision to make. The exceptions,
each requiring an explicit code comment stating *why* the rule is zero (a documented
convention, not a silent stub that reads as an oversight):

- **`Floor`/`Ceiling`**: piecewise-constant, so the derivative is `0` almost everywhere.
  A fitted parameter reachable only through one of these gets zero gradient from Adam —
  correct, but easy to mistake for a bug without the comment.
- **Comparison/boolean nodes** (`Eq`, `GreaterThan`, `And`, ...): same reasoning — a
  truth value doesn't vary smoothly with its operands. Almost always a `Piecewise`
  condition in practice, not a value flowing further into arithmetic.
- **`Factorial`**: a proper derivative needs digamma, which isn't among the existing WAT
  math imports. Declined to add it — `Factorial` is never emitted by the NN-block
  generator and is rare in hand-written rate laws.
- **`Piecewise`/`Max`/`Min`**: not actually a problem despite the non-smooth
  branch/tie boundary — route the adjoint only into whichever branch or argument
  actually won during the forward pass, built as a runtime-evaluated `Piecewise`
  indicator (`And`/`GreaterEqual` for `Max`, mirrored with `LessEqual` for `Min`), the
  standard `lax.cond`/`jnp.where`-style subgradient rule. Ties get credit on every
  tied side, not just the first.
- **`RateOf`**: already a literal zero stub in every numeric backend (an artifact of
  importing SBML's `rateOf` csymbol into a system that only solves explicit ODEs) — its
  backward rule is trivially zero too.

### 2.3 Continuous adjoint, reusing the existing black-box solver for both passes

Forward-solve as today, unmodified. For the backward pass: do **not** reconstruct
`y(t)` by re-integrating the forward vector field backward in time (§1's `BacksolveAdjoint`
rejection). Instead, obtain `y(t)` at whatever points the backward pass needs directly
from the forward solve's own output. Only the adjoint variable `λ` (plus a
parameter-gradient quadrature accumulator) is backward-integrated. `λ`'s ODE is linear
given `y(t)` and inherits the *same* stiffness ratio as the forward problem (transposed,
not worse) — it needs an implicit integrator too, but being linear, its per-step
"Newton iteration" is a single linear solve, cheaper than the forward nonlinear one.

This deliberately does not imitate diffrax's own preferred `RecursiveCheckpointAdjoint`:
reaching into and differentiating Hairer's vendored Fortran step routines was considered
and rejected as a categorically larger, higher-risk undertaking than interpolating a
trajectory the solver already knows how to produce.

#### 2.3.1 Getting y(t): stored trajectory + local Hermite interpolation, not Hairer's dense output

Checked, not assumed: real dense output is not currently reachable. All three wrappers
(`radau5_wrapper.c`) call their solver with `IOUT = 1` (Hairer's "call `solout` every
accepted step, but skip computing the dense-output polynomial" mode) — `contr5_`/
`contd8_`/`contd5_` exist in the vendored source but their `CONT` coefficient arrays are
never populated in this mode.

Two ways to get real `y(t)` at the backward pass's query points: (A) flip `IOUT` to 2,
store the `CONT` array per step, export the `contr5_`/`contd8_`/`contd5_` query
functions — higher accuracy, matching each solver's own order, but reaches into
Hairer's vendored solver-driver internals in three places and grows memory per step (a
coefficient array, not two numbers); or (B) reuse the `(t, y)` step data already
collected today for chart plotting (`get_out_t`/`get_out_y`) and do local cubic Hermite
interpolation within the bracketing step, using `y` and `f = dy/dt` at both endpoints
(one extra RHS evaluation per endpoint, already have the RHS) — third-order accurate,
zero changes to the vendored solver-driver code.

**Decision: B.** This ADR already rejects reaching into Hairer's vendored internals
once (§2.3's `RecursiveCheckpointAdjoint` rejection) — option A would quietly break that
same principle for a secondary accuracy gain. Revisit only if B's accuracy is a measured
problem later, not a theoretical one. A direct consequence: the forward pass needs zero
C changes — `run_radau5`/`get_out_t`/`get_out_y` already produce exactly the data B
needs.

Concretely (`hermite_interp` in `adjoint_wrapper.c`):

```python
def hermite_interp(t_query, fwd_t, fwd_y, forward_rhs, pars):
    lo, hi = bracket(fwd_t, t_query)          # binary search over stored accepted steps
    t0, t1 = fwd_t[lo], fwd_t[hi]
    y0, y1 = fwd_y[lo], fwd_y[hi]
    f0 = forward_rhs(t0, y0, pars)            # one extra RHS eval per endpoint
    f1 = forward_rhs(t1, y1, pars)
    h = t1 - t0
    s = (t_query - t0) / h
    h00, h10, h01, h11 = hermite_basis(s)     # cubic Hermite basis polynomials
    return h00 * y0 + h10 * h * f0 + h01 * y1 + h11 * h * f1
```

##### "Checkpoint" here is not Griewank–Walther checkpointing

Both this codebase's comments and SciMLSensitivity's own naming (`InterpolatingAdjoint`)
use the word "checkpoint" for the `(t, y)` points saved above — but that is a different
concept from the memory-saving "checkpointing" (a.k.a. gradient checkpointing /
rematerialization) that Griewank & Walther's binomial/"revolve" algorithm, and
diffrax's `RecursiveCheckpointAdjoint`, implement. That family stores only a *subset*
of forward states under a fixed memory budget and *recomputes* the missing segments
on demand during the backward pass — an explicit compute/memory tradeoff with its own
scheduling problem (online variants exist specifically because adaptive-step solvers
don't know their step count in advance).

Nothing like that exists in this code. `fwd_t`/`fwd_y` (`adjoint_wrapper.c`) store
*every single accepted step* of the forward solve, full stop — `O(steps)` memory, the
exact cost real checkpointing exists to avoid — and nothing is ever recomputed from an
earlier checkpoint during the backward pass; Hermite interpolation only ever reads the
two already-stored endpoints bracketing a query time. If a future PETC/PAM model's
forward trajectory ever gets long enough that storing every step becomes the actual
memory bottleneck, *that* would be the point to reach for real checkpointing — this
ADR's design does not provide it today, and "we already checkpoint" is not a correct
reason to skip that work when it comes up.

#### 2.3.2 Backward integrator: reuse whichever solver ran forward

No separate backend-solver choice: the backward pass uses whichever of
radau5/dop853/dopri5 the forward pass used. Stiffness is a property of the system, not
of which method was picked — if the forward pass needed Radau5's implicit solve, the
backward adjoint ODE (same eigenvalue structure, transposed) needs it too. Hairer's
solvers already support `xend < xstart` (integrating in decreasing time — the step-size
sign follows `sign(xend − xstart)`), so "backward" needs no special solver support
either; `run_radau5`/`run_dop853`/`run_dopri5` (`radau5_wrapper.c`) are called
completely unchanged, just with a different RHS registered via `set_model_fn_ptr`.

#### 2.3.3 The `-1`-seed trick: one backward pass for both dλ/dt and dθ/dt

`L = Σᵢ λᵢ · fᵢ` (`fᵢ = dxᵢ/dt`) is one scalar expression. Seeding its reverse-mode walk
(`pushGradient`) with `−1` produces `dλ/dt = −∂L/∂y` and `dθ/dt = −∂L/∂θ` in a *single*
backward pass — exactly the vector-Jacobian product the adjoint method needs, with `λ`
playing the role of the seed cotangent (`buildAdjointGraph`, `modelIr.ts`):

```python
def build_adjoint_graph(dxdt, theta_names, var_names, intermediates):
    lam = [Name(f"lambda_{i}") for i in range(len(var_names))]
    L_terms = [Mul(lam[i], dxdt[name]) for i, name in enumerate(var_names)]  # one scalar

    grads = {}
    for term in L_terms:
        term.pushGradient(Num(-1), grads)   # seed with -1, not +1

    # walk intermediates in reverse topological order — mirrors their forward
    # order — so each one's accumulated adjoint is computed once, stored as
    # its own named local, and shared by every further-upstream reference,
    # instead of being re-expanded at every use site.
    for name, expr in reversed(intermediates):
        contrib = sum_or_zero(grads.get(name))
        if contrib is ZERO:
            continue
        accum = new_local(f"__adjoint_accum_{name}")
        accum.expr = contrib
        expr.pushGradient(Name(accum.name), grads)   # push the *reference*, not contrib again

    dlambda = {v: sum_or_zero(grads.get(v)) for v in var_names}      # = -dL/dy
    dtheta  = {t: sum_or_zero(grads.get(t)) for t in theta_names}    # = -dL/dtheta
    return dlambda, dtheta
```

Walking `intermediates` in reverse (mirroring their forward topological order) rather
than treating `L` as one flat tree is what makes this cheap rather than
naive-symbolic-diff-shaped. `buildAdjointWat` (`wat-codegen.ts`) then lays out the
result as a WAT module exporting one `fcn(n, t, y_ptr, lambda_ptr, pars_ptr,
out_dlambda_ptr, out_dtheta_ptr)`, with `λ` resolved as a *runtime* leaf
(`WatContext.lambdaIndex`) exactly like `y`/`pars` resolve via `varIndex`/`parIndex`.

#### 2.3.4 Multi-observation jump conditions

The zettelkasten-standard continuous-adjoint derivation assumes a single terminal or
integrated loss. The real fit loss is a sum over discrete observation times,
`Loss = Σⱼ gⱼ(y(tⱼ))` with `gⱼ = Σₖ ((y_{idxₖ}(tⱼ) − dataₖ)/scaleₖ)²` — extending the
Lagrangian derivation to this case requires `λ` to take an additive **jump** at each
`tⱼ`, applied *at* `tⱼ` when the backward integration passes through it:
`λ(tⱼ⁻) = λ(tⱼ⁺) + (∂gⱼ/∂y)ᵀ`, with `λ(t_end⁺) = 0`. Segments between consecutive data
points are integrated one solver call at a time, backward, applying each jump the
instant the integration arrives there:

```python
def adam_step(y0, pars, theta_idx, data_t, data_y, target_idx, target_scale, t_end):
    fwd_t, fwd_y = solve_forward(y0, pars, t_end)   # once, full trajectory stored

    residual = [(hermite_interp(t_j, fwd_t, fwd_y)[k] - data_y[k][j]) / scale[k]
                for j, t_j in enumerate(data_t) for k in target_idx]
    loss = sum(r * r for r in residual)

    lam = zeros(n_y)
    theta_grad = zeros(n_theta)     # dQ/dt = dtheta(t); Q(t_end) = 0
    t_hi = t_end
    for j in reversed(range(len(data_t))):
        t_lo = data_t[j]
        if t_hi > t_lo:
            # dlambda/dt, dtheta/dt from the compiled adjoint fcn (§2.3.3) —
            # lambda and theta_grad are one augmented state, one integrator call
            lam, theta_grad = integrate_backward(adjoint_rhs, t_hi, t_lo, [lam, theta_grad], pars)
        for k in target_idx:
            lam[k] += 2 * residual[k, j] / scale[k]   # the jump: d(g_j)/dy_k
        t_hi = t_lo
    if t_hi > 0.0:
        lam, theta_grad = integrate_backward(adjoint_rhs, t_hi, 0.0, [lam, theta_grad], pars)

    # theta_grad started at 0 at t_end, accumulated dtheta(t) = -lambda^T df/dtheta
    # while integrating BACKWARD down to 0, so its final value is
    # +integral_0^t_end lambda^T df/dtheta dt = dLoss/dtheta directly.
    return loss, theta_grad
```

The parameter-gradient accumulator is not a separate quadrature bolted on afterward —
it is just another component of the same augmented ODE state
`[λ; theta_grad]` the integrator solves in one call
(`adjoint_rhs_dispatch`, `adjoint_wrapper.c`). Combined with §2.3.3's `−1` seed and
backward integration from `theta_grad(t_end) = 0`, the sign works out to
`+dLoss/dθ` directly — no extra negation anywhere in the C code. Three independent
choices (seed sign, integration direction, accumulator initialization) have to line up
exactly for that cancellation to hold, which is why `adjoint_wrapper.c`'s own comment
spells out the full derivation rather than just asserting the result.

**v1 restricts fit targets to raw state variables**, not derived quantities: a derived
target's jump would need `d(derived)/dy`, which needs a *second* generated adjoint
graph (over the derived-quantity expression tree, not `dxdt`'s) that doesn't exist yet.
Not a fundamental limit, just unbuilt — the `"lm"` backend keeps supporting both.

#### 2.3.5 New C entry points, not an extension of `fit_init`/`fit_chunk`

The adjoint backend gets its own `adjoint_init`/`adjoint_chunk`/`adjoint_free`,
dispatched from `fitWorker.ts` on `session.backend`, rather than growing
`fit_init`/`fit_chunk` in place — MINPACK's QR/trust-region machinery and
Adam-on-an-augmented-adjoint-ODE share essentially no algorithm to factor out. The
optimizer is **Adam** (lr `1e-4`, standard beta1/beta2/eps), not Gauss-Newton: the whole
reason this backend exists is that `lmdif` needs the full residual Jacobian, which
reverse-mode/adjoint isn't cheap for. One Adam step = one full forward solve + one full
backward solve (all segments) + one parameter update; `adjoint_chunk` runs up to
`maxIterations` *complete* Adam steps, unlike `lmdif`'s function-evaluation-granularity
chunking. L-BFGS was considered and rejected outright: its line-search-driven, more
locally-quadratic assumption doesn't fit deep, non-convex ODE/UDE loss landscapes,
reinforced by direct prior experience with these specific loss landscapes.

#### 2.3.6 The backward/VJP WAT is generated lazily — only when actually needed

Mirrors an existing pattern: `FitInitRequest.derivedWat` is already optional, generated
only when a fit target needs a derived quantity. The backward graph does the same —
`FitInitRequest.adjointWat?: string`, generated by `mxl-web` only when it's about to
request `backend: "adjoint"`. Plain simulation (`wasmWorker.ts`) never touches it, and
neither does an `"lm"` fit.

### 2.4 Backend-agnostic stopping criteria and progress reporting

Both backends (`"lm"`, `"adjoint"`) report through one shape
(`FitProgress`/`FitStopReason`, `src/index.ts`), so consumers never need to know which
one ran. `lmdif`'s raw `info` code and `adjoint_wrapper.c`'s `ADJOINT_INFO_*` constants
both map onto the same `FitStopReason` union inside `fitWorker.ts`. `"converged_step"`
has no `"adjoint"` equivalent (a first-order optimizer's step size reflects its
learning-rate schedule, not proximity to a solution) and is never emitted on that path.

## 3. Rationale

Every piece reuses an existing pattern rather than introducing a new one:
`reactionTerm()`'s generated-expression shape and the reaction/stoichiometry and
`setDifferential` wiring points (§2.1), the AST's generic per-node visitor methods
(§2.2), the existing chunked `FIT_INIT`/`FIT_CHUNK`/`FIT_FREE` worker protocol and its
`initialResidualNorm` probe (§2.3.6), and ADR 0004's fit-target/data plumbing. The one
deliberate departure from prior art is not following diffrax's own preferred adjoint
strategy (§2.3) — the reason is architectural (opaque vendored solver), not a
disagreement with that recommendation.

## 4. Consequences / Open Questions

- The augmented `[λ; θ-gradient]` state shares one `rtol`/`atol` (the same ones the
  forward solve uses) even though `λ` and the θ-gradient accumulator can have very
  different natural scales — a known simplification, not revisited here. A
  per-component tolerance vector would need its own design pass if it ever matters in
  practice.
- Whether local Hermite interpolation's accuracy (§2.3.1, option B) is ever actually a
  problem in practice — revisit toward Hairer's true dense output (option A) only if
  measured, not preemptively.
- v1's state-targets-only restriction (§2.3.4) is unbuilt, not fundamental — extending
  to derived-quantity targets needs a second generated adjoint graph over the derived
  expression tree.
- Don't reuse the word "checkpoint" from this ADR to justify skipping real
  Griewank-Walther-style checkpointing if forward-trajectory memory ever becomes a
  measured problem (§2.3.1) — see that subsection for why they're unrelated.
- See `mxl-web`'s ADR 0005 for the UI-facing decisions this ADR does not cover: block
  authoring, the `logSpace` fitting default, the backend-selection trigger, and
  stopping-criteria display — including that ADR's own open item, an uncalibrated
  auto-selection time-budget for purely mechanistic many-parameter fits.
