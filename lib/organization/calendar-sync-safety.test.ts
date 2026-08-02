import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveCalendarSyncSources } from "./calendar-sync-safety";

const PROJECT_SOURCE_KIND_CONSTANT = "PROJECT_SCHEDULE_SOURCE_KIND";
const CSF_SOURCE_KINDS = [
  "csf_opportunity",
  "csf_meeting_session",
  "csf_deadline",
];
const REMOTE_CALENDAR_CALLS = [
  "getGoogleAccessTokenForUser(",
  "ensureOrganizationCalendar(",
  "createGoogleCalendarEventForCalendar(",
  "updateGoogleCalendarEventForCalendar(",
  "deleteGoogleCalendarEventForCalendar(",
];

function readCalendarSyncSource() {
  return readFileSync(
    join(process.cwd(), "lib/organization/calendar-sync.ts"),
    "utf8",
  );
}

function readSyncFunctionSource() {
  const source = readCalendarSyncSource();
  const functionStart = source.indexOf(
    "export async function syncOrganizationCalendarInternal",
  );
  assert.ok(functionStart >= 0, "sync entry point not found");
  return source.slice(functionStart);
}

/**
 * Returns one statement of the sync so a query's filters can be asserted
 * against that query alone, never against an unrelated later query.
 */
function statementAt(functionSource: string, anchor: string) {
  const start = functionSource.indexOf(anchor);
  assert.ok(start >= 0, `expected to find ${anchor}`);
  const end = functionSource.indexOf(";", start);
  assert.ok(end > start, `expected a terminated statement at ${anchor}`);
  return functionSource.slice(start, end);
}

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

test("organization calendar accepts the minimum app-created or staged legacy write grant", () => {
  const functionSource = readSyncFunctionSource();
  const tokenRead = statementAt(functionSource, "const accessToken");
  const calendarService = readFileSync(
    join(process.cwd(), "services/calendar.ts"),
    "utf8",
  );

  assert.ok(tokenRead.includes('connectionType: "calendar"'));
  assert.ok(
    !tokenRead.includes("requiredScopes"),
    "the consumer must not require the legacy full-Calendar token in addition to the shared write-scope gate",
  );
  assert.ok(
    calendarService.includes(
      'options.connectionType === "calendar" &&\n      !hasGoogleCalendarWriteScope(connection.granted_scopes)',
    ),
    "calendar credential consumers must use the exact minimum-or-legacy token gate",
  );
});

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

test("the project source kind is a single named constant, not repeated literals", () => {
  const source = readCalendarSyncSource();

  assert.ok(
    source.includes(
      `const ${PROJECT_SOURCE_KIND_CONSTANT} = "project_schedule"`,
    ),
    "project sync must name its source kind once",
  );
  assert.equal(
    source.split('"project_schedule"').length - 1,
    1,
    "every source_kind touchpoint must reference the named constant",
  );
});

test("existing binding load filters to project sources before reconciliation", () => {
  const functionSource = readSyncFunctionSource();
  const load = statementAt(functionSource, "const existingEventsResult");

  assert.ok(load.includes('.from("organization_calendar_events")'));
  assert.ok(
    load.includes(
      '.select("id, project_id, schedule_id, event_id, source_kind")',
    ),
    "the load must return source_kind as evidence of what it selected",
  );
  assert.ok(load.includes('.eq("organization_id", organizationId)'));
  assert.ok(
    load.includes(`.eq("source_kind", ${PROJECT_SOURCE_KIND_CONSTANT})`),
    "the load must be scoped to project schedule bindings",
  );
  // An exact single-kind filter, not a widened set that could readmit CSF rows.
  assert.ok(!load.includes(".in("), "source filter must not be widened");
  assert.ok(!load.includes(".or("), "source filter must not be widened");
  assert.ok(!load.includes(".neq("), "source filter must be positive");

  const loadIndex = functionSource.indexOf("const existingEventsResult");
  const trackedIndex = functionSource.indexOf("const trackedEvents =");
  const reconcile = functionSource.indexOf("synchronizeCalendarEvents(");
  assert.ok(trackedIndex > loadIndex);
  assert.ok(reconcile > trackedIndex);
});

test("no CSF source kind can reach synchronizeCalendarEvents", () => {
  const source = readCalendarSyncSource();
  const functionSource = readSyncFunctionSource();

  for (const csfSourceKind of CSF_SOURCE_KINDS) {
    assert.ok(
      !source.includes(csfSourceKind),
      `project sync must not reference ${csfSourceKind}`,
    );
  }

  // Tracked rows are re-checked in memory, so a weakened query filter still
  // cannot present a CSF projection to the reconciler as a stale project row.
  const tracked = statementAt(functionSource, "const trackedEvents =");
  assert.ok(tracked.includes("existingEvents"));
  assert.ok(
    tracked.includes(
      `.filter((event) => event.source_kind === ${PROJECT_SOURCE_KIND_CONSTANT})`,
    ),
    "tracked rows must be re-checked against the project source kind",
  );
  assert.ok(
    tracked.includes("key: `${event.project_id}:${event.schedule_id}`"),
    "project key behavior must remain project_id:schedule_id",
  );

  const reconcilerStart = functionSource.indexOf(
    "synchronizeCalendarEvents(",
  );
  const reconcilerArgs = functionSource.slice(
    reconcilerStart,
    functionSource.indexOf("{", reconcilerStart),
  );
  assert.ok(reconcilerArgs.includes("desiredEvents"));
  assert.ok(reconcilerArgs.includes("trackedEvents"));
  assert.ok(
    !reconcilerArgs.includes("existingEvents"),
    "unfiltered rows must never be handed to the reconciler",
  );
});

test("tracking insert declares both legacy and generalized project coordinates", () => {
  const insert = statementAt(
    readSyncFunctionSource(),
    "insertTrackingEvent: async",
  );

  for (const coordinate of [
    "organization_id: organizationId",
    "project_id: desired.projectId",
    "schedule_id: desired.scheduleId",
    `source_kind: ${PROJECT_SOURCE_KIND_CONSTANT}`,
    "source_id: desired.projectId",
    "occurrence_key: desired.scheduleId",
    "event_id: eventId",
  ]) {
    assert.ok(
      insert.includes(coordinate),
      `tracking insert must declare ${coordinate}`,
    );
  }
});

test("tracking update and delete guard source_kind alongside the row id", () => {
  const functionSource = readSyncFunctionSource();

  for (const operation of [
    "updateTrackingEvent: async",
    "deleteTrackingEvent: async",
  ]) {
    const mutation = statementAt(functionSource, operation);
    assert.ok(
      mutation.includes('.eq("id", tracked.id)'),
      `${operation} must target one tracked row`,
    );
    assert.ok(
      mutation.includes(`.eq("source_kind", ${PROJECT_SOURCE_KIND_CONSTANT})`),
      `${operation} must refuse to mutate a non-project projection`,
    );
  }
});

test("a source load failure returns before any Google calendar access", () => {
  const functionSource = readSyncFunctionSource();
  const sourceValidation = functionSource.indexOf(
    "resolveCalendarSyncSources(",
  );
  const failClosedReturn = functionSource.indexOf("if (!sources.ok) {");

  assert.ok(sourceValidation >= 0);
  assert.ok(
    failClosedReturn > sourceValidation,
    "the fail-closed guard must follow source resolution",
  );

  const beforeGuard = functionSource.slice(0, failClosedReturn);
  for (const remoteCall of REMOTE_CALENDAR_CALLS) {
    assert.ok(
      !beforeGuard.includes(remoteCall),
      `${remoteCall} must not run before the source load is validated`,
    );
  }
});
