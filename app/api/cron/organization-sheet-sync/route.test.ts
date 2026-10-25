import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  createSheetSyncTable,
  type SheetSyncTableRow,
} from "@/tests/support/organization-sheet-sync-table";

mock.module("server-only", () => ({}));

const SECRET = "sheet-sync-test-synthetic-secret";
process.env.ORG_SHEET_SYNC_WORKER_ENABLED = "true";
process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN = SECRET;
process.env.ORG_SHEET_SYNC_MAX_PER_RUN = "2";
process.env.ORG_SHEET_SYNC_ORG_BUDGET_MS = "100";
delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

type Row = Record<string, unknown>;

// The table answers the batch call from the limit and run start it was
// given, by each row's own interval, and keeps its cursor between passes the
// way the database does. A load returns only the ids it was asked for.
const table = createSheetSyncTable();
let ownerAllowed = true;
let synced: Row[] = [];
let warnings: Array<{ message: string; attributes: Row }> = [];
let syncResult: (config: Row) => Row | Promise<Row> = () => ({
  success: true,
});
// What the route handed to the worker observation for each pass.
let captured: Array<{ captured: boolean; blocked: boolean }> = [];

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => table,
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: (
    _worker: string,
    operation: () => Promise<Response>,
    summary: { captured: () => boolean; heartbeatBlocked: () => boolean },
  ) =>
    operation().then((response) => {
      captured.push({
        captured: summary.captured(),
        blocked: summary.heartbeatBlocked(),
      });
      return response;
    }),
}));
mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: (message: string, attributes: Row) => {
    warnings.push({ message, attributes });
  },
}));
mock.module("@/services/calendar", () => ({
  getGoogleAccessTokenForSheetsForUser: async () => "fixture-token",
  organizationSheetsGoogleBinding: (organizationId: string) => ({
    organizationId,
  }),
}));
mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: async () => ({
    allowed: ownerAllowed,
  }),
}));
mock.module("@/lib/google-sheets/organization-report-sync", () => ({
  ORGANIZATION_SHEET_SYNC_COLUMNS:
    "organization_id, sheet_id, tab_name, range_a1, report_type, layout_config, created_by, updated_at",
  runOrganizationSheetSync: async ({ config }: { config: Row }) => {
    synced.push(config);
    return syncResult(config);
  },
}));

const { NextRequest } = await import("next/server");
const { POST, maxDuration } = await import("./route");

const layout = {
  reportType: "member-hours",
  orientation: "horizontal",
  columns: [{ key: "email", label: "Contact" }],
};
// Fictional ids that differ only in their last digits.
const organization = (index: number) =>
  `5bee0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const [NEVER, OLDEST, OLDER, FRESH] = [1, 2, 3, 4].map(organization);
const add = (
  organizationId: string,
  lastSyncedAt: string | null,
  overrides: Partial<SheetSyncTableRow> = {},
) =>
  table.add(organizationId, {
    layout_config: layout,
    last_synced_at: lastSyncedAt,
    ...overrides,
  });
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();
const syncedIds = () => synced.map((config) => config.organization_id);
const failEverySync = () => {
  syncResult = () => ({
    success: false,
    code: "sheets_unavailable",
    error: "Fixture provider failure",
  });
};

const run = async (query = "", authorization = `Bearer ${SECRET}`) => {
  const response = await POST(
    new NextRequest(
      `http://127.0.0.1:3009/api/cron/organization-sheet-sync${query}`,
      {
        method: "POST",
        headers: { authorization },
      },
    ),
  );
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  table.reset();
  ownerAllowed = true;
  synced = [];
  warnings = [];
  captured = [];
  syncResult = () => ({ success: true });
  add(NEVER, null);
  add(OLDEST, "2026-01-01T00:00:00.000Z");
  add(OLDER, "2026-01-02T00:00:00.000Z");
  add(FRESH, new Date().toISOString());
});

describe("the scheduled organization sheet sync", () => {
  test("declares the same function limit as the other light cron routes", () => {
    expect(maxDuration).toBe(60);
  });

  test("a request without the worker secret reads nothing", async () => {
    expect((await run("", "Bearer invalid")).status).toBe(401);
    expect(table.calls).toEqual([]);
    expect(table.loads).toEqual([]);
    expect(synced).toEqual([]);
  });

  test("selects the saved layout and hands it to the shared sync", async () => {
    await run();

    expect(table.loads[0].columns).toContain("layout_config");
    expect(synced[0].layout_config).toEqual(layout);
  });

  test("bounds discovery in the database and holds the per-run cap", async () => {
    const started = Date.now();
    const { status, body } = await run();

    // One batch call for this run's start, under a signal, for at most the cap.
    expect(table.calls).toHaveLength(1);
    const [call] = table.calls;
    expect(call.name).toBe("claim_organization_sheet_sync_batch");
    expect(call.limit).toBe(2);
    expect(call.signal).toBeInstanceOf(AbortSignal);
    const runStartedAt = Date.parse(String(call.runStartedAt));
    expect(runStartedAt).toBeGreaterThanOrEqual(started);
    expect(runStartedAt).toBeLessThanOrEqual(Date.now());
    // Only the selected configurations are loaded, never the whole table.
    expect(table.loads).toHaveLength(1);
    expect(table.loads[0].ids).toEqual([NEVER, OLDEST]);
    expect(table.loads[0].signal).toBeInstanceOf(AbortSignal);
    for (const column of ["auto_sync", "sync_interval_minutes", "updated_at"])
      expect(table.loads[0].columns).toContain(column);

    expect(synced).toHaveLength(2);
    expect(syncedIds()).not.toContain(FRESH);
    expect(status).toBe(503);
    expect(body.processed).toBe(2);
    expect(body.deferredOrganizations).toBe(1);
    expect(body.discoveryCounted).toBe(true);
    expect(body.discoveryIncomplete).toBe(false);
    expect(captured).toEqual([{ captured: true, blocked: true }]);
  });

  test("ignores limits sent with the request", async () => {
    const { body } = await run("?limit=500&max=500&concurrency=500");

    expect(table.calls.map((call) => call.limit)).toEqual([2]);
    expect(body.processed).toBe(2);
  });

  test("one organization that throws or never finishes does not stop the others", async () => {
    const [throws, hangs, healthy] = [11, 12, 13].map(organization);
    table.reset();
    add(throws, null);
    add(hangs, null);
    syncResult = (config) => {
      if (config.organization_id === throws) throw new Error("fixture");
      return new Promise<Row>(() => {});
    };
    const first = await run();
    expect(
      first.body.results
        .map((result: Row) => [result.organizationId, result.code])
        .sort(),
    ).toEqual([
      [throws, "unexpected_error"],
      [hangs, "organization_budget_exceeded"],
    ]);

    // With a healthy organization in the same batch, it still syncs.
    table.reset();
    add(throws, null);
    add(healthy, null);
    syncResult = (config) => {
      if (config.organization_id === throws) throw new Error("fixture");
      return { success: true };
    };
    const second = await run();
    expect(second.body.results).toContainEqual({
      organizationId: healthy,
      success: true,
    });
    expect(second.body.processed).toBe(2);
  });

  test("skips an organization that is not due yet, and a counted empty queue is healthy", async () => {
    table.reset();
    add(FRESH, new Date().toISOString());

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({
      processed: 0,
      results: [],
      deferredOrganizations: 0,
      discoveryCounted: true,
      discoveryIncomplete: false,
    });
    expect(synced).toHaveLength(0);
    expect(table.loads).toHaveLength(0);
    expect(captured).toEqual([{ captured: true, blocked: false }]);
  });

  test("logs each failure with the organization and a stable code", async () => {
    table.reset();
    add(NEVER, null);
    add(OLDEST, "2026-01-01T00:00:00.000Z");
    syncResult = (config) =>
      config.organization_id === NEVER
        ? {
            success: false,
            code: "tab_missing",
            error: 'The tab "Member Hours" no longer exists.',
          }
        : { success: true };

    const { status, body } = await run();

    expect(body.results).toContainEqual({
      organizationId: OLDEST,
      success: true,
    });
    expect(status).toBe(503);
    expect(body.results).toContainEqual({
      organizationId: NEVER,
      success: false,
      code: "tab_missing",
      error: 'The tab "Member Hours" no longer exists.',
    });
    expect(warnings).toEqual([
      {
        message: "Organization sheet sync failed",
        attributes: { organization_id: NEVER, error_code: "tab_missing" },
      },
    ]);
  });

  test("turns automatic sync off only for the owner and spreadsheet it checked", async () => {
    table.reset();
    add(NEVER, null);
    ownerAllowed = false;

    const { body } = await run();

    expect(body.results[0]).toMatchObject({ code: "owner_not_admin" });
    expect(synced).toHaveLength(0);
    expect(table.updates).toHaveLength(1);
    expect(table.updates[0].payload.auto_sync).toBe(false);
    expect(table.updates[0].filters).toEqual({
      organization_id: NEVER,
      created_by: "owner-1",
      sheet_id: `sheet-${NEVER}`,
      updated_at: "2026-10-10T00:00:00.000Z",
    });
  });
});

describe("authoritative discovery", () => {
  test("more than 100 clustered organizations that are not due cannot hide the one that is", async () => {
    table.reset();
    for (let index = 1; index <= 120; index += 1)
      add(organization(index), minutesAgo(10));
    const due = add(organization(121), null).organization_id;

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(syncedIds()).toEqual([due]);
    expect(body).toMatchObject({
      processed: 1,
      deferredOrganizations: 0,
      discoveryCounted: true,
      discoveryIncomplete: false,
    });
    expect(captured).toEqual([{ captured: true, blocked: false }]);
  });

  test("more than 100 due organizations are reported as an exact backlog past the cap", async () => {
    table.reset();
    for (let index = 1; index <= 130; index += 1)
      add(organization(index), null);

    const { status, body } = await run();
    expect(status).toBe(503);
    expect(body.processed).toBe(2);
    expect(body.deferredOrganizations).toBe(128);
    expect(body.discoveryCounted).toBe(true);
    expect(syncedIds()).toEqual([organization(1), organization(2)]);
    expect(table.loads[0].ids).toHaveLength(2);
    expect(captured).toEqual([{ captured: true, blocked: true }]);
  });

  test("each organization's own interval decides what is due", async () => {
    table.reset();
    add(organization(1), minutesAgo(30), { sync_interval_minutes: 60 });
    add(organization(2), minutesAgo(30), { sync_interval_minutes: 20 });
    // Five minutes is read as fifteen, and zero as a day.
    add(organization(3), minutesAgo(10), { sync_interval_minutes: 5 });
    add(organization(4), minutesAgo(120), { sync_interval_minutes: 0 });

    const { body } = await run();
    expect(syncedIds()).toEqual([organization(2)]);
    expect(body.deferredOrganizations).toBe(0);
  });

  test("passes in which every sync fails still reach every due organization", async () => {
    table.reset();
    for (let index = 1; index <= 5; index += 1) add(organization(index), null);
    failEverySync();

    const passes: unknown[][] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      synced = [];
      const { status, body } = await run();
      expect(status).toBe(503);
      // Nothing was synced, so all five are still due on every pass.
      expect(body.deferredOrganizations).toBe(3);
      passes.push(syncedIds());
    }
    expect(passes).toEqual([
      [organization(1), organization(2)],
      [organization(3), organization(4)],
      [organization(5), organization(1)],
    ]);
  });

  test("two passes that overlap attempt different organizations, each within the cap", async () => {
    table.reset();
    for (let index = 1; index <= 5; index += 1) add(organization(index), null);
    table.cursors["organization-calendar-sync"] = organization(3);

    // The stand-in answers one batch call at a time, as the database lock does.
    const [first, second] = await Promise.all([run(), run()]);
    const attempted = (pass: typeof first) =>
      pass.body.results.map((result: Row) => result.organizationId).sort();
    expect(attempted(first)).toEqual([organization(1), organization(2)]);
    expect(attempted(second)).toEqual([organization(3), organization(4)]);
    // The Calendar worker's cursor is a separate one.
    expect(table.cursors).toEqual({
      "organization-calendar-sync": organization(3),
      "organization-sheet-sync": organization(4),
    });
  });

  test.each(["error", "throw"] as const)(
    "a batch call that answers with %s is an unknown inventory, not an empty queue",
    async (fault) => {
      table.fault = () => fault;

      const { status, body } = await run();
      expect(status).toBe(500);
      expect(body).toMatchObject({
        processed: 0,
        results: [],
        // No backlog is invented for a queue that could not be counted.
        deferredOrganizations: 0,
        discoveryCounted: false,
        discoveryIncomplete: true,
      });
      expect(JSON.stringify(body)).not.toContain("private database detail");
      expect(synced).toEqual([]);
      expect(table.loads).toEqual([]);
      expect(captured).toEqual([{ captured: true, blocked: true }]);
    },
  );

  test("a batch answer that does not add up attempts nothing", async () => {
    for (const answer of [
      (computed: { organization_ids: string[] }) => ({
        ...computed,
        due_count: 1,
      }),
      (computed: { due_count: number; organization_ids: string[] }) => ({
        ...computed,
        organization_ids: [
          computed.organization_ids[0],
          computed.organization_ids[0],
        ],
      }),
      (computed: { due_count: number; organization_ids: string[] }) => ({
        ...computed,
        organization_ids: ["fictional-org", computed.organization_ids[1]],
      }),
    ]) {
      captured = [];
      table.answer = answer as typeof table.answer;

      const { status, body } = await run();
      expect(status).toBe(500);
      expect(body).toMatchObject({
        deferredOrganizations: 0,
        discoveryCounted: false,
        discoveryIncomplete: true,
      });
      expect(captured).toEqual([{ captured: true, blocked: true }]);
    }
    expect(synced).toEqual([]);
  });

  test("a selected configuration that is gone when it is loaded blocks the pass", async () => {
    // The configuration is removed after the batch selected it.
    table.load = (rows) => rows.slice(1);

    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body).toMatchObject({
      processed: 0,
      results: [],
      // Counted, and none of the three due organizations was attempted.
      deferredOrganizations: 3,
      discoveryCounted: true,
      discoveryIncomplete: true,
    });
    expect(synced).toEqual([]);
    expect(captured).toEqual([{ captured: true, blocked: true }]);
  });

  const unusableLoads: Array<[string, (rows: SheetSyncTableRow[]) => unknown]> =
    [
      ["fails", () => "error"],
      [
        "returns another organization's configuration",
        (rows) => [rows[0], { ...rows[1], organization_id: organization(99) }],
      ],
      [
        "returns a configuration without its owner",
        (rows) => [rows[0], { ...rows[1], created_by: null }],
      ],
    ];
  test.each(unusableLoads)(
    "a configuration load that %s attempts nothing",
    async (_name, load) => {
      table.load = load;

      const { status, body } = await run();
      expect(status).toBe(500);
      expect(body.discoveryIncomplete).toBe(true);
      expect(synced).toEqual([]);
      expect(captured).toEqual([{ captured: true, blocked: true }]);
    },
  );

  test("a configuration switched off after it was selected is not synced, and the pass is not healthy", async () => {
    table.reset();
    add(NEVER, null);
    add(OLDEST, "2026-01-01T00:00:00.000Z");
    table.load = (rows) =>
      rows.map((row) =>
        row.organization_id === NEVER ? { ...row, auto_sync: false } : row,
      );

    const { status, body } = await run();
    expect(syncedIds()).toEqual([OLDEST]);
    expect(status).toBe(503);
    expect(body).toMatchObject({ processed: 1, deferredOrganizations: 1 });
  });

  test("the sync receives the configuration as it was loaded, for its own claim to pin", async () => {
    table.reset();
    add(NEVER, null, { updated_at: "2026-10-11T08:00:00.000Z" });

    await run();
    expect(synced[0]).toMatchObject({
      organization_id: NEVER,
      sheet_id: `sheet-${NEVER}`,
      created_by: "owner-1",
      updated_at: "2026-10-11T08:00:00.000Z",
    });
  });
});
