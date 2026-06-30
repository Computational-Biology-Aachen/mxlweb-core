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
  type ModelBuilderBase,
  type SliderArgs,
} from "./modelBuilderBase.js";
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

function buildKinetic(doc: MxlJsonDocument): KineticModelBuilder {
  const builder = new KineticModelBuilder();
  addVariables(builder, doc);
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

function buildOde(doc: MxlJsonDocument): OdeModelBuilder {
  const builder = new OdeModelBuilder();
  addVariables(builder, doc);
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
      return buildKinetic(parsed);
    case "ode":
      return buildOde(parsed);
    case "steady-state":
      return buildSteadyState(parsed);
  }
}
