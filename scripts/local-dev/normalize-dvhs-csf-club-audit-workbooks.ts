#!/usr/bin/env bun

/**
 * Normalize messy per-club CSF audit workbooks into canonical uploads.
 *
 * Every partner club invents its own spreadsheet shape (see
 * docs/csf/source-data.md). This tool turns each one into a canonical
 * partner-audit workbook the in-app Sheets workspace accepts, in two explicit
 * passes so a HUMAN approves every column decision before anything canonical
 * exists:
 *
 *   1. DRAFT  — `bun run csf:normalize:legacy [files...]`
 *      Runs the same fuzzy detection the upload parser uses and writes an
 *      editable `<file>.mapping.json` under `.artifacts/legacy-csf/mappings/`.
 *      Nothing else is produced. The draft may be machine-assisted; it is only
 *      a draft on disk.
 *
 *   2. APPLY  — `bun run csf:normalize:legacy --apply [files...]`
 *      Reads the reviewed mapping next to each workbook and emits a canonical
 *      workbook under `.artifacts/legacy-csf/normalized/`. Sheets with
 *      `use: false` are skipped; excluded row numbers are dropped;
 *      `pointsPerMark` fills points for sheets that only track attendance.
 *
 * The tool NEVER touches the database. Officers upload the normalized files
 * through the existing preview → commit fence, which is where staff approval
 * and matching live. Inputs default to `$CSF_SOURCE_DATA_DIR/clubs` and
 * outputs always land in git-ignored `.artifacts/legacy-csf/`.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import {
  parseCsfPartnerAuditValues,
  type CsfPartnerAuditParsedSheet,
} from "../../lib/plugins/private/plugins/dvhs-csf/services/partner-audit";

export const MAPPING_VERSION = 1;
export const CANONICAL_HEADERS = [
  "First Name",
  "Last Name",
  "Grade",
  "Email",
  "CSF Points",
  "Evidence",
] as const;

export type SheetMappingDraft = {
  name: string;
  /** Reviewed by a human: only `use: true` sheets produce canonical rows. */
  use: boolean;
  headerRowNumber: number | null;
  detectedColumns: Record<string, string | undefined>;
  rowCount: number;
  rowsMissingPoints: number;
  warningsSample: string[];
  /** 1-based source row numbers to drop (junk/legend rows). */
  excludeRowNumbers: number[];
  /** Points per attendance mark when the sheet has no points column. */
  pointsPerMark: number | null;
  skippedReason?: string;
};

export type WorkbookMapping = {
  version: typeof MAPPING_VERSION;
  sourceFile: string;
  clubName: string;
  notes: string;
  sheets: SheetMappingDraft[];
};

export function clubNameFromFileName(fileName: string): string {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(
      /\b(csf|pts?|points?|audit(s)?|attendance|tracker|form|responses)\b/gi,
      " ",
    )
    .replace(
      /\b(20\d{2}(-20?\d{2})?|\d{2}-\d{2}|fall|spring|sem(ester)?\s*\d?|\d{2})\b/gi,
      " ",
    )
    .replace(/[_()]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
    .trim();
}

/** Fall back to the raw basename when cleanup eats the whole filename. */
export function clubNameOrBasename(fileName: string): string {
  const cleaned = clubNameFromFileName(fileName);
  return cleaned.length >= 2
    ? cleaned
    : path.basename(fileName, path.extname(fileName));
}

export function workbookRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[][];
}

export function draftWorkbookMapping(
  fileName: string,
  workbook: XLSX.WorkBook,
): WorkbookMapping {
  const sheets: SheetMappingDraft[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = workbookRows(workbook, sheetName);
    const parsed: CsfPartnerAuditParsedSheet | null =
      rows.length === 0 ? null : parseCsfPartnerAuditValues(sheetName, rows);
    if (!parsed || parsed.rows.length === 0) {
      sheets.push({
        name: sheetName,
        use: false,
        headerRowNumber: null,
        detectedColumns: {},
        rowCount: 0,
        rowsMissingPoints: 0,
        warningsSample: [],
        excludeRowNumbers: [],
        pointsPerMark: null,
        skippedReason:
          rows.length === 0
            ? "Sheet is empty."
            : "No member rows were detected; review manually if this sheet matters.",
      });
      continue;
    }
    const rowsMissingPoints = parsed.rows.filter(
      (row) => row.claimedPoints === null,
    ).length;
    // With no explicit points column the parser reports raw mark COUNTS as
    // claimed points; the reviewed pointsPerMark multiplier converts marks to
    // points during apply (many clubs award 2 points per event).
    const hasPointsColumn = parsed.detectedColumns.points !== undefined;
    sheets.push({
      name: sheetName,
      // Drafted, not decided: a human flips this during review.
      use: parsed.rows.length >= 3,
      headerRowNumber: parsed.headerRowNumber,
      detectedColumns: Object.fromEntries(
        Object.entries(parsed.detectedColumns).filter(
          ([, header]) => header !== undefined,
        ),
      ),
      rowCount: parsed.rows.length,
      rowsMissingPoints,
      warningsSample: [
        ...new Set(parsed.rows.flatMap((row) => row.warnings)),
      ].slice(0, 5),
      excludeRowNumbers: [],
      pointsPerMark: hasPointsColumn ? null : 1,
    });
  }

  return {
    version: MAPPING_VERSION,
    sourceFile: fileName,
    clubName: clubNameOrBasename(fileName),
    notes:
      "Review every sheet: set use/excludeRowNumbers/pointsPerMark, correct clubName, then run with --apply.",
    sheets,
  };
}

export type NormalizedRow = {
  firstName: string;
  lastName: string;
  grade: string;
  email: string;
  points: number | null;
  evidence: string;
};

export type ApplyResult = {
  clubName: string;
  rows: NormalizedRow[];
  skippedSheets: string[];
  droppedRows: number;
};

export function applyWorkbookMapping(
  workbook: XLSX.WorkBook,
  mapping: WorkbookMapping,
): ApplyResult {
  if (mapping.version !== MAPPING_VERSION) {
    throw new Error(
      `Mapping version ${mapping.version} is not supported; re-run the draft pass.`,
    );
  }
  const rows: NormalizedRow[] = [];
  const skippedSheets: string[] = [];
  let droppedRows = 0;

  for (const sheetMapping of mapping.sheets) {
    if (!sheetMapping.use) {
      skippedSheets.push(sheetMapping.name);
      continue;
    }
    const parsed = parseCsfPartnerAuditValues(
      sheetMapping.name,
      workbookRows(workbook, sheetMapping.name),
    );
    if (!parsed) {
      skippedSheets.push(sheetMapping.name);
      continue;
    }
    const excluded = new Set(sheetMapping.excludeRowNumbers);
    const hasPointsColumn = parsed.detectedColumns.points !== undefined;
    for (const row of parsed.rows) {
      if (excluded.has(row.rowNumber)) {
        droppedRows += 1;
        continue;
      }
      const markCount = Number(
        /(\d+) attendance\/event mark/.exec(row.evidenceSummary ?? "")?.[1] ??
          0,
      );
      // Explicit points column wins. Otherwise the parser's claimed value is a
      // raw mark COUNT, which the reviewed multiplier converts to points.
      const points = hasPointsColumn
        ? row.claimedPoints
        : sheetMapping.pointsPerMark !== null && markCount > 0
          ? markCount * sheetMapping.pointsPerMark
          : row.claimedPoints;
      rows.push({
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        grade: row.grade === null ? "" : String(row.grade),
        email: row.email ?? "",
        points,
        evidence: [
          `${mapping.sourceFile} • ${sheetMapping.name} • row ${row.rowNumber}`,
          row.evidenceSummary ?? "",
        ]
          .filter(Boolean)
          .join(" — "),
      });
    }
  }

  return { clubName: mapping.clubName, rows, skippedSheets, droppedRows };
}

export function buildCanonicalWorkbook(result: ApplyResult): XLSX.WorkBook {
  const sheetRows: unknown[][] = [
    [...CANONICAL_HEADERS],
    ...result.rows.map((row) => [
      row.firstName,
      row.lastName,
      row.grade,
      row.email,
      row.points ?? "",
      row.evidence,
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(sheetRows),
    "CSF Points",
  );
  return workbook;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ARTIFACT_ROOT = path.resolve(".artifacts/legacy-csf");

function defaultInputFiles(): string[] {
  const sourceRoot = path.resolve(
    process.env.CSF_SOURCE_DATA_DIR ?? "docs/csf/source-data",
    "clubs",
  );
  if (!existsSync(sourceRoot)) return [];
  return [...new Bun.Glob("*.{xlsx,xls}").scanSync({ cwd: sourceRoot })].map(
    (file) => path.join(sourceRoot, file),
  );
}

function mappingPathFor(fileName: string): string {
  return path.join(ARTIFACT_ROOT, "mappings", `${fileName}.mapping.json`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const files = args.filter((arg) => arg !== "--apply");
  const inputs = files.length > 0 ? files : defaultInputFiles();
  if (inputs.length === 0) {
    throw new Error(
      "No input workbooks. Pass paths or place files under $CSF_SOURCE_DATA_DIR/clubs.",
    );
  }

  mkdirSync(path.join(ARTIFACT_ROOT, "mappings"), { recursive: true });
  mkdirSync(path.join(ARTIFACT_ROOT, "normalized"), { recursive: true });

  const report: unknown[] = [];
  for (const filePath of inputs) {
    const fileName = path.basename(filePath);
    const workbook = XLSX.read(
      Buffer.from(await Bun.file(filePath).arrayBuffer()),
      { type: "buffer", raw: false, dense: true, cellDates: false },
    );

    if (!apply) {
      const mapping = draftWorkbookMapping(fileName, workbook);
      writeFileSync(
        mappingPathFor(fileName),
        `${JSON.stringify(mapping, null, 2)}\n`,
      );
      report.push({
        file: fileName,
        pass: "draft",
        mapping: mappingPathFor(fileName),
        sheets: mapping.sheets.map((sheet) => ({
          name: sheet.name,
          use: sheet.use,
          rows: sheet.rowCount,
          missingPoints: sheet.rowsMissingPoints,
        })),
      });
      continue;
    }

    const mappingPath = mappingPathFor(fileName);
    if (!existsSync(mappingPath)) {
      throw new Error(
        `No reviewed mapping at ${mappingPath}. Run the draft pass and review it first.`,
      );
    }
    const mapping = JSON.parse(
      readFileSync(mappingPath, "utf8"),
    ) as WorkbookMapping;
    const result = applyWorkbookMapping(workbook, mapping);
    const outputPath = path.join(
      ARTIFACT_ROOT,
      "normalized",
      `${mapping.clubName.replaceAll(/[^A-Za-z0-9 _-]/g, "").trim() || "club"} — normalized.xlsx`,
    );
    writeFileSync(
      outputPath,
      XLSX.write(buildCanonicalWorkbook(result), {
        type: "buffer",
        bookType: "xlsx",
      }) as Buffer,
    );
    report.push({
      file: fileName,
      pass: "apply",
      output: outputPath,
      club: result.clubName,
      rows: result.rows.length,
      rowsWithoutPoints: result.rows.filter((row) => row.points === null)
        .length,
      droppedRows: result.droppedRows,
      skippedSheets: result.skippedSheets,
    });
  }

  console.log(JSON.stringify({ ok: true, files: report }, null, 2));
}

if (import.meta.main) {
  await main();
}
