import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
mock.module("server-only", () => ({}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { log() {}, warn() {}, error() {} },
}));

let claimFailure = false;
let recoveryFailure = false;
let heldHistorical = 0;
let pendingDeliveries = 0;
let heldDeliveries = 0;
let probe: NextResponse | null = null;
// The only outbound request this route can make here is a heartbeat ping.
const heartbeatUrl =
  "https://uptime.betterstack.com/api/v1/heartbeat/fictionalheartbeat0001";
const pings: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  pings.push(String(input));
  return new Response(null, { status: 200 });
}) as unknown as typeof globalThis.fetch;
const workerCalls: Array<{
  operation: string;
  parameters: Record<string, unknown>;
}> = [];
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
const upstreamFailure = { code: "57014", message: "private upstream detail" };
mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      throw new Error("Unexpected table read");
    },
    rpc: async (operation: string, parameters: Record<string, unknown>) => {
      workerCalls.push({ operation, parameters });
      if (operation === "claim_due_hours_publications") {
        return claimFailure
          ? { data: null, error: upstreamFailure }
          : {
              data: {
                contended: false,
                counted: true,
                sessions: [],
                pendingSessions: 0,
                heldSessions: {
                  historical: heldHistorical,
                  oversized: 0,
                  invalidAttendance: 0,
                  missingCreator: 0,
                  invalidSchedule: 0,
                },
              },
              error: null,
            };
      }
      if (operation === "claim_hours_publication_email_recovery") {
        return recoveryFailure
          ? { data: null, error: upstreamFailure }
          : {
              data: {
                counted: true,
                pendingDeliveries,
                heldDeliveries,
                groups: [],
              },
              error: null,
            };
      }
      throw new Error("Unexpected worker RPC");
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
  isTransactionalPublication: () => false,
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
  "AUTO_PUBLISH_APPROVED_FROM",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERCEL_ENV",
  "BETTERSTACK_AUTO_PUBLISH_HEARTBEAT_URL",
] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
beforeEach(() => {
  keys.forEach((key) => delete process.env[key]);
  process.env.CRON_TOKEN = "fictional-local-cron";
  process.env.AUTO_PUBLISH_ENABLED = "true";
  process.env.AUTO_PUBLISH_APPROVED_FROM = "2026-01-01T00:00:00.000Z";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-unused-key";
  claimFailure = false;
  recoveryFailure = false;
  heldHistorical = 0;
  pendingDeliveries = 0;
  heldDeliveries = 0;
  workerCalls.length = 0;
  receipts.length = 0;
  pings.length = 0;
  probe = null;
});
// The scheduled Production invocation: a GET carrying Vercel's cron agent.
function scheduled(
  method = "GET",
  agent = "vercel-cron/1.0",
  token = "fictional-local-cron",
) {
  process.env.VERCEL_ENV = "production";
  process.env.BETTERSTACK_AUTO_PUBLISH_HEARTBEAT_URL = heartbeatUrl;
  return new NextRequest("http://127.0.0.1/api/cron/auto-publish-hours", {
    method,
    headers: { authorization: `Bearer ${token}`, "user-agent": agent },
  });
}
const heartbeatStatus = (response: Response) =>
  response.headers.get("x-lets-assist-worker-heartbeat");
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
  expect(workerCalls).toHaveLength(0);
  expect(receipts).toHaveLength(0);
});
test("a valid secret in malformed authorization cannot invoke hours publication or status", async () => {
  for (const authorization of [
    "fictional-local-cron",
    "bearer fictional-local-cron",
    "Bearer  fictional-local-cron",
    "Bearer fictional-local-cron extra",
  ]) {
    for (const status of [false, true]) {
      const response = await GET(
        new NextRequest(
          `http://127.0.0.1/api/cron/auto-publish-hours${status ? "?status=1" : ""}`,
          { headers: { authorization } },
        ),
      );
      expect(response.status).toBe(401);
    }
  }
  expect(workerCalls).toHaveLength(0);
  expect(receipts).toHaveLength(0);
});
test("a failed publication claim returns failure and records failure instead of an empty queue", async () => {
  claimFailure = true;
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private upstream detail",
  );
  expect(workerCalls.map((call) => call.operation)).toEqual([
    "claim_due_hours_publications",
  ]);
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
test("a failed email recovery claim returns failure without leaking the upstream error", async () => {
  recoveryFailure = true;
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private upstream detail",
  );
  expect(receipts[1].parameters.p_result).toMatchObject({
    outcome: "failed",
    code: "unhandled_error",
  });
});
test("a confirmed empty claim records one enabled empty pass with separate recovery counters", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    approvalStatus: "approved",
    discoveryCounted: true,
    heldSessions: {
      historical: 0,
      oversized: 0,
      invalidAttendance: 0,
      missingCreator: 0,
      invalidSchedule: 0,
    },
    processedSessions: 0,
    successfulSessions: 0,
    pendingSessions: 0,
    discovery: {
      counted: true,
      contended: false,
      pendingSessions: 0,
      heldSessions: { historical: 0, oversized: 0 },
    },
    recovery: {
      counted: true,
      pending: 0,
      held: 0,
      deliveries: 0,
      accepted: 0,
      partial: 0,
      settlementUnconfirmed: 0,
    },
    results: [],
  });
  // A manual call never owns the heartbeat, even for a healthy empty pass.
  expect(pings).toHaveLength(0);
  expect(heartbeatStatus(response)).toBe("not_sent");
  expect(workerCalls).toEqual([
    {
      operation: "claim_due_hours_publications",
      parameters: { p_approved_from: "2026-01-01T00:00:00.000Z", p_limit: 10 },
    },
    {
      operation: "claim_hours_publication_email_recovery",
      parameters: { p_limit: 25 },
    },
  ]);
  expect(receipts).toHaveLength(2);
  expect(receipts[1].parameters).toMatchObject({
    p_worker_key: "auto-publish-hours",
    p_result: { outcome: "no_run", code: "empty_queue" },
  });
});
test("held historical sessions are reported top-level and never record an empty pass", async () => {
  heldHistorical = 2;
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    approvalStatus: "approved",
    discoveryCounted: true,
    heldSessions: { historical: 2, invalidSchedule: 0 },
    pendingSessions: 0,
  });
  expect(receipts[1].parameters.p_result).toMatchObject({
    outcome: "partial",
    code: "partial_work",
    completed: 0,
    refused: 2,
  });
});
test("fallback retries pending or held recovery without receiving a false success", async () => {
  for (const held of [false, true]) {
    pendingDeliveries = held ? 0 : 1;
    heldDeliveries = held ? 1 : 0;
    const response = await POST(
      scheduled("POST", "lets-assist-cron/Auto-Publish Hours"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      recovery: {
        counted: true,
        pending: pendingDeliveries,
        held: heldDeliveries,
      },
    });
    expect(heartbeatStatus(response)).toBe("not_sent");
    expect(receipts.at(-1)?.parameters.p_result).toMatchObject({
      outcome: "partial",
    });
  }
  pendingDeliveries = 0;
  heldDeliveries = 0;
  const retry = await POST(
    scheduled("POST", "lets-assist-cron/Auto-Publish Hours"),
  );
  expect(retry.status).toBe(200);
  expect(receipts.at(-1)?.parameters.p_result).toMatchObject({
    outcome: "no_run",
    code: "empty_queue",
  });
  expect(heartbeatStatus(retry)).toBe("not_sent");
  expect(pings).toHaveLength(0);
});
test("the scheduled Production GET owns the heartbeat and reports an authoritative empty pass", async () => {
  const response = await GET(scheduled());
  expect(response.status).toBe(200);
  expect(receipts[1].parameters.p_result).toMatchObject({
    outcome: "no_run",
    code: "empty_queue",
  });
  expect(response.headers.get("x-lets-assist-worker-receipt")).toBe(
    "committed",
  );
  expect(heartbeatStatus(response)).toBe("scheduler_completed_empty");
  // One ping, to the success endpoint, after the receipt was written.
  expect(pings).toEqual([heartbeatUrl]);
});
test("the scheduled heartbeat fails for pending mail, held sessions, and missing approval", async () => {
  pendingDeliveries = 1;
  let response = await GET(scheduled());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    recovery: { counted: true, pending: 1, deliveries: 0 },
  });
  expect(receipts[1].parameters.p_result).toMatchObject({
    outcome: "partial",
    pending: 1,
  });
  expect(heartbeatStatus(response)).toBe("failed_signaled");

  pendingDeliveries = 0;
  heldHistorical = 1;
  response = await GET(scheduled());
  expect(response.status).toBe(503);
  expect(heartbeatStatus(response)).toBe("failed_signaled");

  heldHistorical = 0;
  delete process.env.AUTO_PUBLISH_APPROVED_FROM;
  response = await GET(scheduled());
  expect(response.status).toBe(503);
  expect(heartbeatStatus(response)).toBe("failed_signaled");

  expect(pings).toEqual([
    `${heartbeatUrl}/fail`,
    `${heartbeatUrl}/fail`,
    `${heartbeatUrl}/fail`,
  ]);
});
test("a scheduled run whose claim fails signals failure and still returns a sanitized 500", async () => {
  claimFailure = true;
  const response = await GET(scheduled());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private upstream detail",
  );
  expect(pings).toEqual([`${heartbeatUrl}/fail`]);
});
test("manual and fallback callers keep their own heartbeat in Production", async () => {
  for (const manual of [
    scheduled("POST"),
    scheduled("GET", "curl/8.4.0"),
    scheduled("GET", "vercel-cron/1.0 extra"),
  ]) {
    receipts.length = 0;
    const response = await (manual.method === "POST" ? POST : GET)(manual);
    expect(response.status).toBe(200);
    // The run is still recorded. Only the ping is left to the caller.
    expect(receipts.map((receipt) => receipt.operation)).toEqual([
      "start_worker_run_receipt",
      "finish_worker_run_receipt",
    ]);
    expect(heartbeatStatus(response)).toBe("not_sent");
  }
  expect(pings).toHaveLength(0);
});
test("unauthorized, probe, disabled, and status requests never reach the heartbeat", async () => {
  expect((await GET(scheduled("GET", "vercel-cron/1.0", "wrong"))).status).toBe(
    401,
  );
  probe = NextResponse.json({ mode: "auth-shape-v1", dispatched: false });
  expect(await GET(scheduled())).toBe(probe);
  probe = null;
  process.env.AUTO_PUBLISH_ENABLED = "false";
  expect((await GET(scheduled())).status).toBe(200);
  expect(pings).toHaveLength(0);
  expect(receipts).toHaveLength(0);
  expect(workerCalls).toHaveLength(0);
});
test("the scheduled GET sends no heartbeat outside Production", async () => {
  const request = scheduled();
  delete process.env.VERCEL_ENV;
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(heartbeatStatus(response)).toBe("not_sent");
  expect(pings).toHaveLength(0);
});
test("a missing or offset approval boundary blocks discovery and reports unknown counts", async () => {
  for (const value of [undefined, "2026-01-01T00:00:00+00:00"]) {
    if (value === undefined) delete process.env.AUTO_PUBLISH_APPROVED_FROM;
    else process.env.AUTO_PUBLISH_APPROVED_FROM = value;
    workerCalls.length = 0;
    receipts.length = 0;

    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      approvalStatus: "approval_required",
      discoveryCounted: false,
      heldSessions: null,
      processedSessions: 0,
      successfulSessions: 0,
      discovery: {
        counted: false,
        contended: false,
        pendingSessions: null,
        heldSessions: null,
      },
      results: [],
    });
    expect(Object.hasOwn(body, "pendingSessions")).toBe(false);
    // Already-committed email work stays recoverable without the boundary.
    expect(workerCalls.map((call) => call.operation)).toEqual([
      "claim_hours_publication_email_recovery",
    ]);
    // The receipt says the pass was refused. It is never an empty queue.
    expect(receipts[1].parameters.p_result).toMatchObject({
      outcome: "partial",
      code: "partial_work",
      refused: 1,
      pending: 0,
    });
  }
});
