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
mock.module("@/services/csf-import-commit-worker", () => ({
  executeCsfImportCommitClaim: async (...args: unknown[]) => {
    actionCalls.push(args);
    return actionResult;
  },
}));
const { POST, maxDuration } = await import("./route");
const { NextRequest } = await import("next/server");

const claim = {
  claimed: true,
  queueId: "cc000000-0000-4000-8000-000000000001",
  leaseToken: "cc000000-0000-4000-8000-000000000002",
  organizationId: "cc000000-0000-4000-8000-000000000003",
  previewJobId: "cc000000-0000-4000-8000-000000000004",
  actorUserId: "cc000000-0000-4000-8000-000000000005",
};

function request(token = "synthetic-import-token") {
  return new NextRequest("http://localhost/api/cron/csf-import-commit", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  rpcCalls.length = 0;
  actionCalls.length = 0;
  rpcResults = [];
  actionResult = {
    success: true,
    message: "Imported.",
    workerDisposition: "completed",
    finalStatus: "completed",
  };
  process.env.CSF_IMPORT_WORKER_SECRET_TOKEN = "synthetic-import-token";
  process.env.CSF_IMPORT_WORKER_ENABLED = "false";
  delete process.env.CRON_TOKEN;
  delete process.env.CRON_SECRET;
});

describe("CSF import commit worker route", () => {
  test("allows one receipt-backed import attempt to finish", () => {
    expect(maxDuration).toBe(800);
  });

  test("rejects unauthorized calls before claiming work", async () => {
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  test("does no work while disabled", async () => {
    const response = await POST(request());
    expect(await response.json()).toEqual({
      enabled: false,
      claimed: 0,
      completed: 0,
      blocked: 0,
    });
    expect(rpcCalls).toHaveLength(0);
  });

  test("claims one preview, commits it, and settles the queue receipt", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "completed" }, error: null },
    ];
    const response = await POST(request());
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 1,
      completed: 1,
      blocked: 0,
    });
    expect(actionCalls).toHaveLength(1);
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "csf_claim_import_commit_queue",
      "csf_finish_import_commit_queue",
    ]);
    expect(rpcCalls[0]?.args.p_lease_seconds).toBeGreaterThan(maxDuration);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_status: "completed",
      p_result_counts: { completed: 1 },
    });
  });

  test("settles a refused commit as blocked", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "blocked" }, error: null },
    ];
    actionResult = {
      success: false,
      error: "Reconnect Google Drive before importing.",
      workerDisposition: "blocked",
    };
    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      blocked: 1,
      completed: 0,
      errorCode: "google_reconnect_required",
    });
    expect(rpcCalls[1]?.args.p_status).toBe("blocked");
    expect(rpcCalls[1]?.args.p_error_code).toBe("google_reconnect_required");
  });

  test.each([
    "source_check_failed",
    "source_not_found",
    "google_reconnect_required",
  ])(
    "preserves the structured %s reason without reading error prose",
    async (reasonCode) => {
      process.env.CSF_IMPORT_WORKER_ENABLED = "true";
      rpcResults = [
        { data: claim, error: null },
        { data: { finished: true, status: "blocked" }, error: null },
      ];
      actionResult = {
        success: false,
        workerDisposition: "blocked",
        reasonCode,
        error: "private provider detail",
      };
      const response = await POST(request());
      expect(await response.json()).toMatchObject({
        errorCode: reasonCode,
        blocked: 1,
      });
      expect(rpcCalls[1]?.args.p_error_code).toBe(reasonCode);
      expect(JSON.stringify(rpcCalls)).not.toContain("private provider detail");
    },
  );

  test("fails closed on malformed claims", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: true }, error: null }];
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(actionCalls).toHaveLength(0);
  });

  test("does not persist an unrecognized structured reason", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "blocked" }, error: null },
    ];
    actionResult = {
      success: false,
      workerDisposition: "blocked",
      reasonCode: "private provider detail",
      error: "Reconnect Google Drive before importing.",
    };
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ errorCode: "commit_failed" });
    expect(rpcCalls[1]?.args.p_error_code).toBe("commit_failed");
    expect(JSON.stringify(rpcCalls)).not.toContain("private provider detail");
  });

  test("reports a completed logical commit reconciled during claim", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      {
        data: {
          claimed: false,
          reconciled: true,
          status: "completed",
          commitStatus: "completed",
        },
        error: null,
      },
    ];
    const response = await POST(request());
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 0,
      reconciled: 1,
      completed: 1,
      blocked: 0,
      commitStatus: "completed",
    });
    expect(actionCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
  });

  test("reports a partial logical commit reconciled as blocked", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      {
        data: {
          claimed: false,
          reconciled: true,
          status: "blocked",
          commitStatus: "partially_completed",
        },
        error: null,
      },
    ];
    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      reconciled: 1,
      completed: 0,
      blocked: 1,
      commitStatus: "partially_completed",
    });
    expect(actionCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
  });

  test.each(["retryable", "unknown"] as const)(
    "leaves a %s attempt leased for recovery",
    async (workerDisposition) => {
      process.env.CSF_IMPORT_WORKER_ENABLED = "true";
      rpcResults = [{ data: claim, error: null }];
      actionResult = {
        success: false,
        error: "The bounded row batch did not settle.",
        workerDisposition,
      };
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        disposition: workerDisposition,
      });
      expect(rpcCalls.map((call) => call.name)).toEqual([
        "csf_claim_import_commit_queue",
      ]);
    },
  );

  test("settles a partial logical commit as blocked", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true, status: "blocked" }, error: null },
    ];
    actionResult = {
      success: true,
      message: "Some rows need review.",
      workerDisposition: "blocked",
      finalStatus: "partially_completed",
    };
    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      completed: 0,
      blocked: 1,
      errorCode: "import_partially_completed",
    });
    expect(rpcCalls[1]?.args).toMatchObject({
      p_status: "blocked",
      p_result_counts: { completed: 0, blocked: 1 },
      p_error_code: "import_partially_completed",
    });
  });

  test("does not settle an unclassified worker result", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [{ data: claim, error: null }];
    actionResult = { success: false, error: "Unclassified failure." };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "csf_claim_import_commit_queue",
    ]);
  });

  test("fails closed when queue settlement returns an unsettled payload", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: false, status: "completed" }, error: null },
    ];
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Import result could not be settled",
    });
  });
});
