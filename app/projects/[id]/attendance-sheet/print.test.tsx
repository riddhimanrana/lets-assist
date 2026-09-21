import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintableAttendanceSheets } from "./PrintableAttendanceSheets";
import {
  paginateAttendanceRows,
  type AttendancePrintSheet,
} from "@/lib/attendance/print-types";

const sheet: AttendancePrintSheet = {
  sheetReference: "11111111-1111-4111-8111-111111111111",
  projectTitle: "Park <cleanup>",
  sessionLabel: "Morning session",
  timezone: "America/Los_Angeles",
  startsAt: "2026-09-20T17:00:00Z",
  endsAt: "2026-09-20T19:00:00Z",
  rows: Array.from({ length: 25 }, (_, index) => ({
    rowReference: index.toString(16).padStart(12, "0"),
    rowNumber: index + 1,
    rowKind: index < 11 ? "signup" : index < 21 ? "walk_in" : "continuation",
    name: index < 11 ? `Volunteer ${index + 1}` : "",
  })),
};

describe("printable attendance sheets", () => {
  test("pagination preserves each stable row reference once and keeps pages bounded", () => {
    const pages = paginateAttendanceRows(sheet.rows);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(sheet.rows);
    expect(paginateAttendanceRows([])).toEqual([[]]);
  });
  test("each page identifies its sheet, session, timezone, date, and page count", () => {
    const html = renderToStaticMarkup(
      <PrintableAttendanceSheets sheets={[sheet]} />,
    );
    for (const text of [
      sheet.sheetReference,
      "Morning session",
      "America/Los_Angeles",
      "In 1",
      "Out 1",
      "In 2",
      "Out 2",
    ]) {
      expect(html.split(text).length - 1).toBe(3);
    }
    expect(html.split("Sep 20, 2026").length - 1).toBe(6);
    expect(html).toContain("Page 1 of 3");
    expect(html).toContain("Page 3 of 3");
    expect(html).toContain("Park &lt;cleanup&gt;");
  });
  test("walk-ins have blank name/email fields and continuation rows ask for the source row", () => {
    const html = renderToStaticMarkup(
      <PrintableAttendanceSheets sheets={[sheet]} />,
    );
    expect(html.split("Email:").length - 1).toBe(10);
    expect(html.split("Continuation for row:").length - 1).toBe(4);
    expect(html).not.toContain("@local.test");
    expect(html).not.toContain("Phone");
    expect(html).not.toContain("signup_id");
    for (const row of sheet.rows)
      expect(html.split(row.rowReference).length - 1).toBe(1);
  });
  test("the print stylesheet repeats column headings and prevents split rows", async () => {
    const css = await Bun.file(new URL("./print.css", import.meta.url)).text();
    expect(css).toContain("display: table-header-group");
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain("break-after: page");
  });
});
