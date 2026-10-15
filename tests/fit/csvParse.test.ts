import { describe, expect, it } from "vitest";
import { parseCsvFile, UNNAMED_COLUMN } from "../../src/fit/csvParse";

describe("parseCsvFile", () => {
  it("names an empty header (pandas' unnamed index column) instead of leaving it falsy", async () => {
    const csv = await parseCsvFile(",A,B\n0.0,1,2\n0.1,3,4\n");
    expect(csv.headers).toEqual([UNNAMED_COLUMN, "A", "B"]);
    expect(csv.columns[UNNAMED_COLUMN]).toEqual([0, 0.1]);
    expect(csv.rowCount).toBe(2);
  });

  it("keeps ordinary headers untouched", async () => {
    const csv = await parseCsvFile("time,A\n0,1\n");
    expect(csv.headers).toEqual(["time", "A"]);
  });
});
