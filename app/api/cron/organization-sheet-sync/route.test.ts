import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const SECRET = "sheet-sync-test-synthetic-secret";
process.env.ORG_SHEET_SYNC_WORKER_ENABLED = "true";
process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN = SECRET;
process.env.ORG_SHEET_SYNC_MAX_PER_RUN = "2";
process.env.ORG_SHEET_SYNC_ORG_BUDGET_MS = "100";
delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

type Row = Record<string, unknown>;

let syncRows: Row[] = [];
let selected = "";
let ordered: unknown[] = [];
let dueFilter = "";
let disabled: Array<{ payload: Row; filters: Row }> = [];
let ownerAllowed = true;
let limited: number | null = null;
let synced: Row[] = [];
let warnings: Array<{ message: string; attributes: Row }> = [];
let syncResult: (config: Row) => Row | Promise<Row> = () => ({
  success: true,
});

const adminClient = {
  from: () => ({
    select: (columns: string) => {
      selected = columns;
      return {
        eq: () => ({
          or: (filter: string) => {
            dueFilter = filter;
            return {
              order: (...args: unknown[]) => {
                ordered = args;
                return {
                  limit: async (count: number) => {
                    limited = count;
                    return { data: syncRows.slice(0, count), error: null };
                  },
                };
              },
            };
          },
        }),
      };
    },
    update: (payload: Row) => {
      const filters: Row = {};
      const query = {
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        then: (resolve: (value: { error: null }) => void) => {
          disabled.push({ payload, filters });
          resolve({ error: null });
        },
      };
      return query;
    },
  }),
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: (_worker: string, operation: () => Promise<Response>) =>
    operation(),
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
    "organization_id, sheet_id, tab_name, range_a1, report_type, layout_config, created_by",
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

const row = (organizationId: string, lastSyncedAt: string | null): Row => ({
  organization_id: organizationId,
  sheet_id: `sheet-${organizationId}`,
  tab_name: "Member Hours",
  range_a1: "A1",
  report_type: "member-hours",
  layout_config: layout,
  auto_sync: true,
  sync_interval_minutes: 60,
  last_synced_at: lastSyncedAt,
  created_by: "owner-1",
});

const run = async (query = "") => {
  const response = await POST(
    new NextRequest(
      `http://127.0.0.1:3009/api/cron/organization-sheet-sync${query}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
      },
    ),
  );
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  selected = "";
  ordered = [];
  dueFilter = "";
  disabled = [];
  ownerAllowed = true;
  limited = null;
  synced = [];
  warnings = [];
  syncResult = () => ({ success: true });
  // The database returns the least recently synced first.
  syncRows = [
    row("never", null),
    row("oldest", "2026-01-01T00:00:00.000Z"),
    row("older", "2026-01-02T00:00:00.000Z"),
    row("fresh", new Date().toISOString()),
  ];
});

describe("the scheduled organization sheet sync", () => {
  test("declares the same function limit as the other light cron routes", () => {
    expect(maxDuration).toBe(60);
  });

  test("selects the saved layout and hands it to the shared sync", async () => {
    await run();

    expect(selected).toContain("layout_config");
    expect(synced[0].layout_config).toEqual(layout);
  });

  test("bounds the query in the database and holds the per-run cap", async () => {
    const { status, body } = await run();

    expect(dueFilter).toMatch(
      /^last_synced_at\.is\.null,last_synced_at\.lte\.\d{4}-/u,
    );
    expect(ordered).toEqual([
      "last_synced_at",
      { ascending: true, nullsFirst: true },
    ]);
    // Four candidates per slot of the cap, never the whole table.
    expect(limited).toBe(8);
    expect(synced).toHaveLength(2);
    expect(synced.some((config) => config.organization_id === "fresh")).toBe(
      false,
    );
    expect(status).toBe(200);
    expect(body.processed).toBe(2);
  });

  test("ignores limits sent with the request", async () => {
    const { body } = await run("?limit=500&max=500&concurrency=500");

    expect(limited).toBe(8);
    expect(body.processed).toBe(2);
  });

  test("one organization that throws or never finishes does not stop the others", async () => {
    syncRows = [row("throws", null), row("hangs", null)];
    syncResult = (config) => {
      if (config.organization_id === "throws") throw new Error("fixture");
      return new Promise<Row>(() => {});
    };
    const first = await run();
    expect(
      first.body.results
        .map((result: Row) => [result.organizationId, result.code])
        .sort(),
    ).toEqual([
      ["hangs", "organization_budget_exceeded"],
      ["throws", "unexpected_error"],
    ]);

    // With a healthy organization in the same batch, it still syncs.
    syncRows = [row("throws", null), row("healthy", null)];
    syncResult = (config) => {
      if (config.organization_id === "throws") throw new Error("fixture");
      return { success: true };
    };
    const second = await run();
    expect(second.body.results).toContainEqual({
      organizationId: "healthy",
      success: true,
    });
    expect(second.body.processed).toBe(2);
  });

  test("skips an organization that is not due yet", async () => {
    syncRows = [row("fresh", new Date().toISOString())];

    expect((await run()).body).toEqual({ processed: 0, results: [] });
    expect(synced).toHaveLength(0);
  });

  test("logs each failure with the organization and a stable code", async () => {
    syncRows = [row("never", null), row("oldest", "2026-01-01T00:00:00.000Z")];
    syncResult = (config) =>
      config.organization_id === "never"
        ? {
            success: false,
            code: "tab_missing",
            error: 'The tab "Member Hours" no longer exists.',
          }
        : { success: true };

    const { body } = await run();

    expect(body.results).toContainEqual({
      organizationId: "oldest",
      success: true,
    });
    expect(body.results).toContainEqual({
      organizationId: "never",
      success: false,
      code: "tab_missing",
      error: 'The tab "Member Hours" no longer exists.',
    });
    expect(warnings).toEqual([
      {
        message: "Organization sheet sync failed",
        attributes: { organization_id: "never", error_code: "tab_missing" },
      },
    ]);
  });

  test("turns automatic sync off only for the owner and spreadsheet it checked", async () => {
    syncRows = [row("never", null)];
    ownerAllowed = false;

    const { body } = await run();

    expect(body.results[0]).toMatchObject({ code: "owner_not_admin" });
    expect(synced).toHaveLength(0);
    expect(disabled).toHaveLength(1);
    expect(disabled[0].payload.auto_sync).toBe(false);
    expect(disabled[0].filters).toEqual({
      organization_id: "never",
      created_by: "owner-1",
      sheet_id: "sheet-never",
    });
  });
});
