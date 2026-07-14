import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

test("manual and cron report syncs share the RAW write-first replacement", () => {
  const manual = readWorkspaceFile(
    "app/organization/[id]/reports/sheets-actions.ts",
  );
  const cron = readWorkspaceFile(
    "app/api/cron/organization-sheet-sync/route.ts",
  );

  for (const source of [manual, cron]) {
    assert.match(source, /replaceSpreadsheetReportValues\(/u);
    assert.doesNotMatch(source, /clearSpreadsheetValues\(/u);
  }
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
