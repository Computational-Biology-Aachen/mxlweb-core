import { SvelteMap } from "svelte/reactivity";
import { Add, Base, Minus, Mul, Name, Num } from "./mathml/index.js";
import {
  type Assign,
  defaultTexName,
  type IntermediateDef,
  ModelBuilderBase,
  type Parameter,
  type Variable,
} from "./modelBuilderBase.js";

export type Stoich = {
  name: string;
  value: Base;
};
export type Stoichiometry = Array<Stoich>;

export type Reaction = {
  fn: Base;
  stoichiometry: Stoichiometry;
  displayName?: string;
  texName?: string;
};

const LINE_LIMIT = 60;

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

  protected extraIntermediates(): Map<string, IntermediateDef> {
    return new Map(
      [...this.reactions.entries()].map(([key, rxn]) => [
        key,
        { fn: rxn.fn, displayName: rxn.displayName, texName: rxn.texName },
      ]),
    );
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
}
