import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

test("calendar cron sync is internal and the Server Action always authorizes", () => {
  const actions = readWorkspaceFile(
    "app/organization/[id]/calendar/actions.ts",
  );
  const cronRoute = readWorkspaceFile(
    "app/api/cron/organization-calendar-sync/route.ts",
  );
  const internalService = readWorkspaceFile(
    "lib/organization/calendar-sync.ts",
  );

  assert.match(internalService, /^import "server-only";/u);
  assert.doesNotMatch(actions, /isFromCron|skipAuth/u);
  assert.match(
    actions,
    /export async function syncOrganizationCalendarNow\([\s\S]*?assertOrgAccess\(organizationId, true\)/u,
  );
  assert.match(cronRoute, /from "@\/lib\/organization\/calendar-sync"/u);
  assert.doesNotMatch(cronRoute, /calendar\/actions/u);
});

test("service-role report sync is not exported from a Server Action module", () => {
  const actions = readWorkspaceFile("app/organization/[id]/reports/actions.ts");
  const cronRoute = readWorkspaceFile(
    "app/api/cron/organization-sheet-sync/route.ts",
  );
  const internalService = readWorkspaceFile(
    "lib/organization/report-service.ts",
  );

  assert.match(internalService, /^import "server-only";/u);
  assert.doesNotMatch(actions, /getAdminClient|ForSync/u);
  assert.match(cronRoute, /from "@\/lib\/organization\/report-service"/u);
  assert.doesNotMatch(cronRoute, /reports\/actions/u);
});

test("global waiver actions expose no unguarded active-definition lookup", () => {
  const actions = readWorkspaceFile("app/admin/waivers/actions.ts");

  assert.doesNotMatch(
    actions,
    /export async function getActiveGlobalWaiverDefinition/u,
  );
});
