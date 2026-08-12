import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

/**
 * Behavioral tests for the feedback worker's pre-send vs. provider boundary
 * split.
 *
 * Invariant: deterministic pre-send failures (missing token secret, project
 * query failure, etc.) MUST NOT produce unknown_outcome. Only ambiguity after
 * the actual provider send may legitimately settle as unknown_outcome.
 */

// ---------------------------------------------------------------------------
// Mutable scenario delegate — swapped before each test so the statically-
// bound getAdminClient() picks up fresh behavior without re-importing.
// ---------------------------------------------------------------------------

type Scenario = {
  profileResult?: object | null;
  projectClaimResult?: object | null;
};

let currentScenario: Scenario = {};

const CLAIM = {
  id: "req-1",
  project_id: "proj-1",
  signup_id: "signup-1",
  user_id: "user-1",
  anonymous_id: null,
  attempts: 0,
};

const VALID_PROJECT = {
  id: "proj-1",
  title: "Beach Cleanup",
  event_type: "oneTime",
  schedule: {
    oneTime: {
      date: "2026-09-01",
      startTime: "09:00",
      endTime: "11:00",
      volunteers: 10,
    },
  },
  project_timezone: "America/Los_Angeles",
  status: "completed",
  cancelled_at: null,
  organization: null,
};

const settleCalls: Array<{ id: string; state: string }> = [];

function makeFluentChain(terminal: () => Promise<{ data: unknown; error: unknown }>) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  for (const m of ["select", "eq", "gte", "lte", "order", "not", "is"]) {
    obj[m] = self;
  }
  obj.limit = () => ({
    ...obj,
    maybeSingle: terminal,
    single: terminal,
    // Resolve as a thenable for patterns that await the query builder directly
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      terminal().then(resolve),
  });
  obj.maybeSingle = terminal;
  obj.single = terminal;
  return obj;
}

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return makeFluentChain(async () => ({
          data: currentScenario.profileResult !== undefined
            ? currentScenario.profileResult
            : { email: "v@example.com", full_name: "Val" },
          error: null,
        }));
      }
      if (table === "notification_settings") {
        return makeFluentChain(async () => ({ data: null, error: null }));
      }
      if (table === "projects") {
        const obj: Record<string, unknown> = {};
        const self = () => obj;
        for (const m of ["select", "eq", "gte", "order", "not", "is"]) {
          obj[m] = self;
        }
        obj.limit = () => ({
          maybeSingle: async () => ({
            data: currentScenario.projectClaimResult !== undefined
              ? currentScenario.projectClaimResult
              : VALID_PROJECT,
            error: null,
          }),
          single: async () => ({
            data: currentScenario.projectClaimResult !== undefined
              ? currentScenario.projectClaimResult
              : VALID_PROJECT,
            error: null,
          }),
          then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
            resolve({ data: [], error: null }),
        });
        obj.maybeSingle = async () => ({
          data: currentScenario.projectClaimResult !== undefined
            ? currentScenario.projectClaimResult
            : VALID_PROJECT,
          error: null,
        });
        obj.single = obj.maybeSingle;
        return obj;
      }
      if (table === "project_signups") {
        return makeFluentChain(async () => ({ data: [], error: null }));
      }
      return makeFluentChain(async () => ({ data: null, error: null }));
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "enqueue_project_feedback_requests") return { data: 0, error: null };
      if (fn === "reap_project_feedback_request_leases") return { data: 0, error: null };
      if (fn === "claim_project_feedback_requests") return { data: [CLAIM], error: null };
      if (fn === "settle_project_feedback_request") {
        if (args?.p_id && args?.p_state) {
          settleCalls.push({ id: String(args.p_id), state: String(args.p_state) });
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

let sendEmailCalls = 0;
let sendEmailImpl: () => Promise<unknown> = async () => ({
  outcome: "accepted",
  messageId: "msg-ok",
});

mock.module("@/services/email", () => ({
  sendEmail: async (..._args: unknown[]) => {
    sendEmailCalls += 1;
    return sendEmailImpl();
  },
}));

// Import worker after all mocks are registered.
const { runProjectFeedbackWorker } = await import(
  "@/services/project-feedback-worker"
);

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "PROJECT_FEEDBACK_TOKEN_SECRET",
  "ENCRYPTION_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "ATTENDANCE_CHALLENGE_SECRET",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sendEmailCalls = 0;
  settleCalls.length = 0;
  currentScenario = {};
  sendEmailImpl = async () => ({ outcome: "accepted", messageId: "msg-ok" });

  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PROJECT_FEEDBACK_TOKEN_SECRET =
    "test-secret-for-worker-tests-that-is-long-enough-x";
  process.env.NEXT_PUBLIC_SITE_URL = "https://test.lets-assist.com";
  process.env.ATTENDANCE_CHALLENGE_SECRET =
    "attendance-secret-for-worker-tests-long-enough-here";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ---------------------------------------------------------------------------
// Pre-send deterministic failures must never produce unknown_outcome
// ---------------------------------------------------------------------------

describe("feedback worker — pre-send failures do not produce unknown_outcome", () => {
  test("missing token secret settles as failed, no provider call", async () => {
    delete process.env.PROJECT_FEEDBACK_TOKEN_SECRET;
    delete process.env.ENCRYPTION_KEY;

    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(0);
    expect(result.outcomes.unknown).toBe(0);
    expect(result.outcomes.failed).toBe(1);
    // State must not be unknown_outcome
    const settled = settleCalls.find((c) => c.id === CLAIM.id);
    expect(settled?.state).not.toBe("unknown_outcome");
  });

  test("short token secret (< 32 chars) settles as failed, no provider call", async () => {
    process.env.PROJECT_FEEDBACK_TOKEN_SECRET = "short";

    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(0);
    expect(result.outcomes.unknown).toBe(0);
    expect(result.outcomes.failed).toBe(1);
  });

  test("project query returns null settles as skipped, no provider call", async () => {
    currentScenario = {
      profileResult: { email: "v@example.com", full_name: "Val" },
      projectClaimResult: null,
    };

    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(0);
    expect(result.outcomes.unknown).toBe(0);
    expect(result.outcomes.skipped).toBe(1);
  });

  test("missing recipient profile settles as skipped, no provider call", async () => {
    currentScenario = { profileResult: null };

    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(0);
    expect(result.outcomes.unknown).toBe(0);
    expect(result.outcomes.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Provider boundary: a throw after send preserves unknown_outcome
// ---------------------------------------------------------------------------

describe("feedback worker — provider boundary preserves unknown_outcome", () => {
  test("sendEmail throwing settles as unknown_outcome (at-most-once preserved)", async () => {
    sendEmailImpl = async () => {
      throw new Error("ECONNRESET");
    };

    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(1);
    expect(result.outcomes.unknown).toBe(1);
    expect(result.outcomes.failed).toBe(0);
  });

  test("sendEmail returning unknown_outcome settles as unknown_outcome", async () => {
    sendEmailImpl = async () => ({
      outcome: "unknown_outcome",
      code: "transport_error",
    });

    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(1);
    expect(result.outcomes.unknown).toBe(1);
  });

  test("successful send increments sent, not unknown", async () => {
    const result = await runProjectFeedbackWorker({
      batchSize: 1,
      deadlineMs: 60_000,
    });

    expect(sendEmailCalls).toBe(1);
    expect(result.outcomes.sent).toBe(1);
    expect(result.outcomes.unknown).toBe(0);
  });
});
