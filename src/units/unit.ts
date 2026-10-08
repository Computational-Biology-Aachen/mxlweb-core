import {
  unitRegistry,
  type UnitKindEntry,
  type UnitPrefixEntry,
} from "./registry.js";

/**
 * Physical units shared with mxlpy (mxl-schemas spec 1.1, `$defs/unit`).
 *
 * A {@link Unit} is a flat product of factors — the SBML unitDefinition
 * model: `multiplier · ∏ (10^prefix · kind)^exponent`. Every `kind` is either
 * an id from the shared registry (`registry.ts`, vendored from mxl-schemas'
 * `v1/units.json`) or a model-specific custom kind declared via
 * {@link CustomUnits}, which consumers treat as an opaque base dimension. A
 * free-form unit string never reaches storage: {@link parseUnit} turns
 * authored text into a `Unit` up front and rejects anything it can't map.
 *
 * @module
 */

/** An SI prefix id from the registry (`"milli"`, `"micro"`, …). */
export type UnitPrefix = string;

/** One `{kind, prefix?, exponent}` factor, exactly as stored in `.mxl.json`. */
export type UnitFactor = {
  kind: string;
  prefix?: UnitPrefix;
  exponent: number;
};

/** The `.mxl.json` shape of a unit (`$defs/unit`). */
export type UnitJson = {
  factors: UnitFactor[];
  multiplier?: number;
};

/** A model-specific unit kind (`$defs/customUnit`), keyed by id in {@link CustomUnits}. */
export type CustomUnit = {
  symbol?: string;
  tex?: string;
  description?: string;
};

/** Custom unit kinds declared by a model (`.mxl.json` `model.units`). */
export type CustomUnits = ReadonlyMap<string, CustomUnit>;

const KINDS: ReadonlyMap<string, UnitKindEntry> = new Map(
  unitRegistry.kinds.map((k) => [k.id, k]),
);
const KIND_ORDER: ReadonlyMap<string, number> = new Map(
  unitRegistry.kinds.map((k, i) => [k.id, i]),
);
const PREFIXES: ReadonlyMap<string, UnitPrefixEntry> = new Map(
  unitRegistry.prefixes.map((p) => [p.id, p]),
);
const PREFIX_BY_SCALE: ReadonlyMap<number, UnitPrefixEntry> = new Map(
  unitRegistry.prefixes.map((p) => [p.scale, p]),
);

/** Registry kind entry for `id`, or `undefined` for a custom/unknown kind. */
export function unitKind(id: string): UnitKindEntry | undefined {
  return KINDS.get(id);
}

/** Registry prefix entry for `id`, or `undefined` if it isn't an SI prefix. */
export function unitPrefix(id: string): UnitPrefixEntry | undefined {
  return PREFIXES.get(id);
}

/** Registry prefix with the given power-of-ten `scale`, if one exists. */
export function unitPrefixByScale(scale: number): UnitPrefixEntry | undefined {
  return PREFIX_BY_SCALE.get(scale);
}

/** Every registry kind id, in registry order. */
export function unitKindIds(): string[] {
  return [...KINDS.keys()];
}

const KIND_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Exact power of ten — `10 ** n` accumulates float error for negative `n`. */
function pow10(n: number): number {
  return Number(`1e${n}`);
}

function prefixScale(prefix: UnitPrefix | undefined): number {
  if (prefix === undefined) return 0;
  const entry = PREFIXES.get(prefix);
  if (entry === undefined) throw new Error(`unknown unit prefix "${prefix}"`);
  return entry.scale;
}

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

function superscript(n: number): string {
  return [...`${n}`].map((c) => SUPERSCRIPT[c] ?? c).join("");
}

/**
 * An immutable physical unit. Construction normalises the factors: one entry
 * per kind (exponents summed, mismatched prefixes folded into a single prefix
 * or the multiplier), zero exponents dropped, and a canonical order —
 * positive exponents first, then registry order, custom kinds last. Two units
 * written differently (`mol/l/s`, `mol/(l*s)`) therefore compare
 * {@link equals} and serialise identically.
 */
export class Unit {
  readonly factors: readonly UnitFactor[];
  readonly multiplier: number;

  constructor(factors: readonly UnitFactor[] = [], multiplier: number = 1) {
    if (!(multiplier > 0) || !Number.isFinite(multiplier)) {
      throw new Error(
        `unit multiplier must be a positive number, got ${multiplier}`,
      );
    }
    // Per kind: first-seen prefix, summed exponent, summed log10 scale.
    const byKind = new Map<
      string,
      { prefix?: UnitPrefix; exponent: number; logScale: number }
    >();
    for (const f of factors) {
      if (!KIND_ID.test(f.kind)) {
        throw new Error(`invalid unit kind "${f.kind}"`);
      }
      if (!Number.isInteger(f.exponent)) {
        throw new Error(
          `unit exponents must be integers, got ${f.exponent} for "${f.kind}"`,
        );
      }
      const scale = prefixScale(f.prefix) * f.exponent;
      const acc = byKind.get(f.kind);
      if (acc === undefined) {
        byKind.set(f.kind, {
          prefix: f.prefix,
          exponent: f.exponent,
          logScale: scale,
        });
      } else {
        acc.exponent += f.exponent;
        acc.logScale += scale;
      }
    }

    let residual = 0;
    const out: UnitFactor[] = [];
    for (const [kind, { prefix, exponent, logScale }] of byKind) {
      if (exponent === 0) {
        residual += logScale;
        continue;
      }
      let chosen = prefix;
      if (logScale !== prefixScale(prefix) * exponent) {
        // Mixed prefixes on one kind: use the prefix that carries the whole
        // scale exactly, else keep the first one and fold the rest away.
        if (logScale === 0) chosen = undefined;
        else chosen = PREFIX_BY_SCALE.get(logScale / exponent)?.id ?? prefix;
        residual += logScale - prefixScale(chosen) * exponent;
      }
      out.push(
        chosen === undefined
          ? { kind, exponent }
          : { kind, prefix: chosen, exponent },
      );
    }
    out.sort((a, b) => {
      const ka = [a.exponent < 0 ? 1 : 0, KIND_ORDER.get(a.kind) ?? Infinity];
      const kb = [b.exponent < 0 ? 1 : 0, KIND_ORDER.get(b.kind) ?? Infinity];
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    });
    this.factors = Object.freeze(out.map((f) => Object.freeze(f)));
    this.multiplier =
      residual === 0 ? multiplier : multiplier * pow10(residual);
  }

  /** The dimensionless unit (no factors). */
  static readonly dimensionless: Unit = new Unit();

  /** A single (optionally prefixed) kind, e.g. `Unit.of("mole", "milli")`. */
  static of(kind: string, prefix?: UnitPrefix, exponent: number = 1): Unit {
    return new Unit([
      prefix === undefined ? { kind, exponent } : { kind, prefix, exponent },
    ]);
  }

  /** Revive the `.mxl.json` form (does not check kinds — see {@link validate}). */
  static fromJson(json: UnitJson): Unit {
    return new Unit(json.factors, json.multiplier ?? 1);
  }

  get isDimensionless(): boolean {
    return this.factors.length === 0;
  }

  mul(other: Unit): Unit {
    return new Unit(
      [...this.factors, ...other.factors],
      this.multiplier * other.multiplier,
    );
  }

  div(other: Unit): Unit {
    return this.mul(other.pow(-1));
  }

  pow(n: number): Unit {
    if (!Number.isInteger(n)) {
      throw new Error(`unit exponents must be integers, got ${n}`);
    }
    return new Unit(
      this.factors.map((f) => ({ ...f, exponent: f.exponent * n })),
      this.multiplier ** n,
    );
  }

  /** Every kind id this unit uses. */
  kinds(): Set<string> {
    return new Set(this.factors.map((f) => f.kind));
  }

  /** Total numeric scale: multiplier times every prefix's contribution. */
  scale(): number {
    return (
      this.multiplier *
      pow10(
        this.factors.reduce(
          (acc, f) => acc + prefixScale(f.prefix) * f.exponent,
          0,
        ),
      )
    );
  }

  /**
   * Same kinds with the same exponents and the same overall scale — so
   * `mmol` equals `1e-3 · mol`, but not `mol`. Prefix placement doesn't
   * matter, matching how mxlpy compares sympy units.
   */
  equals(other: Unit): boolean {
    if (this.factors.length !== other.factors.length) return false;
    const exps = new Map(this.factors.map((f) => [f.kind, f.exponent]));
    for (const f of other.factors) {
      if (exps.get(f.kind) !== f.exponent) return false;
    }
    const a = this.scale();
    const b = other.scale();
    return Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
  }

  /**
   * Throws if any kind is neither in the registry nor declared in `customs`,
   * or if a custom kind shadows a registry id.
   */
  validate(customs: CustomUnits = new Map()): this {
    for (const kind of this.kinds()) {
      if (!KINDS.has(kind) && !customs.has(kind)) {
        throw new Error(
          `unknown unit kind "${kind}" — not in the shared registry and not declared as a custom unit`,
        );
      }
    }
    return this;
  }

  /** The `.mxl.json` form; `multiplier` is omitted when 1. */
  toJson(): UnitJson {
    const factors = this.factors.map((f) =>
      f.prefix === undefined
        ? { kind: f.kind, exponent: f.exponent }
        : { kind: f.kind, prefix: f.prefix, exponent: f.exponent },
    );
    return this.multiplier === 1
      ? { factors }
      : { factors, multiplier: this.multiplier };
  }

  private kindSymbol(kind: string, customs: CustomUnits): string {
    return KINDS.get(kind)?.symbol ?? customs.get(kind)?.symbol ?? kind;
  }

  private kindTex(kind: string, customs: CustomUnits): string {
    return (
      KINDS.get(kind)?.tex ??
      customs.get(kind)?.tex ??
      `\\mathrm{${kind.replace(/_/g, "\\_")}}`
    );
  }

  /** Plain-text rendering, e.g. `mmol·m⁻²·s⁻¹`; `1` when dimensionless. */
  toDisplay(customs: CustomUnits = new Map()): string {
    const parts = this.factors.map((f) => {
      const prefix =
        f.prefix === undefined ? "" : (PREFIXES.get(f.prefix)?.symbol ?? "");
      const exp = f.exponent === 1 ? "" : superscript(f.exponent);
      const sym = this.kindSymbol(f.kind, customs);
      // "mol Chl" style symbols need grouping before a prefix or exponent.
      const base = sym.includes(" ") && (prefix || exp) ? `(${sym})` : sym;
      return `${prefix}${base}${exp}`;
    });
    if (this.multiplier !== 1) parts.unshift(`${this.multiplier}`);
    return parts.length === 0 ? "1" : parts.join("·");
  }

  /** LaTeX rendering, e.g. `\mathrm{m}\mathrm{mol} \cdot \mathrm{m}^{-2}`. */
  toTex(customs: CustomUnits = new Map()): string {
    const parts = this.factors.map((f) => {
      let prefix = "";
      if (f.prefix !== undefined) {
        const sym = PREFIXES.get(f.prefix)?.symbol ?? "";
        prefix = sym === "µ" ? "\\mu" : `\\mathrm{${sym}}`;
      }
      const kind = this.kindTex(f.kind, customs);
      const base = prefix === "" ? kind : `{${prefix}${kind}}`;
      return f.exponent === 1 ? base : `${base}^{${f.exponent}}`;
    });
    if (this.multiplier !== 1) parts.unshift(`${this.multiplier}`);
    return parts.length === 0 ? "1" : parts.join(" \\cdot ");
  }

  /** {@link toDisplay} — so template interpolation shows something readable. */
  toString(): string {
    return this.toDisplay();
  }

  /**
   * A Python expression building this unit with sympy, for mxlpy:
   * registry kinds come from `sympy.physics.units` (imported as `su`, which
   * keeps `m`, `min` etc. from clashing with the generated module's own
   * names), kinds without a sympy equivalent and custom kinds become
   * `Quantity("<id>", abbrev="<abbrev>")` — mxlpy's own `unit_from_json`
   * builds the identical, equal-comparing objects. `None` when
   * dimensionless, matching mxlpy's convention. See {@link unitsPyImports}.
   */
  toPy(): string {
    if (this.isDimensionless) {
      return this.multiplier === 1 ? "None" : `${this.multiplier}`;
    }
    // A product/quotient at the top level (`**` doesn't count) needs parens
    // before it can be raised to a power or used as a lone denominator.
    const compound = (s: string) => /(^|[^*])[*/]([^*]|$)/.test(s);
    const group = (s: string) => (compound(s) ? `(${s})` : s);
    const term = (f: UnitFactor, exponent: number): string => {
      const entry = KINDS.get(f.kind);
      let base: string;
      if (entry?.sympy != null) {
        base = entry.sympy;
      } else {
        const abbrev = entry?.abbrev ?? f.kind;
        base = `Quantity(${JSON.stringify(f.kind)}, abbrev=${JSON.stringify(abbrev)})`;
      }
      // Quantity first: sympy collapses `prefix*quantity` into a plain
      // rational (`su.milli*su.mol` is `mole/1000`), while
      // `quantity*prefix` keeps the Prefix — mxlpy's own convention
      // (`mxlpy.units.mmol = mol * milli`), which its unit checks rely on.
      if (f.prefix !== undefined) base = `${group(base)}*su.${f.prefix}`;
      return exponent === 1 ? base : `${group(base)}**${exponent}`;
    };
    const num = this.factors
      .filter((f) => f.exponent > 0)
      .map((f) => term(f, f.exponent));
    const den = this.factors
      .filter((f) => f.exponent < 0)
      .map((f) => term(f, -f.exponent));
    if (this.multiplier !== 1) num.unshift(`${this.multiplier}`);
    const numerator = num.length === 0 ? "1" : num.join("*");
    if (den.length === 0) return numerator;
    return `${numerator}/${group(den.join("*"))}`;
  }

  /** TypeScript source reconstructing this unit (for `buildMxlweb`). */
  toTs(): string {
    return `Unit.fromJson(${JSON.stringify(this.toJson())})`;
  }

  /**
   * One SBML Level 3 `<unitDefinition>`. A kind with no SBML equivalent
   * (`mol_chl`, `celsius`, custom kinds) is written as `dimensionless` with an
   * explanatory comment — SBML cannot declare new base units. The unit's own
   * multiplier is folded into its first factor's per-unit multiplier.
   */
  toSBML(id: string): string {
    const units: string[] = [];
    let pending = this.multiplier;
    for (const f of this.factors) {
      const sbml = KINDS.get(f.kind)?.sbml ?? null;
      if (sbml === null) {
        units.push(
          `<!-- "${f.kind}" has no SBML equivalent -->\n          <unit kind="dimensionless" exponent="1" scale="0" multiplier="1"/>`,
        );
        continue;
      }
      // (m · 10^s · kind)^e: fold any outstanding multiplier M in as m·M^(1/e).
      const multiplier = sbml.multiplier * pending ** (1 / f.exponent);
      pending = 1;
      units.push(
        `<unit kind="${sbml.kind}" exponent="${f.exponent}" scale="${prefixScale(f.prefix)}" multiplier="${multiplier}"/>`,
      );
    }
    if (units.length === 0 || pending !== 1) {
      units.push(
        `<unit kind="dimensionless" exponent="1" scale="0" multiplier="${pending}"/>`,
      );
    }
    return `<unitDefinition id="${id}">
        <listOfUnits>
          ${units.join("\n          ")}
        </listOfUnits>
      </unitDefinition>`;
  }
}

/**
 * The Python import lines {@link Unit.toPy} output for `units` relies on —
 * empty when no unit is set.
 */
export function unitsPyImports(units: Iterable<Unit | undefined>): string[] {
  let su = false;
  let quantity = false;
  for (const u of units) {
    if (u === undefined) continue;
    const py = u.toPy();
    if (py.includes("su.")) su = true;
    if (py.includes("Quantity(")) quantity = true;
  }
  const lines: string[] = [];
  if (su) lines.push("import sympy.physics.units as su");
  if (quantity) {
    lines.push("from sympy.physics.units.quantities import Quantity");
  }
  return lines;
}
