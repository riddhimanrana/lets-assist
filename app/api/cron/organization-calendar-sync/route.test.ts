import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const SECRET = "calendar-sync-synthetic-secret";
process.env.ORG_CALENDAR_SYNC_WORKER_ENABLED = "true";
process.env.ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN = SECRET;
delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

let rows: Array<{ organization_id: string; last_synced_at: string | null }> =
  [];
let queryError: { message: string } | null = null;
let synced: string[] = [];
let outcomes: Record<string, { success: boolean; error?: string } | Error> = {};
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error: queryError }),
      }),
    }),
  }),
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: (_worker: string, operation: () => Promise<Response>) =>
    operation(),
}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { error: () => undefined },
}));
mock.module("@/lib/organization/calendar-sync", () => ({
  syncOrganizationCalendarInternal: async (organizationId: string) => {
    synced.push(organizationId);
    const result = outcomes[organizationId] ?? { success: true };
    if (result instanceof Error) throw result;
    return result;
  },
}));

const { NextRequest } = await import("next/server");
const { POST } = await import("./route");
const run = async (authorization = `Bearer ${SECRET}`) => {
  const response = await POST(
    new NextRequest(
      "http://127.0.0.1:3009/api/cron/organization-calendar-sync",
      {
        method: "POST",
        headers: { authorization },
      },
    ),
  );
  return { status: response.status, body: await response.json() };
};
beforeEach(() => {
  rows = [];
  queryError = null;
  synced = [];
  outcomes = {};
});

test("authentication failure never dispatches an organization", async () => {
  rows = [{ organization_id: "fictional-org", last_synced_at: null }];
  expect((await run("Bearer invalid")).status).toBe(401);
  expect(synced).toEqual([]);
});
test("empty and wholly successful passes answer healthy", async () => {
  expect((await run()).status).toBe(200);
  rows = [{ organization_id: "fictional-org", last_synced_at: null }];
  expect((await run()).status).toBe(200);
  expect(synced).toEqual(["fictional-org"]);
});
test("one failed organization makes the heartbeat fail without hiding completed work", async () => {
  rows = ["fictional-healthy", "fictional-failed"].map((organization_id) => ({
    organization_id,
    last_synced_at: null,
  }));
  outcomes["fictional-failed"] = {
    success: false,
    error: "Fixture authorization changed",
  };
  const result = await run();
  expect(result.status).toBe(503);
  expect(result.body.processed).toBe(2);
  expect(result.body.results).toContainEqual({
    organizationId: "fictional-healthy",
    success: true,
  });
  expect(result.body.results).toContainEqual({
    organizationId: "fictional-failed",
    success: false,
    error: "Fixture authorization changed",
  });
});
test("thrown organization failures remain visible to the heartbeat", async () => {
  rows = [{ organization_id: "fictional-throws", last_synced_at: null }];
  outcomes["fictional-throws"] = new Error("Fixture failure");
  const result = await run();
  expect(result.status).toBe(503);
  expect(result.body.results[0]).toMatchObject({ success: false });
});
test("query failure answers an error and dispatches nothing", async () => {
  queryError = { message: "Fixture database unavailable" };
  expect((await run()).status).toBe(500);
  expect(synced).toEqual([]);
});
