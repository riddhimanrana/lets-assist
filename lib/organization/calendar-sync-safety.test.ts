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
  const sharedSync = postSource.indexOf("await runOrganizationSheetSync(");

  assert.ok(authorization >= 0);
  assert.ok(disableAutoSync > authorization);
  assert.ok(sharedSync > disableAutoSync);
  const sharedSource = readFileSync(
    join(process.cwd(), "lib/google-sheets/organization-report-sync.ts"),
    "utf8",
  );
  assert.match(
    sharedSource,
    /prepareOrganizationSheetSyncAuthority\(\s*supabase,\s*config,\s*signal,?\s*\)/u,
  );
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
  // The report is read, checked and saved by one step, which the write follows.
  const snapshotStep = writeSource.indexOf(
    "await saveOrganizationReportSnapshot(",
  );
  const googleWrite = writeSource.indexOf(
    "const replacement = await replaceSpreadsheetReportRanges(",
  );
  const snapshotSource = source.slice(
    source.indexOf("async function saveOrganizationReportSnapshot"),
  );
  const reportRead = snapshotSource.indexOf(
    "buildOrganizationReportRowsForSync(",
  );
  const rangeCheck = snapshotSource.indexOf("describeReportRangeOverflow(");
  const reportSave = snapshotSource.indexOf("await run.plan(snapshot)");

  assert.ok(destinationCheck >= 0);
  assert.ok(snapshotStep > destinationCheck);
  assert.ok(googleWrite > snapshotStep);
  assert.ok(reportRead >= 0);
  assert.ok(rangeCheck > reportRead);
  assert.ok(reportSave > rangeCheck);
  // The durable claim is taken before this function reads anything.
  const runSource = source.slice(
    source.indexOf("export async function runOrganizationSheetSync"),
  );
  const claim = runSource.indexOf("await claimOrganizationSheetSyncRun(");
  assert.ok(claim >= 0);
  assert.ok(runSource.indexOf("await writeOrganizationReport(") > claim);
  // A sync never creates a tab.
  assert.doesNotMatch(source, /ensureSpreadsheetTab|addSheet/u);
});
