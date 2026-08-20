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
            "UDE/NODE correction terms keyed by name (mxlweb ADR 0005). Weights/biases are ordinary parameters, named `<block>_w{layer}_{i}_{j}` / `<block>_b{layer}_{i}`; this section only records the architecture needed to regenerate or re-edit a block, and is optional — a document with no NN blocks simply omits it.",
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
        "A UDE/NODE correction term: a fully-connected softplus network (arbitrary depth, uniform width) with a linear (unactivated) output layer, added onto one or more existing variables' dynamics.",
      required: ["inputs", "depth", "width", "seed", "targets", "trained", "scale", "mechanism"],
      additionalProperties: false,
      properties: {
        inputs: {
          type: "array",
          description:
            "Names of existing variables/parameters/derived quantities the block reads.",
          items: { type: "string" },
        },
        depth: {
          type: "integer",
          description: "Number of hidden layers.",
          minimum: 1,
        },
        width: {
          type: "integer",
          description: "Uniform width of every hidden layer.",
          minimum: 1,
        },
        seed: {
          type: "integer",
          description:
            "Seed for reproducible Glorot-uniform weight initialization, used once when the block is (re-)generated.",
        },
        targets: {
          type: "array",
          description:
            "Which existing variable(s) this block corrects — one entry per output, in order.",
          items: { type: "string" },
        },
        trained: {
          type: "boolean",
          description:
            "Whether this block's weights are included when fitting the model.",
        },
        scale: {
          type: "number",
          description:
            "Initial value for the block's single trainable output-scaling factor: dx/dt = f(x,p,t) + scale * NN(x,\u03b8), shared across all of the block's outputs.",
        },
        mechanism: {
          type: "string",
          enum: ["additive", "multiplicative"],
          description:
            "How this block's output composes onto the mechanistic dynamics of its target(s). additive: dx/dt = f(x,p,t) + scale * NN(x,\u03b8). multiplicative: dx/dt = f(x,p,t) * (1 + scale * NN(x,\u03b8)) -- a near-zero/untrained network leaves f unchanged. When a variable has multiple blocks, all multiplicative ones combine into one factor on f (product), then all additive ones are summed on top.",
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
            "UDE/NODE correction terms keyed by name (mxlweb ADR 0005). Weights/biases are ordinary parameters, named `<block>_w{layer}_{i}_{j}` / `<block>_b{layer}_{i}`; this section only records the architecture needed to regenerate or re-edit a block, and is optional — a document with no NN blocks simply omits it.",
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
        "A UDE/NODE correction term: a fully-connected softplus network (arbitrary depth, uniform width) with a linear (unactivated) output layer, added onto one or more existing variables' dynamics.",
      required: ["inputs", "depth", "width", "seed", "targets", "trained", "scale", "mechanism"],
      additionalProperties: false,
      properties: {
        inputs: {
          type: "array",
          description:
            "Names of existing variables/parameters/derived quantities the block reads.",
          items: { type: "string" },
        },
        depth: {
          type: "integer",
          description: "Number of hidden layers.",
          minimum: 1,
        },
        width: {
          type: "integer",
          description: "Uniform width of every hidden layer.",
          minimum: 1,
        },
        seed: {
          type: "integer",
          description:
            "Seed for reproducible Glorot-uniform weight initialization, used once when the block is (re-)generated.",
        },
        targets: {
          type: "array",
          description:
            "Which existing variable(s) this block corrects — one entry per output, in order.",
          items: { type: "string" },
        },
        trained: {
          type: "boolean",
          description:
            "Whether this block's weights are included when fitting the model.",
        },
        scale: {
          type: "number",
          description:
            "Initial value for the block's single trainable output-scaling factor: dx/dt = f(x,p,t) + scale * NN(x,\u03b8), shared across all of the block's outputs.",
        },
        mechanism: {
          type: "string",
          enum: ["additive", "multiplicative"],
          description:
            "How this block's output composes onto the mechanistic dynamics of its target(s). additive: dx/dt = f(x,p,t) + scale * NN(x,\u03b8). multiplicative: dx/dt = f(x,p,t) * (1 + scale * NN(x,\u03b8)) -- a near-zero/untrained network leaves f unchanged. When a variable has multiple blocks, all multiplicative ones combine into one factor on f (product), then all additive ones are summed on top.",
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
