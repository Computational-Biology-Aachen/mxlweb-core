import {
  Abs,
  Add,
  Base,
  Exp,
  Ln,
  Max,
  Minus,
  Mul,
  Name,
  Num,
} from "./mathml/index.js";
import { defaultTexName, type Parameter } from "./modelBuilderBase.js";

/**
 * Generates a UDE/NODE correction term as an ordinary expression tree built
 * from existing `mathml` node types — no new AST surface, per ADR 0005 §2.1.
 * `KineticModelBuilder` already establishes this precedent for `Reaction`
 * (`kineticModelBuilder.ts`'s `reactionTerm()`); this module is the same
 * trick for a fully-connected softplus network.
 *
 * Builder-agnostic by design (ADR 0005 §2.1): this module only produces
 * `Parameter` entries plus one `Base` expression per output. Wiring the
 * result into a model is the caller's job and differs per builder —
 * `KineticModelBuilder` as an ordinary `Reaction` with stoichiometry
 * `{ variable: 1 }`, `OdeModelBuilder` as `setDifferential(key, new
 * Add([existingExpr, output]))` — neither of which this module needs to
 * know about.
 */

/** Architecture and identity of one NN block. */
export type NNBlockSpec = {
  /** Unique-within-model name; every generated weight/bias is namespaced under it (`${name}_w{layer}_{i}_{j}`, `${name}_b{layer}_{i}`). */
  name: string;
  /** Names of existing variables/parameters/derived quantities the block reads. */
  inputs: string[];
  /** Number of hidden layers — arbitrary/configurable, no cap (ADR 0005 §2.1: real prior work needed up to 6). */
  depth: number;
  /** Uniform width for every hidden layer (matches the cited precedent's uniform `flux_width`-style sizing; per-layer widths aren't supported). */
  width: number;
  /** Number of outputs. The final layer is a plain linear combination — no activation — so outputs can take any real value, not just softplus's range. */
  outputs: number;
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
};

export type NNBlockResult = {
  /** New `Parameter` entries for every weight and bias, keyed by generated name — `addParameter` each into the target builder. */
  parameters: Map<string, Parameter>;
  /** One expression per output, `spec.outputs` long, in order. */
  outputs: Base[];
};

/**
 * `max(x, 0) + ln(1 + exp(-|x|))` — softplus in its numerically-stable form
 * (ADR 0005 §2.1.1). Deliberately not the naive `ln(1+exp(x))`, which
 * overflows to `Infinity` for large `x` instead of the correct asymptotic
 * value of `x` itself.
 */
function stableSoftplus(x: Base): Base {
  const positivePart = new Max([x, new Num(0)]);
  const stableTail = new Ln(
    new Add([new Num(1), new Exp(new Minus([new Abs(x)]))]),
  );
  return new Add([positivePart, stableTail]);
}

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
function glorotUniform(rng: () => number, fanIn: number, fanOut: number): number {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  return (rng() * 2 - 1) * limit;
}

/** One fully-connected layer: `fanOut` units, each reading all of `inputs`, weights Glorot-initialized. Biases start at zero (standard practice — only the weights need the symmetry-breaking Glorot spread). */
function buildLayer(
  blockName: string,
  layerIdx: number,
  inputs: Base[],
  inputNames: string[],
  fanOut: number,
  rng: () => number,
  parameters: Map<string, Parameter>,
): Base[] {
  const fanIn = inputs.length;
  const outputs: Base[] = [];
  for (let i = 0; i < fanOut; i++) {
    const biasName = `${blockName}_b${layerIdx}_${i}`;
    const biasDisplayName = `${blockName} layer ${layerIdx}: bias -> unit ${i}`;
    // texName, not just displayName: this generated name has multiple
    // underscores (`${key}_b${layer}_${i}`), and Name.toTex falls back to
    // the raw identifier whenever no texName is registered — fed straight
    // into KaTeX outside \text{}, multiple bare underscores parse as a
    // "Double subscript" error. Every generated weight/bias needs its own
    // safe texName from the moment it's created, not only once some UI
    // layer gets around to synthesizing one (the live "Generated LaTeX"
    // preview renders straight from this generator, before any such UI
    // pass ever runs).
    parameters.set(biasName, {
      value: 0,
      displayName: biasDisplayName,
      texName: defaultTexName(biasDisplayName),
    });
    const terms: Base[] = [new Name(biasName)];
    for (let j = 0; j < fanIn; j++) {
      const weightName = `${blockName}_w${layerIdx}_${i}_${j}`;
      const weightDisplayName = `${blockName} layer ${layerIdx}: ${inputNames[j]} -> unit ${i}`;
      parameters.set(weightName, {
        value: glorotUniform(rng, fanIn, fanOut),
        displayName: weightDisplayName,
        texName: defaultTexName(weightDisplayName),
      });
      terms.push(new Mul([new Name(weightName), inputs[j]]));
    }
    outputs.push(new Add(terms));
  }
  return outputs;
}

/**
 * Builds a fully-connected softplus network per `spec`: `spec.depth` hidden
 * layers of `spec.width` units each (softplus-activated), then one plain
 * linear output layer (no activation — see {@link NNBlockSpec.outputs}).
 * Every weight is Glorot-uniform-initialized from `spec.seed`; every bias
 * starts at zero.
 */
export function buildNNBlock(spec: NNBlockSpec): NNBlockResult {
  const parameters = new Map<string, Parameter>();
  const rng = mulberry32(spec.seed);

  let layerInputs: Base[] = spec.inputs.map((name) => new Name(name));
  let layerInputNames = spec.inputs;

  for (let layer = 0; layer < spec.depth; layer++) {
    const preActivations = buildLayer(
      spec.name,
      layer,
      layerInputs,
      layerInputNames,
      spec.width,
      rng,
      parameters,
    );
    layerInputs = preActivations.map(stableSoftplus);
    layerInputNames = layerInputs.map((_, i) => `${spec.name}_h${layer}_${i}`);
  }

  const rawOutputs = buildLayer(
    spec.name,
    spec.depth,
    layerInputs,
    layerInputNames,
    spec.outputs,
    rng,
    parameters,
  );

  // Single trainable factor shared across every output (NNBlockSpec.scale's
  // doc comment). Named/tex'd like a weight/bias, not just given a bare
  // value, for the same reason those need it: it's an ordinary Parameter
  // like any other, and the live "Generated LaTeX" preview renders straight
  // from this generator before any UI-side texName-defaulting ever runs.
  const scaleName = `${spec.name}_scale`;
  const scaleDisplayName = `${spec.name}: output scale`;
  parameters.set(scaleName, {
    value: spec.scale,
    displayName: scaleDisplayName,
    texName: defaultTexName(scaleDisplayName),
  });
  const outputs = rawOutputs.map(
    (output) => new Mul([new Name(scaleName), output]),
  );

  return { parameters, outputs };
}
