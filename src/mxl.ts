/**
 * Import side of the shared mxl-schemas `.mxl.json` format: parse a document
 * (the inverse of {@link ModelBuilderBase.buildMxlJson}) into the matching model
 * builder. Dispatch is by the `kind` discriminator. The document is validated
 * against the vendored v1 JSON Schema before any builder is constructed.
 *
 * `model_id` and `description` are not builder state, so they are dropped on
 * import — supply them again at export time.
 *
 * @module
 */

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { type Base, type JsonNode, nodeFromJson, Num } from "./mathml/index.js";
import { KineticModelBuilder, type Reaction } from "./kineticModelBuilder.js";
import {
  type MxlEntity,
  type MxlJsonDocument,
  type MxlNNLayer,
  type ModelBuilderBase,
  type SliderArgs,
} from "./modelBuilderBase.js";
import type { NNBlockLayer } from "./nnBlock.js";
import { OdeModelBuilder } from "./odeModelBuilder.js";
import { SteadyStateModelBuilder } from "./steadyStateModelBuilder.js";
import { kineticSchema, odeSchema, steadyStateSchema } from "./mxl/schemas.js";

const ajv = new Ajv2020({ strict: false });
const validators: Record<string, ValidateFunction> = {
  kinetic: ajv.compile(kineticSchema),
  ode: ajv.compile(odeSchema),
  "steady-state": ajv.compile(steadyStateSchema),
};

/** Revive a slider config (string bounds preserve authored precision). */
function sliderFromEntry(slider: NonNullable<MxlEntity["slider"]>): SliderArgs {
  const out: SliderArgs = {
    min: slider.min,
    max: slider.max,
    step: slider.step,
  };
  if (slider.desc !== undefined) out.desc = slider.desc;
  return out;
}

/** Revive an initial/parameter value node; a bare `Num` collapses to a number. */
function valueFromNode(node: JsonNode): number | Base {
  const revived = nodeFromJson(node);
  return revived instanceof Num ? revived.value : revived;
}

/** Revive a parameter value, which the schema constrains to a numeric literal. */
function numberFromNode(id: string, node: JsonNode): number {
  const revived = nodeFromJson(node);
  if (!(revived instanceof Num)) {
    throw new Error(`parameter "${id}" must have a numeric value`);
  }
  return revived.value;
}

function meta(entry: MxlEntity): { displayName?: string; texName?: string } {
  const out: { displayName?: string; texName?: string } = {};
  if (entry.displayName !== undefined) out.displayName = entry.displayName;
  if (entry.texName !== undefined) out.texName = entry.texName;
  return out;
}

function section(
  doc: MxlJsonDocument,
  name: string,
): Record<string, MxlEntity> {
  return doc.model[name] ?? {};
}

function addVariables(builder: ModelBuilderBase, doc: MxlJsonDocument): void {
  for (const [id, entry] of Object.entries(section(doc, "variables"))) {
    builder.addVariable(id, {
      value: valueFromNode(entry.value!),
      ...meta(entry),
      ...(entry.slider ? { slider: sliderFromEntry(entry.slider) } : {}),
    });
  }
}

function addParameters(builder: ModelBuilderBase, doc: MxlJsonDocument): void {
  for (const [id, entry] of Object.entries(section(doc, "parameters"))) {
    builder.addParameter(id, {
      value: numberFromNode(id, entry.value!),
      ...meta(entry),
      ...(entry.slider ? { slider: sliderFromEntry(entry.slider) } : {}),
    });
  }
}

function addDerived(builder: ModelBuilderBase, doc: MxlJsonDocument): void {
  for (const [id, entry] of Object.entries(section(doc, "derived"))) {
    builder.addAssignment(id, { fn: nodeFromJson(entry.fn!), ...meta(entry) });
  }
}

/**
 * A `weights_ref` sidecar file's already-parsed content (mxl-schemas
 * nn-weights.schema.json): `w{n}`/`b{n}`, 1-indexed by layer, matrix shape
 * `[out_features, in_features]`. `mxlJsonToModel` never reads a file
 * itself — the caller resolves and parses every `weights_ref` path
 * (relative to wherever the main document came from) and supplies the
 * results here, since file access is a browser/fs/network concern this
 * package stays agnostic of.
 */
export type NNWeightsFile = Record<string, number[][] | number[]>;

/**
 * Reshape a `weights_ref` sidecar's nested per-layer matrices back into the
 * flat `Name`-addressable naming `buildNNBlock`/`ModelBuilderBase.nnWeights`
 * use (`${blockKey}_w{layerIdx}_{i}_{j}` / `${blockKey}_b{layerIdx}_{i}`,
 * 0-indexed) — the inverse of `ModelBuilderBase.buildNNWeightsFile`.
 */
function flattenNNWeights(
  blockKey: string,
  sidecar: NNWeightsFile,
): Map<string, number> {
  const flat = new Map<string, number>();
  let layerIdx = 0;
  while (`w${layerIdx + 1}` in sidecar) {
    const w = sidecar[`w${layerIdx + 1}`] as number[][];
    const b = sidecar[`b${layerIdx + 1}`] as number[];
    w.forEach((row, i) => {
      if (b[i] !== undefined) {
        flat.set(`${blockKey}_b${layerIdx}_${i}`, b[i]);
      }
      row.forEach((value, j) => {
        flat.set(`${blockKey}_w${layerIdx}_${i}_${j}`, value);
      });
    });
    layerIdx++;
  }
  return flat;
}

/**
 * Revive `nn_blocks` — deliberately *before* `addParameters` in both
 * `buildKinetic`/`buildOde` below: `addNNBlock` always adds the block's
 * `scale` at `config.scale`'s *initial* value (like `seed`, not necessarily
 * its current, possibly fitting-updated one — `NNBlockConfig.scale`'s doc
 * comment), so importing it after `parameters` would clobber the
 * document's actual scale value with that initial one. Running
 * `addParameters` second lets its `parameters` section — which includes
 * every block's `${id}_scale`, serialised alongside `mxlNNBlocks` by its
 * sibling `mxlParameters` — overwrite it back to the correct value, the
 * same trick `buildMxlweb`'s export uses. Weight/bias values need no such
 * trick: they never touch `parameters` at all (mxl-schemas nn_blocks v2)
 * and are instead passed straight into `addNNBlock`'s `trainedWeights`
 * argument, reshaped from `weightsByRef`.
 */
/** {@link MxlNNLayer} -> {@link NNBlockLayer}: revives each layer's optional `activation.expression` from a `JsonNode` into a live `Base` via `nodeFromJson`. `activation` itself is genuinely optional per the schema (absent means linear), unlike this function's sibling fields. */
function nnBlockLayer(layer: MxlNNLayer): NNBlockLayer {
  if (layer.activation === undefined) {
    return { type: layer.type, width: layer.width };
  }
  return {
    type: layer.type,
    width: layer.width,
    activation: {
      name: layer.activation.name,
      expression: nodeFromJson(layer.activation.expression),
    },
  };
}

function addNNBlocks(
  builder: ModelBuilderBase,
  doc: MxlJsonDocument,
  weightsByRef: Map<string, NNWeightsFile>,
): void {
  for (const [id, entry] of Object.entries(section(doc, "nn_blocks"))) {
    // Every field is required by the schema, already validated by the time
    // this runs (mxlJsonToModel validates before calling buildKinetic/
    // buildOde) — non-null assertions are safe here, same as elsewhere in
    // this file (e.g. entry.fn!). Per-layer `activation` is the one
    // genuinely optional exception, handled by `nnBlockLayer`.
    const config = {
      inputs: entry.inputs!,
      layers: entry.layers!.map((layer) => nnBlockLayer(layer)),
      seed: entry.seed!,
      targets: entry.targets!,
      trained: entry.trained!,
      scale: entry.scale!,
      mechanism: nodeFromJson(entry.mechanism!),
    };
    let trainedWeights: Map<string, number> | undefined;
    if (entry.trained) {
      if (entry.weights_ref === undefined) {
        throw new Error(
          `nn_block "${id}": trained is true but weights_ref is missing`,
        );
      }
      const sidecar = weightsByRef.get(entry.weights_ref);
      if (sidecar === undefined) {
        throw new Error(
          `nn_block "${id}": no weights file supplied for weights_ref "${entry.weights_ref}"`,
        );
      }
      trainedWeights = flattenNNWeights(id, sidecar);
    }
    builder.addNNBlock(id, config, trainedWeights);
  }
}

function buildKinetic(
  doc: MxlJsonDocument,
  weightsByRef: Map<string, NNWeightsFile>,
): KineticModelBuilder {
  const builder = new KineticModelBuilder();
  addVariables(builder, doc);
  addNNBlocks(builder, doc, weightsByRef);
  addParameters(builder, doc);
  for (const [id, entry] of Object.entries(section(doc, "reactions"))) {
    const reaction: Reaction = {
      fn: nodeFromJson(entry.fn!),
      stoichiometry: Object.entries(entry.stoichiometry ?? {}).map(
        ([name, value]) => ({ name, value: nodeFromJson(value) }),
      ),
      ...meta(entry),
    };
    builder.addReaction(id, reaction);
  }
  addDerived(builder, doc);
  return builder;
}

function buildOde(
  doc: MxlJsonDocument,
  weightsByRef: Map<string, NNWeightsFile>,
): OdeModelBuilder {
  const builder = new OdeModelBuilder();
  addVariables(builder, doc);
  addNNBlocks(builder, doc, weightsByRef);
  addParameters(builder, doc);
  for (const [id, entry] of Object.entries(section(doc, "variables"))) {
    if (entry.fn !== undefined) {
      builder.setDifferential(id, nodeFromJson(entry.fn));
    }
  }
  addDerived(builder, doc);
  return builder;
}

function buildSteadyState(doc: MxlJsonDocument): SteadyStateModelBuilder {
  const builder = new SteadyStateModelBuilder();
  addParameters(builder, doc);
  addDerived(builder, doc);
  return builder;
}

/**
 * Parse an mxl-schemas `.mxl.json` document (a JSON string or the already-parsed
 * object) into the model builder selected by its `kind`. Throws on an unknown
 * `kind`, on a document that fails schema validation, or on an unknown math node
 * type within an expression.
 */
export function mxlJsonToModel(
  doc: string | MxlJsonDocument,
  weightsByRef: Map<string, NNWeightsFile> = new Map(),
): ModelBuilderBase {
  const parsed: MxlJsonDocument =
    typeof doc === "string" ? JSON.parse(doc) : doc;

  const kind = parsed.kind;
  const validate = validators[kind];
  if (validate === undefined) {
    throw new Error(`unknown mxl model kind: ${String(kind)}`);
  }
  if (!validate(parsed)) {
    throw new Error(
      `invalid ${kind} .mxl.json: ${ajv.errorsText(validate.errors)}`,
    );
  }

  switch (kind) {
    case "kinetic":
      return buildKinetic(parsed, weightsByRef);
    case "ode":
      return buildOde(parsed, weightsByRef);
    case "steady-state":
      return buildSteadyState(parsed);
  }
}
