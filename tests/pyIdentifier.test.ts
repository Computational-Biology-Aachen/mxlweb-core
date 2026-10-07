import {
  isPyIdentifier,
  PY_KEYWORDS,
  PY_RESERVED,
  pyIdentifierMap,
  toPyIdentifier,
  uniqueName,
} from "@computational-biology-aachen/mxlweb-core";
import { describe, expect, it } from "vitest";

const VALID = ["x", "_x", "x1", "X_Y", "__dunder__", "α", "kₘ", "Ångström"];
const SOFT_KEYWORDS = ["match", "case", "type", "_"];

const INVALID = [
  "",
  " ",
  "1abc",
  "9",
  "123",
  "1_000",
  "a b",
  " a",
  "a ",
  "a\tb",
  "a\nb",
  "a-b",
  "a.b",
  "a+b",
  "a*b",
  "a/b",
  'a"b',
  "a'b",
  "a(b)",
  "a[0]",
  "a,b",
  "a:b",
  "a=b",
  "a#b",
  "a\\b",
  "$x",
  "x$",
  "@x",
  "€",
  "🙂",
  "x🙂",
  "E. coli max. growth rate",
];

describe("isPyIdentifier", () => {
  it.each(VALID)("accepts %j", (s) => {
    expect(isPyIdentifier(s)).toBe(true);
  });

  it.each(SOFT_KEYWORDS)("accepts soft keyword %j", (s) => {
    expect(isPyIdentifier(s)).toBe(true);
  });

  it.each(INVALID)("rejects %j", (s) => {
    expect(isPyIdentifier(s)).toBe(false);
  });

  it.each([...PY_KEYWORDS])("rejects hard keyword %j", (s) => {
    expect(isPyIdentifier(s)).toBe(false);
  });

  it("is case-sensitive about keywords", () => {
    expect(isPyIdentifier("none")).toBe(true);
    expect(isPyIdentifier("Lambda")).toBe(true);
    expect(isPyIdentifier("DEF")).toBe(true);
  });

  it("applies NFKC like Python does (ligature ﬁ is a valid identifier)", () => {
    expect(isPyIdentifier("ﬁx")).toBe(true);
  });
});

describe("toPyIdentifier", () => {
  it.each([
    ["Species A", "Species_A"],
    ["E. coli max. growth rate", "E_coli_max_growth_rate"],
    ["first reaction", "first_reaction"],
    ["1abc", "_1abc"],
    ["123", "_123"],
    ["1st param", "_1st_param"],
    ["k-cat", "k_cat"],
    ["a  --  b", "a_b"],
    ["a.b.c", "a_b_c"],
    ['a"b', "a_b"],
    ["a'b", "a_b"],
    ["f(x)", "f_x"],
    ["a\tb\nc", "a_b_c"],
    ["  padded  ", "padded"],
    ["(x)", "x"],
    ["$x", "x"],
    ["x🙂", "x"],
    ["_ a", "__a"],
    ["lambda", "lambda_"],
    ["None", "None_"],
    ["class", "class_"],
    ["", "_"],
    [" ", "_"],
    ["!!!", "_"],
    ["🙂", "_"],
    ["ﬁ x", "fi_x"],
    ["Ångström rate", "Ångström_rate"],
  ])("%j -> %j", (raw, expected) => {
    expect(toPyIdentifier(raw)).toBe(expected);
  });

  it.each([...VALID, ...SOFT_KEYWORDS])(
    "leaves valid identifier %j unchanged",
    (s) => {
      expect(toPyIdentifier(s)).toBe(s);
    },
  );

  it.each([...INVALID, ...PY_KEYWORDS])(
    "always produces a valid identifier for %j",
    (raw) => {
      expect(isPyIdentifier(toPyIdentifier(raw))).toBe(true);
    },
  );
});

describe("uniqueName", () => {
  it("returns the base when free and claims it", () => {
    const taken = new Set<string>();
    expect(uniqueName("x", taken)).toBe("x");
    expect(taken.has("x")).toBe(true);
  });

  it("suffixes _2, _3, ... on collision", () => {
    const taken = new Set(["x", "x_2"]);
    expect(uniqueName("x", taken)).toBe("x_3");
    expect(uniqueName("x", taken)).toBe("x_4");
  });

  it("compares NFKC-normalized", () => {
    expect(uniqueName("ﬁ", new Set(["fi"]))).toBe("ﬁ_2");
  });
});

describe("pyIdentifierMap", () => {
  const values = (m: Map<string, string>) => [...m.values()];

  it("keeps valid names and converts invalid ones", () => {
    const m = pyIdentifierMap([
      ["a", "Species A"],
      ["b", "k"],
      ["c", "1st"],
    ]);
    expect(m).toEqual(
      new Map([
        ["a", "Species_A"],
        ["b", "k"],
        ["c", "_1st"],
      ]),
    );
  });

  it("preserves entry order", () => {
    const m = pyIdentifierMap([
      ["z", "a b"],
      ["y", "c"],
    ]);
    expect([...m.keys()]).toEqual(["z", "y"]);
  });

  it.each([
    [
      "converted first",
      [
        ["p", "a b"],
        ["q", "a_b"],
      ],
    ],
    [
      "valid first",
      [
        ["q", "a_b"],
        ["p", "a b"],
      ],
    ],
  ] as [string, [string, string][]][])(
    "a valid name keeps its spelling over a converted one (%s)",
    (_, entries) => {
      const m = pyIdentifierMap(entries);
      expect(m.get("q")).toBe("a_b");
      expect(m.get("p")).toBe("a_b_2");
    },
  );

  it("suffixes several names that convert to the same identifier", () => {
    const m = pyIdentifierMap([
      ["a", "x y"],
      ["b", "x-y"],
      ["c", "x.y"],
    ]);
    expect(values(m)).toEqual(["x_y", "x_y_2", "x_y_3"]);
  });

  it("skips a suffix already claimed by a valid name", () => {
    const m = pyIdentifierMap([
      ["a", "x y"],
      ["b", "x-y"],
      ["c", "x_y"],
      ["d", "x_y_2"],
    ]);
    expect(m).toEqual(
      new Map([
        ["a", "x_y_3"],
        ["b", "x_y_4"],
        ["c", "x_y"],
        ["d", "x_y_2"],
      ]),
    );
  });

  it("deduplicates identical valid names, first one wins", () => {
    const m = pyIdentifierMap([
      ["a", "rate"],
      ["b", "rate"],
      ["c", "rate"],
    ]);
    expect(values(m)).toEqual(["rate", "rate_2", "rate_3"]);
  });

  it.each([...PY_RESERVED])("never produces reserved name %j", (r) => {
    const m = pyIdentifierMap([["a", r]]);
    expect(m.get("a")).toBe(`${r}_2`);
  });

  it("treats NFKC-equivalent names as duplicates", () => {
    const m = pyIdentifierMap([
      ["a", "fi"],
      ["b", "ﬁ"],
    ]);
    expect(m.get("a")).toBe("fi");
    expect(m.get("b")).toBe("ﬁ_2");
  });

  it("accepts a custom reserved set", () => {
    const m = pyIdentifierMap([["a", "foo"]], new Set(["foo"]));
    expect(m.get("a")).toBe("foo_2");
  });

  it("always yields unique, valid identifiers", () => {
    const raws = [...INVALID, ...PY_KEYWORDS, ...VALID, ...PY_RESERVED];
    const entries = [...raws, ...raws].map((raw, i): [string, string] => [
      `id${i}`,
      raw,
    ]);
    const out = values(pyIdentifierMap(entries));
    expect(out).toHaveLength(entries.length);
    for (const name of out) expect(isPyIdentifier(name)).toBe(true);
    const normalized = out.map((n) => n.normalize("NFKC"));
    expect(new Set(normalized).size).toBe(normalized.length);
    for (const r of PY_RESERVED) expect(normalized).not.toContain(r);
  });
});
