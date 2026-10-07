/**
 * Python identifier validation/sanitization for the Python exports
 * (`buildMxlpy`, `buildPython`), which emit model names verbatim as Python
 * identifiers — display names are free-form prose ("E. coli growth rate"),
 * so every exported name goes through {@link pyIdentifierMap} first.
 */

/** Python's hard keywords. Soft keywords (`match`, `case`, `type`, `_`) are valid identifiers. */
export const PY_KEYWORDS: ReadonlySet<string> = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

/**
 * Names the generated Python modules use themselves — `time` (mxlpy's time
 * argument, `buildPython`'s `model()` argument), the imported modules a
 * same-named function parameter would shadow, and the generated
 * functions/locals of `buildMxlpy`/`buildPython`.
 */
export const PY_RESERVED: ReadonlySet<string> = new Set([
  "time",
  "math",
  "np",
  "jnp",
  "jax",
  "eqx",
  "m",
  "get_model",
  "variables",
  "model",
  "all_derived",
  "selected_derived",
  "derived",
]);

const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
const NON_CONTINUE_RUN = /[^\p{XID_Continue}]+/gu;
const EDGE_NON_CONTINUE = /^[^\p{XID_Continue}]+|[^\p{XID_Continue}]+$/gu;
const START = /^[\p{XID_Start}_]/u;

/** `s` as a Python string literal — JSON string syntax is valid Python, escapes included. */
export function pyString(s: string): string {
  return JSON.stringify(s);
}

/** Whether `s` is a valid Python identifier: `str.isidentifier()` and not a keyword. */
export function isPyIdentifier(s: string): boolean {
  const n = s.normalize("NFKC");
  return IDENTIFIER.test(n) && !PY_KEYWORDS.has(n);
}

/** `raw` unchanged if it's already a valid identifier, otherwise the closest valid one. */
export function toPyIdentifier(raw: string): string {
  if (isPyIdentifier(raw)) return raw;
  let s = raw
    .normalize("NFKC")
    .replace(EDGE_NON_CONTINUE, "")
    .replace(NON_CONTINUE_RUN, "_");
  if (s === "") return "_";
  if (!START.test(s)) s = `_${s}`;
  if (PY_KEYWORDS.has(s)) s = `${s}_`;
  return s;
}

/** `base`, or `base_2`, `base_3`, … — the first one not in `taken` (compared NFKC-normalized). Claims the result in `taken`. */
export function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let i = 2; taken.has(candidate.normalize("NFKC")); i++) {
    candidate = `${base}_${i}`;
  }
  taken.add(candidate.normalize("NFKC"));
  return candidate;
}

/**
 * Map every id to a unique, valid Python identifier derived from its raw
 * name. Entries whose raw name is already valid and free claim it first
 * (in iteration order), so sanitizing one name never renames a valid one;
 * the rest get {@link toPyIdentifier} plus a `_2`, `_3`, … suffix on
 * collision. Nothing in `reserved` is ever produced.
 */
export function pyIdentifierMap(
  entries: Iterable<[string, string]>,
  reserved: ReadonlySet<string> = PY_RESERVED,
): Map<string, string> {
  const list = [...entries];
  const taken = new Set([...reserved].map((r) => r.normalize("NFKC")));
  const out = new Map<string, string>();
  for (const [id, raw] of list) {
    const n = raw.normalize("NFKC");
    if (isPyIdentifier(raw) && !taken.has(n)) {
      taken.add(n);
      out.set(id, raw);
    }
  }
  for (const [id, raw] of list) {
    if (out.has(id)) continue;
    out.set(id, uniqueName(toPyIdentifier(raw), taken));
  }
  return new Map(list.map(([id]) => [id, out.get(id)!]));
}
