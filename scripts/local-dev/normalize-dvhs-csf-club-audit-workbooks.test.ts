import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import {
  applyWorkbookMapping,
  buildCanonicalWorkbook,
  clubNameFromFileName,
  draftWorkbookMapping,
  CANONICAL_HEADERS,
} from "./normalize-dvhs-csf-club-audit-workbooks";

// Synthetic, fictional data only — these mirror the SHAPES of observed club
// workbooks (junk header rows, combined names, mark-only attendance, agenda
// side sheets) but never their values.

function workbookFrom(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return workbook;
}

const explicitPointsWorkbook = workbookFrom({
  "csf pts list": [
    ["CSF audit list", "", "", "", "", ""],
    [
      "CSF audit list",
      "first name",
      "last name",
      "meeting 1 (September)",
      "meeting 2 (October)",
      "CSF Points earned",
    ],
    ["", "Avery", "Testperson", "True", "True", 2],
    ["", "Jordan", "Sampleton", "True", "", 1],
  ],
  Extra: [],
});

const markOnlyWorkbook = workbookFrom({
  Attendance: [
    ["Name", "Email", "9/18 Meeting 1", "10/2 Meeting 2", "11/6 Meeting 3"],
    ["Casey Fixture", "casey.fixture@example.org", "X", "X", ""],
    ["Robin Placeholder", "robin.placeholder@example.org", "X", "X", "X"],
  ],
  "Meeting Agendas": [
    ["Meeting Date", "Agenda"],
    ["9/18", "Interest meeting"],
  ],
});

describe("club name derivation", () => {
  test("strips audit/points/semester noise from filenames", () => {
    expect(
      clubNameFromFileName("Fictional Club CSF PTS AUDIT Fall 25.xlsx"),
    ).toBe("Fictional Club");
    expect(
      clubNameFromFileName(
        "Imaginary Society point tracker 2025-2026 Semester 1.xlsx",
      ),
    ).toBe("Imaginary Society");
  });
});

describe("draft pass", () => {
  test("finds the real header row past junk and keeps empty sheets off", () => {
    const mapping = draftWorkbookMapping(
      "Fictional Club CSF PTS AUDIT Fall 25.xlsx",
      explicitPointsWorkbook,
    );
    const main = mapping.sheets.find((sheet) => sheet.name === "csf pts list");
    expect(main).toBeDefined();
    expect(main!.rowCount).toBe(2);
    expect(main!.detectedColumns.firstName).toBe("first name");
    expect(main!.detectedColumns.points).toContain("CSF Points");
    const extra = mapping.sheets.find((sheet) => sheet.name === "Extra");
    expect(extra!.use).toBe(false);
  });

  test("suggests pointsPerMark when a sheet has no explicit points column", () => {
    const mapping = draftWorkbookMapping(
      "Imaginary Society Attendance.xlsx",
      markOnlyWorkbook,
    );
    const attendance = mapping.sheets.find(
      (sheet) => sheet.name === "Attendance",
    );
    expect(attendance!.detectedColumns.points).toBeUndefined();
    expect(attendance!.pointsPerMark).toBe(1);

    const explicit = draftWorkbookMapping(
      "Fictional Club CSF PTS AUDIT Fall 25.xlsx",
      explicitPointsWorkbook,
    ).sheets.find((sheet) => sheet.name === "csf pts list");
    expect(explicit!.pointsPerMark).toBeNull();
  });
});

describe("apply pass", () => {
  test("emits canonical rows with explicit points and provenance evidence", () => {
    const mapping = draftWorkbookMapping(
      "Fictional Club CSF PTS AUDIT Fall 25.xlsx",
      explicitPointsWorkbook,
    );
    for (const sheet of mapping.sheets) {
      sheet.use = sheet.name === "csf pts list";
    }
    const result = applyWorkbookMapping(explicitPointsWorkbook, mapping);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      firstName: "Avery",
      lastName: "Testperson",
      points: 2,
    });
    expect(result.rows[0].evidence).toContain("csf pts list");
    expect(result.skippedSheets).toContain("Extra");
  });

  test("derives points from marks via the reviewed pointsPerMark", () => {
    const mapping = draftWorkbookMapping(
      "Imaginary Society Attendance.xlsx",
      markOnlyWorkbook,
    );
    for (const sheet of mapping.sheets) {
      sheet.use = sheet.name === "Attendance";
      if (sheet.use) sheet.pointsPerMark = 2;
    }
    const result = applyWorkbookMapping(markOnlyWorkbook, mapping);
    const robin = result.rows.find((row) => row.firstName === "Robin");
    expect(robin?.points).toBe(6);
  });

  test("excluded row numbers are dropped and counted", () => {
    const mapping = draftWorkbookMapping(
      "Fictional Club CSF PTS AUDIT Fall 25.xlsx",
      explicitPointsWorkbook,
    );
    const main = mapping.sheets.find((sheet) => sheet.name === "csf pts list")!;
    main.use = true;
    main.excludeRowNumbers = [3];
    const result = applyWorkbookMapping(explicitPointsWorkbook, mapping);
    expect(result.droppedRows).toBe(1);
    expect(result.rows.map((row) => row.firstName)).toEqual(["Jordan"]);
  });

  test("the canonical workbook carries exactly the canonical headers", () => {
    const mapping = draftWorkbookMapping(
      "Fictional Club CSF PTS AUDIT Fall 25.xlsx",
      explicitPointsWorkbook,
    );
    const workbook = buildCanonicalWorkbook(
      applyWorkbookMapping(explicitPointsWorkbook, mapping),
    );
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["CSF Points"], {
      header: 1,
    }) as unknown[][];
    expect(rows[0]).toEqual([...CANONICAL_HEADERS]);
  });

  test("a future mapping version is refused instead of misread", () => {
    const mapping = draftWorkbookMapping(
      "Fictional Club CSF PTS AUDIT Fall 25.xlsx",
      explicitPointsWorkbook,
    );
    expect(() =>
      applyWorkbookMapping(explicitPointsWorkbook, {
        ...mapping,
        version: 2 as never,
      }),
    ).toThrow(/not supported/);
  });
});
