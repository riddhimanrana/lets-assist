import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

import type { SendEmailParams, SendEmailResult } from "@/services/email";

mock.module("server-only", () => ({}));

type LedgerState =
  | "queued"
  | "preparing"
  | "dispatching"
  | "sent"
  | "skipped"
  | "failed"
  | "unknown_outcome";

type LedgerRow = {
  id: string;
  project_id: string;
  signup_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  attempts: number;
  state: LedgerState;
  leaseOwner: string | null;
  leaseExpired: boolean;
  failureCode: string | null;
};

type Scenario = {
  ledger: LedgerRow[];
  project: Record<string, unknown> | null;
  signup: { project_id: string; schedule_id: string | null } | null;
  profile: { email: string; full_name: string | null } | null;
  settings: {
    email_notifications: boolean;
    project_updates: boolean;
  } | null;
  queryErrors: Partial<Record<string, Error>>;
  rpcErrors: Partial<Record<string, Error>>;
  settlementReportedState: string | null;
};

const CLAIM_ID = "request-1";
const PROJECT_ID = "project-1";
const SIGNUP_ID = "signup-1";
const USER_ID = "user-1";

const ONE_TIME_PROJECT = {
  id: PROJECT_ID,
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

function queuedRow(): LedgerRow {
  return {
    id: CLAIM_ID,
    project_id: PROJECT_ID,
    signup_id: SIGNUP_ID,
    user_id: USER_ID,
    anonymous_id: null,
    attempts: 0,
    state: "queued",
    leaseOwner: null,
    leaseExpired: false,
    failureCode: null,
  };
}

function defaultScenario(): Scenario {
  return {
    ledger: [queuedRow()],
    project: structuredClone(ONE_TIME_PROJECT),
    signup: { project_id: PROJECT_ID, schedule_id: "oneTime" },
    profile: { email: "volunteer@example.com", full_name: "Val Volunteer" },
    settings: null,
    queryErrors: {},
    rpcErrors: {},
    settlementReportedState: null,
  };
}

let scenario = defaultScenario();

type QueryResult = { data: unknown; error: Error | null; count?: number };

class StatefulQuery {
  private readonly equals = new Map<string, unknown>();

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.equals.set(column, value);
    return this;
  }

  gte() {
    return this;
  }

  lte() {
    return this;
  }

  order() {
    return this;
  }

  not() {
    return this;
  }

  is() {
    return this;
  }

  limit() {
    return this;
  }

  range() {
    return this;
  }

  private result(single: boolean): QueryResult {
    const candidateQuery = !this.equals.has("id");
    const errorKey = candidateQuery ? `${this.table}:candidate` : this.table;
    const error =
      scenario.queryErrors[errorKey] ?? scenario.queryErrors[this.table];
    if (error) return { data: null, error };

    switch (this.table) {
      case "projects":
        return single
          ? { data: scenario.project, error: null }
          : { data: [], error: null };
      case "project_signups":
        return single
          ? { data: scenario.signup, error: null }
          : { data: [], error: null };
      case "profiles":
        return { data: scenario.profile, error: null };
      case "notification_settings":
        return { data: scenario.settings, error: null };
      case "anonymous_signups":
        return { data: null, error: null };
      default:
        throw new Error(`Unexpected table ${this.table}`);
    }
  }

  maybeSingle() {
    return Promise.resolve(this.result(true));
  }

  single() {
    return Promise.resolve(this.result(true));
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result(false)).then(onfulfilled, onrejected);
  }
}

function rpcError(name: string): { data: null; error: Error } | null {
  const error = scenario.rpcErrors[name];
  return error ? { data: null, error } : null;
}

const adminClient = {
  from: (table: string) => new StatefulQuery(table),
  rpc: async (name: string, args?: Record<string, unknown>) => {
    const configuredError = rpcError(name);
    if (configuredError) return configuredError;

    switch (name) {
      case "enqueue_project_feedback_requests":
        return { data: 0, error: null };
      case "reap_project_feedback_request_leases": {
        let reaped = 0;
        for (const row of scenario.ledger) {
          if (!row.leaseExpired) continue;
          if (row.state === "preparing") {
            row.state = "queued";
            row.failureCode = "preparation_lease_expired";
          } else if (row.state === "dispatching") {
            row.state = "unknown_outcome";
            row.failureCode = "dispatch_lease_expired";
          } else {
            continue;
          }
          row.leaseOwner = null;
          row.leaseExpired = false;
          reaped += 1;
        }
        return { data: reaped, error: null };
      }
      case "claim_project_feedback_requests_for_preparation": {
        const limit = Number(args?.p_limit ?? 0);
        const workerId = String(args?.p_worker_id ?? "");
        const claimed = scenario.ledger
          .filter((row) => row.state === "queued" && row.attempts < 3)
          .slice(0, limit);
        for (const row of claimed) {
          row.state = "preparing";
          row.leaseOwner = workerId;
        }
        return {
          data: claimed.map((row) => ({
            id: row.id,
            project_id: row.project_id,
            signup_id: row.signup_id,
            user_id: row.user_id,
            anonymous_id: row.anonymous_id,
            attempts: row.attempts,
          })),
          error: null,
        };
      }
      case "begin_project_feedback_request_dispatch": {
        const row = scenario.ledger.find((item) => item.id === args?.p_id);
        const workerId = String(args?.p_worker_id ?? "");
        if (!row || row.state !== "preparing" || row.leaseOwner !== workerId) {
          return { data: null, error: new Error("not preparing") };
        }
        row.state = "dispatching";
        row.attempts += 1;
        return { data: row.attempts, error: null };
      }
      case "settle_project_feedback_request": {
        const row = scenario.ledger.find((item) => item.id === args?.p_id);
        const requestedState = String(args?.p_state ?? "");
        const workerId = String(args?.p_worker_id ?? "");
        if (scenario.settlementReportedState) {
          return { data: scenario.settlementReportedState, error: null };
        }
        if (!row || row.leaseOwner !== workerId) {
          return { data: row?.state ?? "missing", error: null };
        }
        const allowed =
          (row.state === "preparing" &&
            ["queued", "skipped", "failed"].includes(requestedState)) ||
          (row.state === "dispatching" &&
            ["queued", "sent", "skipped", "failed", "unknown_outcome"].includes(
              requestedState,
            ));
        if (!allowed) return { data: row.state, error: null };
        const attemptsExhausted =
          requestedState === "queued" && row.attempts >= 3;
        row.state = attemptsExhausted
          ? "failed"
          : (requestedState as LedgerState);
        row.failureCode = attemptsExhausted
          ? "attempts_exhausted"
          : args?.p_failure_code
            ? String(args.p_failure_code)
            : null;
        row.leaseOwner = null;
        return { data: row.state, error: null };
      }
      default:
        throw new Error(`Unexpected RPC ${name}`);
    }
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));

const ACCEPTED: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "message-1",
  transport: "resend",
  data: { id: "message-1" },
};

let sendEmailCalls: SendEmailParams[] = [];
let sendEmailImplementation: (
  params: SendEmailParams,
) => Promise<SendEmailResult> = async () => ACCEPTED;

mock.module("@/services/email", () => ({
  sendEmail: async (params: SendEmailParams) => {
    sendEmailCalls.push(params);
    return sendEmailImplementation(params);
  },
}));

const { feedbackProjectPageOffset, runProjectFeedbackWorker } =
  await import("@/services/project-feedback-worker");

const ENV_KEYS = [
  "PROJECT_FEEDBACK_TOKEN_SECRET",
  "ENCRYPTION_KEY",
  "NEXT_PUBLIC_SITE_URL",
];
const savedEnvironment: Record<string, string | undefined> = {};

beforeEach(() => {
  scenario = defaultScenario();
  sendEmailCalls = [];
  sendEmailImplementation = async () => ACCEPTED;

  for (const key of ENV_KEYS) {
    savedEnvironment[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PROJECT_FEEDBACK_TOKEN_SECRET =
    "test-feedback-token-secret-that-is-long-enough";
  process.env.NEXT_PUBLIC_SITE_URL = "https://test.lets-assist.com";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[key];
  }
});

describe("feedback project page rotation", () => {
  test("every bounded page is selected across consecutive hourly runs", () => {
    const hour = 60 * 60 * 1000;
    expect(feedbackProjectPageOffset(0 * hour, 61)).toBe(0);
    expect(feedbackProjectPageOffset(1 * hour, 61)).toBe(25);
    expect(feedbackProjectPageOffset(2 * hour, 61)).toBe(50);
    expect(feedbackProjectPageOffset(3 * hour, 61)).toBe(0);
  });

  test("invalid and empty totals fail closed to the first page", () => {
    expect(feedbackProjectPageOffset(Date.now(), 0)).toBe(0);
    expect(feedbackProjectPageOffset(Date.now(), -1)).toBe(0);
    expect(feedbackProjectPageOffset(Date.now(), 1.5)).toBe(0);
  });
});

describe("feedback worker durable phases", () => {
  test("a deterministic preparation failure settles failed without dispatch", async () => {
    delete process.env.PROJECT_FEEDBACK_TOKEN_SECRET;

    const result = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(sendEmailCalls).toHaveLength(0);
    expect(scenario.ledger[0]).toMatchObject({
      state: "failed",
      attempts: 0,
      failureCode: "pre_send_error",
    });
    expect(result.outcomes).toMatchObject({ failed: 1, unknown: 0 });
  });

  test("an expired preparing lease is requeued and safely dispatched", async () => {
    scenario.ledger[0] = {
      ...queuedRow(),
      state: "preparing",
      leaseOwner: "dead-worker",
      leaseExpired: true,
    };

    const result = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(result.reaped).toBe(1);
    expect(sendEmailCalls).toHaveLength(1);
    expect(scenario.ledger[0]).toMatchObject({ state: "sent", attempts: 1 });
  });

  test("an expired dispatch is unknown and is never sent again", async () => {
    scenario.ledger[0] = {
      ...queuedRow(),
      state: "dispatching",
      attempts: 1,
      leaseOwner: "dead-worker",
      leaseExpired: true,
    };

    const first = await runProjectFeedbackWorker({ batchSize: 1 });
    const second = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(first.reaped).toBe(1);
    expect(second.claimed).toBe(0);
    expect(sendEmailCalls).toHaveLength(0);
    expect(scenario.ledger[0].state).toBe("unknown_outcome");
  });

  test("a provider throw settles unknown only after dispatching", async () => {
    sendEmailImplementation = async () => {
      throw new Error("ambiguous transport failure");
    };

    const result = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(sendEmailCalls).toHaveLength(1);
    expect(scenario.ledger[0]).toMatchObject({
      state: "unknown_outcome",
      attempts: 1,
    });
    expect(result.outcomes.unknown).toBe(1);
    expect((await runProjectFeedbackWorker({ batchSize: 1 })).claimed).toBe(0);
    expect(sendEmailCalls).toHaveLength(1);
  });

  test("a dispatch-transition RPC error sends nothing and leaves preparation retryable", async () => {
    scenario.rpcErrors.begin_project_feedback_request_dispatch = new Error(
      "transition unavailable",
    );

    await expect(runProjectFeedbackWorker({ batchSize: 1 })).rejects.toThrow(
      "Failed beginning dispatch",
    );
    expect(sendEmailCalls).toHaveLength(0);
    expect(scenario.ledger[0]).toMatchObject({
      state: "preparing",
      attempts: 0,
    });
  });

  test("top-level RPC errors fail closed without exposing raw database messages", async () => {
    scenario.rpcErrors.reap_project_feedback_request_leases = new Error(
      "private volunteer@example.com provider detail",
    );

    try {
      await runProjectFeedbackWorker({ batchSize: 1 });
      throw new Error("worker unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Failed reaping feedback request leases",
      );
      expect((error as Error).message).not.toContain("volunteer@example.com");
    }
    expect(sendEmailCalls).toHaveLength(0);
  });

  test("a post-send settlement error remains dispatching and reaps unknown without a resend", async () => {
    scenario.rpcErrors.settle_project_feedback_request = new Error(
      "settlement unavailable",
    );

    await expect(runProjectFeedbackWorker({ batchSize: 1 })).rejects.toThrow(
      "Failed settling feedback request",
    );
    expect(sendEmailCalls).toHaveLength(1);
    expect(scenario.ledger[0].state).toBe("dispatching");

    delete scenario.rpcErrors.settle_project_feedback_request;
    scenario.ledger[0].leaseExpired = true;
    const retry = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(retry.reaped).toBe(1);
    expect(sendEmailCalls).toHaveLength(1);
    expect(scenario.ledger[0].state).toBe("unknown_outcome");
  });

  test("a mismatched settlement state is treated as a database failure", async () => {
    scenario.settlementReportedState = "dispatching";

    await expect(runProjectFeedbackWorker({ batchSize: 1 })).rejects.toThrow(
      "database reported dispatching",
    );
    expect(sendEmailCalls).toHaveLength(1);
    expect(scenario.ledger[0].state).toBe("dispatching");
  });

  test("query errors are checked and safely requeue preparation without dispatch", async () => {
    scenario.queryErrors.profiles = new Error("profile read failed");

    const first = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(sendEmailCalls).toHaveLength(0);
    expect(first.outcomes.retryable).toBe(1);
    expect(scenario.ledger[0].state).toBe("queued");

    delete scenario.queryErrors.profiles;
    const retry = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(retry.outcomes.sent).toBe(1);
    expect(sendEmailCalls).toHaveLength(1);
    expect(scenario.ledger[0].state).toBe("sent");
  });
});

describe("feedback signup schedule binding", () => {
  test("multi-day email date comes from the exact claimed signup slot", async () => {
    scenario.project = {
      ...ONE_TIME_PROJECT,
      event_type: "multiDay",
      schedule: {
        multiDay: [
          {
            date: "2026-09-01",
            slots: [
              {
                name: "Morning",
                startTime: "09:00",
                endTime: "11:00",
                volunteers: 5,
              },
            ],
          },
          {
            date: "2026-09-03",
            slots: [
              {
                name: "Afternoon",
                startTime: "14:00",
                endTime: "16:00",
                volunteers: 5,
              },
            ],
          },
        ],
      },
    };
    scenario.signup = {
      project_id: PROJECT_ID,
      schedule_id: "2026-09-03-1-0",
    };

    await runProjectFeedbackWorker({ batchSize: 1 });

    const element = sendEmailCalls[0]?.react as ReactElement<{
      eventDate: string | null;
    }>;
    expect(element.props.eventDate).toBe("September 3, 2026");
  });

  test("an unresolvable claimed schedule omits the date instead of using the first slot", async () => {
    scenario.project = {
      ...ONE_TIME_PROJECT,
      event_type: "multiDay",
      schedule: {
        multiDay: [
          {
            date: "2026-09-01",
            slots: [
              {
                startTime: "09:00",
                endTime: "11:00",
                volunteers: 5,
              },
            ],
          },
        ],
      },
    };
    scenario.signup = {
      project_id: PROJECT_ID,
      schedule_id: "legacy-ambiguous-slot",
    };

    await runProjectFeedbackWorker({ batchSize: 1 });

    const element = sendEmailCalls[0]?.react as ReactElement<{
      eventDate: string | null;
    }>;
    expect(element.props.eventDate).toBeNull();
  });

  test("a missing schedule id uses the date only when the project is unambiguous", async () => {
    scenario.signup = { project_id: PROJECT_ID, schedule_id: null };

    await runProjectFeedbackWorker({ batchSize: 1 });

    const element = sendEmailCalls[0]?.react as ReactElement<{
      eventDate: string | null;
    }>;
    expect(element.props.eventDate).toBe("September 1, 2026");
  });
});

describe("feedback retry state", () => {
  test("a definite pre-send retry requeues and uses a new dispatch attempt", async () => {
    const idempotencyKeys: string[] = [];
    let sendNumber = 0;
    sendEmailImplementation = async (params) => {
      idempotencyKeys.push(params.idempotencyKey ?? "");
      sendNumber += 1;
      if (sendNumber === 1) {
        return {
          outcome: "retryable_pre_send",
          success: false,
          skipped: false,
          phase: "provider_request",
          code: "rate_limit_exceeded",
          status: 429,
          error: "provider refused before acceptance",
        };
      }
      return ACCEPTED;
    };

    const first = await runProjectFeedbackWorker({ batchSize: 1 });
    const second = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(first.outcomes.retryable).toBe(1);
    expect(second.outcomes.sent).toBe(1);
    expect(scenario.ledger[0]).toMatchObject({ state: "sent", attempts: 2 });
    expect(idempotencyKeys).toEqual([
      `project-feedback:${CLAIM_ID}:1`,
      `project-feedback:${CLAIM_ID}:2`,
    ]);
  });

  test("a third definite rejection settles failed instead of freezing queued", async () => {
    scenario.ledger[0].attempts = 2;
    sendEmailImplementation = async () => ({
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "provider_request",
      code: "rate_limit_exceeded",
      status: 429,
      error: "provider refused before acceptance",
    });

    const result = await runProjectFeedbackWorker({ batchSize: 1 });
    const retry = await runProjectFeedbackWorker({ batchSize: 1 });

    expect(result.outcomes.failed).toBe(1);
    expect(scenario.ledger[0]).toMatchObject({
      state: "failed",
      attempts: 3,
      failureCode: "attempts_exhausted",
    });
    expect(retry.claimed).toBe(0);
    expect(sendEmailCalls).toHaveLength(1);
  });
});
