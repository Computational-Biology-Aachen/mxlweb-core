/**
 * Vendored copy of the canonical mxl-schemas unit registry (`v1/units.json`,
 * https://github.com/Computational-Biology-Aachen/mxl-schemas): the closed
 * vocabulary of unit kinds and SI prefixes shared with mxlpy
 * (`mxlpy.units.REGISTRY`). `unitRegistry.drift.test.ts` fails if this copy
 * diverges from upstream. Regenerate rather than hand-edit.
 *
 * @module
 */

/** One registry unit kind. `sympy` is an expression over `sympy.physics.units` (as `su`), or null for a kind built as `Quantity(id, abbrev=abbrev)`; `sbml` is null for kinds with no SBML equivalent. */
export type UnitKindEntry = {
  id: string;
  symbol: string;
  tex: string;
  sympy: string | null;
  abbrev?: string;
  sbml: { kind: string; multiplier: number } | null;
};

/** One SI prefix: `scale` is the power of ten. */
export type UnitPrefixEntry = { id: string; symbol: string; scale: number };

export const unitRegistry: {
  $comment: string;
  version: string;
  kinds: UnitKindEntry[];
  prefixes: UnitPrefixEntry[];
} = {
  $comment:
    "Canonical unit vocabulary for the mxl* tool family. A unit in a .mxl.json file is a list of factors {kind, prefix?, exponent}; every kind must be an id from `kinds` below or a custom unit declared in the model's own `units` section. `sympy` is an expression over `sympy.physics.units` (imported as `su`) or null, in which case consumers construct `Quantity(id, abbrev=abbrev)`. `sbml` maps the kind onto an SBML Level 3 UnitKind (with a multiplier for non-SI units such as minute); null means the kind has no SBML equivalent and is exported as dimensionless. Consumers vendor this file and must keep their copy in sync (drift tests).",
  version: "1.1",
  kinds: [
    {
      id: "ampere",
      symbol: "A",
      tex: "\\mathrm{A}",
      sympy: "su.ampere",
      sbml: {
        kind: "ampere",
        multiplier: 1,
      },
    },
    {
      id: "becquerel",
      symbol: "Bq",
      tex: "\\mathrm{Bq}",
      sympy: "su.becquerel",
      sbml: {
        kind: "becquerel",
        multiplier: 1,
      },
    },
    {
      id: "candela",
      symbol: "cd",
      tex: "\\mathrm{cd}",
      sympy: "su.candela",
      sbml: {
        kind: "candela",
        multiplier: 1,
      },
    },
    {
      id: "coulomb",
      symbol: "C",
      tex: "\\mathrm{C}",
      sympy: "su.coulomb",
      sbml: {
        kind: "coulomb",
        multiplier: 1,
      },
    },
    {
      id: "farad",
      symbol: "F",
      tex: "\\mathrm{F}",
      sympy: "su.farad",
      sbml: {
        kind: "farad",
        multiplier: 1,
      },
    },
    {
      id: "gram",
      symbol: "g",
      tex: "\\mathrm{g}",
      sympy: "su.gram",
      sbml: {
        kind: "gram",
        multiplier: 1,
      },
    },
    {
      id: "gray",
      symbol: "Gy",
      tex: "\\mathrm{Gy}",
      sympy: "su.gray",
      sbml: {
        kind: "gray",
        multiplier: 1,
      },
    },
    {
      id: "henry",
      symbol: "H",
      tex: "\\mathrm{H}",
      sympy: "su.henry",
      sbml: {
        kind: "henry",
        multiplier: 1,
      },
    },
    {
      id: "hertz",
      symbol: "Hz",
      tex: "\\mathrm{Hz}",
      sympy: "su.hertz",
      sbml: {
        kind: "hertz",
        multiplier: 1,
      },
    },
    {
      id: "item",
      symbol: "item",
      tex: "\\mathrm{item}",
      sympy: null,
      abbrev: "item",
      sbml: {
        kind: "item",
        multiplier: 1,
      },
    },
    {
      id: "joule",
      symbol: "J",
      tex: "\\mathrm{J}",
      sympy: "su.joule",
      sbml: {
        kind: "joule",
        multiplier: 1,
      },
    },
    {
      id: "katal",
      symbol: "kat",
      tex: "\\mathrm{kat}",
      sympy: "su.katal",
      sbml: {
        kind: "katal",
        multiplier: 1,
      },
    },
    {
      id: "kelvin",
      symbol: "K",
      tex: "\\mathrm{K}",
      sympy: "su.kelvin",
      sbml: {
        kind: "kelvin",
        multiplier: 1,
      },
    },
    {
      id: "litre",
      symbol: "L",
      tex: "\\mathrm{L}",
      sympy: "su.liter",
      sbml: {
        kind: "litre",
        multiplier: 1,
      },
    },
    {
      id: "lumen",
      symbol: "lm",
      tex: "\\mathrm{lm}",
      sympy: "su.candela*su.steradian",
      sbml: {
        kind: "lumen",
        multiplier: 1,
      },
    },
    {
      id: "lux",
      symbol: "lx",
      tex: "\\mathrm{lx}",
      sympy: "su.lux",
      sbml: {
        kind: "lux",
        multiplier: 1,
      },
    },
    {
      id: "metre",
      symbol: "m",
      tex: "\\mathrm{m}",
      sympy: "su.meter",
      sbml: {
        kind: "metre",
        multiplier: 1,
      },
    },
    {
      id: "mole",
      symbol: "mol",
      tex: "\\mathrm{mol}",
      sympy: "su.mol",
      sbml: {
        kind: "mole",
        multiplier: 1,
      },
    },
    {
      id: "newton",
      symbol: "N",
      tex: "\\mathrm{N}",
      sympy: "su.newton",
      sbml: {
        kind: "newton",
        multiplier: 1,
      },
    },
    {
      id: "ohm",
      symbol: "Ω",
      tex: "\\Omega",
      sympy: "su.ohm",
      sbml: {
        kind: "ohm",
        multiplier: 1,
      },
    },
    {
      id: "pascal",
      symbol: "Pa",
      tex: "\\mathrm{Pa}",
      sympy: "su.pascal",
      sbml: {
        kind: "pascal",
        multiplier: 1,
      },
    },
    {
      id: "radian",
      symbol: "rad",
      tex: "\\mathrm{rad}",
      sympy: "su.radian",
      sbml: {
        kind: "radian",
        multiplier: 1,
      },
    },
    {
      id: "second",
      symbol: "s",
      tex: "\\mathrm{s}",
      sympy: "su.second",
      sbml: {
        kind: "second",
        multiplier: 1,
      },
    },
    {
      id: "siemens",
      symbol: "S",
      tex: "\\mathrm{S}",
      sympy: "su.siemens",
      sbml: {
        kind: "siemens",
        multiplier: 1,
      },
    },
    {
      id: "sievert",
      symbol: "Sv",
      tex: "\\mathrm{Sv}",
      sympy: "su.joule/su.kilogram",
      sbml: {
        kind: "sievert",
        multiplier: 1,
      },
    },
    {
      id: "steradian",
      symbol: "sr",
      tex: "\\mathrm{sr}",
      sympy: "su.steradian",
      sbml: {
        kind: "steradian",
        multiplier: 1,
      },
    },
    {
      id: "tesla",
      symbol: "T",
      tex: "\\mathrm{T}",
      sympy: "su.tesla",
      sbml: {
        kind: "tesla",
        multiplier: 1,
      },
    },
    {
      id: "volt",
      symbol: "V",
      tex: "\\mathrm{V}",
      sympy: "su.volt",
      sbml: {
        kind: "volt",
        multiplier: 1,
      },
    },
    {
      id: "watt",
      symbol: "W",
      tex: "\\mathrm{W}",
      sympy: "su.watt",
      sbml: {
        kind: "watt",
        multiplier: 1,
      },
    },
    {
      id: "weber",
      symbol: "Wb",
      tex: "\\mathrm{Wb}",
      sympy: "su.weber",
      sbml: {
        kind: "weber",
        multiplier: 1,
      },
    },
    {
      id: "minute",
      symbol: "min",
      tex: "\\mathrm{min}",
      sympy: "su.minute",
      sbml: {
        kind: "second",
        multiplier: 60,
      },
    },
    {
      id: "hour",
      symbol: "h",
      tex: "\\mathrm{h}",
      sympy: "su.hour",
      sbml: {
        kind: "second",
        multiplier: 3600,
      },
    },
    {
      id: "celsius",
      symbol: "°C",
      tex: "{}^{\\circ}\\mathrm{C}",
      sympy: null,
      abbrev: "°C",
      sbml: null,
    },
    {
      id: "mol_chl",
      symbol: "mol Chl",
      tex: "\\mathrm{mol}_{\\mathrm{Chl}}",
      sympy: null,
      abbrev: "mol_chl",
      sbml: null,
    },
  ],
  prefixes: [
    {
      id: "yotta",
      symbol: "Y",
      scale: 24,
    },
    {
      id: "zetta",
      symbol: "Z",
      scale: 21,
    },
    {
      id: "exa",
      symbol: "E",
      scale: 18,
    },
    {
      id: "peta",
      symbol: "P",
      scale: 15,
    },
    {
      id: "tera",
      symbol: "T",
      scale: 12,
    },
    {
      id: "giga",
      symbol: "G",
      scale: 9,
    },
    {
      id: "mega",
      symbol: "M",
      scale: 6,
    },
    {
      id: "kilo",
      symbol: "k",
      scale: 3,
    },
    {
      id: "hecto",
      symbol: "h",
      scale: 2,
    },
    {
      id: "deca",
      symbol: "da",
      scale: 1,
    },
    {
      id: "deci",
      symbol: "d",
      scale: -1,
    },
    {
      id: "centi",
      symbol: "c",
      scale: -2,
    },
    {
      id: "milli",
      symbol: "m",
      scale: -3,
    },
    {
      id: "micro",
      symbol: "µ",
      scale: -6,
    },
    {
      id: "nano",
      symbol: "n",
      scale: -9,
    },
    {
      id: "pico",
      symbol: "p",
      scale: -12,
    },
    {
      id: "femto",
      symbol: "f",
      scale: -15,
    },
    {
      id: "atto",
      symbol: "a",
      scale: -18,
    },
    {
      id: "zepto",
      symbol: "z",
      scale: -21,
    },
    {
      id: "yocto",
      symbol: "y",
      scale: -24,
    },
  ],
};
