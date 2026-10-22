import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { reportWorkerHeartbeat, workerHeartbeatOwner } =
  await import("./worker-heartbeat");
import type { WorkerOutcome } from "./worker-outcome";
import type {
  WorkerHeartbeatStatus,
  WorkerHeartbeatDependencies,
} from "./worker-heartbeat";
const EMPTY: WorkerOutcome = {
  outcome: "no_run",
  code: "empty_queue",
  attempted: 0,
  completed: 0,
  failed: 0,
  pending: 0,
  refused: 0,
  faults: 0,
  deadlineReached: false,
};
const WORK: WorkerOutcome = {
  ...EMPTY,
  outcome: "processed",
  code: "completed",
  attempted: 2,
  completed: 2,
};
const URL =
  "https://incidents.betterstack.com/api/v1/heartbeat/fictional-heartbeat-token-123456";
const input = (outcome = WORK) => ({
  worker: "organization-calendar-sync" as const,
  environment: "production" as const,
  owner: "vercel_cron" as const,
  outcome,
  responseOk: true,
  committed: true,
});
function harness(url: string | undefined = URL) {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const warnings: string[] = [];
  const deps: WorkerHeartbeatDependencies = {
    env: { BETTERSTACK_CALENDAR_SYNC_HEARTBEAT_URL: url },
    fetch: (async (url: string | URL | Request, options?: RequestInit) => {
      calls.push({ url: String(url), options: options ?? {} });
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch,
    unavailable: (code: "delivery_failed" | "configuration_invalid") =>
      warnings.push(code),
    timeoutMs: 25,
  };
  return { calls, warnings, deps };
}
test("only Vercel GET ownership is selected, independently of authentication", () => {
  const request = (method: string, agent: string) => ({
    method,
    headers: new Headers({ "user-agent": agent }),
  });
  expect(workerHeartbeatOwner(request("GET", "vercel-cron/1.0"))).toBe(
    "vercel_cron",
  );
  expect(workerHeartbeatOwner(request("POST", "vercel-cron/1.0"))).toBe(
    "manual",
  );
  expect(workerHeartbeatOwner(request("GET", "curl/8"))).toBe("manual");
});
test("completed work and authoritative empty discovery remain distinct", async () => {
  for (const [outcome, expected] of [
    [WORK, "work_completed"],
    [EMPTY, "scheduler_completed_empty"],
  ] as const) {
    const h = harness();
    expect(await reportWorkerHeartbeat(input(outcome), h.deps)).toBe(expected);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(URL);
    expect(h.calls[0].options).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
    });
    expect(h.calls[0].options.signal).toBeInstanceOf(AbortSignal);
  }
});
test("committed failed and partial passes call only the failure destination", async () => {
  for (const outcome of [
    {
      ...EMPTY,
      outcome: "failed" as const,
      code: "worker_failed" as const,
      attempted: 1,
      failed: 1,
    },
    {
      ...WORK,
      outcome: "partial" as const,
      code: "partial_work" as const,
      attempted: 3,
      failed: 1,
    },
  ]) {
    const h = harness(`${URL}/`);
    expect(
      await reportWorkerHeartbeat(
        { ...input(outcome), responseOk: false, blocked: true },
        h.deps,
      ),
    ).toBe("failed_signaled");
    expect(h.calls.map((x) => x.url)).toEqual([`${URL}/fail`]);
  }
});
test("manual, preview, uncommitted and unrelated workers never inspect destinations", async () => {
  for (const changes of [
    { owner: "manual" as const },
    { environment: "development" as const },
    { committed: false },
    { worker: "ai-moderation" as const },
  ]) {
    const h = harness();
    h.deps.env = new Proxy(
      {},
      {
        get() {
          throw new Error("Unexpected secret read");
        },
      },
    );
    expect(
      await reportWorkerHeartbeat({ ...input(), ...changes }, h.deps),
    ).toBe("not_sent");
    expect(h.calls).toHaveLength(0);
  }
});
test("blocked, unsuccessful, inconsistent and invalid healthy passes cannot send green", async () => {
  for (const value of [
    { ...input(), blocked: true },
    { ...input(EMPTY), blocked: true },
    { ...input(), responseOk: false },
    input({ ...WORK, attempted: 3 }),
    input({ ...WORK, pending: 1 }),
    input({ ...EMPTY, completed: 1 }),
    input({
      ...WORK,
      outcome: "auth_probe",
      code: "auth_probe",
    } as unknown as WorkerOutcome),
  ]) {
    const h = harness();
    expect(await reportWorkerHeartbeat(value, h.deps)).toBe("not_sent");
    expect(h.calls).toHaveLength(0);
  }
});
test("each worker uses its dedicated existing variable without generic fallback", async () => {
  for (const [worker, key] of [
    ["auto-publish-hours", "BETTERSTACK_AUTO_PUBLISH_HEARTBEAT_URL"],
    ["organization-calendar-sync", "BETTERSTACK_CALENDAR_SYNC_HEARTBEAT_URL"],
    ["organization-sheet-sync", "BETTERSTACK_SHEET_SYNC_HEARTBEAT_URL"],
  ] as const) {
    const h = harness();
    const deps = {
      ...h.deps,
      env: {
        [key]: URL,
        BETTERSTACK_HEARTBEAT_URL: "https://example.test/forbidden",
      },
    };
    expect(await reportWorkerHeartbeat({ ...input(), worker }, deps)).toBe(
      "work_completed",
    );
    expect(h.calls[0].url).toBe(URL);
  }
  const h = harness();
  const deps = { ...h.deps, env: { BETTERSTACK_HEARTBEAT_URL: URL } };
  expect(await reportWorkerHeartbeat(input(), deps)).toBe(
    "configuration_invalid",
  );
  expect(h.calls).toHaveLength(0);
});
test("all supported exact Better Stack hosts can receive a valid dedicated heartbeat", async () => {
  for (const host of [
    "incidents.betterstack.com",
    "uptime.betterstack.com",
    "betteruptime.com",
  ]) {
    const h = harness(URL.replace("incidents.betterstack.com", host));
    expect(await reportWorkerHeartbeat(input(), h.deps)).toBe("work_completed");
  }
});
test("malformed or arbitrary destinations fail closed with only sanitized codes", async () => {
  for (const url of [
    undefined,
    "http://incidents.betterstack.com/api/v1/heartbeat/fictional-token123456",
    "https://incidents.betterstack.com.evil.test/api/v1/heartbeat/fictional-token123456",
    URL.replace("https://", "https://user:private@"),
    `${URL}?private=secret`,
    `${URL}#private`,
    URL.replace(".com/", ".com:8443/"),
    URL.replace("heartbeat/", "monitors/"),
    `${URL}/fail`,
    URL.replace("fictional", "%66ictional"),
    URL.replace("fictional-heartbeat-token-123456", "short"),
  ]) {
    const h = harness(url);
    if (url === undefined)
      h.deps.env.BETTERSTACK_CALENDAR_SYNC_HEARTBEAT_URL = undefined;
    expect(await reportWorkerHeartbeat(input(), h.deps)).toBe(
      "configuration_invalid",
    );
    expect(h.calls).toHaveLength(0);
    expect(h.warnings).toEqual(["configuration_invalid"]);
  }
});
test("HTTP rejection, redirects and transport errors never report delivered success", async () => {
  for (const status of [302, 429, 500]) {
    const h = harness();
    h.deps.fetch = (async () =>
      new Response("private body", {
        status,
      })) as unknown as typeof globalThis.fetch;
    expect(await reportWorkerHeartbeat(input(), h.deps)).toBe(
      "delivery_failed",
    );
    expect(h.warnings).toEqual(["delivery_failed"]);
  }
  const h = harness();
  h.deps.fetch = (async () => {
    throw new Error(`private ${URL}`);
  }) as unknown as typeof globalThis.fetch;
  h.deps.unavailable = () => {
    throw new Error("broken logger");
  };
  expect(await reportWorkerHeartbeat(input(), h.deps)).toBe("delivery_failed");
});
test("a nonsettling transport has a bounded deadline", async () => {
  const h = harness();
  let signal: AbortSignal | null = null;
  h.deps.fetch = ((_url: unknown, options: RequestInit) => {
    signal = options.signal as AbortSignal;
    return new Promise<Response>(() => {});
  }) as typeof globalThis.fetch;
  const started = Date.now();
  const status: WorkerHeartbeatStatus = await reportWorkerHeartbeat(
    input(),
    h.deps,
  );
  expect(status).toBe("delivery_failed");
  expect(Date.now() - started).toBeLessThan(500);
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
});
