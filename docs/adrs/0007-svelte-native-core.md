# ADR 0007: Svelte-Native Core, Not Framework-Agnostic

**Status:** Implemented
**Scope:** `src/modelBuilderBase.ts` and every builder built on it;
`package.json` `exports` (`svelte` vs. `default` conditions)

---

## 1. Context

`ModelBuilderBase`'s core mutable state (`parameters`, `variables`, `assignments`) is
typed and constructed as `SvelteMap`, not a plain `Map` — Svelte's reactivity primitive
is used directly in what's nominally a framework-agnostic "core" package. This is
pervasive (~20 usages across the builder classes), not incidental.

`package.json` declares a `svelte` export condition pointing at `src/` alongside the
`default` condition pointing at compiled `dist/`.

## 2. Decision

`mxlweb-core` is **Svelte-native by design**, not framework-agnostic with Svelte support
bolted on. There is no plan to decouple the reactive state from Svelte.

## 3. Rationale

Every current and planned consumer (MxlWeb, ComPhot, GreenSloth) is Svelte/SvelteKit,
and the builders' whole reason for existing is to back *live, reactive* UIs (sliders,
in-place equation editing). Making state reactive at the source avoids every consumer
re-wrapping or mirroring builder state into its own reactive layer. The `svelte`/
`default` export condition split is the escape hatch for non-Svelte contexts (tests,
Node scripts, `vitest`): they resolve to `dist/`'s plain compiled output, while Svelte
consumers get the reactive `src/` directly at build time.

## 4. Consequences

- Don't propose replacing `SvelteMap` with a framework-agnostic reactive primitive (or
  plain `Map` + a separate reactivity layer) as a "purity" cleanup — this is a
  deliberate, permanent choice, not unfinished decoupling.
- A future consumer that isn't Svelte-based would need to go through the `default`
  export condition and lose automatic reactivity, by design.
