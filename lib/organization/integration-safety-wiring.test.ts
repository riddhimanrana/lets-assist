import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readOrganizationSheetActionsSource } from "@/tests/support/organization-sheet-actions-source";

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

test("manual and cron report syncs share the RAW write-first replacement", () => {
  const manual = readOrganizationSheetActionsSource();
  const cron = readWorkspaceFile(
    "app/api/cron/organization-sheet-sync/route.ts",
  );
  const sharedSync = readWorkspaceFile(
    "lib/google-sheets/organization-report-sync.ts",
  );

  // Both paths run the one shared sync, and neither writes to Sheets itself.
  for (const source of [manual, cron]) {
    assert.match(source, /runOrganizationSheetSync\(/u);
    assert.doesNotMatch(source, /replaceSpreadsheetReportValues\(/u);
    assert.doesNotMatch(source, /clearSpreadsheetValues\(/u);
    assert.match(source, /ORGANIZATION_SHEET_SYNC_COLUMNS/u);
  }
  assert.match(sharedSync, /replaceSpreadsheetReportValues\(/u);
  assert.doesNotMatch(sharedSync, /clearSpreadsheetValues\(/u);
  assert.match(sharedSync, /layout_config/u);
});

test("organization integration crons use an explicit concurrency bound", () => {
  const calendarCron = readWorkspaceFile(
    "app/api/cron/organization-calendar-sync/route.ts",
  );
  const sheetCron = readWorkspaceFile(
    "app/api/cron/organization-sheet-sync/route.ts",
  );

  assert.match(calendarCron, /CALENDAR_SYNC_CONCURRENCY/u);
  assert.match(sheetCron, /SHEET_SYNC_CONCURRENCY/u);
  for (const source of [calendarCron, sheetCron]) {
    assert.match(source, /mapWithConcurrency\(/u);
    assert.doesNotMatch(source, /Promise\.all\(syncPromises\)/u);
  }
});
