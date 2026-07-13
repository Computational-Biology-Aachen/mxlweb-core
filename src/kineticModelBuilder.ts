import { SvelteMap } from "svelte/reactivity";
import {
  Add,
  Base,
  type JsonNode,
  Minus,
  Mul,
  Name,
  Num,
} from "./mathml/index.js";
import {
  type Assign,
  defaultTexName,
  type IntermediateDef,
  ModelBuilderBase,
  type MxlEntity,
  type MxlKind,
  type Parameter,
  type Variable,
} from "./modelBuilderBase.js";

/**
 * Reaction-based kinetic model builder and its LaTeX rendering helpers.
 *
 * A model is a set of named reactions, each with a rate expression and a
 * stoichiometry; {@link KineticModelBuilder} assembles the system of ODEs
 * `dx/dt = N · v` from them. The free functions here render that model (and its
 * stoichiometry) to aligned LaTeX for display.
 *
 * @module
 */

/** One entry of a reaction's stoichiometry: a species `name` and its coefficient `value` (an expression, usually a {@link Num}). */
export type Stoich = {
  name: string;
  value: Base;
};
/** A reaction's full stoichiometry — the list of species coefficients it affects. */
export type Stoichiometry = Array<Stoich>;

/** A reaction: a rate expression `fn`, its `stoichiometry`, and optional display/LaTeX names. */
export type Reaction = {
  fn: Base;
  stoichiometry: Stoichiometry;
  displayName?: string;
  texName?: string;
};

/** Maximum LaTeX line length before {@link renderTerms} wraps onto a new aligned row. */
const LINE_LIMIT = 60;

/**
 * Render a list of signed `coeff · term` contributions to LaTeX, normalising
 * signs (so negatives become subtractions) and dropping unit coefficients.
 * Long sums are wrapped across multiple lines at {@link LINE_LIMIT} characters.
 * Returns one string per line (`["0"]` when empty).
 */
export function renderTerms(
  terms: { tex: string; value: Base }[],
  texNames: Map<string, string>,
): string[] {
  if (terms.length === 0) return ["0"];

  type SignedTerm = { sign: "+" | "-"; tex: string };
  const signed: SignedTerm[] = terms.map(({ tex, value }) => {
    let sign: "+" | "-" = "+";
    let coeff: Base = value;

    if (value instanceof Num && value.value < 0) {
      sign = "-";
      coeff = new Num(-value.value);
    } else if (value instanceof Minus && value.children.length === 1) {
      sign = "-";
      coeff = value.children[0];
    }

    const isNum = coeff instanceof Num;

    if (!isNum) {
      return { sign, tex: `${coeff.toTex(texNames)} \\cdot ${tex}` };
    }

    const isOne = coeff instanceof Num && coeff.value === 1;
    const rendered = isOne ? tex : `${coeff.toTex(texNames)} \\cdot ${tex}`;
    return { sign, tex: rendered };
  });

  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < signed.length; i++) {
    const { sign, tex } = signed[i];
    if (i === 0) {
      currentLine = sign === "-" ? `- ${tex}` : tex;
    } else {
      const addition = ` ${sign} ${tex}`;
      if (currentLine.length + addition.length > LINE_LIMIT) {
        lines.push(currentLine);
        currentLine = `${sign} ${tex}`;
      } else {
        currentLine += addition;
      }
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Render a reaction's stoichiometry to LaTeX (zero coefficients dropped). A
 * single species renders inline as `species: coeff`; multiple species become an
 * aligned `species : coeff` column.
 */
export function stoichToTex(
  stoich: Stoichiometry,
  texNames: Map<string, string>,
): string {
  const filtered = stoich.filter(({ value }) =>
    value instanceof Num ? value.value !== 0 : true,
  );
  if (filtered.length === 0) return "0";

  // A single species renders inline; multiple species become a
  // stoichiometric-matrix column (species : coeff), one per aligned row.
  if (filtered.length === 1) {
    const { name, value } = filtered[0];
    return `${texNames.get(name) || name}: ${value.toTex(texNames)}`;
  }
  const lines = filtered.map(
    ({ name, value }) =>
      `&${texNames.get(name) || name} : ${value.toTex(texNames)}`,
  );
  return `\\begin{aligned}${lines.join(" \\\\ ")}\\end{aligned}`;
}

/**
 * Build the symbol → LaTeX-name lookup used by the `toTex` serialisers, drawing
 * explicit `texName`s from every variable, parameter, assignment and reaction
 * (falling back to {@link defaultTexName}). Symbols without a `texName` are
 * omitted, so callers render them by their raw name.
 */
export function getTexNames(
  variables: Iterable<[string, Variable]>,
  parameters: Iterable<[string, Parameter]>,
  assignments: Iterable<[string, Assign]>,
  reactions: Iterable<[string, Reaction]>,
): Map<string, string> {
  const texNames: Map<string, string> = new Map();

  for (const [name, variable] of variables) {
    if (variable.texName) {
      texNames.set(name, variable.texName || defaultTexName(name));
    }
  }
  for (const [name, parameter] of parameters) {
    if (parameter.texName) {
      texNames.set(name, parameter.texName || defaultTexName(name));
    }
  }
  for (const [name, ass] of assignments) {
    if (ass.texName) {
      texNames.set(name, ass.texName || defaultTexName(name));
    }
  }
  for (const [name, rxn] of reactions) {
    if (rxn.texName) {
      texNames.set(name, rxn.texName || defaultTexName(name));
    }
  }
  return texNames;
}

// Build a single additive term `coeff · v(rxn)` as an AST, simplifying the
// common ±1 / unary-minus cases so generated code stays readable.
function reactionTerm(coeff: Base, rxnName: string): Base {
  const ref = new Name(rxnName);
  if (coeff instanceof Num) {
    if (coeff.value === 1) return ref;
    if (coeff.value === -1) return new Minus([ref]);
    return new Mul([new Num(coeff.value), ref]);
  }
  if (coeff instanceof Minus && coeff.children.length === 1) {
    return new Minus([reactionTerm(coeff.children[0], rxnName)]);
  }
  return new Mul([coeff, ref]);
}

/**
 * Reaction/stoichiometry model builder: dx/dt = N · v.
 *
 * State changes are expressed as reactions (a rate expression `fn` plus a
 * stoichiometry mapping each species to its coefficient). The per-variable
 * dx/dt is assembled by summing `stoich · rate` over all reactions.
 */
export class KineticModelBuilder extends ModelBuilderBase {
  readonly builderType = "KineticModelBuilder";
  reactions: SvelteMap<string, Reaction> = new SvelteMap();

  constructor() {
    super();
  }

  clone(): KineticModelBuilder {
    const cl = new KineticModelBuilder();
    cl.parameters = new SvelteMap(this.parameters);
    cl.variables = new SvelteMap(this.variables);
    cl.assignments = new SvelteMap(this.assignments);
    cl.reactions = new SvelteMap(this.reactions);
    return cl;
  }

  // Reactions
  addReaction(key: string, reaction: Reaction) {
    if (key === "time") throw new Error('"time" is a reserved identifier');
    this.reactions.set(key, reaction);
    return this;
  }
  updateReaction(key: string, reaction: Reaction) {
    this.reactions.set(key, reaction);
    return this;
  }
  removeReaction(key: string) {
    this.reactions.delete(key);
    return this;
  }

  protected extraMxlwebChains(collect: (expr: Base) => void): string[] {
    const chains: string[] = [];
    for (const [id, rxn] of this.reactions) {
      collect(rxn.fn);
      const stoich = rxn.stoichiometry.map((s) => {
        collect(s.value);
        return `{ name: ${JSON.stringify(s.name)}, value: ${s.value.toTs()} }`;
      });
      const opts = this.tsFields([
        ["fn", rxn.fn.toTs()],
        ["stoichiometry", `[${stoich.join(", ")}]`],
        ["displayName", this.tsString(rxn.displayName)],
        ["texName", this.tsString(rxn.texName)],
      ]);
      chains.push(`    .addReaction(${JSON.stringify(id)}, ${opts})`);
    }
    return chains;
  }

  protected extraIntermediates(): Map<string, IntermediateDef> {
    return new Map(
      [...this.reactions.entries()].map(([key, rxn]) => [
        key,
        { fn: rxn.fn, displayName: rxn.displayName, texName: rxn.texName },
      ]),
    );
  }

  protected mxlKind(): MxlKind {
    return "kinetic";
  }

  protected mxlModel(): Record<string, Record<string, MxlEntity>> {
    return {
      variables: this.mxlVariables(),
      parameters: this.mxlParameters(),
      reactions: this.mxlReactions(),
      derived: this.mxlDerived(),
      readouts: {},
    };
  }

  private mxlReactions(): Record<string, MxlEntity> {
    const out: Record<string, MxlEntity> = {};
    for (const [id, rxn] of this.reactions) {
      const stoichiometry: Record<string, JsonNode> = {};
      for (const { name, value } of rxn.stoichiometry) {
        stoichiometry[name] = value.toJson();
      }
      const entry: MxlEntity = { fn: rxn.fn.toJson(), stoichiometry };
      this.mxlApplyMeta(entry, rxn.displayName, rxn.texName);
      out[id] = entry;
    }
    return out;
  }

  protected dxdtExpr(varName: string): Base {
    const terms: Base[] = [];
    for (const [rxnName, rxn] of this.reactions) {
      for (const { name, value } of rxn.stoichiometry) {
        if (name !== varName) continue;
        if (value instanceof Num && value.value === 0) continue;
        terms.push(reactionTerm(value, rxnName));
      }
    }
    if (terms.length === 0) return new Num(0);
    if (terms.length === 1) return terms[0];
    return new Add(terms);
  }

  /** Render the full ODE system `dx/dt = N · v` as a LaTeX `align*` block, one row per variable. */
  buildTex(): string {
    const texNames: Map<string, string> = getTexNames(
      this.variables.entries(),
      this.parameters.entries(),
      this.assignments.entries(),
      this.reactions.entries(),
    );

    // Collect rhs terms per variable
    const rhs: Record<string, { tex: string; value: Base }[]> =
      Object.fromEntries([...this.variables.entries()].map(([k]) => [k, []]));
    this.reactions.entries().forEach(([_, rxn]) => {
      const rxnTex = rxn.fn.toTex(texNames);
      rxn.stoichiometry.forEach(({ name: varName, value: stoich }) => {
        rhs[varName].push({ tex: rxnTex, value: stoich });
      });
    });

    // Finalize rhs
    const rhsString = Object.entries(rhs)
      .map(([name, terms]) => {
        const lines = renderTerms(terms, texNames);
        const rendered = lines.join(" \\\\\n  & ");
        return `\\frac{d ${texNames.get(name) || name}}{dt} &= ${rendered}`;
      })
      .join(" \\\\ \n  ");

    return String.raw`\begin{align*}
  ${rhsString}
\end{align*}`;
  }

  /**
   * Generate an [mxlpy](https://github.com/Computational-Biology-Aachen/mxlpy)
   * model module as Python source: a `get_model() -> Model` factory plus the
   * module-level rate/derived/initial-assignment functions it references.
   *
   * Each reaction, assignment and expression-valued initial value becomes its
   * own generated `def` (body `return <expr>`); the factory then wires them up
   * via `add_parameter` / `add_variable` / `add_derived` / `add_reaction`.
   * Numeric stoichiometry coefficients are emitted as floats; non-numeric ones
   * become `Derived` entries. Function arguments follow model declaration order
   * (variables, parameters, derived, reactions), with mxlpy's reserved `time`
   * argument placed first.
   */
  buildMxlpy(): string {
    const displayNames = this.getDisplayNames();
    const name = (id: string) => displayNames.get(id) ?? id;

    // Declaration-order index, used to order generated-function arguments.
    const declOrder = new Map<string, number>();
    for (const id of [
      ...this.variables.keys(),
      ...this.parameters.keys(),
      ...this.assignments.keys(),
      ...this.reactions.keys(),
    ]) {
      declOrder.set(id, declOrder.size);
    }

    const orderArgs = (expr: Base): string[] => {
      const symbols = [...expr.getSymbols(new Set<string>())];
      const known = symbols
        .filter((s) => s !== "time")
        .sort(
          (a, b) =>
            (declOrder.get(a) ?? Infinity) - (declOrder.get(b) ?? Infinity),
        );
      return symbols.includes("time") ? ["time", ...known] : known;
    };

    const argList = (args: string[]) =>
      args.map((a) => `"${name(a)}"`).join(", ");

    const defs: string[] = [];
    // Emit a module-level `def <fnName>(...): return <expr>` and return the
    // ordered arg ids so the call site can build a matching `args=[...]`.
    const emitFn = (fnName: string, expr: Base): string[] => {
      const args = orderArgs(expr);
      const params = args.map(name).join(", ");
      defs.push(
        `def ${fnName}(${params}):\n    return ${expr.toPy(displayNames)}`,
      );
      return args;
    };

    let usesInitial = false;
    let usesDerived = false;
    const body: string[] = [];

    for (const [id, p] of this.parameters) {
      body.push(`m.add_parameter("${name(id)}", ${p.value})`);
    }

    for (const [id, v] of this.variables) {
      if (v.value instanceof Base) {
        usesInitial = true;
        const fnName = `_init_${name(id)}`;
        const args = emitFn(fnName, v.value);
        body.push(
          `m.add_variable("${name(id)}", InitialAssignment(${fnName}, args=[${argList(args)}]))`,
        );
      } else {
        body.push(`m.add_variable("${name(id)}", ${v.value})`);
      }
    }

    for (const [id, ass] of this.assignments) {
      const fnName = `_derived_${name(id)}`;
      const args = emitFn(fnName, ass.fn);
      body.push(
        `m.add_derived("${name(id)}", ${fnName}, args=[${argList(args)}])`,
      );
    }

    for (const [id, rxn] of this.reactions) {
      const fnName = `_rate_${name(id)}`;
      const args = emitFn(fnName, rxn.fn);

      const stoich: string[] = [];
      for (const { name: species, value } of rxn.stoichiometry) {
        if (value instanceof Num) {
          if (value.value === 0) continue;
          stoich.push(`"${name(species)}": ${value.value}`);
        } else {
          usesDerived = true;
          const sFn = `_stoich_${name(id)}_${name(species)}`;
          const sArgs = emitFn(sFn, value);
          stoich.push(
            `"${name(species)}": Derived(${sFn}, args=[${argList(sArgs)}])`,
          );
        }
      }

      body.push(
        [
          `m.add_reaction(`,
          `        "${name(id)}",`,
          `        ${fnName},`,
          `        args=[${argList(args)}],`,
          `        stoichiometry={${stoich.join(", ")}},`,
          `    )`,
        ].join("\n"),
      );
    }

    const imports = ["Model"];
    if (usesDerived) imports.push("Derived");
    if (usesInitial) imports.push("InitialAssignment");
    imports.sort();

    const defsBlock = defs.length > 0 ? `${defs.join("\n\n")}\n\n` : "";
    const factory = ["m = Model()", ...body, "return m"]
      .map((line) => `    ${line}`)
      .join("\n");

    return `import math

import numpy as np

from mxlpy import ${imports.join(", ")}

${defsBlock}def get_model() -> Model:
${factory}
`;
  }
}
