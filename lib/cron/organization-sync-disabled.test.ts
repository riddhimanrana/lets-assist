import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const SECRET = "disabled-sync-synthetic-secret";
process.env.ORG_CALENDAR_SYNC_WORKER_ENABLED = "false";
process.env.ORG_SHEET_SYNC_WORKER_ENABLED = "false";
process.env.ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN = SECRET;
process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN = SECRET;
delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

let dispatches = 0;
const forbidden = () => {
  dispatches++;
  throw new Error("Disabled workers must not access data or providers");
};
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: forbidden }));
mock.module("@/lib/organization/calendar-sync", () => ({
  syncOrganizationCalendarInternal: forbidden,
}));
mock.module("@/lib/google-sheets/organization-report-sync", () => ({
  ORGANIZATION_SHEET_SYNC_COLUMNS: "organization_id",
  runOrganizationSheetSync: forbidden,
}));
mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: forbidden,
}));
const { NextRequest } = await import("next/server");
const calendar =
  await import("@/app/api/cron/organization-calendar-sync/route");
const sheets = await import("@/app/api/cron/organization-sheet-sync/route");
for (const [name, handler] of [
  ["Calendar", calendar.POST],
  ["Sheets", sheets.POST],
] as const) {
  test(`${name} disabled heartbeat is unsuccessful and dispatches nothing`, async () => {
    const response = await handler(
      new NextRequest("http://127.0.0.1:3009/api/cron/disabled-fixture", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ enabled: false });
    expect(dispatches).toBe(0);
  });
  test(`${name} disabled worker still rejects invalid authentication`, async () => {
    const response = await handler(
      new NextRequest("http://127.0.0.1:3009/api/cron/disabled-fixture", {
        method: "POST",
        headers: { authorization: "Bearer invalid" },
      }),
    );
    expect(response.status).toBe(401);
    expect(dispatches).toBe(0);
  });
}
