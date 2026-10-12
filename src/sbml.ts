import {
  type Base,
  Abs,
  Acos,
  Acot,
  Add,
  And,
  ArcCosh,
  ArcCoth,
  ArcCsc,
  ArcCsch,
  ArcSec,
  ArcSech,
  ArcSinh,
  ArcTanh,
  Asin,
  Atan,
  Bool,
  Ceiling,
  Cos,
  Cosh,
  Cot,
  Coth,
  Csc,
  Csch,
  Divide,
  E,
  Eq,
  Exp,
  Factorial,
  Floor,
  GreaterEqual,
  GreaterThan,
  Implies,
  IntDivide,
  LessEqual,
  LessThan,
  Ln,
  Log,
  Max,
  Min,
  Minus,
  Mul,
  Name,
  Not,
  NotEqual,
  Num,
  Or,
  Pi,
  Piecewise,
  Pow,
  RateOf,
  Rem,
  Sec,
  Sech,
  Sin,
  Sinh,
  Sqrt,
  Tan,
  Tanh,
  Xor,
} from "./mathml/index.js";
import type { Stoichiometry } from "./kineticModelBuilder.js";
import { KineticModelBuilder } from "./kineticModelBuilder.js";
import {
  Unit,
  type UnitFactor,
  unitKind,
  unitKindIds,
  unitPrefixByScale,
} from "./units/index.js";

/**
 * SBML (Systems Biology Markup Language) interop for the kinetic model builder.
 *
 * Bridges in both directions:
 * - {@link mathMLToAst} parses a MathML `<apply>`/leaf element into the
 *   {@link Base} expression AST.
 * - {@link modelToSbml} serialises a {@link KineticModelBuilder} to an SBML L3v2
 *   document (species, parameters, assignment rules, reactions).
 * - {@link sbmlToModel} parses an SBML document back into a builder, handling
 *   compartments, boundary species, initial/assignment/rate rules and reaction
 *   stoichiometry.
 *
 * Parameter units travel as `<unitDefinition>`s (see {@link Unit.toSBML} and
 * {@link sbmlUnitDefinitionToUnit}). Species units are neither exported nor
 * imported: SBML derives them from substance units and compartment size,
 * which this flat single-compartment mapping doesn't model.
 *
 * @module
 */

const SBML_NS = "http://www.sbml.org/sbml/level3/version2/core";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mathBlock(inner: string): string {
  return `<math xmlns="${MATHML_NS}">${inner}</math>`;
}

function parseFloatAttr(el: Element, attr: string): number {
  const val = el.getAttribute(attr);
  if (val === null) return NaN;
  const n = parseFloat(val);
  return isNaN(n) ? NaN : n;
}

// ─── Units ──────────────────────────────────────────────────────────────────

/** Registry kind for an SBML UnitKind with the given per-unit multiplier (`second`×60 → `minute`). */
function registryKindForSbml(
  kind: string,
  multiplier: number,
): string | undefined {
  return unitKindIds().find((id) => {
    const sbml = unitKind(id)?.sbml;
    return sbml?.kind === kind && sbml.multiplier === multiplier;
  });
}

/** Level 1/2 spellings and kinds outside the registry's SBML mapping. */
const SBML_KIND_ALIASES: Record<string, { kind: string; scale: number }> = {
  kilogram: { kind: "gram", scale: 3 },
  meter: { kind: "metre", scale: 0 },
  liter: { kind: "litre", scale: 0 },
  celsius: { kind: "celsius", scale: 0 },
};

type SbmlUnit = {
  kind: string;
  exponent: number;
  scale: number;
  multiplier: number;
};

/**
 * Convert SBML units (`∏ (multiplier · 10^scale · kind)^exponent`) into a
 * {@link Unit}. Returns `undefined`, with a warning, for anything the shared
 * registry can't represent (`avogadro`, non-integer exponents, unknown kinds)
 * — the unit is dropped rather than guessed.
 */
function sbmlUnitsToUnit(id: string, units: SbmlUnit[]): Unit | undefined {
  const drop = (why: string) => {
    console.warn(`SBML unit "${id}": ${why}, dropping the unit`);
    return undefined;
  };
  const factors: UnitFactor[] = [];
  let multiplier = 1;
  for (const u of units) {
    let { scale, multiplier: m } = u;
    const e = u.exponent;
    if (!Number.isInteger(e) || !Number.isInteger(scale)) {
      return drop("non-integer exponent/scale isn't representable");
    }
    if (u.kind === "dimensionless") {
      multiplier *= (m * 10 ** scale) ** e;
      continue;
    }
    let kind = registryKindForSbml(u.kind, m);
    if (kind !== undefined) {
      m = 1;
    } else {
      const alias = SBML_KIND_ALIASES[u.kind];
      kind = alias?.kind ?? registryKindForSbml(u.kind, 1);
      scale += alias?.scale ?? 0;
    }
    if (kind === undefined) {
      return drop(`kind "${u.kind}" has no equivalent in the unit registry`);
    }
    multiplier *= m ** e;
    const prefix = scale === 0 ? undefined : unitPrefixByScale(scale)?.id;
    if (scale !== 0 && prefix === undefined) multiplier *= 10 ** (scale * e);
    factors.push(
      prefix === undefined
        ? { kind, exponent: e }
        : { kind, prefix, exponent: e },
    );
  }
  try {
    return new Unit(factors, multiplier);
  } catch (err) {
    return drop((err as Error).message);
  }
}

/** {@link sbmlUnitsToUnit} for one `<unitDefinition>` element. */
export function sbmlUnitDefinitionToUnit(def: Element): Unit | undefined {
  const attr = (el: Element, name: string, fallback: number) => {
    const v = parseFloatAttr(el, name);
    return isNaN(v) ? fallback : v;
  };
  return sbmlUnitsToUnit(
    def.getAttribute("id") ?? "?",
    [...def.querySelectorAll("listOfUnits > unit")].map((u) => ({
      kind: u.getAttribute("kind") ?? "",
      exponent: attr(u, "exponent", 1),
      scale: attr(u, "scale", 0),
      multiplier: attr(u, "multiplier", 1),
    })),
  );
}

/**
 * Resolve a `units="..."` attribute: a `<unitDefinition>` id from `defs`, or
 * a bare SBML base unit kind (`second`, `mole`, …).
 */
function resolveSbmlUnits(
  ref: string | null,
  defs: Map<string, Unit | undefined>,
): Unit | undefined {
  if (ref === null) return undefined;
  if (defs.has(ref)) return defs.get(ref);
  return sbmlUnitsToUnit(ref, [
    { kind: ref, exponent: 1, scale: 0, multiplier: 1 },
  ]);
}

// ─── MathML → AST ───────────────────────────────────────────────────────────

/**
 * Recursively convert a MathML DOM element into an expression {@link Base} node.
 *
 * Handles leaves (`<ci>`, `<cn>`, the boolean/constant tokens and `<csymbol>`
 * for `time`/`avogadro`), `<apply>` operators (arithmetic, elementary functions,
 * comparisons, logical connectives — including the `floor(divide(...))` encoding
 * of integer division) and `<piecewise>`.
 *
 * @throws if it encounters an unknown operator or element, or an empty `<apply>`.
 */
export function mathMLToAst(el: Element): Base {
  const tag = el.localName;

  if (tag === "ci") return new Name(el.textContent!.trim());
  if (tag === "cn") return new Num(parseFloat(el.textContent!.trim()));
  if (tag === "true") return new Bool(true);
  if (tag === "false") return new Bool(false);
  if (tag === "pi") return new Pi();
  if (tag === "exponentiale") return new E();
  if (tag === "notanumber") return new Num(NaN);
  if (tag === "infinity") return new Num(Infinity);

  // Stand-alone csymbol (e.g., time, avogadro)
  if (tag === "csymbol") {
    const defUrl = el.getAttribute("definitionURL") ?? "";
    if (defUrl.endsWith("time")) return new Name("t");
    if (defUrl.endsWith("avogadro")) return new Num(6.02214076e23);
    return new Name(el.textContent!.trim());
  }

  if (tag === "apply") {
    const children = Array.from(el.children);
    if (children.length === 0) throw new Error("Empty <apply>");
    const op = children[0];
    const opName = op.localName;
    const args = children.slice(1);

    switch (opName) {
      case "plus":
        return new Add(args.map(mathMLToAst));
      case "minus":
        return new Minus(args.map(mathMLToAst));
      case "times":
        return new Mul(args.map(mathMLToAst));
      case "divide":
        return new Divide(args.map(mathMLToAst));
      case "power":
        return new Pow(mathMLToAst(args[0]), mathMLToAst(args[1]));
      case "root": {
        if (args[0]?.localName === "degree") {
          return new Sqrt(
            mathMLToAst(args[1]),
            mathMLToAst(args[0].children[0]),
          );
        }
        return new Sqrt(mathMLToAst(args[0]), new Num(2));
      }
      case "log": {
        if (args[0]?.localName === "logbase") {
          return new Log(
            mathMLToAst(args[1]),
            mathMLToAst(args[0].children[0]),
          );
        }
        return new Log(mathMLToAst(args[0]), new Num(10));
      }
      case "floor": {
        // Detect encoded IntDivide: floor(divide(a, b))
        if (
          args[0]?.localName === "apply" &&
          args[0].children[0]?.localName === "divide"
        ) {
          return new IntDivide(
            Array.from(args[0].children).slice(1).map(mathMLToAst),
          );
        }
        return new Floor(mathMLToAst(args[0]));
      }
      case "implies":
        return new Implies(mathMLToAst(args[0]), mathMLToAst(args[1]));
      case "abs":
        return new Abs(mathMLToAst(args[0]));
      case "ceiling":
        return new Ceiling(mathMLToAst(args[0]));
      case "exp":
        return new Exp(mathMLToAst(args[0]));
      case "ln":
        return new Ln(mathMLToAst(args[0]));
      case "factorial":
        return new Factorial(mathMLToAst(args[0]));
      case "sin":
        return new Sin(mathMLToAst(args[0]));
      case "cos":
        return new Cos(mathMLToAst(args[0]));
      case "tan":
        return new Tan(mathMLToAst(args[0]));
      case "sec":
        return new Sec(mathMLToAst(args[0]));
      case "csc":
        return new Csc(mathMLToAst(args[0]));
      case "cot":
        return new Cot(mathMLToAst(args[0]));
      case "arcsin":
        return new Asin(mathMLToAst(args[0]));
      case "arccos":
        return new Acos(mathMLToAst(args[0]));
      case "arctan":
        return new Atan(mathMLToAst(args[0]));
      case "arccot":
        return new Acot(mathMLToAst(args[0]));
      case "arcsec":
        return new ArcSec(mathMLToAst(args[0]));
      case "arccsc":
        return new ArcCsc(mathMLToAst(args[0]));
      case "sinh":
        return new Sinh(mathMLToAst(args[0]));
      case "cosh":
        return new Cosh(mathMLToAst(args[0]));
      case "tanh":
        return new Tanh(mathMLToAst(args[0]));
      case "sech":
        return new Sech(mathMLToAst(args[0]));
      case "csch":
        return new Csch(mathMLToAst(args[0]));
      case "coth":
        return new Coth(mathMLToAst(args[0]));
      case "arcsinh":
        return new ArcSinh(mathMLToAst(args[0]));
      case "arccosh":
        return new ArcCosh(mathMLToAst(args[0]));
      case "arctanh":
        return new ArcTanh(mathMLToAst(args[0]));
      case "arccsch":
        return new ArcCsch(mathMLToAst(args[0]));
      case "arcsech":
        return new ArcSech(mathMLToAst(args[0]));
      case "arccoth":
        return new ArcCoth(mathMLToAst(args[0]));
      case "max":
        return new Max(args.map(mathMLToAst));
      case "min":
        return new Min(args.map(mathMLToAst));
      case "rem":
        return new Rem(args.map(mathMLToAst));
      case "and":
        return new And(args.map(mathMLToAst));
      case "or":
        return new Or(args.map(mathMLToAst));
      case "xor":
        return new Xor(args.map(mathMLToAst));
      case "not":
        return new Not(args.map(mathMLToAst));
      case "eq":
        return new Eq(args.map(mathMLToAst));
      case "geq":
        return new GreaterEqual(args.map(mathMLToAst));
      case "gt":
        return new GreaterThan(args.map(mathMLToAst));
      case "leq":
        return new LessEqual(args.map(mathMLToAst));
      case "lt":
        return new LessThan(args.map(mathMLToAst));
      case "neq":
        return new NotEqual(args.map(mathMLToAst));
      case "csymbol": {
        const defUrl = op.getAttribute("definitionURL") ?? "";
        const sym = op.textContent!.trim();
        if (defUrl.endsWith("rateOf")) return new RateOf(mathMLToAst(args[0]));
        if (defUrl.endsWith("time")) return new Name("t");
        if (defUrl.endsWith("avogadro")) return new Num(6.02214076e23);
        return new Name(sym);
      }
      default:
        throw new Error(`Unknown MathML operator: ${opName}`);
    }
  }

  if (tag === "piecewise") {
    const children: Base[] = [];
    for (const child of el.children) {
      if (child.localName === "piece") {
        const grandchildren = Array.from(child.children);
        if (grandchildren.length >= 2) {
          children.push(mathMLToAst(grandchildren[0]));
          children.push(mathMLToAst(grandchildren[1]));
        }
      } else if (child.localName === "otherwise") {
        if (child.children.length > 0) {
          children.push(mathMLToAst(child.children[0]));
        }
      }
    }
    return new Piecewise(children);
  }

  throw new Error(`Unknown MathML element: ${tag}`);
}

// ─── ModelBuilder → SBML ────────────────────────────────────────────────────

/**
 * Serialise a {@link KineticModelBuilder} to an SBML Level 3 Version 2 document
 * string. Variables become species and parameters become `<parameter>`s, both
 * in a single `default` compartment; assignments become assignment rules and
 * reactions become `<reaction>`s with reactant/product `speciesReference`s
 * derived from the sign of each stoichiometric coefficient.
 *
 * @param model The kinetic model to export.
 * @param name Human-readable model name (also sanitised into the model `id`).
 */
export function modelToSbml(model: KineticModelBuilder, name: string): string {
  // NN blocks aren't representable here at all: this builds <listOfReactions>
  // purely from model.reactions, which -- like buildMxlpy -- used to get a
  // block "for free" via wireNNBlockOutputs wiring it in as an ordinary
  // reaction. That trick is gone (NNBlockConfig.mechanism's doc comment):
  // composition now happens outside model.reactions entirely, so a naive
  // export would silently emit an SBML model missing every block's
  // dynamical contribution, with its weight/bias/scale parameters exported
  // as orphaned <parameter> elements nothing references. Loud failure
  // instead of a silently wrong exported model, same as buildMxlpy.
  if (model.nnBlocks.size > 0) {
    throw new Error(
      "modelToSbml: NN blocks are not yet representable in SBML export " +
        "(ADR 0005) — remove them before exporting, or export as " +
        ".mxl.json / mxlweb TS source instead.",
    );
  }
  const modelId = name.replace(/[^A-Za-z0-9_]/g, "_") || "model";

  // One <unitDefinition> per distinct parameter unit, in first-use order.
  const unitDefs: Array<{ id: string; unit: Unit }> = [];
  const unitRef = (unit: Unit | undefined): string => {
    if (unit === undefined) return "";
    let def = unitDefs.find((d) => d.unit.equals(unit));
    if (def === undefined) {
      def = { id: `unit_${unitDefs.length + 1}`, unit };
      unitDefs.push(def);
    }
    return ` units="${def.id}"`;
  };

  const compartmentXml = `<listOfCompartments>
      <compartment id="default" size="1" constant="true"/>
    </listOfCompartments>`;

  let speciesXml = "";
  if (model.variables.size > 0) {
    const items = [...model.variables.entries()]
      .map(([id, v]) => {
        const displayName = v.displayName ?? id;
        return `<species id="${escapeXml(id)}" name="${escapeXml(displayName)}" compartment="default" initialConcentration="${v.value}" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>`;
      })
      .join("\n      ");
    speciesXml = `<listOfSpecies>\n      ${items}\n    </listOfSpecies>`;
  }

  let parametersXml = "";
  if (model.parameters.size > 0) {
    const items = [...model.parameters.entries()]
      .map(([id, p]) => {
        const displayName = p.displayName ?? id;
        return `<parameter id="${escapeXml(id)}" name="${escapeXml(displayName)}" value="${p.value}"${unitRef(p.unit)} constant="true"/>`;
      })
      .join("\n      ");
    parametersXml = `<listOfParameters>\n      ${items}\n    </listOfParameters>`;
  }

  let rulesXml = "";
  if (model.assignments.size > 0) {
    const items = [...model.assignments.entries()]
      .map(([id, a]) => {
        return `<assignmentRule variable="${escapeXml(id)}">
        ${mathBlock(a.fn.toSBML())}
      </assignmentRule>`;
      })
      .join("\n      ");
    rulesXml = `<listOfRules>\n      ${items}\n    </listOfRules>`;
  }

  let reactionsXml = "";
  if (model.reactions.size > 0) {
    const items = [...model.reactions.entries()]
      .map(([id, r]) => {
        const displayName = r.displayName ?? id;

        const reactants = r.stoichiometry.filter(
          (s) => s.value instanceof Num && s.value.value < 0,
        );
        const products = r.stoichiometry.filter(
          (s) => !(s.value instanceof Num) || s.value.value > 0,
        );

        const reactantsXml =
          reactants.length > 0
            ? `\n        <listOfReactants>\n          ${reactants
                .map(
                  (s) =>
                    `<speciesReference species="${escapeXml(s.name)}" stoichiometry="${s.value instanceof Num ? Math.abs(s.value.value) : 1}" constant="true"/>`,
                )
                .join("\n          ")}\n        </listOfReactants>`
            : "";

        const productsXml =
          products.length > 0
            ? `\n        <listOfProducts>\n          ${products
                .map(
                  (s) =>
                    `<speciesReference species="${escapeXml(s.name)}" stoichiometry="${s.value instanceof Num ? s.value.value : 1}" constant="true"/>`,
                )
                .join("\n          ")}\n        </listOfProducts>`
            : "";

        return `<reaction id="${escapeXml(id)}" name="${escapeXml(displayName)}" reversible="false">${reactantsXml}${productsXml}
        <kineticLaw>
          ${mathBlock(r.fn.toSBML())}
        </kineticLaw>
      </reaction>`;
      })
      .join("\n      ");
    reactionsXml = `<listOfReactions>\n      ${items}\n    </listOfReactions>`;
  }

  const unitDefsXml =
    unitDefs.length > 0
      ? `<listOfUnitDefinitions>\n      ${unitDefs
          .map(({ id, unit }) => unit.toSBML(id))
          .join("\n      ")}\n    </listOfUnitDefinitions>`
      : "";

  const sections = [
    unitDefsXml,
    compartmentXml,
    speciesXml,
    parametersXml,
    rulesXml,
    reactionsXml,
  ]
    .filter(Boolean)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="${SBML_NS}" level="3" version="2">
  <model id="${escapeXml(modelId)}" name="${escapeXml(name)}">
    ${sections}
  </model>
</sbml>`;
}

// ─── SBML → ModelBuilder ────────────────────────────────────────────────────

/**
 * Parse an SBML document string into a {@link KineticModelBuilder}.
 *
 * Boundary-condition species become parameters; ordinary species become
 * variables (concentrations are converted to amounts using the compartment
 * size). Initial assignments, assignment rules, rate rules (turned into a
 * reaction with unit stoichiometry) and reactions are all imported; net
 * stoichiometry is computed by combining reactants and products and dropping
 * boundary species. Individual elements that fail to parse are skipped with a
 * `console.warn` rather than aborting the whole import.
 *
 * @throws if the XML is malformed or contains no `<model>` element.
 */
export function sbmlToModel(xmlString: string): KineticModelBuilder {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent}`);
  }

  if (!doc.querySelector("model")) {
    throw new Error("No <model> element found in SBML");
  }

  const builder = new KineticModelBuilder();

  // 1. Compartments — collect sizes for concentration → amount conversion
  const compartmentSizes = new Map<string, number>();
  for (const comp of doc.querySelectorAll("listOfCompartments > compartment")) {
    const id = comp.getAttribute("id");
    const size = parseFloatAttr(comp, "size");
    if (id && !isNaN(size)) compartmentSizes.set(id, size);
  }

  // Helper: which species have boundaryCondition=true
  const boundarySpecies = new Set<string>();
  for (const sp of doc.querySelectorAll("listOfSpecies > species")) {
    if (sp.getAttribute("boundaryCondition") === "true") {
      const id = sp.getAttribute("id");
      if (id) boundarySpecies.add(id);
    }
  }

  // 2. Species → variables (or parameters if boundary)
  for (const species of doc.querySelectorAll("listOfSpecies > species")) {
    const id = species.getAttribute("id");
    if (!id) continue;

    const compartmentId = species.getAttribute("compartment") ?? "default";
    const compartmentSize = compartmentSizes.get(compartmentId) ?? 1;

    const initAmount = parseFloatAttr(species, "initialAmount");
    const initConc = parseFloatAttr(species, "initialConcentration");

    let value: number;
    if (!isNaN(initAmount)) {
      value = initAmount;
    } else if (!isNaN(initConc)) {
      value = initConc * compartmentSize;
    } else {
      value = 0;
    }

    const displayName = species.getAttribute("name");
    const meta = {
      value,
      displayName: displayName && displayName !== id ? displayName : undefined,
    };

    if (boundarySpecies.has(id)) {
      builder.addParameter(id, meta);
    } else {
      builder.addVariable(id, meta);
    }
  }

  // 3. Global parameters (with units, when representable)
  const unitDefs = new Map<string, Unit | undefined>();
  for (const def of doc.querySelectorAll(
    "listOfUnitDefinitions > unitDefinition",
  )) {
    const id = def.getAttribute("id");
    if (id) unitDefs.set(id, sbmlUnitDefinitionToUnit(def));
  }
  for (const param of doc.querySelectorAll("listOfParameters > parameter")) {
    const id = param.getAttribute("id");
    if (!id) continue;
    const value = parseFloatAttr(param, "value");
    const displayName = param.getAttribute("name");
    const unit = resolveSbmlUnits(param.getAttribute("units"), unitDefs);
    builder.addParameter(id, {
      value: isNaN(value) ? 0 : value,
      displayName: displayName && displayName !== id ? displayName : undefined,
      ...(unit !== undefined && !unit.isDimensionless ? { unit } : {}),
    });
  }

  // 4. Initial assignments — override initial values or add as assignment rules
  for (const ia of doc.querySelectorAll(
    "listOfInitialAssignments > initialAssignment",
  )) {
    const symbol = ia.getAttribute("symbol");
    if (!symbol) continue;
    const mathEl = ia.querySelector("math");
    if (!mathEl || mathEl.children.length === 0) continue;
    const firstChild = mathEl.children[0];

    if (firstChild.localName === "cn") {
      // Simple numeric override
      const val = parseFloat(firstChild.textContent!.trim());
      if (!isNaN(val)) {
        if (builder.variables.has(symbol)) {
          builder.updateVariable(symbol, {
            ...builder.variables.get(symbol)!,
            value: val,
          });
        } else if (builder.parameters.has(symbol)) {
          builder.updateParameter(symbol, {
            ...builder.parameters.get(symbol)!,
            value: val,
          });
        }
      }
    } else {
      try {
        builder.addAssignment(symbol, { fn: mathMLToAst(firstChild) });
      } catch (e) {
        console.warn(`Failed to parse initial assignment for ${symbol}:`, e);
      }
    }
  }

  // 5. Assignment rules
  for (const rule of doc.querySelectorAll("listOfRules > assignmentRule")) {
    const variable = rule.getAttribute("variable");
    if (!variable) continue;
    const mathEl = rule.querySelector("math");
    if (!mathEl || mathEl.children.length === 0) continue;
    try {
      builder.addAssignment(variable, { fn: mathMLToAst(mathEl.children[0]) });
    } catch (e) {
      console.warn(`Failed to parse assignment rule for ${variable}:`, e);
    }
  }

  // 6. Rate rules (dX/dt = expr) → reaction with stoichiometry 1
  for (const rule of doc.querySelectorAll("listOfRules > rateRule")) {
    const variable = rule.getAttribute("variable");
    if (!variable) continue;
    const mathEl = rule.querySelector("math");
    if (!mathEl || mathEl.children.length === 0) continue;
    try {
      builder.addReaction(`rateRule_${variable}`, {
        fn: mathMLToAst(mathEl.children[0]),
        stoichiometry: [{ name: variable, value: new Num(1) }],
      });
    } catch (e) {
      console.warn(`Failed to parse rate rule for ${variable}:`, e);
    }
  }

  // 7. Reactions
  for (const reaction of doc.querySelectorAll("listOfReactions > reaction")) {
    const id = reaction.getAttribute("id");
    if (!id) continue;

    // Local parameters from kinetic law (may shadow global params)
    for (const kl of reaction.querySelectorAll("kineticLaw")) {
      for (const lp of kl.querySelectorAll(
        "listOfLocalParameters > localParameter, listOfParameters > parameter",
      )) {
        const lpId = lp.getAttribute("id");
        const lpVal = parseFloatAttr(lp, "value");
        if (
          lpId &&
          !isNaN(lpVal) &&
          !builder.parameters.has(lpId) &&
          !builder.variables.has(lpId)
        ) {
          builder.addParameter(lpId, { value: lpVal });
        }
      }
    }

    // Build net stoichiometry (combine reactants + products, skip boundary species)
    const stoichMap = new Map<string, number>();

    for (const ref of reaction.querySelectorAll(
      "listOfReactants > speciesReference",
    )) {
      const species = ref.getAttribute("species");
      if (!species || boundarySpecies.has(species)) continue;
      const refId = ref.getAttribute("id");
      let stoichVal =
        refId && builder.parameters.has(refId)
          ? builder.parameters.get(refId)!.value
          : parseFloatAttr(ref, "stoichiometry");
      if (isNaN(stoichVal)) stoichVal = 1;
      stoichMap.set(
        species,
        (stoichMap.get(species) ?? 0) - Math.abs(stoichVal),
      );
    }

    for (const ref of reaction.querySelectorAll(
      "listOfProducts > speciesReference",
    )) {
      const species = ref.getAttribute("species");
      if (!species || boundarySpecies.has(species)) continue;
      const refId = ref.getAttribute("id");
      let stoichVal =
        refId && builder.parameters.has(refId)
          ? builder.parameters.get(refId)!.value
          : parseFloatAttr(ref, "stoichiometry");
      if (isNaN(stoichVal)) stoichVal = 1;
      stoichMap.set(
        species,
        (stoichMap.get(species) ?? 0) + Math.abs(stoichVal),
      );
    }

    const stoichiometry: Stoichiometry = [...stoichMap.entries()]
      .filter(([, val]) => val !== 0)
      .map(([name, val]) => ({ name, value: new Num(val) }));

    const mathEl = reaction.querySelector("kineticLaw > math");
    if (!mathEl || mathEl.children.length === 0) continue;

    try {
      const displayName = reaction.getAttribute("name");
      builder.addReaction(id, {
        fn: mathMLToAst(mathEl.children[0]),
        stoichiometry,
        displayName:
          displayName && displayName !== id ? displayName : undefined,
      });
    } catch (e) {
      console.warn(`Failed to parse reaction ${id}:`, e);
    }
  }

  return builder;
}
