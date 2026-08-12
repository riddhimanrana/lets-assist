import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Auth grammar, enable flag, and response privacy for the cancellation worker
 * route. The worker module is mocked with a recorder, which doubles as the
 * proof that a disabled or unauthorized request performs zero database and zero
 * provider work.
 */

mock.module("server-only", () => ({}));

let workerCalls: Record<string, unknown>[] = [];
let workerBehavior: () => unknown = () => WORKER_RESULT;

const WORKER_RESULT = {
  jobsClaimed: 1,
  jobsCompleted: 1,
  jobsNeedingReview: 0,
  jobsReleased: 0,
  recipientsSnapshotted: 3,
  deliveriesClaimed: 3,
  outcomes: { sent: 3, skipped: 0, failed: 0, retryable: 0, unknown: 0 },
  notifications: { delivered: 3, replayed: 0, skipped: 0, failed: 0 },
  reapedDeliveryLeases: 0,
  reapedJobLeases: 0,
  failedExhaustedJobs: 0,
  deadlineReached: false,
};

mock.module("@/services/project-cancellation-worker", () => ({
  CANCELLATION_WORKER_MAX_BATCH_SIZE: 50,
  CANCELLATION_WORKER_MAX_JOBS_PER_RUN: 5,
  runProjectCancellationWorker: async (options: Record<string, unknown>) => {
    workerCalls.push(options);
    return workerBehavior();
  },
}));

const { NextRequest } = await import("next/server");
const { GET, POST } = await import("./route");

const SECRET = "cancellation-cron-secret-for-tests";

function request(headers: Record<string, string> = {}, search = "") {
  return new NextRequest(
    `http://127.0.0.1:3000/api/cron/project-cancellations${search}`,
    { method: "POST", headers },
  );
}

function statusRequest(headers: Record<string, string> = {}) {
  return new NextRequest(
    "http://127.0.0.1:3000/api/cron/project-cancellations?status=1",
    { method: "GET", headers },
  );
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "PROJECT_CANCELLATION_WORKER_SECRET_TOKEN",
  "CRON_TOKEN",
  "CRON_SECRET",
  "PROJECT_CANCELLATION_WORKER_ENABLED",
  "PROJECT_CANCELLATION_WORKER_BATCH_SIZE",
  "PROJECT_CANCELLATION_WORKER_MAX_JOBS",
];

beforeEach(() => {
  workerCalls = [];
  workerBehavior = () => WORKER_RESULT;
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN = SECRET;
  process.env.PROJECT_CANCELLATION_WORKER_ENABLED = "true";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("project-cancellations auth grammar", () => {
  test("a well-formed bearer token is accepted", async () => {
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(workerCalls.length).toBe(1);
  });

  test.each([
    ["bare secret", "cancellation-cron-secret-for-tests"],
    ["prefixed grammar", "xBearer cancellation-cron-secret-for-tests"],
    ["embedded space", "Bearer cancellation-cron secret"],
    ["lowercase scheme", "bearer cancellation-cron-secret-for-tests"],
    ["double space", "Bearer  cancellation-cron-secret-for-tests"],
    ["trailing padding", "Bearer cancellation-cron-secret-for-tests="],
  ])("%s is rejected", async (_label, header) => {
    const response = await POST(request({ authorization: header }));
    expect(response.status).toBe(401);
    expect(workerCalls.length).toBe(0);
  });

  test("a missing header is rejected", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(workerCalls.length).toBe(0);
  });

  test("no configured secret denies even a matching-looking token", async () => {
    delete process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN;
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(401);
    expect(workerCalls.length).toBe(0);
  });

  test("the shared CRON_TOKEN is also accepted", async () => {
    delete process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN;
    process.env.CRON_TOKEN = "shared-cron-token";
    const response = await POST(
      request({ authorization: "Bearer shared-cron-token" }),
    );
    expect(response.status).toBe(200);
  });

  test("the status path authenticates before answering anything", async () => {
    const unauthenticated = await GET(statusRequest());
    expect(unauthenticated.status).toBe(401);
    expect(workerCalls.length).toBe(0);

    const authenticated = await GET(
      statusRequest({ authorization: `Bearer ${SECRET}` }),
    );
    expect(authenticated.status).toBe(200);
    // The status path reports liveness only; it never runs the worker.
    expect(workerCalls.length).toBe(0);
    expect((await authenticated.json()).enabled).toBe(true);
  });
});

describe("enable flag", () => {
  test("a disabled worker responds without touching the worker at all", async () => {
    process.env.PROJECT_CANCELLATION_WORKER_ENABLED = "false";
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(workerCalls.length).toBe(0);
  });

  test("an unset flag behaves as disabled", async () => {
    delete process.env.PROJECT_CANCELLATION_WORKER_ENABLED;
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect((await response.json()).enabled).toBe(false);
    expect(workerCalls.length).toBe(0);
  });
});

describe("bounded run scope", () => {
  test("environment overrides are clamped to the worker's declared maxima", async () => {
    process.env.PROJECT_CANCELLATION_WORKER_BATCH_SIZE = "100000";
    process.env.PROJECT_CANCELLATION_WORKER_MAX_JOBS = "100000";

    await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(workerCalls[0].batchSize).toBe(50);
    expect(workerCalls[0].maxJobs).toBe(5);
    expect(workerCalls[0].deadlineMs).toBe(45_000);
  });

  test("a nonsense override falls back to the default rather than zero", async () => {
    process.env.PROJECT_CANCELLATION_WORKER_BATCH_SIZE = "not-a-number";
    process.env.PROJECT_CANCELLATION_WORKER_MAX_JOBS = "-4";

    await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(workerCalls[0].batchSize).toBe(50);
    expect(workerCalls[0].maxJobs).toBe(3);
  });

  test("the route accepts no caller-supplied work coordinates", async () => {
    // A project id, job id, or batch size in the query string must change
    // nothing: an authenticated cron caller still cannot aim the worker.
    await POST(
      request(
        { authorization: `Bearer ${SECRET}` },
        "?projectId=11111111-1111-4111-8111-111111111111&batchSize=9999&jobId=abc",
      ),
    );

    expect(workerCalls[0]).toEqual({
      batchSize: 50,
      maxJobs: 3,
      deadlineMs: 45_000,
    });
  });
});

describe("the response is aggregate-only", () => {
  test("the body is exactly the worker's counters plus enabled and duration", async () => {
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(WORKER_RESULT), "enabled", "durationMs"].sort(),
    );
    for (const [key, value] of Object.entries(body)) {
      if (key === "outcomes" || key === "notifications") {
        expect(
          Object.values(value as Record<string, unknown>).every(
            (count) => typeof count === "number",
          ),
        ).toBe(true);
        continue;
      }
      expect(["number", "boolean"]).toContain(typeof value);
    }
  });

  test("a worker failure reports a fixed sentence, never the underlying error", async () => {
    workerBehavior = () => {
      throw new Error(
        "connect ECONNREFUSED db://volunteer@local.test:5432/postgres",
      );
    };

    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Worker run failed" });
  });
});
