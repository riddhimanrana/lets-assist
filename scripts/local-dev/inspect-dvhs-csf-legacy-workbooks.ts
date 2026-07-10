#!/usr/bin/env bun

import path from "node:path";
import * as XLSX from "xlsx";

import { parseCsfMeetingAttendanceRows } from "../../lib/plugins/private/plugins/dvhs-csf/services/meeting-attendance";
import { parseCsfPartnerFormResponsesWorkbook } from "../../lib/plugins/private/plugins/dvhs-csf/services/partner-audit";
import { parseCsfSheetRows, summarizeCsfParsedRows, type CsfSheetCell } from "../../lib/plugins/private/plugins/dvhs-csf/services/sheet-import";

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error("Pass one or more legacy CSF .xlsx/.xls/.csv file paths.");
}

function workbookRows(workbook: XLSX.WorkBook, sheetName: string): CsfSheetCell[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false }) as CsfSheetCell[][];
}

const summaries = [];
for (const filePath of files) {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const fileName = path.basename(filePath);
  const lower = fileName.toLowerCase();
  if (lower.includes("returning club") || lower.includes("club audit") || lower.includes("club point") || lower.includes("clubs point")) {
    const parsed = await parseCsfPartnerFormResponsesWorkbook(new File([bytes], fileName));
    summaries.push({ file: fileName, kind: "partner_forms", ...parsed.summary });
    continue;
  }

  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer", raw: false, dense: true, cellDates: false });
  if (lower.includes("meeting attendance")) {
    const sheetName = workbook.SheetNames[0];
    const parsed = parseCsfMeetingAttendanceRows(workbookRows(workbook, sheetName));
    summaries.push({
      file: fileName,
      kind: "meeting_attendance",
      sheet: sheetName,
      rows: parsed.length,
      verifiedEmailRows: parsed.filter((row) => row.normalizedEmail).length,
      reconciliationRows: parsed.filter((row) => !row.normalizedEmail).length,
    });
    continue;
  }

  if (lower.includes("application")) {
    const sheetName = workbook.SheetNames[0];
    const parsed = parseCsfSheetRows("S26", workbookRows(workbook, sheetName));
    summaries.push({ file: fileName, kind: "applications", sheet: sheetName, ...summarizeCsfParsedRows(parsed) });
    continue;
  }

  const termTabs = workbook.SheetNames.filter((sheetName) => /^[FS]\d{2}$/i.test(sheetName));
  const tabs = termTabs.map((sheetName) => {
    const parsed = parseCsfSheetRows(sheetName, workbookRows(workbook, sheetName));
    return { sheet: sheetName, ...summarizeCsfParsedRows(parsed) };
  });
  summaries.push({ file: fileName, kind: "class_term_workbook", tabs });
}

console.log(JSON.stringify({ ok: true, files: summaries }, null, 2));
