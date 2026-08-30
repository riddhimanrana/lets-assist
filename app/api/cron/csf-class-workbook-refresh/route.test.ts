import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const actionCalls: unknown[][] = [];
let rpcResults: Array<{ data: unknown; error: unknown }> = [];
let actionResult: Record<string, unknown>;

mock.module("@/lib/cron/auth-shape-probe", () => ({
  cronAuthShapeProbe: () => null,
}));
mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResults.shift() ?? { data: null, error: null };
    },
  }),
}));
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/server/actions/class-sheet-sync",
  () => ({
    linkCsfClassSheetAction: async (...args: unknown[]) => {
      actionCalls.push(args);
      return actionResult;
    },
  }),
);

const { GET, POST } = await import("./route");
const { NextRequest } = await import("next/server");

const claim = {
  claimed: true,
  jobId: "ca000000-0000-4000-8000-000000000001",
  leaseToken: "ca000000-0000-4000-8000-000000000002",
  organizationId: "ca000000-0000-4000-8000-000000000003",
  cohortId: "ca000000-0000-4000-8000-000000000004",
  workbookId: "ca000000-0000-4000-8000-000000000005",
  driveFileId: "synthetic-drive-file",
  ownerUserId: "ca000000-0000-4000-8000-000000000006",
  providerVersion: "125",
};

function request(token = "synthetic-workbook-token", method = "POST") {
  return new NextRequest(
    "http://localhost/api/cron/csf-class-workbook-refresh",
    { method, headers: { authorization: `Bearer ${token}` } },
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  actionCalls.length = 0;
  rpcResults = [];
  actionResult = { success: true };
  process.env.CSF_WORKBOOK_WORKER_SECRET_TOKEN = "synthetic-workbook-token";
  process.env.CSF_WORKBOOK_WORKER_ENABLED = "false";
  delete process.env.CRON_TOKEN;
  delete process.env.CRON_SECRET;
});

describe("CSF class workbook refresh route", () => {
  test("rejects unauthorized calls before the database or action", async () => {
    expect((await POST(request("wrong-token"))).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(actionCalls).toHaveLength(0);
  });

  test("keeps the worker disabled unless the exact flag is true", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      claimed: 0,
      prepared: 0,
      blocked: 0,
    });
    expect(rpcCalls).toHaveLength(0);
  });

  test("allows Vercel GET auth but refuses work without the worker secret", async () => {
    delete process.env.CSF_WORKBOOK_WORKER_SECRET_TOKEN;
    process.env.CRON_SECRET = "synthetic-cron-secret";
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    const response = await GET(request("synthetic-cron-secret", "GET"));
    expect(response.status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
  });

  test("returns count-only truth when no job is available", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: false }, error: null }];
    const response = await POST(request());
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 0,
      prepared: 0,
      blocked: 0,
    });
    expect(actionCalls).toHaveLength(0);
  });

  test("prepares the claimed version and settles aggregate counts", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true }, error: null },
    ];
    actionResult = {
      success: true,
      preparedTermCodes: ["2032-fall", "2033-spring"],
      templateTermCodes: ["2033-fall"],
      missingTabTermCodes: [],
      discoveredTabs: [
        { tabName: "Fall 2032" },
        { tabName: "Spring 2033" },
      ],
    };

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 1,
      prepared: 2,
      templates: 1,
      blocked: 0,
      status: "completed",
    });
    expect(actionCalls).toHaveLength(1);
    const formData = actionCalls[0]?.[1] as FormData;
    expect(formData.get("expectedProviderVersion")).toBe("125");
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "csf_claim_class_workbook_refresh_job",
      "csf_finish_class_workbook_refresh_job",
    ]);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_status: "completed",
      p_prepared_count: 2,
      p_template_count: 1,
      p_blocked_count: 0,
    });
  });

  test("fails closed on malformed queue claims", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: true, jobId: "not-a-uuid" }, error: null }];
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(actionCalls).toHaveLength(0);
  });
});
