/**
 * Vendored copy of the canonical mxl-schemas `v1` JSON Schemas
 * (https://github.com/Computational-Biology-Aachen/mxl-schemas). Used by
 * {@link mxlJsonToModel} to validate an `.mxl.json` document before building.
 *
 * These are a copy and can drift from upstream; `schemas.drift.test.ts` fetches
 * the canonical files and fails if this copy diverges. Regenerate rather than
 * hand-edit.
 *
 * @module
 */

/** A JSON Schema document (kept loosely typed; consumed only by Ajv). */
export type JsonSchema = Record<string, unknown>;

export const kineticSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://raw.githubusercontent.com/Computational-Biology-Aachen/mxl-schemas/main/v1/kinetic-model.schema.json",
  title: "Mxl kinetic model format",
  description:
    "Version-controllable JSON representation of a kinetic mechanistic model, shared between mxlpy and mxlweb. The time derivative of each variable is computed from the reaction rates and stoichiometry (dx/dt = N*v). Rate expressions are stored as trees of math nodes from the shared MathML node set.",
  type: "object",
  required: ["spec_version", "kind", "model_id", "model"],
  properties: {
    $schema: {
      type: "string",
      description: "URI of this schema, for editor tooling.",
    },
    spec_version: {
      type: "string",
      description: "Version of the .mxl.json format.",
      const: "1.0",
    },
    kind: {
      type: "string",
      description:
        "Discriminator identifying the model formulation; selects which schema applies.",
      const: "kinetic",
    },
    model_id: {
      type: "string",
      description: "Identifier of the model.",
    },
    description: {
      type: "string",
      description: "Human-readable description of the model.",
    },
    model: {
      type: "object",
      required: ["variables", "parameters", "reactions", "derived", "readouts"],
      additionalProperties: false,
      properties: {
        variables: {
          type: "object",
          description: "State variables keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/variable",
          },
        },
        parameters: {
          type: "object",
          description: "Constant parameters keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/parameter",
          },
        },
        reactions: {
          type: "object",
          description: "Reactions keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/reaction",
          },
        },
        derived: {
          type: "object",
          description: "Derived quantities keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/derived",
          },
        },
        readouts: {
          type: "object",
          description: "Readouts keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/readout",
          },
        },
        nn_blocks: {
          type: "object",
          description:
            "UDE/NODE correction terms keyed by name (mxlweb ADR 0005, v2 layout). Trained weight/bias values are never stored as ordinary parameters or inline here — they live in an external per-block JSON sidecar file (see nn-weights.schema.json) referenced by each block's weights_ref, keeping numeric weights structurally separate from parameters that carry kinetic/biological meaning. This section records the architecture and composition needed to regenerate, re-edit, or evaluate a block, and is optional — a document with no NN blocks simply omits it.",
          additionalProperties: {
            $ref: "#/$defs/nnBlock",
          },
        },
      },
    },
  },
  $defs: {
    nnBlock: {
      type: "object",
      description:
        "A UDE/NODE correction term: a stack of layers (only `dense` exists today) added onto one or more existing variables' dynamics via `mechanism`. Each layer carries its own optional activation (see `nnLayer`) — there is no separate block-level activation field.",
      required: [
        "inputs",
        "layers",
        "seed",
        "targets",
        "trained",
        "scale",
        "mechanism",
      ],
      additionalProperties: false,
      properties: {
        inputs: {
          type: "array",
          description:
            "Names of existing variables/parameters/derived quantities the block reads.",
          items: {
            type: "string",
          },
        },
        layers: {
          type: "array",
          description:
            "The network's layer stack, input-to-output order. The final layer's width is the number of outputs (must match the length of targets).",
          minItems: 1,
          items: {
            $ref: "#/$defs/nnLayer",
          },
        },
        seed: {
          type: "integer",
          description:
            "Seed for reproducible Glorot-uniform weight initialization, used once when the block is (re-)generated and whenever trained is false (no weights_ref to load instead).",
        },
        targets: {
          type: "array",
          description:
            "Which existing variable(s) this block corrects — one entry per output, in order.",
          items: {
            type: "string",
          },
        },
        trained: {
          type: "boolean",
          description:
            "Whether this block has been fit. true requires weights_ref (load trained values); false forbids it (initialize from seed instead).",
        },
        weights_ref: {
          type: "string",
          description:
            "Relative path, resolved against this .mxl.json file's own location, to a JSON sidecar file (nn-weights.schema.json) holding this block's trained weight/bias values. Required when trained is true; must be absent when trained is false.",
        },
        scale: {
          type: "number",
          description:
            "Initial value for the block's single trainable output-scaling factor, referenced as `nde` inside mechanism after being applied: NN(x,θ) is scaled by this factor before mechanism composes it onto the mechanistic term, shared across all of the block's outputs.",
        },
        mechanism: {
          $ref: "#/$defs/mechanismNode",
          description:
            "How this block's (scaled) output composes onto the mechanistic dynamics of its target(s), as a math expression over exactly two named placeholders: `ode` (the pre-existing dx/dt term for this target) and `nde` (this block's scaled network output). E.g. additive: Add(ode, nde) -- dx/dt = f(x,p,t) + scale*NN(x,θ). relative_multiply: Mul(ode, Add(1, nde)) -- dx/dt = f(x,p,t) * (1 + scale*NN(x,θ)); a near-zero/untrained network leaves f unchanged. multiply: Mul(ode, nde) -- dx/dt = f(x,p,t) * scale*NN(x,θ); a bare product with no such safeguard, a near-zero/untrained network zeroes out both f and the gradient w.r.t. every mechanistic parameter. When a variable has multiple blocks, they compose sequentially in insertion order: the first block's mechanism takes the purely mechanistic dx/dt as ode; each subsequent block's mechanism takes the previous block's already-composed result as its ode. This is the only well-defined generalization once mechanism is an arbitrary expression rather than a fixed set of categories -- unlike the old closed enum, block order is now numerically significant whenever more than one block targets the same variable.",
        },
      },
      allOf: [
        {
          if: {
            properties: {
              trained: {
                const: true,
              },
            },
          },
          then: {
            required: ["weights_ref"],
          },
        },
        {
          if: {
            properties: {
              trained: {
                const: false,
              },
            },
          },
          then: {
            not: {
              required: ["weights_ref"],
            },
          },
        },
      ],
    },
    nnLayer: {
      type: "object",
      description:
        "One layer of an nn_block's stack. type selects the layer kind; only dense exists today, but every layer is tagged so a downstream library can map future kinds to the right constructor without guessing from shape alone.",
      required: ["type", "width"],
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["dense"],
          description: "Layer kind discriminator.",
        },
        width: {
          type: "integer",
          description:
            "Number of output units of this layer (a dense layer's fan-out).",
          minimum: 1,
        },
        activation: {
          $ref: "#/$defs/nnActivation",
          description:
            "Activation applied elementwise to this layer's output. Absent means identity/linear (so this layer's output can take any real value) — the common case for the final layer, but any layer, including the final one, may carry a non-identity activation.",
        },
      },
    },
    nnActivation: {
      type: "object",
      description:
        "A named activation function with a portable math definition, applied elementwise.",
      required: ["name", "expression"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description:
            'Recognized name (e.g. "softplus") so a backend with its own native, optimized implementation can use it directly instead of evaluating expression node-by-node.',
        },
        expression: {
          $ref: "#/$defs/activationNode",
          description:
            "Portable definition over the single placeholder `x` (the pre-activation value), usable by any consumer regardless of whether it recognizes name.",
        },
      },
    },
    variable: {
      type: "object",
      description:
        "A state variable. Its time derivative is determined by the reactions; only the initial value is stored here.",
      required: ["value"],
      additionalProperties: false,
      properties: {
        value: {
          $ref: "#/$defs/node",
          description:
            "Initial value: a constant (Num node) or an initial-assignment expression.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
        slider: {
          $ref: "#/$defs/slider",
        },
      },
    },
    parameter: {
      type: "object",
      description: "A constant parameter.",
      required: ["value"],
      additionalProperties: false,
      properties: {
        value: {
          $ref: "#/$defs/node",
          description:
            "Value: a constant (Num node) or an initial-assignment expression.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
        slider: {
          $ref: "#/$defs/slider",
        },
      },
    },
    derived: {
      type: "object",
      description:
        "A quantity computed from other model entities at each time point.",
      required: ["fn"],
      additionalProperties: false,
      properties: {
        fn: {
          $ref: "#/$defs/node",
          description: "Expression computing the derived value.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
      },
    },
    readout: {
      type: "object",
      description:
        "A quantity computed for reporting only; it does not feed back into the dynamics.",
      required: ["fn"],
      additionalProperties: false,
      properties: {
        fn: {
          $ref: "#/$defs/node",
          description: "Expression computing the readout value.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
      },
    },
    reaction: {
      type: "object",
      description:
        "A reaction with a rate function and the stoichiometry it acts on.",
      required: ["fn", "stoichiometry"],
      additionalProperties: false,
      properties: {
        fn: {
          $ref: "#/$defs/node",
          description: "Rate expression of the reaction.",
        },
        stoichiometry: {
          type: "object",
          description:
            "Per-variable stoichiometric coefficient as a node tree (constant or dynamic).",
          additionalProperties: {
            $ref: "#/$defs/node",
          },
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
      },
    },
    slider: {
      type: "object",
      description:
        "Interactive-slider configuration (mxlweb UI). Bounds are strings so the authored precision is preserved verbatim.",
      required: ["min", "max", "step"],
      additionalProperties: false,
      properties: {
        min: {
          type: "string",
          description: "Lower bound of the slider.",
        },
        max: {
          type: "string",
          description: "Upper bound of the slider.",
        },
        step: {
          type: "string",
          description: "Increment between slider positions.",
        },
        desc: {
          type: "string",
          description: "Optional tooltip / description for the slider.",
        },
      },
    },
    node: {
      type: "object",
      description:
        "A math expression node. The 'type' discriminator selects the operand fields.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/node",
        },
        base: {
          $ref: "#/$defs/node",
        },
        left: {
          $ref: "#/$defs/node",
        },
        right: {
          $ref: "#/$defs/node",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/node",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
    mechanismNode: {
      type: "object",
      description:
        "A node in a `mechanism` expression tree. Identical to `node`, except a Name leaf's value is restricted to the two mechanism placeholders (`ode`, `nde`) and every operand recurses into mechanismNode rather than the unrestricted node, so the restriction holds at every depth.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/mechanismNode",
        },
        base: {
          $ref: "#/$defs/mechanismNode",
        },
        left: {
          $ref: "#/$defs/mechanismNode",
        },
        right: {
          $ref: "#/$defs/mechanismNode",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/mechanismNode",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
                enum: ["ode", "nde"],
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
    activationNode: {
      type: "object",
      description:
        "A node in an `activation.expression` tree. Identical to `node`, except a Name leaf's value is restricted to the single activation placeholder (`x`) and every operand recurses into activationNode rather than the unrestricted node, so the restriction holds at every depth.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/activationNode",
        },
        base: {
          $ref: "#/$defs/activationNode",
        },
        left: {
          $ref: "#/$defs/activationNode",
        },
        right: {
          $ref: "#/$defs/activationNode",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/activationNode",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
                enum: ["x"],
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
  },
};

export const odeSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://raw.githubusercontent.com/Computational-Biology-Aachen/mxl-schemas/main/v1/ode-model.schema.json",
  title: "Mxl ode model format",
  description:
    "Version-controllable JSON representation of an ODE mechanistic model, shared between mxlpy and mxlweb. The time derivative of each variable is encoded directly on the variable (dx/dt) rather than derived from reactions. Rate expressions are stored as trees of math nodes from the shared MathML node set.",
  type: "object",
  required: ["spec_version", "kind", "model_id", "model"],
  properties: {
    $schema: {
      type: "string",
      description: "URI of this schema, for editor tooling.",
    },
    spec_version: {
      type: "string",
      description: "Version of the .mxl.json format.",
      const: "1.0",
    },
    kind: {
      type: "string",
      description:
        "Discriminator identifying the model formulation; selects which schema applies.",
      const: "ode",
    },
    model_id: {
      type: "string",
      description: "Identifier of the model.",
    },
    description: {
      type: "string",
      description: "Human-readable description of the model.",
    },
    model: {
      type: "object",
      required: ["variables", "parameters", "derived", "readouts"],
      additionalProperties: false,
      properties: {
        variables: {
          type: "object",
          description: "State variables keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/variable",
          },
        },
        parameters: {
          type: "object",
          description: "Constant parameters keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/parameter",
          },
        },
        derived: {
          type: "object",
          description: "Derived quantities keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/derived",
          },
        },
        readouts: {
          type: "object",
          description: "Readouts keyed by name.",
          additionalProperties: {
            $ref: "#/$defs/readout",
          },
        },
        nn_blocks: {
          type: "object",
          description:
            "UDE/NODE correction terms keyed by name (mxlweb ADR 0005, v2 layout). Trained weight/bias values are never stored as ordinary parameters or inline here — they live in an external per-block JSON sidecar file (see nn-weights.schema.json) referenced by each block's weights_ref, keeping numeric weights structurally separate from parameters that carry kinetic/biological meaning. This section records the architecture and composition needed to regenerate, re-edit, or evaluate a block, and is optional — a document with no NN blocks simply omits it.",
          additionalProperties: {
            $ref: "#/$defs/nnBlock",
          },
        },
      },
    },
  },
  $defs: {
    nnBlock: {
      type: "object",
      description:
        "A UDE/NODE correction term: a stack of layers (only `dense` exists today) added onto one or more existing variables' dynamics via `mechanism`. Each layer carries its own optional activation (see `nnLayer`) — there is no separate block-level activation field.",
      required: [
        "inputs",
        "layers",
        "seed",
        "targets",
        "trained",
        "scale",
        "mechanism",
      ],
      additionalProperties: false,
      properties: {
        inputs: {
          type: "array",
          description:
            "Names of existing variables/parameters/derived quantities the block reads.",
          items: {
            type: "string",
          },
        },
        layers: {
          type: "array",
          description:
            "The network's layer stack, input-to-output order. The final layer's width is the number of outputs (must match the length of targets).",
          minItems: 1,
          items: {
            $ref: "#/$defs/nnLayer",
          },
        },
        seed: {
          type: "integer",
          description:
            "Seed for reproducible Glorot-uniform weight initialization, used once when the block is (re-)generated and whenever trained is false (no weights_ref to load instead).",
        },
        targets: {
          type: "array",
          description:
            "Which existing variable(s) this block corrects — one entry per output, in order.",
          items: {
            type: "string",
          },
        },
        trained: {
          type: "boolean",
          description:
            "Whether this block has been fit. true requires weights_ref (load trained values); false forbids it (initialize from seed instead).",
        },
        weights_ref: {
          type: "string",
          description:
            "Relative path, resolved against this .mxl.json file's own location, to a JSON sidecar file (nn-weights.schema.json) holding this block's trained weight/bias values. Required when trained is true; must be absent when trained is false.",
        },
        scale: {
          type: "number",
          description:
            "Initial value for the block's single trainable output-scaling factor, referenced as `nde` inside mechanism after being applied: NN(x,θ) is scaled by this factor before mechanism composes it onto the mechanistic term, shared across all of the block's outputs.",
        },
        mechanism: {
          $ref: "#/$defs/mechanismNode",
          description:
            "How this block's (scaled) output composes onto the mechanistic dynamics of its target(s), as a math expression over exactly two named placeholders: `ode` (the pre-existing dx/dt term for this target) and `nde` (this block's scaled network output). E.g. additive: Add(ode, nde) -- dx/dt = f(x,p,t) + scale*NN(x,θ). relative_multiply: Mul(ode, Add(1, nde)) -- dx/dt = f(x,p,t) * (1 + scale*NN(x,θ)); a near-zero/untrained network leaves f unchanged. multiply: Mul(ode, nde) -- dx/dt = f(x,p,t) * scale*NN(x,θ); a bare product with no such safeguard, a near-zero/untrained network zeroes out both f and the gradient w.r.t. every mechanistic parameter. When a variable has multiple blocks, they compose sequentially in insertion order: the first block's mechanism takes the purely mechanistic dx/dt as ode; each subsequent block's mechanism takes the previous block's already-composed result as its ode. This is the only well-defined generalization once mechanism is an arbitrary expression rather than a fixed set of categories -- unlike the old closed enum, block order is now numerically significant whenever more than one block targets the same variable.",
        },
      },
      allOf: [
        {
          if: {
            properties: {
              trained: {
                const: true,
              },
            },
          },
          then: {
            required: ["weights_ref"],
          },
        },
        {
          if: {
            properties: {
              trained: {
                const: false,
              },
            },
          },
          then: {
            not: {
              required: ["weights_ref"],
            },
          },
        },
      ],
    },
    nnLayer: {
      type: "object",
      description:
        "One layer of an nn_block's stack. type selects the layer kind; only dense exists today, but every layer is tagged so a downstream library can map future kinds to the right constructor without guessing from shape alone.",
      required: ["type", "width"],
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["dense"],
          description: "Layer kind discriminator.",
        },
        width: {
          type: "integer",
          description:
            "Number of output units of this layer (a dense layer's fan-out).",
          minimum: 1,
        },
        activation: {
          $ref: "#/$defs/nnActivation",
          description:
            "Activation applied elementwise to this layer's output. Absent means identity/linear (so this layer's output can take any real value) — the common case for the final layer, but any layer, including the final one, may carry a non-identity activation.",
        },
      },
    },
    nnActivation: {
      type: "object",
      description:
        "A named activation function with a portable math definition, applied elementwise.",
      required: ["name", "expression"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description:
            'Recognized name (e.g. "softplus") so a backend with its own native, optimized implementation can use it directly instead of evaluating expression node-by-node.',
        },
        expression: {
          $ref: "#/$defs/activationNode",
          description:
            "Portable definition over the single placeholder `x` (the pre-activation value), usable by any consumer regardless of whether it recognizes name.",
        },
      },
    },
    variable: {
      type: "object",
      description:
        "A state variable with an initial value and its time derivative (dx/dt) encoded directly.",
      required: ["value", "fn"],
      additionalProperties: false,
      properties: {
        value: {
          $ref: "#/$defs/node",
          description:
            "Initial value: a constant (Num node) or an initial-assignment expression.",
        },
        fn: {
          $ref: "#/$defs/node",
          description: "Time derivative dx/dt of the variable.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
        slider: {
          $ref: "#/$defs/slider",
        },
      },
    },
    parameter: {
      type: "object",
      description: "A constant parameter.",
      required: ["value"],
      additionalProperties: false,
      properties: {
        value: {
          $ref: "#/$defs/node",
          description:
            "Value: a constant (Num node) or an initial-assignment expression.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
        slider: {
          $ref: "#/$defs/slider",
        },
      },
    },
    derived: {
      type: "object",
      description:
        "A quantity computed from other model entities at each time point.",
      required: ["fn"],
      additionalProperties: false,
      properties: {
        fn: {
          $ref: "#/$defs/node",
          description: "Expression computing the derived value.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
      },
    },
    readout: {
      type: "object",
      description:
        "A quantity computed for reporting only; it does not feed back into the dynamics.",
      required: ["fn"],
      additionalProperties: false,
      properties: {
        fn: {
          $ref: "#/$defs/node",
          description: "Expression computing the readout value.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
      },
    },
    slider: {
      type: "object",
      description:
        "Interactive-slider configuration (mxlweb UI). Bounds are strings so the authored precision is preserved verbatim.",
      required: ["min", "max", "step"],
      additionalProperties: false,
      properties: {
        min: {
          type: "string",
          description: "Lower bound of the slider.",
        },
        max: {
          type: "string",
          description: "Upper bound of the slider.",
        },
        step: {
          type: "string",
          description: "Increment between slider positions.",
        },
        desc: {
          type: "string",
          description: "Optional tooltip / description for the slider.",
        },
      },
    },
    node: {
      type: "object",
      description:
        "A math expression node. The 'type' discriminator selects the operand fields.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/node",
        },
        base: {
          $ref: "#/$defs/node",
        },
        left: {
          $ref: "#/$defs/node",
        },
        right: {
          $ref: "#/$defs/node",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/node",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
    mechanismNode: {
      type: "object",
      description:
        "A node in a `mechanism` expression tree. Identical to `node`, except a Name leaf's value is restricted to the two mechanism placeholders (`ode`, `nde`) and every operand recurses into mechanismNode rather than the unrestricted node, so the restriction holds at every depth.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/mechanismNode",
        },
        base: {
          $ref: "#/$defs/mechanismNode",
        },
        left: {
          $ref: "#/$defs/mechanismNode",
        },
        right: {
          $ref: "#/$defs/mechanismNode",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/mechanismNode",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
                enum: ["ode", "nde"],
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
    activationNode: {
      type: "object",
      description:
        "A node in an `activation.expression` tree. Identical to `node`, except a Name leaf's value is restricted to the single activation placeholder (`x`) and every operand recurses into activationNode rather than the unrestricted node, so the restriction holds at every depth.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/activationNode",
        },
        base: {
          $ref: "#/$defs/activationNode",
        },
        left: {
          $ref: "#/$defs/activationNode",
        },
        right: {
          $ref: "#/$defs/activationNode",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/activationNode",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
                enum: ["x"],
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
  },
};

export const steadyStateSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://raw.githubusercontent.com/Computational-Biology-Aachen/mxl-schemas/main/v1/steady-state-model.schema.json",
  title: "Mxl steady-state model format",
  description:
    "Version-controllable JSON representation of an algebraic (steady-state) model, shared between mxlpy and mxlweb. There are no state variables and no time integration: the outputs are closed-form derived quantities of the parameters. Expressions are stored as trees of math nodes from the shared MathML node set.",
  type: "object",
  required: ["spec_version", "kind", "model_id", "model"],
  properties: {
    $schema: {
      type: "string",
      description: "URI of this schema, for editor tooling.",
    },
    spec_version: {
      type: "string",
      description: "Version of the .mxl.json format.",
      const: "1.0",
    },
    kind: {
      type: "string",
      description:
        "Discriminator identifying the model formulation; selects which schema applies.",
      const: "steady-state",
    },
    model_id: {
      type: "string",
      description: "Identifier of the model.",
    },
    description: {
      type: "string",
      description: "Human-readable description of the model.",
    },
    model: {
      type: "object",
      required: ["parameters", "derived"],
      additionalProperties: false,
      properties: {
        parameters: {
          type: "object",
          description:
            "Constant parameters keyed by name. Any parameter can be swept as the independent axis.",
          additionalProperties: {
            $ref: "#/$defs/parameter",
          },
        },
        derived: {
          type: "object",
          description:
            "Derived quantities keyed by name — the algebraic outputs of the model.",
          additionalProperties: {
            $ref: "#/$defs/derived",
          },
        },
      },
    },
  },
  $defs: {
    parameter: {
      type: "object",
      description: "A constant parameter.",
      required: ["value"],
      additionalProperties: false,
      properties: {
        value: {
          $ref: "#/$defs/node",
          description:
            "Value: a constant (Num node) or an initial-assignment expression.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
        slider: {
          $ref: "#/$defs/slider",
        },
      },
    },
    derived: {
      type: "object",
      description:
        "A quantity computed from the parameters — an output of the model.",
      required: ["fn"],
      additionalProperties: false,
      properties: {
        fn: {
          $ref: "#/$defs/node",
          description: "Expression computing the derived value.",
        },
        displayName: {
          type: "string",
          description: "Human-readable label for UI and code generation.",
        },
        texName: {
          type: "string",
          description: "LaTeX rendering of the symbol.",
        },
      },
    },
    slider: {
      type: "object",
      description:
        "Interactive-slider configuration (mxlweb UI). Bounds are strings so the authored precision is preserved verbatim.",
      required: ["min", "max", "step"],
      additionalProperties: false,
      properties: {
        min: {
          type: "string",
          description: "Lower bound of the slider.",
        },
        max: {
          type: "string",
          description: "Upper bound of the slider.",
        },
        step: {
          type: "string",
          description: "Increment between slider positions.",
        },
        desc: {
          type: "string",
          description: "Optional tooltip / description for the slider.",
        },
      },
    },
    node: {
      type: "object",
      description:
        "A math expression node. The 'type' discriminator selects the operand fields.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
        },
        value: {
          type: ["number", "string", "boolean"],
          description: "Payload of a leaf node (Num/Name/Bool).",
        },
        child: {
          $ref: "#/$defs/node",
        },
        base: {
          $ref: "#/$defs/node",
        },
        left: {
          $ref: "#/$defs/node",
        },
        right: {
          $ref: "#/$defs/node",
        },
        children: {
          type: "array",
          items: {
            $ref: "#/$defs/node",
          },
        },
      },
      allOf: [
        {
          if: {
            properties: {
              type: {
                const: "Num",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "number",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Name",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "string",
              },
            },
          },
        },
        {
          if: {
            properties: {
              type: {
                const: "Bool",
              },
            },
          },
          then: {
            required: ["value"],
            properties: {
              value: {
                type: "boolean",
              },
            },
          },
        },
      ],
    },
  },
};
