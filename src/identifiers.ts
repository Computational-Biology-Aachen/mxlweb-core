/**
 * Canonical identifiers shared with mxlpy (mxl-schemas `v1/identifiers.json`).
 *
 * Model ids are free-form, but code exports need identifiers. mxlpy maps a
 * model's names through these rules when it emits `model.ts`, and the Python
 * exports here (`buildMxlpy`, `buildPython`) map ids through the same rules,
 * so a model has the same ids in Python and JavaScript: an already canonical
 * id maps to itself. {@link RESERVED} and {@link TRANSLITERATE} are vendored
 * copies of the shared file; a drift test compares them against it.
 */

// prettier-ignore
export const RESERVED: ReadonlySet<string> = new Set([
  // Python hard keywords
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally", "for",
  "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
  "or", "pass", "raise", "return", "try", "while", "with", "yield",
  // JavaScript reserved words
  "Infinity", "NaN", "arguments", "case", "catch", "const", "debugger",
  "default", "delete", "do", "enum", "eval", "export", "extends", "false",
  "function", "implements", "instanceof", "interface", "let", "new", "null",
  "package", "private", "protected", "public", "static", "super", "switch",
  "this", "throw", "true", "typeof", "undefined", "var", "void",
  // Names the generated Python / JavaScript code uses itself
  "Math", "all", "all_derived", "derived", "eqx", "get_model", "jax", "jnp",
  "m", "math", "model", "np", "pars", "selected_derived", "time", "variables",
]);

export const SYMBOLS: Readonly<Record<string, string>> = {
  "+": "plus",
  "*": "star",
  "/": "per",
};

// prettier-ignore
export const TRANSLITERATE: Readonly<Record<string, string>> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon",
  "ζ": "zeta", "η": "eta", "θ": "theta", "ι": "iota", "κ": "kappa",
  "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "ο": "omicron", "π": "pi",
  "ρ": "rho", "σ": "sigma", "ς": "sigma", "τ": "tau", "υ": "upsilon",
  "φ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  "Α": "Alpha", "Β": "Beta", "Γ": "Gamma", "Δ": "Delta", "Ε": "Epsilon",
  "Ζ": "Zeta", "Η": "Eta", "Θ": "Theta", "Ι": "Iota", "Κ": "Kappa",
  "Λ": "Lambda", "Μ": "Mu", "Ν": "Nu", "Ξ": "Xi", "Ο": "Omicron", "Π": "Pi",
  "Ρ": "Rho", "Σ": "Sigma", "Τ": "Tau", "Υ": "Upsilon", "Φ": "Phi",
  "Χ": "Chi", "Ψ": "Psi", "Ω": "Omega",
  "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O",
  "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "þ": "th", "Þ": "Th",
};

const CANONICAL = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EDGES = /^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/gu;
const INVALID_RUN = /[^A-Za-z0-9]*[^A-Za-z0-9_][^A-Za-z0-9]*/gu;
const COMBINING_MARK = /\p{M}/gu;
// A `-` ending a token is a charge / reduced-state marker (`FA-`), one between
// letters or digits a hyphen (`Light-harvesting`).
const CHARGE_MINUS = /-(?=[^A-Za-z0-9]|$)/gu;

/** Whether `s` is already canonical (and thus maps to itself). */
export function isCanonicalIdentifier(s: string): boolean {
  return CANONICAL.test(s) && !RESERVED.has(s);
}

/** `raw` unchanged if it's already canonical, otherwise its canonical form. */
export function canonicalIdentifier(raw: string): string {
  if (isCanonicalIdentifier(raw)) return raw;
  let s = [...raw.normalize("NFKD").replace(COMBINING_MARK, "")]
    .map((c) => TRANSLITERATE[c] ?? c)
    .join("")
    .replace(CHARGE_MINUS, " minus ");
  s = [...s]
    .map((c) => (Object.hasOwn(SYMBOLS, c) ? ` ${SYMBOLS[c]} ` : c))
    .join("")
    .replace(EDGES, "")
    .replace(INVALID_RUN, "_");
  if (s === "") s = "_";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  if (RESERVED.has(s)) s = `${s}_`;
  return s;
}

/** `base`, or `base_2`, `base_3`, … — the first one not in `taken`. Claims the result in `taken`. */
export function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let i = 2; taken.has(candidate); i++) {
    candidate = `${base}_${i}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Map every id to the canonical identifier of its raw name. Two entries
 * mapping to the same identifier is an error — rename one at the source.
 */
export function canonicalIdentifierMap(
  entries: Iterable<[string, string]>,
): Map<string, string> {
  const out = new Map<string, string>();
  const owner = new Map<string, string>();
  for (const [id, raw] of entries) {
    const ident = canonicalIdentifier(raw);
    const other = owner.get(ident);
    if (other !== undefined) {
      throw new Error(
        `${JSON.stringify(other)} and ${JSON.stringify(raw)} both map to the identifier ${JSON.stringify(ident)}; rename one of them`,
      );
    }
    owner.set(ident, raw);
    out.set(id, ident);
  }
  return out;
}
