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
  const disableAutoSync = postSource.indexOf(".update({ auto_sync: false");
  const tokenRead = postSource.indexOf("getGoogleAccessTokenForSheetsForUser(");
  const reportRead = postSource.indexOf("buildOrganizationReportRowsForSync(");
  const googleWrite = postSource.indexOf(
    "const replacement = await replaceSpreadsheetReportValues(",
  );

  assert.ok(authorization >= 0);
  assert.ok(disableAutoSync > authorization);
  assert.ok(tokenRead > disableAutoSync);
  assert.ok(reportRead > tokenRead);
  assert.ok(googleWrite > reportRead);
});
