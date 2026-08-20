import {
  Add,
  Base,
  Exp,
  Ln,
  Max,
  Minus,
  Abs,
  Mul,
  Name,
  Num,
  substituteName,
} from "./mathml/index.js";
import { defaultTexName, type Parameter } from "./modelBuilderBase.js";

/**
 * Generates a UDE/NODE correction term as an ordinary expression tree built
 * from existing `mathml` node types — no new AST surface, per ADR 0005 §2.1.
 * `KineticModelBuilder` already establishes this precedent for `Reaction`
 * (`kineticModelBuilder.ts`'s `reactionTerm()`); this module is the same
 * trick for a fully-connected network.
 *
 * v2 (mxl-schemas nn_blocks redesign): weight/bias values are no longer
 * `Parameter` entries — they carry no biological/kinetic meaning the way a
 * real parameter does, so `ModelBuilderBase` keeps them in a separate
 * `nnWeights` map instead, structurally excluded from `parameters`/the
 * parameter table/the ordinary fit picker. Only `scale` — a meaningful,
 * user-facing knob — remains an ordinary `Parameter`. Architecture also
 * generalizes from uniform depth×width to an explicit `layers` stack, and
 * activation is data (`{name, expression}`) rather than a hardcoded
 * function, substituted in via `substituteName` — the same portability the
 * schema's `mechanism` placeholders rely on (`modelBuilderBase.ts`'s
 * `composeNNBlocks`).
 */

/** One layer of an nn_block's stack (mxl-schemas `nnLayer`). Only `dense` exists today, but every layer is tagged so a future kind is a new variant rather than a restructure. */
export type NNBlockLayer = { type: "dense"; width: number };

/** A named activation function with a portable definition (mxl-schemas `nnActivation`). `expression` is instantiated per pre-activation value via `substituteName(expression, "x", preActivation)`. */
export type NNBlockActivation = { name: string; expression: Base };

/**
 * `max(x, 0) + ln(1 + exp(-|x|))` — softplus in its numerically-stable form
 * (ADR 0005 §2.1.1), as the canonical `expression` for the schema's
 * `activation.name === "softplus"`. Deliberately not the naive
 * `ln(1+exp(x))`, which overflows to `Infinity` for large `x` instead of the
 * correct asymptotic value of `x` itself. Exported so every caller that
 * authors a fresh block (there is no other activation yet) shares one
 * definition rather than re-deriving the tree; `Base` instances carry a
 * process-unique id, so this is a factory, not a shared singleton.
 */
/**
 * The three common `mechanism` presets (ADR 0005 §2.1's grill-me follow-up,
 * generalized to an arbitrary expression in the nn_blocks v2 schema
 * redesign) as ready-made `Base` trees over the `ode`/`nde` placeholders —
 * `additive`: `dx/dt = ode + nde`. `relativeMultiply`: `dx/dt = ode · (1 +
 * nde)` — a near-zero/untrained network leaves `ode` unchanged.
 * `multiply`: `dx/dt = ode · nde` — a bare product with no such safeguard.
 * These are not the only legal `mechanism` values; a caller (e.g. the
 * mxlweb-core UI's mechanism editor) can construct any other expression
 * over the same two placeholders. Factories, not shared instances: `Base`
 * carries a process-unique id, so reusing one instance across blocks would
 * collide.
 */
export function additiveMechanism(): Base {
  return new Add([new Name("ode"), new Name("nde")]);
}
export function relativeMultiplyMechanism(): Base {
  return new Mul([new Name("ode"), new Add([new Num(1), new Name("nde")])]);
}
export function multiplyMechanism(): Base {
  return new Mul([new Name("ode"), new Name("nde")]);
}

export function softplusActivation(): NNBlockActivation {
  return {
    name: "softplus",
    expression: new Add([
      new Max([new Name("x"), new Num(0)]),
      new Ln(
        new Add([new Num(1), new Exp(new Minus([new Abs(new Name("x"))]))]),
      ),
    ]),
  };
}

/** Architecture and identity of one NN block. */
export type NNBlockSpec = {
  /** Unique-within-model name; every generated weight/bias is namespaced under it (`${name}_w{layer}_{i}_{j}`, `${name}_b{layer}_{i}`). */
  name: string;
  /** Names of existing variables/parameters/derived quantities the block reads. */
  inputs: string[];
  /** Layer stack, input-to-output order. The last layer is a plain linear combination (no activation), so outputs can take any real value; its width is the block's output count. */
  layers: NNBlockLayer[];
  /** Seed for reproducible Glorot-uniform weight initialization. */
  seed: number;
  /**
   * Initial value for `${name}_scale` — every output gets multiplied by
   * this single, shared, trainable factor: `dx/dt = f(x,p,t) + scale ·
   * NN(x,θ)`. Needed in practice: a freshly Glorot-initialized network's
   * raw output can be large enough to blow up the very first fit iteration
   * on a bigger block; starting small (mxl-web defaults this to `0.1`) and
   * letting the scale itself train fixes that without capping the
   * network's own expressiveness.
   */
  scale: number;
  /** Elementwise activation applied after every layer except the last. */
  activation: NNBlockActivation;
};

export type NNBlockResult = {
  /** Every generated weight/bias value, keyed by its generated name. Internal-only: `ModelBuilderBase.nnWeights` makes these `Name`-addressable for codegen without ever putting them in `parameters`. */
  weights: Map<string, number>;
  /** The block's single trainable output-scaling factor — unlike weights, an ordinary `Parameter` (meaningful on its own, `addNNBlock` adds it under `${name}_scale`). */
  scale: Parameter;
  /** One expression per output, `layers[layers.length - 1].width` long, in order. */
  outputs: Base[];
};

/**
 * mulberry32 — a small, fast, seedable PRNG. Not cryptographic, not needed
 * to be: this only picks reproducible initial weight values, nothing
 * security-sensitive. Chosen over `Math.random()` specifically because it
 * *is* seedable, which `Math.random()` isn't — reproducible initialization
 * matters here (re-authoring/resizing a block, or comparing training runs,
 * shouldn't silently start from different weights each time).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Glorot/Xavier-uniform sample: uniform on `[-limit, limit]`, `limit = sqrt(6 / (fanIn + fanOut))`. */
function glorotUniform(
  rng: () => number,
  fanIn: number,
  fanOut: number,
): number {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  return (rng() * 2 - 1) * limit;
}

/** One fully-connected layer: `fanOut` units, each reading all of `inputs`, weights Glorot-initialized. Biases start at zero (standard practice — only the weights need the symmetry-breaking Glorot spread). */
function buildLayer(
  blockName: string,
  layerIdx: number,
  inputs: Base[],
  fanOut: number,
  rng: () => number,
  weights: Map<string, number>,
): Base[] {
  const fanIn = inputs.length;
  const outputs: Base[] = [];
  for (let i = 0; i < fanOut; i++) {
    const biasName = `${blockName}_b${layerIdx}_${i}`;
    weights.set(biasName, 0);
    const terms: Base[] = [new Name(biasName)];
    for (let j = 0; j < fanIn; j++) {
      const weightName = `${blockName}_w${layerIdx}_${i}_${j}`;
      weights.set(weightName, glorotUniform(rng, fanIn, fanOut));
      terms.push(new Mul([new Name(weightName), inputs[j]]));
    }
    outputs.push(new Add(terms));
  }
  return outputs;
}

/**
 * Builds a fully-connected network per `spec.layers`: every layer but the
 * last is activated (`spec.activation`), the last is a plain linear
 * combination. Every weight is Glorot-uniform-initialized from `spec.seed`;
 * every bias starts at zero. Throws if `spec.layers` is empty — a block
 * needs at least an output layer.
 */
export function buildNNBlock(spec: NNBlockSpec): NNBlockResult {
  if (spec.layers.length === 0) {
    throw new Error(`buildNNBlock: "${spec.name}" has no layers`);
  }

  const weights = new Map<string, number>();
  const rng = mulberry32(spec.seed);

  let layerInputs: Base[] = spec.inputs.map((name) => new Name(name));

  spec.layers.forEach((layer, layerIdx) => {
    const isOutputLayer = layerIdx === spec.layers.length - 1;
    const preActivations = buildLayer(
      spec.name,
      layerIdx,
      layerInputs,
      layer.width,
      rng,
      weights,
    );
    layerInputs = isOutputLayer
      ? preActivations
      : preActivations.map((pre) =>
          substituteName(spec.activation.expression, "x", pre),
        );
  });

  // Single trainable factor shared across every output (NNBlockSpec.scale's
  // doc comment) — an ordinary Parameter, unlike weights, since it's a
  // meaningful, user-facing knob on its own.
  const scaleName = `${spec.name}_scale`;
  const scaleDisplayName = `${spec.name}: output scale`;
  const scale: Parameter = {
    value: spec.scale,
    displayName: scaleDisplayName,
    texName: defaultTexName(scaleDisplayName),
  };
  const outputs = layerInputs.map(
    (output) => new Mul([new Name(scaleName), output]),
  );

  return { weights, scale, outputs };
}
