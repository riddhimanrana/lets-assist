import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Auth grammar and enable-flag behavior for the follow-up worker route.
 * The worker module is mocked to throw, which doubles as the proof that a
 * disabled or unauthorized request performs zero database or provider work.
 */

let workerCalls = 0;

mock.module("@/services/project-feedback-worker", () => ({
  FEEDBACK_WORKER_MAX_BATCH_SIZE: 50,
  runProjectFeedbackWorker: async () => {
    workerCalls += 1;
    return {
      projectsScanned: 0,
      enqueued: 0,
      reaped: 0,
      claimed: 0,
      outcomes: { sent: 0, skipped: 0, failed: 0, retryable: 0, unknown: 0 },
      deadlineReached: false,
    };
  },
}));

const { POST } = await import("./route");

const SECRET = "feedback-cron-secret-for-tests";

function request(headers: Record<string, string> = {}) {
  // The route only reads headers, so a plain Request satisfies it.
  return new Request(
    "http://127.0.0.1:3000/api/cron/project-feedback-followups",
    { method: "POST", headers },
  ) as unknown as Parameters<typeof POST>[0];
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "PROJECT_FEEDBACK_WORKER_SECRET_TOKEN",
  "CRON_TOKEN",
  "CRON_SECRET",
  "PROJECT_FEEDBACK_WORKER_ENABLED",
];

beforeEach(() => {
  workerCalls = 0;
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PROJECT_FEEDBACK_WORKER_SECRET_TOKEN = SECRET;
  process.env.PROJECT_FEEDBACK_WORKER_ENABLED = "true";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("project-feedback-followups auth grammar", () => {
  test("a well-formed bearer token is accepted", async () => {
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(workerCalls).toBe(1);
  });

  test.each([
    ["bare secret", "feedback-cron-secret-for-tests"],
    ["prefixed grammar", "xBearer feedback-cron-secret-for-tests"],
    // A literal trailing newline cannot be tested through the Headers API —
    // the Fetch spec strips edge whitespace before the route sees it — so
    // the control-byte case stands in for the non-printable class.
    ["embedded control byte", "Bearer feedbacksecret"],
    ["embedded space", "Bearer feedback-cron secret"],
    ["lowercase scheme", "bearer feedback-cron-secret-for-tests"],
    ["double space", "Bearer  feedback-cron-secret-for-tests"],
  ])("%s is rejected", async (_label, header) => {
    const response = await POST(request({ authorization: header }));
    expect(response.status).toBe(401);
    expect(workerCalls).toBe(0);
  });

  test("a missing header is rejected", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(workerCalls).toBe(0);
  });

  test("no configured secret denies even a matching-looking token", async () => {
    delete process.env.PROJECT_FEEDBACK_WORKER_SECRET_TOKEN;
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(401);
    expect(workerCalls).toBe(0);
  });

  test("the shared CRON_TOKEN is also accepted", async () => {
    delete process.env.PROJECT_FEEDBACK_WORKER_SECRET_TOKEN;
    process.env.CRON_TOKEN = "shared-cron-token";
    const response = await POST(
      request({ authorization: "Bearer shared-cron-token" }),
    );
    expect(response.status).toBe(200);
  });
});

describe("enable flag", () => {
  test("a disabled worker responds without touching the worker at all", async () => {
    process.env.PROJECT_FEEDBACK_WORKER_ENABLED = "false";
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(workerCalls).toBe(0);
  });

  test("an unset flag behaves as disabled", async () => {
    delete process.env.PROJECT_FEEDBACK_WORKER_ENABLED;
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(workerCalls).toBe(0);
  });
});
