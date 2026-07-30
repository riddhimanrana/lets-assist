import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function readActionsSource() {
  return readFileSync(
    join(
      process.cwd(),
      "app/organization/[id]/calendar/actions.ts",
    ),
    "utf8",
  );
}

function exportedFunctionSource(functionName: string) {
  const source = readActionsSource();
  const start = source.indexOf(`export async function ${functionName}(`);
  assert.ok(start >= 0, `${functionName} must exist`);

  const nextExport = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

test("account removal pauses sync and preserves calendar identity and event bindings", () => {
  const source = exportedFunctionSource(
    "disconnectOrganizationCalendarConnection",
  );
  const pause = source.indexOf(".update({");
  const deactivate = source.indexOf("deactivateGoogleConnection(");

  assert.ok(pause >= 0, "the sync must be paused");
  assert.ok(
    source.slice(pause).includes("auto_sync: false"),
    "account removal must disable auto-sync",
  );
  assert.ok(
    deactivate > pause,
    "the sync must be paused before the local credential is removed",
  );
  assert.ok(
    source.includes("revokeAccess: false"),
    "account removal must not revoke the shared Google grant remotely",
  );
  assert.ok(
    !source.includes('.from("organization_calendar_events")'),
    "account removal must retain event bindings for reconciliation",
  );
  assert.ok(
    !source.includes('.from("organization_calendar_syncs")\n    .delete()'),
    "account removal must retain the configured calendar identity",
  );
  assert.ok(!source.includes("fetch("), "account removal must not call Google");
});

test("calendar disconnect is a reversible pause with no local deletion or remote cleanup", () => {
  const source = exportedFunctionSource("disconnectOrganizationCalendar");

  assert.ok(source.includes('.from("organization_calendar_syncs")'));
  assert.ok(source.includes(".update({"));
  assert.ok(source.includes("auto_sync: false"));
  assert.ok(
    !source.includes('.from("organization_calendar_events")'),
    "disconnect must retain event bindings",
  );
  assert.ok(
    !source.includes(".delete()"),
    "disconnect must retain the sync configuration",
  );
  assert.ok(
    !source.includes("deactivateGoogleConnection("),
    "calendar pause must retain the purpose-bound credential",
  );
  assert.ok(!source.includes("fetch("), "disconnect must not call Google");
});

test("status retains the configured email and marks a missing owner connection for reconnect", () => {
  const source = exportedFunctionSource("getOrganizationCalendarStatus");

  assert.ok(
    source.includes(
      '"calendar_id, calendar_email, created_by, auto_sync, last_synced_at"',
    ),
    "status must load the retained configured account identity",
  );
  assert.ok(
    source.includes(
      "ownerConnection?.calendar_email ?? syncConfig.calendar_email ?? null",
    ),
    "status must retain the configured email while disconnected",
  );
  assert.ok(
    source.includes("needsReconnect: !ownerConnection"),
    "a retained sync without a credential must be represented as reconnect-required",
  );
});
