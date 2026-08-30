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

const { POST } = await import("./route");
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
  actionResult = { success: true, message: "Imported." };
  process.env.CSF_IMPORT_WORKER_SECRET_TOKEN = "synthetic-import-token";
  process.env.CSF_IMPORT_WORKER_ENABLED = "false";
  delete process.env.CRON_TOKEN;
  delete process.env.CRON_SECRET;
});

describe("CSF import commit worker route", () => {
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
      { data: { finished: true }, error: null },
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
    expect(rpcCalls[1]?.args).toMatchObject({
      p_status: "completed",
      p_result_counts: { completed: 1 },
    });
  });

  test("settles a refused commit as blocked", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [
      { data: claim, error: null },
      { data: { finished: true }, error: null },
    ];
    actionResult = { success: false, error: "Review required." };
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ blocked: 1, completed: 0 });
    expect(rpcCalls[1]?.args.p_status).toBe("blocked");
  });

  test("fails closed on malformed claims", async () => {
    process.env.CSF_IMPORT_WORKER_ENABLED = "true";
    rpcResults = [{ data: { claimed: true }, error: null }];
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(actionCalls).toHaveLength(0);
  });
});
