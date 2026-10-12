import { unitRegistry } from "./registry.js";
import { type CustomUnits, Unit } from "./unit.js";

/**
 * Parse authored unit text (`"mmol/s"`, `"µmol·m⁻²·s⁻¹"`, `"umol m^-2 s^-1"`,
 * `"1/s"`, `"mM"`) into a {@link Unit}. A convenience for authoring only — the
 * stored, exported form is always the structured `Unit`.
 *
 * Grammar: products of atoms joined by `*`, `·`, `⋅`, `×` or whitespace; `/`
 * divides by the single atom that follows it (`mol/l/s` = `mol/(l·s)`);
 * parentheses group; an atom takes an integer exponent via `^n`, `**n`,
 * Unicode superscripts (`m⁻²`) or a directly attached signed integer (`s-1`,
 * `m2`). The literal `1` and `dimensionless` are dimensionless; `%` is
 * `0.01`.
 *
 * Symbols resolve, in order: a declared custom kind id, a registry kind id
 * (`mole`, `litre`), a registry symbol (`mol`, `L`, `min`, `M` = mol/L), then
 * an SI prefix followed by one of those (`mmol`, `µM`, `km`, `millimole`).
 * Exact matches win over prefix splits, so `min` is minute, not milli-inch,
 * and `mol` is mole. Anything else throws an error naming the symbol — a unit
 * is never silently dropped or guessed.
 */
export function parseUnit(
  text: string,
  customs: CustomUnits = new Map(),
): Unit {
  const parser = new Parser(text, customs);
  const unit = parser.parse();
  return unit.validate(customs);
}

/** Symbols beyond the registry's own `symbol`s. */
const ALIASES: Record<string, Unit> = {
  l: Unit.of("litre"),
  liter: Unit.of("litre"),
  meter: Unit.of("metre"),
  mol: Unit.of("mole"),
  sec: Unit.of("second"),
  hr: Unit.of("hour"),
  "°C": Unit.of("celsius"),
  degC: Unit.of("celsius"),
  ohm: Unit.of("ohm"),
  M: new Unit([
    { kind: "mole", exponent: 1 },
    { kind: "litre", exponent: -1 },
  ]),
};

const SYMBOLS: Map<string, Unit> = new Map([
  ...unitRegistry.kinds.map((k): [string, Unit] => [k.symbol, Unit.of(k.id)]),
  ...Object.entries(ALIASES),
]);

/** Prefix spellings, longest first so `da` wins over `d`. */
const PREFIX_SPELLINGS: Array<[string, string]> = [
  ...unitRegistry.prefixes.flatMap((p): Array<[string, string]> => [
    [p.symbol, p.id],
    [p.id, p.id],
  ]),
  ["μ", "micro"], // Greek mu, next to the micro sign µ the registry uses
  ["u", "micro"],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
  "⁺": "+",
};

type Token =
  | { t: "sym"; v: string }
  | { t: "num"; v: number }
  | { t: "exp"; v: number }
  | { t: "op"; v: "*" | "/" | "(" | ")" | "^" };

const SYM_START = /[A-Za-z_µμΩ°%]/;
const SYM_CHAR = /[A-Za-z0-9_µμΩ°]/;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const err = (msg: string) =>
    new Error(`cannot parse unit "${text}": ${msg} at position ${i}`);
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "*" && text[i + 1] === "*") {
      tokens.push({ t: "op", v: "^" });
      i += 2;
      continue;
    }
    if ("*·⋅×".includes(c)) {
      tokens.push({ t: "op", v: "*" });
      i++;
      continue;
    }
    if (c === "/" || c === "(" || c === ")" || c === "^") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c in SUPERSCRIPT_DIGITS) {
      let s = "";
      while (i < text.length && text[i] in SUPERSCRIPT_DIGITS) {
        s += SUPERSCRIPT_DIGITS[text[i]];
        i++;
      }
      const n = Number(s);
      if (!Number.isInteger(n)) throw err(`bad superscript exponent "${s}"`);
      tokens.push({ t: "exp", v: n });
      continue;
    }
    if (/[-+0-9]/.test(c)) {
      const m = /^[-+]?\d+/.exec(text.slice(i));
      if (m === null) throw err(`unexpected "${c}"`);
      const prev = tokens.at(-1);
      // A signed/bare integer glued to a symbol or `)` is its exponent (`s-1`).
      const glued =
        i > 0 &&
        !/\s/.test(text[i - 1]) &&
        (prev?.t === "sym" || (prev?.t === "op" && prev.v === ")"));
      tokens.push(
        glued ? { t: "exp", v: Number(m[0]) } : { t: "num", v: Number(m[0]) },
      );
      i += m[0].length;
      continue;
    }
    if (c === "%") {
      tokens.push({ t: "sym", v: "%" });
      i++;
      continue;
    }
    if (SYM_START.test(c)) {
      let s = c;
      i++;
      // `°C`: allow the degree sign to start a symbol.
      while (i < text.length && SYM_CHAR.test(text[i])) {
        s += text[i];
        i++;
      }
      tokens.push({ t: "sym", v: s });
      continue;
    }
    throw err(`unexpected "${c}"`);
  }
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly customs: CustomUnits,
  ) {
    this.tokens = tokenize(text);
  }

  private error(msg: string): Error {
    return new Error(`cannot parse unit "${this.text}": ${msg}`);
  }

  parse(): Unit {
    if (this.tokens.length === 0) throw this.error("empty unit");
    const unit = this.product();
    if (this.pos < this.tokens.length) {
      throw this.error(`unexpected "${String(this.tokens[this.pos].v)}"`);
    }
    return unit;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private product(): Unit {
    let unit = this.power();
    for (;;) {
      const tok = this.peek();
      if (tok === undefined || (tok.t === "op" && tok.v === ")")) return unit;
      if (tok.t === "op" && tok.v === "/") {
        this.pos++;
        unit = unit.div(this.power());
      } else if (tok.t === "op" && tok.v === "*") {
        this.pos++;
        unit = unit.mul(this.power());
      } else {
        // Juxtaposition (`kg m`) is multiplication.
        unit = unit.mul(this.power());
      }
    }
  }

  private power(): Unit {
    const base = this.atom();
    const tok = this.peek();
    if (tok?.t === "exp") {
      this.pos++;
      return base.pow(tok.v);
    }
    if (tok?.t === "op" && tok.v === "^") {
      this.pos++;
      let open = false;
      if (this.peek()?.t === "op" && this.peek()?.v === "(") {
        open = true;
        this.pos++;
      }
      const n = this.peek();
      if (n?.t !== "num" && n?.t !== "exp") {
        throw this.error("expected an integer exponent after ^");
      }
      this.pos++;
      if (open) this.expect(")");
      return base.pow(n.v);
    }
    return base;
  }

  private expect(v: ")"): void {
    const tok = this.peek();
    if (tok?.t !== "op" || tok.v !== v) throw this.error(`expected "${v}"`);
    this.pos++;
  }

  private atom(): Unit {
    const tok = this.peek();
    if (tok === undefined) throw this.error("unexpected end");
    this.pos++;
    if (tok.t === "op" && tok.v === "(") {
      const inner = this.product();
      this.expect(")");
      return inner;
    }
    if (tok.t === "num") {
      if (tok.v !== 1) {
        throw this.error(`numbers other than 1 aren't units (got ${tok.v})`);
      }
      return Unit.dimensionless;
    }
    if (tok.t === "sym") return this.symbol(tok.v);
    throw this.error(`unexpected "${String(tok.v)}"`);
  }

  private symbol(s: string): Unit {
    const resolved = this.resolve(s);
    if (resolved !== undefined) return resolved;
    // `m2`, `OD600`: a trailing integer is an exponent only if the rest of the
    // symbol is a unit and the whole thing is not.
    const m = /^(.*?[^0-9])(\d+)$/.exec(s);
    if (m !== null) {
      const base = this.resolve(m[1]);
      if (base !== undefined) return base.pow(Number(m[2]));
    }
    throw this.error(
      `unknown unit symbol "${s}" — use a registry unit or declare it as a custom unit`,
    );
  }

  private resolve(s: string): Unit | undefined {
    if (s === "%") return new Unit([], 0.01);
    if (s === "dimensionless") return Unit.dimensionless;
    if (this.customs.has(s)) return Unit.of(s);
    const exact = this.exact(s);
    if (exact !== undefined) return exact;
    for (const [spelling, prefix] of PREFIX_SPELLINGS) {
      if (s.length <= spelling.length || !s.startsWith(spelling)) continue;
      const rest = this.exact(s.slice(spelling.length));
      if (rest === undefined) continue;
      // Apply the prefix to the unit's first factor (`mM` = mmol/L).
      const [first, ...others] = rest.factors;
      if (first.prefix !== undefined || first.exponent !== 1) continue;
      return new Unit(
        [{ kind: first.kind, prefix, exponent: 1 }, ...others],
        rest.multiplier,
      );
    }
    return undefined;
  }

  private exact(s: string): Unit | undefined {
    const sym = SYMBOLS.get(s);
    if (sym !== undefined) return sym;
    // Registry ids (`mole`, `second`), but never custom ones — those must be
    // declared to be used.
    if (unitRegistry.kinds.some((k) => k.id === s)) return Unit.of(s);
    return undefined;
  }
}
