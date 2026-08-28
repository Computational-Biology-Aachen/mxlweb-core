import {
  KineticModelBuilder,
  OdeModelBuilder,
  SteadyStateModelBuilder,
} from "@computational-biology-aachen/mxlweb-core";
import {
  Add,
  Mul,
  Name,
  Num,
} from "@computational-biology-aachen/mxlweb-core/mathml";
import { mxlJsonToModel } from "@computational-biology-aachen/mxlweb-core/mxl";
import { describe, expect, it } from "vitest";

// A minimal kinetic model with an assignment ("total", a real dynamics-feeding
// derived quantity) and a readout ("totalSquared", report-only, depending on
// the assignment) plus a second readout ("totalSquaredPlusOne") depending on
// the first readout — exercises both "readout depends on assignment" and
// "readout depends on readout".
function kineticWithReadouts(): KineticModelBuilder {
  return new KineticModelBuilder()
    .addParameter("k", { value: 0.3 })
    .addVariable("A", { value: 5 })
    .addVariable("B", { value: 1 })
    .addAssignment("total", { fn: new Add([new Name("A"), new Name("B")]) })
    .addReaction("r", {
      fn: new Mul([new Name("k"), new Name("total")]),
      stoichiometry: [
        { name: "A", value: new Num(-1) },
        { name: "B", value: new Num(1) },
      ],
    })
    .addReadout("totalSquared", {
      fn: new Mul([new Name("total"), new Name("total")]),
      displayName: "total squared",
    })
    .addReadout("totalSquaredPlusOne", {
      fn: new Add([new Name("totalSquared"), new Num(1)]),
    });
}

function odeWithReadouts(): OdeModelBuilder {
  return new OdeModelBuilder()
    .addParameter("k", { value: 0.3 })
    .addVariable("A", { value: 5 })
    .addAssignment("doubled", { fn: new Mul([new Num(2), new Name("A")]) })
    .setDifferential("A", new Mul([new Num(-1), new Name("k"), new Name("A")]))
    .addReadout("doubledPlusOne", {
      fn: new Add([new Name("doubled"), new Num(1)]),
    });
}

describe("readouts: CRUD and structural exclusion from dynamics", () => {
  it("KineticModelBuilder: add/update/remove", () => {
    const b = new KineticModelBuilder().addReadout("r1", { fn: new Num(1) });
    expect(b.readouts.get("r1")?.fn).toBeInstanceOf(Num);

    b.updateReadout("r1", { fn: new Num(2) });
    expect((b.readouts.get("r1")?.fn as Num).value).toBe(2);

    b.removeReadout("r1");
    expect(b.readouts.has("r1")).toBe(false);
  });

  it("OdeModelBuilder: add/update/remove", () => {
    const b = new OdeModelBuilder().addReadout("r1", { fn: new Num(1) });
    expect(b.readouts.get("r1")?.fn).toBeInstanceOf(Num);
    b.updateReadout("r1", { fn: new Num(2) });
    expect((b.readouts.get("r1")?.fn as Num).value).toBe(2);
    b.removeReadout("r1");
    expect(b.readouts.has("r1")).toBe(false);
  });

  it('rejects "time" as a readout key', () => {
    expect(() =>
      new KineticModelBuilder().addReadout("time", { fn: new Num(1) }),
    ).toThrow(/reserved/);
  });

  it("SteadyStateModelBuilder has no readout concept at all", () => {
    const b = new SteadyStateModelBuilder();
    expect("addReadout" in b).toBe(false);
    expect("readouts" in b).toBe(false);
    // The base-class default (no override) always sorts to an empty list.
    expect(b.sortReadoutDependencies()).toEqual([]);
  });

  it("a readout never appears in sortDependencies()/dxdt codegen", () => {
    const b = kineticWithReadouts();
    expect(b.sortDependencies()).not.toContain("totalSquared");
    expect(b.sortDependencies()).not.toContain("totalSquaredPlusOne");
    expect(b.buildJs()).not.toContain("totalSquared");
  });

  it("referencing a readout from an assignment fails (unresolved symbol) rather than silently feeding dynamics", () => {
    const b = new KineticModelBuilder()
      .addVariable("A", { value: 1 })
      .addReadout("ro", { fn: new Num(1) })
      .addAssignment("bad", { fn: new Name("ro") });
    // "bad" can never resolve — sortDependencies gives up on it instead of
    // silently pulling "ro" into the dynamics-feeding order.
    expect(b.sortDependencies()).not.toContain("bad");
  });
});

describe("readouts: dependency ordering", () => {
  it("orders a readout after the assignment/reaction it depends on, and a readout-on-readout after its readout", () => {
    const b = kineticWithReadouts();
    const order = b.sortReadoutDependencies();
    expect(order.indexOf("totalSquared")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("totalSquaredPlusOne")).toBeGreaterThan(
      order.indexOf("totalSquared"),
    );
  });

  it("ModelIR keeps readouts entirely separate from intermediates", () => {
    const ir = kineticWithReadouts().lower();
    expect(ir.intermediates.map((m) => m.name)).toEqual(["total", "r"]);
    expect(ir.readouts.map((m) => m.name)).toEqual([
      "totalSquared",
      "totalSquaredPlusOne",
    ]);
  });
});

describe("readouts: clone and getDisplayNames", () => {
  it("clone() preserves readouts independently of the original", () => {
    const b = kineticWithReadouts();
    const cl = b.clone();
    expect([...cl.readouts.keys()]).toEqual([...b.readouts.keys()]);
    cl.removeReadout("totalSquared");
    expect(b.readouts.has("totalSquared")).toBe(true);
    expect(cl.readouts.has("totalSquared")).toBe(false);
  });

  it("getDisplayNames() includes readout display names", () => {
    const names = kineticWithReadouts().getDisplayNames();
    expect(names.get("totalSquared")).toBe("total squared");
    expect(names.get("totalSquaredPlusOne")).toBe("totalSquaredPlusOne");
  });
});

describe("readouts: JS/Python derived-output codegen", () => {
  it("buildJsDerived exposes readouts as selectable outputs, computed after intermediates", () => {
    const b = kineticWithReadouts();
    const { allDerived, selectDerived } = b.buildJsDerived();
    const all = new Function(`return (${allDerived})`)();
    const select = new Function(`return (${selectDerived})`)();

    // A=5, B=1 -> total=6, totalSquared=36, totalSquaredPlusOne=37.
    const values = all(0, [5, 1], [0.3]);
    expect(values).toEqual([6, 0.3 * 6, 36, 37]);
    expect(select(values)).toEqual(values);
  });

  it("buildJsDerived can select just a readout by name", () => {
    const b = kineticWithReadouts();
    const { allDerived, selectDerived } = b.buildJsDerived(["totalSquared"]);
    const all = new Function(`return (${allDerived})`)();
    const select = new Function(`return (${selectDerived})`)();
    const values = all(0, [5, 1], [0.3]);
    expect(select(values)).toEqual([36]);
  });

  it("buildPython's model() RHS never references a readout; all_derived does", () => {
    const py = kineticWithReadouts().buildPython([]);
    const modelBody = py.slice(
      py.indexOf("def model("),
      py.indexOf("def all_derived("),
    );
    expect(modelBody).not.toMatch(/totalSquared/);
    const allDerivedBody = py.slice(py.indexOf("def all_derived("));
    expect(allDerivedBody).toMatch(/totalSquared/);
  });
});

describe("readouts: .mxl.json round-trip", () => {
  it("KineticModelBuilder: readouts serialise and round-trip through mxlJsonToModel", () => {
    const b = kineticWithReadouts();
    const doc = JSON.parse(b.buildMxlJson("demo"));
    expect(doc.model.readouts.totalSquared.fn.type).toBe("Mul");
    expect(doc.model.readouts.totalSquared.displayName).toBe("total squared");
    expect(doc.model.readouts.totalSquaredPlusOne.fn.type).toBe("Add");

    const revived = mxlJsonToModel(doc) as KineticModelBuilder;
    expect([...revived.readouts.keys()]).toEqual([
      "totalSquared",
      "totalSquaredPlusOne",
    ]);
    expect(revived.readouts.get("totalSquared")?.displayName).toBe(
      "total squared",
    );
  });

  it("OdeModelBuilder: readouts serialise and round-trip through mxlJsonToModel", () => {
    const b = odeWithReadouts();
    const doc = JSON.parse(b.buildMxlJson("demo"));
    expect(doc.model.readouts.doubledPlusOne.fn.type).toBe("Add");

    const revived = mxlJsonToModel(doc) as OdeModelBuilder;
    expect([...revived.readouts.keys()]).toEqual(["doubledPlusOne"]);
  });
});

describe("readouts: buildMxlweb round-trip", () => {
  it("emits an .addReadout(...) chain", () => {
    const src = kineticWithReadouts().buildMxlweb();
    expect(src).toContain('.addReadout("totalSquared"');
    expect(src).toContain('.addReadout("totalSquaredPlusOne"');
  });
});
