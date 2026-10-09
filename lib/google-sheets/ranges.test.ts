import { describe, expect, test } from "bun:test";

import {
  buildClearRange,
  buildStaleClearRanges,
  buildWriteRange,
  describeReportRangeOverflow,
  parseReportRange,
} from "./ranges";

const rowsOf = (rowCount: number, columnCount: number) =>
  Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => "x"),
  );

describe("bounded report ranges", () => {
  test("a report that fits is written inside the box", () => {
    expect(buildWriteRange("Member Hours", "A1:H20", rowsOf(20, 8))).toBe(
      "'Member Hours'!A1:H20",
    );
    expect(describeReportRangeOverflow("A1:H20", rowsOf(20, 8))).toBeNull();
  });

  test("a report with too many rows fails with the row counts", () => {
    const rows = rowsOf(101, 8);
    const message =
      "The report has 101 rows but the selected range A1:H20 holds 20. Widen the range or remove its end.";

    expect(describeReportRangeOverflow("A1:H20", rows)).toBe(message);
    // Nothing can build a write range past the box, whoever calls it.
    expect(() => buildWriteRange("Member Hours", "A1:H20", rows)).toThrow(
      message,
    );
  });

  test("a report with too many columns fails with the column counts", () => {
    expect(describeReportRangeOverflow("B2:D50", rowsOf(3, 9))).toBe(
      "The report has 9 columns but the selected range B2:D50 holds 3. Widen the range or remove its end.",
    );
  });

  test("the box is measured from its own start, not from A1", () => {
    expect(describeReportRangeOverflow("C5:E9", rowsOf(5, 3))).toBeNull();
    expect(describeReportRangeOverflow("C5:E9", rowsOf(6, 3))).toContain(
      "holds 5",
    );
  });

  test("stale cells are cleared only inside the box", () => {
    expect(
      buildStaleClearRanges("Member Hours", "A1:H20", rowsOf(3, 2)),
    ).toEqual(["'Member Hours'!C1:H3", "'Member Hours'!A4:H20"]);
    expect(buildClearRange("Member Hours", "A1:H20", rowsOf(3, 2))).toBe(
      "'Member Hours'!A1:H20",
    );
  });
});

describe("start-only report ranges", () => {
  test("the report grows from the anchor with no limit", () => {
    const rows = rowsOf(101, 8);
    expect(describeReportRangeOverflow("A1", rows)).toBeNull();
    expect(buildWriteRange("Member Hours", "A1", rows)).toBe(
      "'Member Hours'!A1:H101",
    );
    expect(buildWriteRange("Member Hours", "C3", rowsOf(2, 2))).toBe(
      "'Member Hours'!C3:D4",
    );
  });

  test("a missing or unreadable range falls back to the top-left cell", () => {
    for (const range of [null, undefined, "", "not a range", "A"]) {
      expect(describeReportRangeOverflow(range, rowsOf(500, 30))).toBeNull();
      expect(buildWriteRange("Member Hours", range, rowsOf(2, 2))).toBe(
        "'Member Hours'!A1:B2",
      );
    }
  });
});

describe("whole-column report ranges", () => {
  test("columns are bounded and rows are not", () => {
    expect(parseReportRange("A:H")).toEqual({
      tabName: null,
      startColumn: "A",
      startRow: 1,
      endColumn: "H",
      endRow: null,
      label: "A:H",
    });
    expect(describeReportRangeOverflow("A:H", rowsOf(5000, 8))).toBeNull();
    expect(buildWriteRange("Member Hours", "A:H", rowsOf(101, 8))).toBe(
      "'Member Hours'!A1:H101",
    );
  });

  test("a report wider than the columns fails", () => {
    expect(describeReportRangeOverflow("A:H", rowsOf(4, 9))).toBe(
      "The report has 9 columns but the selected range A:H holds 8. Widen the range or remove its end.",
    );
  });

  test("an open-ended range keeps its first row and clears only its columns", () => {
    expect(buildWriteRange("Member Hours", "B2:D", rowsOf(3, 3))).toBe(
      "'Member Hours'!B2:D4",
    );
    const stale = buildStaleClearRanges("Member Hours", "A:C", rowsOf(3, 2));
    expect(stale).toEqual(["'Member Hours'!C1:C3", "'Member Hours'!A4:C1000"]);
  });

  test("a tab named in the range is used and escaped", () => {
    expect(
      buildWriteRange("Member Hours", "'Bob''s tab'!A:B", rowsOf(1, 2)),
    ).toBe("'Bob''s tab'!A1:B1");
  });
});
