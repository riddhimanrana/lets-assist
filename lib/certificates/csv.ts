import { neutralizeSpreadsheetFormula } from "@/lib/organization/report-output-safety";

/**
 * The text a value is exported as, safe to open in a spreadsheet.
 *
 * A value a spreadsheet would read as a formula (one that starts with =, +, -,
 * or @, after any whitespace or control characters) gets a leading apostrophe.
 * A value that itself starts with an apostrophe gets one more, so the exported
 * text always says which case it was: "=A1" becomes "'=A1" and "'=A1" becomes
 * "''=A1". Every other value is exported unchanged.
 *
 * The checker compares an uploaded cell with this encoding of the recorded
 * value. Nothing decodes it, so the guard is never stripped from a cell.
 */
export function encodeCsvField(value: string): string {
  return value.trimStart().startsWith("'")
    ? `'${value}`
    : neutralizeSpreadsheetFormula(value);
}

/**
 * The CSV format shared by the certificate export and the certificate checker.
 *
 * Written as RFC 4180: every field is quoted, a quote inside a field is
 * doubled, and records end with CRLF. A field may therefore hold commas,
 * quotes, and line breaks and still read back as it was written. Each field is
 * first passed through encodeCsvField.
 */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((field) => `"${encodeCsvField(field).replace(/"/gu, '""')}"`)
        .join(","),
    )
    .join("\r\n");
}

/**
 * The Certificate Type cell for a stored certificate type. A missing type and
 * the legacy name "verified" are both platform certificates, the same alias
 * the verification lookup and the checker apply. Any other value, including
 * one this code does not know, is exported as self-reported so it is never
 * given platform standing by default.
 */
export function certificateExportType(
  storedType: string | null | undefined,
): "platform" | "self-reported" {
  return !storedType || storedType === "platform" || storedType === "verified"
    ? "platform"
    : "self-reported";
}

/**
 * Reads CSV text into records of fields, without trimming or altering them.
 * A protective apostrophe written by encodeCsvField is part of the field.
 *
 * Records may end with CRLF, LF, or CR, and a leading byte order mark and
 * blank lines are skipped. Exports made before quotes were escaped wrapped
 * each field in quotes and left inner quotes as they were; a quote inside a
 * quoted field that is not doubled and not followed by a delimiter is kept as
 * a literal quote, which reads most of those files back as written. RFC 4180
 * text never contains such a quote, so this does not change how it is read.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  let recordOpen = false;

  const endField = () => {
    record.push(field);
    field = "";
    atFieldStart = true;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    recordOpen = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (next === '"') {
        field += '"';
        index += 1;
      } else if (
        next === undefined ||
        next === "," ||
        next === "\n" ||
        next === "\r"
      ) {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      recordOpen = true;
    } else if (char === ",") {
      endField();
      recordOpen = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") index += 1;
      if (recordOpen) endRecord();
    } else {
      field += char;
      atFieldStart = false;
      recordOpen = true;
    }
  }

  if (recordOpen) endRecord();
  return records;
}
