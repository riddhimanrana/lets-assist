import { describe, expect, test } from "bun:test";

import {
  buildRangeA1,
  parseSavedRange,
  type RangeFields,
} from "./sheet-sync-options";

const custom = (fields: Partial<RangeFields>): RangeFields => ({
  mode: "custom",
  startColumn: "A",
  startRow: "1",
  endColumn: "",
  endRow: "",
  ...fields,
});

describe("buildRangeA1", () => {
  test("the default destination is the start cell with no end", () => {
    expect(buildRangeA1(custom({ mode: "full" }))).toBe("A1");
    expect(buildRangeA1(custom({}))).toBe("A1");
    expect(buildRangeA1(custom({ startColumn: "B", startRow: "2" }))).toBe(
      "B2",
    );
  });

  test("an end counts only when both its column and row are set", () => {
    expect(buildRangeA1(custom({ endColumn: "H" }))).toBe("A1");
    expect(buildRangeA1(custom({ endRow: "40" }))).toBe("A1");
    expect(buildRangeA1(custom({ endColumn: "H", endRow: "40" }))).toBe(
      "A1:H40",
    );
  });

  test("an end never sits before the start cell", () => {
    expect(
      buildRangeA1(
        custom({
          startColumn: "D",
          startRow: "9",
          endColumn: "B",
          endRow: "3",
        }),
      ),
    ).toBe("D9:D9");
  });
});

describe("parseSavedRange", () => {
  test("a start cell alone has no end", () => {
    expect(parseSavedRange("A1")).toBeNull();
    expect(parseSavedRange("B2")).toEqual(
      custom({ startColumn: "B", startRow: "2" }),
    );
  });

  test("a bounded range keeps its end", () => {
    expect(parseSavedRange("B2:D20")).toEqual(
      custom({ startColumn: "B", startRow: "2", endColumn: "D", endRow: "20" }),
    );
    expect(parseSavedRange("A1:H21")).toEqual(
      custom({ endColumn: "H", endRow: "21" }),
    );
  });

  test("the old pre-filled range keeps its fields, so an untouched save stores the same value", () => {
    const fields = parseSavedRange("A1:H20");
    expect(fields).toEqual({
      mode: "custom",
      startColumn: "A",
      startRow: "1",
      endColumn: "H",
      endRow: "20",
    });
    expect(fields && buildRangeA1(fields)).toBe("A1:H20");
  });

  test("every saved range survives a round trip through the form", () => {
    for (const range of ["B2", "B2:D20", "A1:H21", "C5:E9"]) {
      const fields = parseSavedRange(range);
      expect(fields && buildRangeA1(fields)).toBe(range);
    }
  });
});
