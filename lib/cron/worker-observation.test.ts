import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("No provider access in unit tests");
  },
}));
const { observeWorkerRun, serverWorkerIdentity } =
  await import("./worker-observation");
import type { WorkerObservationDependencies } from "./worker-observation";
import { failedWorkerOutcome } from "./worker-outcome";
import { workerResponseSummary } from "./worker-response-summary";
const body = {
  claimed: 0,
  outcomes: {
    sent: 0,
    failed: 0,
    unknown: 0,
    retryable: 0,
    refused: 0,
    authorization_lost: 0,
  },
  faults: 0,
  deadlineReached: false,
};
function harness() {
  const writes: { operation: string; parameters: Record<string, unknown> }[] =
    [];
  const warnings: string[] = [];
  const deps: WorkerObservationDependencies = {
    write: async (operation, parameters) => {
      writes.push({ operation, parameters });
    },
    now: () => 100,
    id: () => "ba100000-0000-4000-8000-000000000001",
    environment: "local",
    sourceSha: "a".repeat(40),
    unavailable: (phase) => warnings.push(phase),
  };
  return { writes, warnings, deps };
}
test("large successful business responses retain bounded in-memory counters and unchanged output", async () => {
  const body = {
    processed: 400,
    results: Array.from({ length: 400 }, (_, index) => ({
      success: true,
      organizationId: `private-organization-${index}`,
      diagnostic: "private ".repeat(20),
    })),
  };
  expect(JSON.stringify(body).length).toBeGreaterThan(32_768);
  const summary = workerResponseSummary("organization-calendar-sync");
  const h = harness();
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
    ),
  ).toBe(response);
  expect(await response.json()).toEqual(body);
  expect(h.writes[1].parameters.p_result).toMatchObject({
    outcome: "processed",
    attempted: 400,
    completed: 400,
  });
  expect(JSON.stringify(h.writes)).not.toContain("private");
  expect(JSON.stringify(h.writes).length).toBeLessThan(2000);
});
test("in-memory summary cannot hide an error response or manufacture evidence before capture", async () => {
  for (const status of [200, 503]) {
    const summary = workerResponseSummary("ai-moderation");
    if (status === 503) summary.capture({ success: true, moderated: 0 });
    const h = harness();
    await observeWorkerRun(
      "ai-moderation",
      async () => Response.json({}, { status }),
      summary,
      h.deps,
    );
    expect(h.writes[1].parameters.p_result).toMatchObject({
      outcome: "failed",
      code: status === 503 ? "worker_failed" : "invalid_response",
    });
  }
});
test("the default response parser still refuses oversized evidence", async () => {
  const h = harness();
  await observeWorkerRun(
    "ai-moderation",
    async () =>
      Response.json({
        success: true,
        moderated: 0,
        diagnostics: "x".repeat(33_000),
      }),
    undefined,
    h.deps,
  );
  expect(h.writes[1].parameters.p_result).toMatchObject({
    outcome: "failed",
    code: "invalid_response",
  });
});
test("an 800-second worker retains its elapsed time and still caps malformed timing", async () => {
  for (const elapsed of [800_100, 950_000]) {
    const h = harness();
    let reads = 0;
    h.deps.now = () => (reads++ === 0 ? 0 : elapsed);
    await observeWorkerRun(
      "csf-class-workbook-refresh",
      async () => Response.json({ claimed: 0, prepared: 0, blocked: 0 }),
      undefined,
      h.deps,
    );
    expect(h.writes[1].parameters.p_result).toMatchObject({
      outcome: "no_run",
      durationMs: Math.min(elapsed, 900_000),
    });
    expect(h.warnings).toHaveLength(0);
  }
});
test("records start before execution and a bounded aggregate finish while preserving the response", async () => {
  const h = harness();
  const response = Response.json(body, {
    headers: { "x-worker": "preserved" },
  });
  const output = await observeWorkerRun(
    "csf-communications-dispatch",
    async () => {
      expect(h.writes.map((x) => x.operation)).toEqual([
        "start_worker_run_receipt",
      ]);
      return response;
    },
    undefined,
    h.deps,
  );
  expect(output).toBe(response);
  expect(output.headers.get("x-worker")).toBe("preserved");
  expect(await output.json()).toEqual(body);
  expect(h.writes[1].parameters.p_result).toEqual({
    outcome: "no_run",
    code: "empty_queue",
    attempted: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    refused: 0,
    faults: 0,
    deadlineReached: false,
    durationMs: 0,
  });
  expect(JSON.stringify(h.writes)).not.toContain("outcomes");
});
test("receipt errors and logger errors cannot replace worker success or failure", async () => {
  for (const phase of ["start", "finish"]) {
    const h = harness();
    h.deps.write = async (operation) => {
      if (operation.startsWith(phase))
        throw new Error("synthetic secret must not be logged");
    };
    h.deps.unavailable = () => {
      throw new Error("logger unavailable");
    };
    const response = Response.json(body);
    expect(
      await observeWorkerRun(
        "csf-communications-dispatch",
        async () => response,
        undefined,
        h.deps,
      ),
    ).toBe(response);
  }
  const h = harness();
  const failure = new Error("domain failure");
  await expect(
    observeWorkerRun(
      "csf-communications-dispatch",
      async () => {
        throw failure;
      },
      undefined,
      h.deps,
    ),
  ).rejects.toBe(failure);
  expect((h.writes[1].parameters.p_result as { code: string }).code).toBe(
    "unhandled_error",
  );
});
test("unknown response shape and oversized bodies produce a failed receipt, not a changed domain response", async () => {
  for (const response of [
    Response.json({ extra: "synthetic" }),
    new Response("x".repeat(33_000)),
  ]) {
    const h = harness();
    expect(
      await observeWorkerRun(
        "csf-communications-dispatch",
        async () => response,
        undefined,
        h.deps,
      ),
    ).toBe(response);
    expect((h.writes[1].parameters.p_result as { code: string }).code).toBe(
      "invalid_response",
    );
  }
});
test("custom export classifier supports reviewed aggregate outcomes and refuses probes", async () => {
  const h = harness();
  await observeWorkerRun(
    "data-exports",
    async () => Response.json({ processed: 1 }),
    () => ({
      ...failedWorkerOutcome("worker_failed"),
      outcome: "processed",
      code: "completed",
      attempted: 1,
      completed: 1,
      faults: 0,
    }),
    h.deps,
  );
  expect((h.writes[1].parameters.p_result as { outcome: string }).outcome).toBe(
    "processed",
  );
  const probe = harness();
  await observeWorkerRun(
    "data-exports",
    async () => Response.json({}),
    () => ({ outcome: "auth_probe", code: "auth_probe" }),
    probe.deps,
  );
  expect((probe.writes[1].parameters.p_result as { code: string }).code).toBe(
    "invalid_response",
  );
});
test("deployment identity comes only from server environment", () => {
  expect(
    serverWorkerIdentity({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    }),
  ).toEqual({ environment: "development", sourceSha: "a".repeat(40) });
  expect(
    serverWorkerIdentity({
      VERCEL_ENV: "production",
      LETS_ASSIST_BUILD_SHA: "bad",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    }),
  ).toEqual({ environment: "production", sourceSha: null });
  expect(serverWorkerIdentity({})).toEqual({
    environment: "local",
    sourceSha: null,
  });
});

test("a stalled response cannot hold the worker observer open indefinitely", async () => {
  const h = harness();
  const response = new Response(new ReadableStream<Uint8Array>({ start() {} }));
  const start = Date.now();
  expect(
    await observeWorkerRun(
      "data-exports",
      async () => response,
      undefined,
      h.deps,
    ),
  ).toBe(response);
  expect(Date.now() - start).toBeLessThan(2500);
  expect((h.writes[1].parameters.p_result as { code: string }).code).toBe(
    "invalid_response",
  );
  await response.body?.cancel();
});
