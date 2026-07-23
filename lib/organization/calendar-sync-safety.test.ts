import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveCalendarSyncSources } from "./calendar-sync-safety";

test("calendar source resolution fails closed on either database query error", () => {
  assert.deepEqual(
    resolveCalendarSyncSources(
      { data: null, error: { message: "projects unavailable" } },
      { data: [], error: null },
    ),
    { ok: false, error: "Failed to load organization projects" },
  );

  assert.deepEqual(
    resolveCalendarSyncSources(
      { data: [], error: null },
      { data: null, error: { message: "events unavailable" } },
    ),
    { ok: false, error: "Failed to load existing calendar events" },
  );
});

test("calendar sync loads and validates both sources before calling Google", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/organization/calendar-sync.ts"),
    "utf8",
  );
  const functionStart = source.indexOf(
    "export async function syncOrganizationCalendarInternal",
  );
  const functionSource = source.slice(functionStart);
  const projectsQuery = functionSource.indexOf('from("projects")');
  const eventsQuery = functionSource.indexOf(
    'from("organization_calendar_events")',
  );
  const sourceValidation = functionSource.indexOf(
    "resolveCalendarSyncSources(",
  );
  const googleAccess = functionSource.indexOf("getGoogleAccessTokenForUser(");
  const googleMutation = functionSource.indexOf("ensureOrganizationCalendar(");
  const ownerAuthorization = functionSource.indexOf(
    "authorizeGoogleOAuthOrganizationRequest({",
  );
  const disableAutoSync = functionSource.indexOf(
    ".update({ auto_sync: false",
  );

  assert.ok(ownerAuthorization >= 0);
  assert.ok(disableAutoSync > ownerAuthorization);
  assert.ok(projectsQuery > disableAutoSync);
  assert.ok(projectsQuery >= 0);
  assert.ok(eventsQuery > projectsQuery);
  assert.ok(sourceValidation > eventsQuery);
  assert.ok(googleAccess > sourceValidation);
  assert.ok(googleMutation > googleAccess);
});

test("the Sheets worker reauthorizes its owner and disables stale syncs before export", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/cron/organization-sheet-sync/route.ts"),
    "utf8",
  );
  const authorization = source.indexOf(
    "authorizeGoogleOAuthOrganizationRequest({",
  );
  const disableAutoSync = source.indexOf(".update({ auto_sync: false");
  const tokenRead = source.indexOf("getGoogleAccessTokenForSheetsForUser(");
  const reportRead = source.indexOf("buildOrganizationReportRowsForSync(");
  const googleWrite = source.indexOf("replaceSpreadsheetReportValues(");

  assert.ok(authorization >= 0);
  assert.ok(disableAutoSync > authorization);
  assert.ok(tokenRead > disableAutoSync);
  assert.ok(reportRead > tokenRead);
  assert.ok(googleWrite > reportRead);
});
