import type { Base } from "./mathml/index.js";
import {
  additiveMechanism,
  multiplyMechanism,
  relativeMultiplyMechanism,
  softplusActivation,
} from "./nnBlock.js";
import type { NNBlockConfig, NNBlockWeightMatrix } from "./modelBuilderBase.js";

/**
 * Python export for a UDE/NODE correction block (`buildMxlpy()`'s NN path).
 *
 * `mxlpy.surrogates` is deliberately not the target: that abstraction only
 * ever composes additively, like a plain reaction ("never a selectable
 * composition algebra", per its own docstring). `mxlpy.jax.models.Ude`/
 * `FluxUde` are the actual UDE primitives — they combine a *whole*
 * mechanistic `Ode`/`FluxOde` with a *whole* neural `Node`/`FluxNode` via a
 * selectable `op`, matching this package's `mechanism` concept directly
 * (`op="rel"` even reuses the same name as `relativeMultiplyMechanism`).
 *
 * The catch: `Ude`/`FluxUde` are whole-state — `Node`'s MLP takes literally
 * every model variable as input and produces a correction for literally
 * every one of them, combined via one global `op`. `NNBlockConfig` allows a
 * *partial* correction (an arbitrary `inputs`/`targets` subset, several
 * independent blocks). The two coincide only when a single block's own
 * `targets` happens to cover every variable (`Ude`) or every reaction
 * (`FluxUde`, `KineticModelBuilder` only). {@link planNNBlockMxlpy} checks
 * exactly that, and throws a specific, actionable error otherwise rather
 * than silently emitting a wrong or partial export.
 */

export type NNBlockMxlpyKind = "ude" | "fluxUde";
/** `Ude`'s `op` dict has a `"rel"` entry; `FluxUde`'s does not (`jax/models.py`) — {@link planNNBlockMxlpy} only ever returns `"rel"` for `kind: "ude"`. */
export type NNBlockMxlpyOp = "+" | "*" | "rel";

export type NNBlockMxlpyPlan = {
  kind: NNBlockMxlpyKind;
  key: string;
  config: NNBlockConfig;
  op: NNBlockMxlpyOp;
  /** Hidden-layer width (`eqx.nn.MLP`'s `width_size`) — every hidden layer shares one. */
  width: number;
  /** Number of hidden layers (`eqx.nn.MLP`'s `depth`) — i.e. `layers.length - 1`. */
  depth: number;
  /** Model variable count (`Node`'s `n_obs`) — always `config.inputs.length` once validated. */
  nObs: number;
};

function sameExpr(a: Base, b: Base): boolean {
  return JSON.stringify(a.toJson()) === JSON.stringify(b.toJson());
}

function sameNameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
}

function mechanismOp(
  key: string,
  mechanism: Base,
  kind: NNBlockMxlpyKind,
): NNBlockMxlpyOp {
  if (sameExpr(mechanism, additiveMechanism())) return "+";
  if (sameExpr(mechanism, multiplyMechanism())) return "*";
  if (kind === "ude" && sameExpr(mechanism, relativeMultiplyMechanism()))
    return "rel";
  const supported =
    kind === "ude"
      ? 'additive ("+"), multiply ("*"), or relativeMultiply ("rel")'
      : 'additive ("+") or multiply ("*") — FluxUde has no "rel" op';
  throw new Error(
    `buildMxlpy: NN block "${key}"'s mechanism isn't representable as a mxlpy.jax.models.${kind === "ude" ? "Ude" : "FluxUde"} op — only ${supported} are supported.`,
  );
}

/**
 * Validate that `nnBlocks` is representable as a single `mxlpy.jax.models.
 * Ude`/`FluxUde` and return the plan to emit one, or `undefined` if there
 * are no NN blocks at all. Throws a specific, actionable error for any
 * unrepresentable configuration — see this module's doc comment.
 *
 * `reactionNames` is `undefined` for a builder with no reactions
 * (`OdeModelBuilder`); a `"reaction"`-targeted block can never occur there
 * in practice (`OdeModelBuilder.wireNNBlockOutputs` already rejects it at
 * `addNNBlock` time), so this only guards defensively.
 */
export function planNNBlockMxlpy(
  nnBlocks: Map<string, NNBlockConfig>,
  variableNames: string[],
  reactionNames: string[] | undefined,
): NNBlockMxlpyPlan | undefined {
  if (nnBlocks.size === 0) return undefined;
  if (nnBlocks.size > 1) {
    throw new Error(
      `buildMxlpy: ${nnBlocks.size} NN blocks present — mxlpy.jax.models.Ude/FluxUde combine exactly one mechanistic model with exactly one neural network, so only a single NN block is representable this way. Remove the extra blocks, or export as .mxl.json / mxlweb TS source instead.`,
    );
  }
  const [key, config] = [...nnBlocks.entries()][0];
  const kind: NNBlockMxlpyKind =
    config.targetKind === "variable" ? "ude" : "fluxUde";
  const coverage = kind === "ude" ? variableNames : reactionNames;

  if (coverage === undefined) {
    throw new Error(
      `buildMxlpy: NN block "${key}" targets reactions, but this model has none to target.`,
    );
  }
  if (!sameNameSet(config.targets, coverage)) {
    throw new Error(
      `buildMxlpy: NN block "${key}"'s targets (${config.targets.join(", ")}) don't cover every ${kind === "ude" ? "variable" : "reaction"} in the model (${coverage.join(", ")}) — mxlpy.jax.models.${kind === "ude" ? "Ude" : "FluxUde"} corrects the whole state at once, so a block must target all of them, not a subset.`,
    );
  }
  if (!sameNameSet(config.inputs, variableNames)) {
    throw new Error(
      `buildMxlpy: NN block "${key}"'s inputs (${config.inputs.join(", ")}) must be exactly the model's variables (${variableNames.join(", ")}) — mxlpy.jax.models.Node/FluxNode read the whole state and nothing else; inputs beyond the state (e.g. parameters) aren't supported by this export.`,
    );
  }
  if (config.layers.length === 0) {
    throw new Error(`buildMxlpy: NN block "${key}" has no layers.`);
  }

  const hiddenLayers = config.layers.slice(0, -1);
  const outputLayer = config.layers[config.layers.length - 1];
  hiddenLayers.forEach((layer, i) => {
    if (
      layer.activation === undefined ||
      !sameExpr(layer.activation.expression, softplusActivation().expression)
    ) {
      throw new Error(
        `buildMxlpy: NN block "${key}" layer ${i} doesn't use softplus activation — mxlpy.jax.models.Node/FluxNode hardcode softplus for every hidden layer.`,
      );
    }
  });
  if (outputLayer.activation !== undefined) {
    throw new Error(
      `buildMxlpy: NN block "${key}"'s output layer has an activation — mxlpy.jax.models.Node/FluxNode always leave the output layer linear.`,
    );
  }
  const width = hiddenLayers[0]?.width ?? outputLayer.width;
  if (hiddenLayers.some((l) => l.width !== width)) {
    throw new Error(
      `buildMxlpy: NN block "${key}"'s hidden layers have different widths — mxlpy.jax.models.Node/FluxNode use one uniform hidden width (eqx.nn.MLP's width_size).`,
    );
  }

  const op = mechanismOp(key, config.mechanism, kind);

  return {
    kind,
    key,
    config,
    op,
    width,
    depth: hiddenLayers.length,
    nObs: variableNames.length,
  };
}

function pyFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function matrixLiteral(w: number[][]): string {
  return `jnp.array([${w.map((row) => `[${row.map(pyFloat).join(", ")}]`).join(", ")}])`;
}

function vectorLiteral(b: number[]): string {
  return `jnp.array([${b.map(pyFloat).join(", ")}])`;
}

/** The `from mxlpy.jax.models import ...` names {@link buildNNBlockMxlpySource}'s output needs. */
export function nnBlockMxlpyImportNames(kind: NNBlockMxlpyKind): string[] {
  return kind === "ude"
    ? ["Node", "Ode", "Ude"]
    : ["FluxNode", "FluxOde", "FluxUde"];
}

/**
 * Emit the `get_ude()`/`get_flux_ude()` factory: builds the mechanistic
 * `Ode`/`FluxOde` from `get_model()` (already emitted earlier in the same
 * module by the caller), constructs a matching `Node`/`FluxNode`, injects
 * `matrices`' real (possibly fitted) weights into it via `eqx.tree_at`
 * (mirroring the same idiom `mxlpy/surrogates/_equinox.py` already uses for
 * loading explicit weights into an `eqx.nn.MLP`), and composes the two via
 * `Ude`/`FluxUde`.
 */
export function buildNNBlockMxlpySource(
  plan: NNBlockMxlpyPlan,
  matrices: NNBlockWeightMatrix[],
): string {
  const nnAttr = plan.kind === "ude" ? "nn" : "flux_nn";
  const leaves: string[] = [];
  const values: string[] = [];
  matrices.forEach(({ w, b }, i) => {
    leaves.push(
      `node.${nnAttr}.layers[${i}].weight`,
      `node.${nnAttr}.layers[${i}].bias`,
    );
    values.push(matrixLiteral(w), vectorLiteral(b));
  });
  const scale = vectorLiteral([plan.config.scale]);
  const opLiteral = JSON.stringify(plan.op);

  if (plan.kind === "ude") {
    return `def get_ude() -> Ude:
    m = get_model()
    ode = Ode.from_mxlpy(m)
    nn = Node(
        n_obs=${plan.nObs},
        width=${plan.width},
        depth=${plan.depth},
        key=jax.random.PRNGKey(${plan.config.seed}),
        out_scale=${scale},
    )
    nn = eqx.tree_at(
        lambda node: (${leaves.join(", ")}),
        nn,
        (${values.join(", ")}),
    )
    return Ude(ode=ode, nn=nn, op=${opLiteral})
`;
  }

  return `def get_flux_ude() -> FluxUde:
    m = get_model()
    flux_ode = FluxOde.from_mxlpy(m)
    flux_nn = FluxNode.from_flux_ode(
        flux_ode,
        width=${plan.width},
        depth=${plan.depth},
        key=jax.random.PRNGKey(${plan.config.seed}),
        out_scale=${scale},
    )
    flux_nn = eqx.tree_at(
        lambda node: (${leaves.join(", ")}),
        flux_nn,
        (${values.join(", ")}),
    )
    return FluxUde(flux_ode=flux_ode, flux_nn=flux_nn, op=${opLiteral})
`;
}
