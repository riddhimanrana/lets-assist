import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const actionCalls: unknown[][] = [];
let rpcResults: Array<{ data: unknown; error: unknown }> = [];
let actionResult: Record<string, unknown>;
let applicationResult: unknown;
let applicationCalls = 0;
let applicationThrows = false;
let metadataResult: unknown;
let metadataCalls = 0;
let dispatchResult: unknown;
let dispatchCalls = 0;
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/automatic-class-preview-dispatch",
  () => ({
    dispatchCsfAutomaticClassPreviews: async () => {
      dispatchCalls++;
      return dispatchResult;
    },
  }),
);
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/automatic-class-workbook-check",
  () => ({
    checkNextCsfAutomaticClassWorkbook: async () => {
      metadataCalls++;
      return metadataResult;
    },
  }),
);
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/automatic-application-sheet-refresh",
  () => ({
    prepareNextCsfAutomaticApplicationSheet: async () => {
      applicationCalls++;
      if (applicationThrows)
        throw new Error("fictional private provider detail");
      return applicationResult;
    },
  }),
);

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

const { GET, POST, maxDuration } = await import("./route");
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
  applicationCalls = 0;
  applicationThrows = false;
  applicationResult = { status: "idle", claimed: 0, prepared: 0 };
  metadataCalls = 0;
  metadataResult = { status: "idle", claimed: 0, queued: 0 };
  dispatchCalls = 0;
  dispatchResult = {
    checked: 0,
    queued: 0,
    needsAttention: 0,
    blocked: 0,
    unknown: 0,
  };
  process.env.CSF_WORKBOOK_WORKER_SECRET_TOKEN = "synthetic-workbook-token";
  process.env.CSF_WORKBOOK_WORKER_ENABLED = "false";
  delete process.env.CRON_TOKEN;
  delete process.env.CRON_SECRET;
});

describe("CSF class workbook refresh route", () => {
  test("dispatches completed class previews even without a new workbook job", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: false }, error: null }];
    dispatchResult = {
      checked: 3,
      queued: 2,
      needsAttention: 1,
      blocked: 0,
      unknown: 0,
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      automaticClassImports: dispatchResult,
      prepared: 0,
    });
    expect(dispatchCalls).toBe(1);
  });
  test("preserves unknown class queue outcomes without reporting success", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: false }, error: null }];
    dispatchResult = { privateDetail: "fictional-private-detail" };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      automaticClassImports: { unknown: 1, queued: 0 },
    });
  });
  test("checks due workbook metadata without reporting a prepared import", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: false }, error: null }];
    metadataResult = { status: "queued", claimed: 1, queued: 1 };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 0,
      prepared: 0,
      blocked: 0,
      workbookChecks: { status: "queued", claimed: 1, queued: 1 },
    });
    expect(metadataCalls).toBe(1);
  });
  test("an unknown metadata result keeps its own count-only failure", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: false }, error: null }];
    metadataResult = { privateDetail: "fictional-provider-detail" };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      workbookChecks: { status: "unknown", claimed: 0, queued: 0 },
    });
  });
  test("allows one workbook run to finish within the worker budget", () => {
    expect(maxDuration).toBe(800);
  });

  test("rejects unauthorized calls before the database or action", async () => {
    expect((await POST(request("wrong-token"))).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(actionCalls).toHaveLength(0);
    expect(applicationCalls).toBe(0);
    expect(metadataCalls).toBe(0);
    expect(dispatchCalls).toBe(0);
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
    expect(applicationCalls).toBe(0);
    expect(metadataCalls).toBe(0);
    expect(dispatchCalls).toBe(0);
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
      { data: { finished: true, status: "completed" }, error: null },
    ];
    actionResult = {
      success: true,
      workerDisposition: "completed",
      preparedTermCodes: ["2032-fall", "2033-spring"],
      templateTermCodes: ["2033-fall"],
      missingTabTermCodes: [],
      discoveredTabs: [{ tabName: "Fall 2032" }, { tabName: "Spring 2033" }],
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

  test("settles a finished preparation cycle while retaining per-term review exceptions", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "completed" }, error: null },
    ];
    actionResult = {
      success: true,
      workerDisposition: "completed",
      preparedTermCodes: ["S25", "F25"],
      templateTermCodes: ["S26"],
      blockedTermCodes: ["F24"],
      missingTabTermCodes: ["S24"],
      discoveredTabs: ["F24", "S25", "F25", "S26"],
    };
    const response = await POST(request());
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 1,
      prepared: 2,
      templates: 1,
      blocked: 2,
      status: "completed",
    });
    expect(rpcCalls[1]?.args).toMatchObject({
      p_status: "completed",
      p_prepared_count: 2,
      p_template_count: 1,
      p_blocked_count: 2,
    });
    expect(rpcCalls[1]?.args.p_discovered_tabs).toEqual([
      "F24",
      "S25",
      "F25",
      "S26",
    ]);
  });

  test("fails closed on malformed queue claims", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [
      { data: { claimed: true, jobId: "not-a-uuid" }, error: null },
    ];
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(actionCalls).toHaveLength(0);
  });

  test("fails closed when workbook settlement returns an unsettled payload", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: false, status: "blocked" }, error: null },
    ];
    actionResult = { success: true, workerDisposition: "completed" };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Workbook result could not be settled",
    });
  });

  test.each(["retryable", "unknown"])(
    "leaves a %s worker result leased for safe reconciliation",
    async (workerDisposition) => {
      process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
      rpcResults = [{ data: claim, error: null }];
      actionResult = { success: false, workerDisposition };

      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Workbook preparation did not settle",
      });
      expect(rpcCalls.map((call) => call.name)).toEqual([
        "csf_claim_class_workbook_refresh_job",
      ]);
    },
  );

  test("settles a closed reconnect result without parsing error copy", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "needs_reconnect" }, error: null },
    ];
    actionResult = {
      success: false,
      error: "Provider copy may change.",
      workerDisposition: "needs_reconnect",
    };

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 1,
      prepared: 0,
      templates: 0,
      blocked: 1,
      status: "needs_reconnect",
    });
    expect(rpcCalls[1]?.args.p_status).toBe("needs_reconnect");
  });

  test("reports a database safety downgrade as a settled block", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "blocked" }, error: null },
    ];
    actionResult = {
      success: true,
      workerDisposition: "completed",
      preparedTermCodes: ["2032-fall"],
    };

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 1,
      prepared: 0,
      templates: 0,
      blocked: 1,
      status: "blocked",
    });
  });
  test("checks application sources even when no class workbook is queued", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: false }, error: null }];
    applicationResult = {
      status: "prepared",
      claimed: 1,
      prepared: 1,
      privateSource: "fictional-private-sheet",
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 0,
      prepared: 0,
      blocked: 0,
      applications: { status: "prepared", claimed: 1, prepared: 1 },
    });
    expect(applicationCalls).toBe(1);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  test("a class queue outage does not skip due application work", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    rpcResults = [{ data: null, error: { message: "fictional queue outage" } }];
    applicationResult = { status: "unchanged", claimed: 1, prepared: 0 };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).applications.status).toBe("unchanged");
    expect(applicationCalls).toBe(1);
  });
  test.each(["retryable", "unknown"])(
    "reports unsettled application work as %s without hiding class outcomes",
    async (status) => {
      process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
      rpcResults = [{ data: { claimed: false }, error: null }];
      applicationResult = { status, claimed: 1, prepared: 0 };
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect((await response.json()).applications).toEqual({
        status,
        claimed: 1,
        prepared: 0,
      });
    },
  );
  test("does not expose thrown provider details or malformed application results", async () => {
    process.env.CSF_WORKBOOK_WORKER_ENABLED = "true";
    applicationThrows = true;
    rpcResults = [{ data: { claimed: false }, error: null }];
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "fictional private provider detail",
    );
    applicationThrows = false;
    applicationResult = { status: "prepared", claimed: -1, prepared: 99 };
    rpcResults = [{ data: { claimed: false }, error: null }];
    expect((await POST(request())).status).toBe(503);
  });
});
