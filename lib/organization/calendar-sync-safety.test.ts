import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("the Sheets worker reauthorizes its owner and disables stale syncs before export", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/cron/organization-sheet-sync/route.ts"),
    "utf8",
  );
  const postSource = source.slice(source.indexOf("export async function POST"));
  const authorization = postSource.indexOf(
    "authorizeGoogleOAuthOrganizationRequest({",
  );
  const disableAutoSync = postSource.search(
    /\.update\(\s*\{\s*auto_sync:\s*false/u,
  );
  const tokenRead = postSource.indexOf("getGoogleAccessTokenForSheetsForUser(");
  const sharedSync = postSource.indexOf("await runOrganizationSheetSync(");

  assert.ok(authorization >= 0);
  assert.ok(disableAutoSync > authorization);
  assert.ok(tokenRead > disableAutoSync);
  assert.ok(sharedSync > tokenRead);
});

test("the shared Sheets sync checks the destination before it reads or writes the report", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/google-sheets/organization-report-sync.ts"),
    "utf8",
  );
  const writeSource = source.slice(
    source.indexOf("async function writeOrganizationReport"),
  );
  const destinationCheck = writeSource.indexOf("await inspectSpreadsheet(");
  const reportRead = writeSource.indexOf("buildOrganizationReportRowsForSync(");
  const rangeCheck = writeSource.indexOf("describeReportRangeOverflow(");
  const googleWrite = writeSource.indexOf(
    "const replacement = await replaceSpreadsheetReportValues(",
  );

  assert.ok(destinationCheck >= 0);
  assert.ok(reportRead > destinationCheck);
  assert.ok(rangeCheck > reportRead);
  assert.ok(googleWrite > rangeCheck);
  // A sync never creates a tab.
  assert.doesNotMatch(source, /ensureSpreadsheetTab|addSheet/u);
});
