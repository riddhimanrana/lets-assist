import { beforeEach, expect, mock, test } from "bun:test";

import { createCalendarSyncTable } from "@/tests/support/organization-calendar-sync-table";

mock.module("server-only", () => ({}));
const SECRET = "calendar-sync-synthetic-secret";
process.env.ORG_CALENDAR_SYNC_WORKER_ENABLED = "true";
process.env.ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN = SECRET;
delete process.env.ORG_CALENDAR_SYNC_MAX_PER_RUN;
delete process.env.ORG_CALENDAR_SYNC_ORG_BUDGET_MS;
delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

// The table answers the batch call from the limit and run start it was
// given, and keeps its cursor between passes the way the database does.
const table = createCalendarSyncTable();
let rows: Array<{
  organization_id: string;
  last_synced_at: string | null;
  auto_sync?: boolean;
}> = [];
let queryError: { message: string } | null = null;
let synced: string[] = [];
let syncOptions: unknown[] = [];
let outcomes: Record<string, { success: boolean; error?: string } | Error> = {};
// What the route handed to the worker observation for each pass.
let captured: Array<{ captured: boolean; blocked: boolean; outcome: unknown }> =
  [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    table.rows = rows;
    if (queryError) table.fault = () => "error";
    return table;
  },
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: (
    _worker: string,
    operation: () => Promise<Response>,
    summary: {
      outcome: () => unknown;
      captured: () => boolean;
      heartbeatBlocked: () => boolean;
    },
  ) =>
    operation().then((response) => {
      captured.push({
        captured: summary.captured(),
        blocked: summary.heartbeatBlocked(),
        outcome: summary.outcome(),
      });
      return response;
    }),
}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { error: () => undefined },
}));
mock.module("@/lib/organization/calendar-sync", () => ({
  syncOrganizationCalendarInternal: async (
    organizationId: string,
    options?: unknown,
  ) => {
    synced.push(organizationId);
    syncOptions.push(options);
    const result = outcomes[organizationId] ?? { success: true };
    if (result instanceof Error) throw result;
    return result;
  },
}));

const { NextRequest } = await import("next/server");
const { POST, maxDuration } = await import("./route");
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
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();
// Fictional ids that differ only in their last digits.
const organization = (index: number) =>
  `ca1e0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const neverSynced = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    organization_id: organization(index + 1),
    last_synced_at: null,
  }));
beforeEach(() => {
  table.reset();
  rows = [];
  queryError = null;
  synced = [];
  syncOptions = [];
  outcomes = {};
  captured = [];
});

test("authentication failure never dispatches an organization", async () => {
  rows = neverSynced(1);
  expect((await run("Bearer invalid")).status).toBe(401);
  expect(synced).toEqual([]);
  expect(table.calls).toEqual([]);
});
test("empty and wholly successful passes answer healthy", async () => {
  const empty = await run();
  expect(empty.status).toBe(200);
  expect(empty.body).toMatchObject({
    processed: 0,
    results: [],
    deferredOrganizations: 0,
    discoveryCounted: true,
    discoveryIncomplete: false,
  });
  rows = neverSynced(1);
  const completed = await run();
  expect(completed.status).toBe(200);
  expect(completed.body).toMatchObject({
    processed: 1,
    deferredOrganizations: 0,
    discoveryCounted: true,
    discoveryIncomplete: false,
  });
  expect(synced).toEqual([organization(1)]);
  expect(captured.map((entry) => entry.blocked)).toEqual([false, false]);
});
test("one failed organization makes the heartbeat fail without hiding completed work", async () => {
  rows = neverSynced(2);
  outcomes[organization(2)] = {
    success: false,
    error: "Fixture authorization changed",
  };
  const result = await run();
  expect(result.status).toBe(503);
  expect(result.body.processed).toBe(2);
  expect(result.body.results).toContainEqual({
    organizationId: organization(1),
    success: true,
  });
  expect(result.body.results).toContainEqual({
    organizationId: organization(2),
    success: false,
    error: "Fixture authorization changed",
  });
});
test("thrown organization failures remain visible to the heartbeat", async () => {
  rows = neverSynced(1);
  outcomes[organization(1)] = new Error("Fixture failure");
  const result = await run();
  expect(result.status).toBe(503);
  expect(result.body.results[0]).toMatchObject({ success: false });
});
test("query failure answers an error and dispatches nothing", async () => {
  rows = neverSynced(1);
  queryError = { message: "Fixture database unavailable" };
  const result = await run();
  expect(result.status).toBe(500);
  expect(synced).toEqual([]);
  // The inventory is unknown: no healthy zero, and no invented backlog.
  expect(result.body).toMatchObject({
    processed: 0,
    results: [],
    deferredOrganizations: 0,
    discoveryCounted: false,
    discoveryIncomplete: true,
  });
  expect(JSON.stringify(result.body)).not.toContain("private database detail");
  expect(captured).toEqual([
    expect.objectContaining({ captured: true, blocked: true }),
  ]);
});
test("a batch answer that does not add up is an unknown inventory and dispatches nothing", async () => {
  rows = neverSynced(3);
  for (const answer of [
    // More was selected than was counted as due.
    (computed: { organization_ids: string[] }) => ({
      ...computed,
      due_count: 2,
    }),
    // The same organization twice.
    (computed: { due_count: number; organization_ids: string[] }) => ({
      ...computed,
      organization_ids: [
        ...computed.organization_ids.slice(0, 2),
        computed.organization_ids[0],
      ],
    }),
    // An id the worker cannot trust as an organization.
    (computed: { due_count: number; organization_ids: string[] }) => ({
      ...computed,
      organization_ids: [
        "fictional-org",
        ...computed.organization_ids.slice(1),
      ],
    }),
  ]) {
    captured = [];
    table.answer = answer as typeof table.answer;
    const result = await run();
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      processed: 0,
      deferredOrganizations: 0,
      discoveryCounted: false,
      discoveryIncomplete: true,
    });
    expect(captured).toEqual([expect.objectContaining({ blocked: true })]);
  }
  expect(synced).toEqual([]);
});
test("only organizations that are enabled and due are read and dispatched", async () => {
  rows = [
    { organization_id: organization(1), last_synced_at: null },
    { organization_id: organization(2), last_synced_at: minutesAgo(61) },
    { organization_id: organization(3), last_synced_at: minutesAgo(10) },
    {
      organization_id: organization(4),
      last_synced_at: null,
      auto_sync: false,
    },
  ];
  const started = Date.now();
  const result = await run();
  expect(result.status).toBe(200);
  expect(result.body.processed).toBe(2);
  expect([...synced].sort()).toEqual([organization(1), organization(2)]);
  // One bounded batch call, under the run's signal, for this run's start.
  expect(table.calls).toHaveLength(1);
  const [call] = table.calls;
  expect(call.name).toBe("claim_organization_calendar_sync_batch");
  expect(call.limit).toBe(25);
  expect(call.signal).toBeInstanceOf(AbortSignal);
  const runStartedAt = Date.parse(String(call.runStartedAt));
  expect(runStartedAt).toBeGreaterThanOrEqual(started);
  expect(runStartedAt).toBeLessThanOrEqual(Date.now());
});
test("each organization is given a deadline it can check before it mutates", async () => {
  rows = neverSynced(1);
  await run();
  expect(syncOptions).toHaveLength(1);
  const { signal } = syncOptions[0] as { signal: AbortSignal };
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal.aborted).toBe(false);
  expect(maxDuration).toBe(60);
});

test("due tenants past the cap remain visible as deferred work", async () => {
  rows = neverSynced(30);
  const result = await run();
  expect(result.status).toBe(503);
  expect(result.body.processed).toBeLessThanOrEqual(25);
  expect(result.body.deferredOrganizations).toBe(30 - result.body.processed);
  expect(result.body.discoveryCounted).toBe(true);
  // The cap is the default 25, every attempt is distinct, and the pass is
  // recorded as blocked rather than as a completed queue.
  expect(result.body.processed).toBe(25);
  expect(result.body.discoveryIncomplete).toBe(false);
  expect(new Set(synced).size).toBe(25);
  expect(captured).toEqual([expect.objectContaining({ blocked: true })]);
});
test("the next pass starts with the tenants the last one deferred, even when every sync fails", async () => {
  rows = neverSynced(30);
  for (const row of rows)
    outcomes[row.organization_id] = {
      success: false,
      error: "Fixture provider failure",
    };

  expect((await run()).status).toBe(503);
  const first = [...synced];
  synced = [];
  const second = await run();
  expect(second.status).toBe(503);
  expect(second.body.deferredOrganizations).toBe(5);

  // Nothing was synced, so all 30 are still due. The five the first pass
  // deferred lead the second, and both passes together reach every tenant.
  const deferred = rows
    .map((row) => row.organization_id)
    .filter((id) => !first.includes(id));
  expect(deferred).toHaveLength(5);
  expect(synced.slice(0, 5)).toEqual(deferred);
  expect(new Set([...first, ...synced]).size).toBe(30);
});
