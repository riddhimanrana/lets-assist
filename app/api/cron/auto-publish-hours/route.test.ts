import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
mock.module("server-only", () => ({}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { log() {}, warn() {}, error() {} },
}));

let queryFailure = false;
let queryCalls = 0;
let probe: NextResponse | null = null;
const receipts: Array<{
  operation: string;
  parameters: Record<string, unknown>;
}> = [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: (operation: string, parameters: Record<string, unknown>) => ({
      abortSignal: async () => {
        receipts.push({ operation, parameters });
        return { error: null };
      },
    }),
  }),
}));
mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      queryCalls++;
      const chain = {
        select: () => chain,
        not: () => chain,
        gte: () => chain,
        lte: () => chain,
        in: async () => ({
          data: queryFailure ? null : [],
          error: queryFailure ? { message: "private upstream detail" } : null,
        }),
      };
      return chain;
    },
  }),
}));
mock.module("@/lib/cron/auth-shape-probe", () => ({
  cronAuthShapeProbe: () => probe,
}));
mock.module("@/lib/projects/hours-publication-email-service", () => ({
  drainPublicationEmails: () => {
    throw new Error("Unexpected mail work");
  },
}));
mock.module("@/lib/projects/hours-publication-service", () => ({
  publishVolunteerHoursTransaction: () => {
    throw new Error("Unexpected publication");
  },
}));
const { GET, POST } = await import("./route");
const keys = [
  "CRON_TOKEN",
  "CRON_SECRET",
  "AUTO_PUBLISH_SECRET_TOKEN",
  "AUTO_PUBLISH_ENABLED",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
beforeEach(() => {
  keys.forEach((key) => delete process.env[key]);
  process.env.CRON_TOKEN = "fictional-local-cron";
  process.env.AUTO_PUBLISH_ENABLED = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-unused-key";
  queryFailure = false;
  queryCalls = 0;
  receipts.length = 0;
  probe = null;
});
function request(token = "fictional-local-cron", status = false) {
  return new NextRequest(
    `http://127.0.0.1/api/cron/auto-publish-hours${status ? "?status=1" : ""}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
}
test("unauthorized, probe, disabled, and status requests create no execution receipt", async () => {
  expect((await POST(request("wrong"))).status).toBe(401);
  probe = NextResponse.json({ mode: "auth-shape-v1", dispatched: false });
  expect(await POST(request())).toBe(probe);
  probe = null;
  process.env.AUTO_PUBLISH_ENABLED = "false";
  expect((await POST(request())).status).toBe(200);
  process.env.AUTO_PUBLISH_ENABLED = "true";
  expect((await GET(request("fictional-local-cron", true))).status).toBe(200);
  expect(queryCalls).toBe(0);
  expect(receipts).toHaveLength(0);
});
test("a failed eligible-signup query returns failure and records failure instead of an empty queue", async () => {
  queryFailure = true;
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private upstream detail",
  );
  expect(queryCalls).toBe(1);
  expect(receipts.map((r) => r.operation)).toEqual([
    "start_worker_run_receipt",
    "finish_worker_run_receipt",
  ]);
  expect(receipts[1].parameters.p_result).toMatchObject({
    outcome: "failed",
    code: "unhandled_error",
    completed: 0,
  });
});
test("a confirmed empty query records one enabled empty pass", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    processedSessions: 0,
    successfulSessions: 0,
    pendingSessions: 0,
  });
  expect(receipts).toHaveLength(2);
  expect(receipts[1].parameters).toMatchObject({
    p_worker_key: "auto-publish-hours",
    p_result: { outcome: "no_run", code: "empty_queue" },
  });
});
