import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const SECRET = "sheet-sync-test-synthetic-secret";
process.env.ORG_SHEET_SYNC_WORKER_ENABLED = "true";
process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN = SECRET;
process.env.ORG_SHEET_SYNC_MAX_PER_RUN = "2";
delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

type Row = Record<string, unknown>;

let syncRows: Row[] = [];
let selected = "";
let ordered: unknown[] = [];
let synced: Row[] = [];
let warnings: Array<{ message: string; attributes: Row }> = [];
let syncResult: (config: Row) => Row = () => ({ success: true });

const adminClient = {
  from: () => ({
    select: (columns: string) => {
      selected = columns;
      return {
        eq: () => ({
          order: async (...args: unknown[]) => {
            ordered = args;
            return { data: syncRows, error: null };
          },
        }),
      };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
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
  authorizeGoogleOAuthOrganizationRequest: async () => ({ allowed: true }),
}));
mock.module("@/lib/google-sheets/organization-report-sync", () => ({
  ORGANIZATION_SHEET_SYNC_COLUMNS:
    "organization_id, sheet_id, tab_name, range_a1, report_type, layout_config",
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

const run = async () => {
  const response = await POST(
    new NextRequest("http://127.0.0.1:3009/api/cron/organization-sheet-sync", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  selected = "";
  ordered = [];
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

  test("takes the least recently synced first and stops at the per-run cap", async () => {
    const { status, body } = await run();

    expect(ordered).toEqual([
      "last_synced_at",
      { ascending: true, nullsFirst: true },
    ]);
    expect(synced.map((config) => config.organization_id)).toEqual([
      "never",
      "oldest",
    ]);
    expect(status).toBe(200);
    expect(body.processed).toBe(2);
  });

  test("skips an organization that is not due yet", async () => {
    syncRows = [row("fresh", new Date().toISOString())];

    expect((await run()).body).toEqual({ processed: 0, results: [] });
    expect(synced).toHaveLength(0);
  });

  test("logs each failure with the organization and a stable code", async () => {
    syncResult = (config) =>
      config.organization_id === "never"
        ? {
            success: false,
            code: "tab_missing",
            error: 'The tab "Member Hours" no longer exists.',
          }
        : { success: true };

    const { body } = await run();

    expect(body.results).toEqual([
      {
        organizationId: "never",
        success: false,
        code: "tab_missing",
        error: 'The tab "Member Hours" no longer exists.',
      },
      { organizationId: "oldest", success: true },
    ]);
    expect(warnings).toEqual([
      {
        message: "Organization sheet sync failed",
        attributes: { organization_id: "never", error_code: "tab_missing" },
      },
    ]);
  });
});
