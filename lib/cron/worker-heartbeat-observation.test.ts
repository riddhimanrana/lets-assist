import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("No database or provider access");
  },
}));
const { observeWorkerRun } = await import("./worker-observation");
const { workerResponseSummary } = await import("./worker-response-summary");
import type { WorkerObservationDependencies } from "./worker-observation";
import type { reportWorkerHeartbeat } from "./worker-heartbeat";
type Input = Parameters<typeof reportWorkerHeartbeat>[0];
function harness(failPhase?: "start" | "finish") {
  const calls: Input[] = [];
  const order: string[] = [];
  const deps: WorkerObservationDependencies = {
    write: async (operation) => {
      order.push(operation);
      if (operation.startsWith(failPhase ?? "none"))
        throw new Error("Fixture missing or already-finalized row");
    },
    now: () => 100,
    id: () => "ba100000-0000-4000-8000-000000000002",
    environment: "production",
    sourceSha: "a".repeat(40),
    unavailable: () => undefined,
    reportHeartbeat: async (input) => {
      order.push("heartbeat");
      calls.push(input);
      return input.outcome.outcome === "no_run"
        ? "scheduler_completed_empty"
        : input.outcome.outcome === "processed"
          ? "work_completed"
          : "failed_signaled";
    },
  };
  return { calls, order, deps };
}
test("only an acknowledged finalized receipt precedes a scheduler heartbeat", async () => {
  for (const results of [[], [{ success: true }]]) {
    const h = harness();
    const body = { processed: results.length, results };
    const summary = workerResponseSummary("organization-calendar-sync");
    const response = Response.json(body);
    expect(
      await observeWorkerRun(
        "organization-calendar-sync",
        async () => {
          summary.capture(body);
          return response;
        },
        summary,
        h.deps,
        { heartbeatOwner: "vercel_cron" },
      ),
    ).toBe(response);
    expect(h.order).toEqual([
      "start_worker_run_receipt",
      "finish_worker_run_receipt",
      "heartbeat",
    ]);
    expect(h.calls[0]).toMatchObject({
      committed: true,
      owner: "vercel_cron",
      environment: "production",
      responseOk: true,
      blocked: false,
    });
    expect(response.headers.get("x-lets-assist-worker-receipt")).toBe(
      "committed",
    );
    expect(response.headers.get("x-lets-assist-worker-heartbeat")).toBe(
      results.length ? "work_completed" : "scheduler_completed_empty",
    );
    expect(await response.json()).toEqual(body);
  }
});
test("missing or unacknowledged start/finish cannot report completed execution", async () => {
  for (const phase of ["start", "finish"] as const) {
    const h = harness(phase);
    const response = await observeWorkerRun(
      "organization-calendar-sync",
      async () => Response.json({ processed: 0, results: [] }),
      undefined,
      h.deps,
      { heartbeatOwner: "vercel_cron" },
    );
    expect(h.calls).toHaveLength(0);
    expect(response.headers.get("x-lets-assist-worker-receipt")).toBe(
      "unavailable",
    );
    expect(response.headers.get("x-lets-assist-worker-heartbeat")).toBe(
      "not_sent",
    );
    expect(response.status).toBe(200);
  }
});
test("partial failure keeps the business response and durable aggregate before fail signaling", async () => {
  const h = harness();
  const body = {
    processed: 2,
    results: [
      { success: true },
      { success: false, error: "private diagnostic" },
    ],
  };
  const summary = workerResponseSummary("organization-sheet-sync");
  const response = Response.json(body, { status: 503 });
  expect(
    await observeWorkerRun(
      "organization-sheet-sync",
      async () => {
        summary.capture(body);
        return response;
      },
      summary,
      h.deps,
      { heartbeatOwner: "vercel_cron" },
    ),
  ).toBe(response);
  expect(h.calls[0].outcome).toMatchObject({
    outcome: "partial",
    attempted: 2,
    completed: 1,
    failed: 1,
  });
  expect(JSON.stringify(h.calls)).not.toContain("private");
  expect(response.status).toBe(503);
  expect(response.headers.get("x-lets-assist-worker-heartbeat")).toBe(
    "failed_signaled",
  );
});
test("heartbeat transport failure cannot turn provider result into a different result", async () => {
  const h = harness();
  h.deps.reportHeartbeat = async () => "delivery_failed";
  const response = Response.json({
    processed: 1,
    results: [{ success: true }],
  });
  expect(
    await observeWorkerRun(
      "organization-calendar-sync",
      async () => response,
      undefined,
      h.deps,
      { heartbeatOwner: "vercel_cron" },
    ),
  ).toBe(response);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-lets-assist-worker-heartbeat")).toBe(
    "delivery_failed",
  );
});
test("a thrown worker is finalized as failed and rethrows the same failure", async () => {
  const h = harness();
  const failure = new Error("private domain error");
  await expect(
    observeWorkerRun(
      "organization-calendar-sync",
      async () => {
        throw failure;
      },
      undefined,
      h.deps,
      { heartbeatOwner: "vercel_cron" },
    ),
  ).rejects.toBe(failure);
  expect(h.order).toEqual([
    "start_worker_run_receipt",
    "finish_worker_run_receipt",
    "heartbeat",
  ]);
  expect(h.calls[0].outcome).toMatchObject({
    outcome: "failed",
    code: "unhandled_error",
  });
  expect(JSON.stringify(h.calls)).not.toContain("private");
});
test("hours approval and discovery blockers are supplied to heartbeat policy", async () => {
  for (const extra of [
    { approvalStatus: "approval_required", discoveryCounted: true },
    { approvalStatus: "approved", discoveryCounted: false },
    {
      approvalStatus: "approved",
      discoveryCounted: true,
      heldSessions: {
        historical: 1,
        oversized: 0,
        invalidAttendance: 0,
        missingCreator: 0,
        invalidSchedule: 0,
      },
    },
  ]) {
    const h = harness();
    const summary = workerResponseSummary("auto-publish-hours");
    const body = {
      processedSessions: 0,
      successfulSessions: 0,
      results: [],
      heldSessions: {
        historical: 0,
        oversized: 0,
        invalidAttendance: 0,
        missingCreator: 0,
        invalidSchedule: 0,
      },
      ...extra,
    };
    await observeWorkerRun(
      "auto-publish-hours",
      async () => {
        summary.capture(body);
        return Response.json(body);
      },
      summary,
      h.deps,
      { heartbeatOwner: "vercel_cron" },
    );
    expect(h.calls[0].blocked).toBe(true);
  }
});
