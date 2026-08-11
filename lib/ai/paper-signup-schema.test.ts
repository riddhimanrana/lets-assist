import { describe, expect, test } from "bun:test";

import {
  paperSignupExtractionSchema,
  shouldEscalatePaperScan,
  type PaperSignupExtraction,
  type PaperSignupRow,
} from "./paper-signup-schema";

function row(overrides: Partial<PaperSignupRow> = {}): PaperSignupRow {
  return {
    sheetRowNumber: 1,
    name: { value: "Jane Doe", confidence: 0.95 },
    email: { value: "jane@example.com", confidence: 0.9 },
    phone: { value: null, confidence: 0 },
    timeIn: { value: "9am", confidence: 0.8 },
    timeOut: { value: "12:00", confidence: 0.8 },
    signaturePresent: true,
    rowConfidence: 0.9,
    ...overrides,
  };
}

function extraction(
  overrides: Partial<PaperSignupExtraction> = {},
): PaperSignupExtraction {
  return {
    sheetLegible: true,
    detectedColumns: ["Name", "Email", "Time in", "Time out", "Signature"],
    rows: [row()],
    ...overrides,
  };
}

describe("paperSignupExtractionSchema", () => {
  test("accepts a well-formed payload", () => {
    const parsed = paperSignupExtractionSchema.safeParse(extraction());
    expect(parsed.success).toBe(true);
  });

  test("accepts a null value with confidence 0", () => {
    const parsed = paperSignupExtractionSchema.safeParse(
      extraction({ rows: [row({ email: { value: null, confidence: 0 } })] }),
    );
    expect(parsed.success).toBe(true);
  });

  test("rejects out-of-range confidence", () => {
    const parsed = paperSignupExtractionSchema.safeParse(
      extraction({
        rows: [row({ name: { value: "Jane", confidence: 1.4 } })],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  test("rejects sheetRowNumber below 1", () => {
    const parsed = paperSignupExtractionSchema.safeParse(
      extraction({ rows: [row({ sheetRowNumber: 0 })] }),
    );
    expect(parsed.success).toBe(false);
  });

  test("rejects more than 60 rows per image", () => {
    const rows = Array.from({ length: 61 }, (_, index) =>
      row({ sheetRowNumber: index + 1 }),
    );
    const parsed = paperSignupExtractionSchema.safeParse(extraction({ rows }));
    expect(parsed.success).toBe(false);
  });
});

describe("shouldEscalatePaperScan", () => {
  test("does not escalate a clean sheet", () => {
    expect(shouldEscalatePaperScan(extraction())).toBe(false);
  });

  test("escalates an illegible sheet", () => {
    expect(shouldEscalatePaperScan(extraction({ sheetLegible: false }))).toBe(
      true,
    );
  });

  test("escalates when no rows were found", () => {
    expect(shouldEscalatePaperScan(extraction({ rows: [] }))).toBe(true);
  });

  test("escalates when more than a quarter of rows are low confidence", () => {
    const rows = [
      row({ sheetRowNumber: 1, rowConfidence: 0.5 }),
      row({ sheetRowNumber: 2, rowConfidence: 0.6 }),
      row({ sheetRowNumber: 3 }),
      row({ sheetRowNumber: 4 }),
    ];
    expect(shouldEscalatePaperScan(extraction({ rows }))).toBe(true);
  });

  test("does not escalate when exactly a quarter of rows are low confidence", () => {
    const rows = [
      row({ sheetRowNumber: 1, rowConfidence: 0.5 }),
      row({ sheetRowNumber: 2 }),
      row({ sheetRowNumber: 3 }),
      row({ sheetRowNumber: 4 }),
    ];
    expect(shouldEscalatePaperScan(extraction({ rows }))).toBe(false);
  });

  test("escalates on a single low-confidence name", () => {
    const rows = [
      row({ sheetRowNumber: 1, name: { value: "J?", confidence: 0.5 } }),
    ];
    expect(shouldEscalatePaperScan(extraction({ rows }))).toBe(true);
  });

  test("escalates on a low-confidence non-null email", () => {
    const rows = [
      row({
        sheetRowNumber: 1,
        email: { value: "j@ex.com", confidence: 0.4 },
      }),
    ];
    expect(shouldEscalatePaperScan(extraction({ rows }))).toBe(true);
  });

  test("does not escalate on a low-confidence phone alone", () => {
    const rows = [
      row({ sheetRowNumber: 1, phone: { value: "555", confidence: 0.2 } }),
    ];
    expect(shouldEscalatePaperScan(extraction({ rows }))).toBe(false);
  });

  test("does not escalate on a null email with confidence 0", () => {
    const rows = [
      row({ sheetRowNumber: 1, email: { value: null, confidence: 0 } }),
    ];
    expect(shouldEscalatePaperScan(extraction({ rows }))).toBe(false);
  });
});
