import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The cancellation worker driven with no database, no provider, and no network.
 *
 * Every boundary it can cross is mocked with a recorder, so the properties that
 * matter are numbers this file checks rather than claims it trusts: no send
 * without a revalidated recipient, no unbounded claim, no ambiguous outcome
 * turned back into a retry, and no recipient identity in the returned
 * aggregates.
 */

mock.module("server-only", () => ({}));
mock.module("@/emails/project-cancellation", () => ({ default: () => null }));

type RpcCall = { name: string; args: Record<string, unknown> };
type Row = Record<string, unknown>;

const rpcCalls: RpcCall[] = [];
const emailCalls: Record<string, unknown>[] = [];
const notificationCalls: { notification: Row; userId: string }[] = [];

let rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> =
  {};
let tables: Record<string, Row[]> = {};
let emailBehavior: () => unknown = () => ({
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "provider-message-1",
  transport: "resend",
  data: { id: "provider-message-1" },
});
let notificationBehavior: () => unknown = () => ({ success: true });

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    maybeSingle: async () => ({
      data:
        (tables[table] ?? []).find((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value),
        ) ?? null,
      error: null,
    }),
  };
  return builder;
}

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const handler = rpcHandlers[name];
      return { data: handler ? handler(args) : null, error: null };
    },
    from: (table: string) => makeQuery(table),
  }),
}));

mock.module("@/services/email", () => ({
  sendEmail: async (payload: Record<string, unknown>) => {
    emailCalls.push(payload);
    return emailBehavior();
  },
}));

mock.module("@/services/notifications-server", () => ({
  createNotificationForUser: async (notification: Row, userId: string) => {
    notificationCalls.push({ notification, userId });
    return notificationBehavior();
  },
}));

const {
  CANCELLATION_WORKER_MAX_BATCH_SIZE,
  CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
  CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
  runProjectCancellationWorker,
} = await import("@/services/project-cancellation-worker");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const SIGNUP_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "66666666-6666-4666-8666-666666666666";
const DEDUPE_KEY = `project-cancelled:${PROJECT_ID}`;

function job(overrides: Row = {}) {
  return {
    id: JOB_ID,
    project_id: PROJECT_ID,
    cancelled_at: "2026-08-11T00:00:00.000Z",
    cancellation_reason: "Storm warning",
    attempts: 1,
    audience_snapshot_at: "2026-08-11T00:00:01.000Z",
    recipient_count: 1,
    ...overrides,
  };
}

function delivery(overrides: Row = {}) {
  return {
    id: DELIVERY_ID,
    project_id: PROJECT_ID,
    signup_id: SIGNUP_ID,
    user_id: USER_ID,
    anonymous_id: null,
    notification_dedupe_key: DEDUPE_KEY,
    notification_state: "pending",
    attempts: 1,
    ...overrides,
  };
}

/** One job, one claimable delivery, then drained. */
function singleDeliveryHandlers(deliveryRow: Row = delivery()) {
  let served = false;
  return {
    reap_project_cancellation_delivery_leases: () => 0,
    reap_project_cancellation_job_leases: () => ({ released: 0, failed: 0 }),
    claim_project_cancellation_jobs: () => [job()],
    claim_project_cancellation_deliveries: () => {
      if (served) return [];
      served = true;
      return [deliveryRow];
    },
    settle_project_cancellation_delivery: () => "sent",
    finalize_project_cancellation_job: () => ({
      finalized: true,
      status: "completed",
    }),
  };
}

function settlements() {
  return rpcCalls
    .filter((call) => call.name === "settle_project_cancellation_delivery")
    .map((call) => call.args);
}

beforeEach(() => {
  rpcCalls.length = 0;
  emailCalls.length = 0;
  notificationCalls.length = 0;
  rpcHandlers = {};
  emailBehavior = () => ({
    outcome: "accepted",
    success: true,
    skipped: false,
    phase: "provider_response",
    messageId: "provider-message-1",
    transport: "resend",
    data: { id: "provider-message-1" },
  });
  notificationBehavior = () => ({ success: true });
  tables = {
    projects: [{ id: PROJECT_ID, title: "Beach Cleanup", status: "cancelled" }],
    project_signups: [
      {
        id: SIGNUP_ID,
        project_id: PROJECT_ID,
        user_id: USER_ID,
        anonymous_id: null,
      },
    ],
    profiles: [
      { id: USER_ID, email: "volunteer@local.test", full_name: "Vee" },
    ],
    anonymous_signups: [],
  };
});

describe("lease recovery is discoverable with no pending work", () => {
  test("both reapers run before any claim, even when nothing is claimable", async () => {
    rpcHandlers = {
      reap_project_cancellation_delivery_leases: () => 2,
      reap_project_cancellation_job_leases: () => ({ released: 1, failed: 3 }),
      claim_project_cancellation_jobs: () => [],
    };

    const result = await runProjectCancellationWorker({});

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "reap_project_cancellation_delivery_leases",
      "reap_project_cancellation_job_leases",
      "claim_project_cancellation_jobs",
    ]);
    expect(result.reapedDeliveryLeases).toBe(2);
    expect(result.reapedJobLeases).toBe(1);
    expect(result.failedExhaustedJobs).toBe(3);
    expect(result.jobsClaimed).toBe(0);
    expect(emailCalls.length).toBe(0);
  });
});

describe("bounded scope", () => {
  test("claims are clamped to the declared maxima regardless of caller input", async () => {
    rpcHandlers = singleDeliveryHandlers();

    await runProjectCancellationWorker({ batchSize: 10_000, maxJobs: 10_000 });

    const jobClaim = rpcCalls.find(
      (call) => call.name === "claim_project_cancellation_jobs",
    );
    expect(jobClaim?.args.p_limit).toBe(CANCELLATION_WORKER_MAX_JOBS_PER_RUN);

    const deliveryClaim = rpcCalls.find(
      (call) => call.name === "claim_project_cancellation_deliveries",
    );
    expect(deliveryClaim?.args.p_limit).toBe(
      CANCELLATION_WORKER_MAX_BATCH_SIZE,
    );
    expect(Number(deliveryClaim?.args.p_limit)).toBeLessThanOrEqual(
      CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
    );
  });

  test("a job that never drains still stops at the per-run delivery ceiling", async () => {
    // A ledger that always returns a full page: without the ceiling this loops
    // until the deadline, holding a lease over unbounded provider work.
    rpcHandlers = {
      reap_project_cancellation_delivery_leases: () => 0,
      reap_project_cancellation_job_leases: () => ({ released: 0, failed: 0 }),
      claim_project_cancellation_jobs: () => [job()],
      claim_project_cancellation_deliveries: (args) =>
        Array.from({ length: Number(args.p_limit) }, (_unused, index) =>
          delivery({ id: `${DELIVERY_ID}-${index}` }),
        ),
      settle_project_cancellation_delivery: () => "sent",
      finalize_project_cancellation_job: () => ({
        finalized: true,
        status: "pending",
      }),
    };

    const result = await runProjectCancellationWorker({});

    expect(result.deliveriesClaimed).toBe(
      CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
    );
    expect(result.jobsReleased).toBe(1);
  });
});

describe("send-time revalidation", () => {
  test("a reinstated project is skipped without touching the provider", async () => {
    tables.projects = [
      { id: PROJECT_ID, title: "Beach Cleanup", status: "upcoming" },
    ];
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(emailCalls.length).toBe(0);
    expect(notificationCalls.length).toBe(0);
    expect(result.outcomes.skipped).toBe(1);
    expect(settlements()[0]?.p_failure_code).toBe("project_not_cancelled");
  });

  test("a ledger row pointing at another project is refused", async () => {
    tables.project_signups = [
      {
        id: SIGNUP_ID,
        project_id: OTHER_PROJECT_ID,
        user_id: USER_ID,
        anonymous_id: null,
      },
    ];
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(emailCalls.length).toBe(0);
    expect(result.outcomes.skipped).toBe(1);
    expect(settlements()[0]?.p_failure_code).toBe("signup_project_mismatch");
  });

  test("a deleted signup is skipped rather than mailed from stale ledger data", async () => {
    tables.project_signups = [];
    rpcHandlers = singleDeliveryHandlers();

    await runProjectCancellationWorker({});

    expect(emailCalls.length).toBe(0);
    expect(settlements()[0]?.p_failure_code).toBe("signup_missing");
  });

  test("a recipient with no address still receives the in-app notice", async () => {
    tables.profiles = [{ id: USER_ID, email: null, full_name: "Vee" }];
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(emailCalls.length).toBe(0);
    expect(notificationCalls.length).toBe(1);
    expect(result.notifications.delivered).toBe(1);
    expect(settlements()[0]?.p_failure_code).toBe("no_address");
    expect(settlements()[0]?.p_notification_state).toBe("delivered");
  });
});

describe("exactly one logical notice per recipient", () => {
  test("the in-app notice carries the ledger's deterministic dedupe key", async () => {
    rpcHandlers = singleDeliveryHandlers();

    await runProjectCancellationWorker({});

    expect(notificationCalls.length).toBe(1);
    expect(notificationCalls[0].userId).toBe(USER_ID);
    expect(notificationCalls[0].notification.dedupeKey).toBe(DEDUPE_KEY);
  });

  test("a replayed notification is recorded as a success, not a duplicate", async () => {
    notificationBehavior = () => ({ success: true, replayed: true });
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(result.notifications.replayed).toBe(1);
    expect(result.notifications.delivered).toBe(0);
    expect(settlements()[0]?.p_notification_state).toBe("replayed");
  });

  test("an anonymous recipient gets no in-app notice and no notification state", async () => {
    const anonymousId = "77777777-7777-4777-8777-777777777777";
    tables.project_signups = [
      {
        id: SIGNUP_ID,
        project_id: PROJECT_ID,
        user_id: null,
        anonymous_id: anonymousId,
      },
    ];
    tables.anonymous_signups = [
      {
        id: anonymousId,
        project_id: PROJECT_ID,
        email: "anon@local.test",
        name: "Anon",
      },
    ];
    rpcHandlers = singleDeliveryHandlers(
      delivery({ user_id: null, anonymous_id: anonymousId }),
    );

    const result = await runProjectCancellationWorker({});

    expect(notificationCalls.length).toBe(0);
    expect(emailCalls.length).toBe(1);
    // NULL leaves the ledger's 'not_applicable' intact; sending any other
    // value would violate the table's applicability constraint.
    expect(settlements()[0]?.p_notification_state).toBeNull();
    expect(result.outcomes.sent).toBe(1);
  });

  test("the provider idempotency key is scoped to the delivery and its attempt", async () => {
    rpcHandlers = singleDeliveryHandlers(delivery({ attempts: 2 }));

    await runProjectCancellationWorker({});

    expect(emailCalls[0].idempotencyKey).toBe(
      `project-cancellation:${DELIVERY_ID}:2`,
    );
  });
});

describe("ambiguity is never turned back into a retry", () => {
  test("an unknown provider outcome settles terminally", async () => {
    emailBehavior = () => ({
      outcome: "unknown_outcome",
      success: false,
      skipped: false,
      phase: "provider_request",
      code: "provider_request_aborted",
      status: null,
      error: "The provider request did not complete.",
    });
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(result.outcomes.unknown).toBe(1);
    expect(result.outcomes.retryable).toBe(0);
    expect(settlements()[0]?.p_email_state).toBe("unknown_outcome");
  });

  test("a crash mid-dispatch settles unknown_outcome rather than releasing", async () => {
    emailBehavior = () => {
      throw new Error("socket died");
    };
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(result.outcomes.unknown).toBe(1);
    expect(settlements()[0]?.p_email_state).toBe("unknown_outcome");
    expect(settlements()[0]?.p_failure_code).toBe("dispatch_crashed");
  });

  test("a pre-send refusal is the only path back to queued", async () => {
    emailBehavior = () => ({
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: "resend_client_setup_failed",
      status: null,
      error: "The transport refused before the request was made.",
    });
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});

    expect(result.outcomes.retryable).toBe(1);
    expect(settlements()[0]?.p_email_state).toBe("queued");
  });

  test("an expired budget abandons the job before its audience is touched", async () => {
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({ deadlineMs: -1 });

    expect(emailCalls.length).toBe(0);
    expect(result.deadlineReached).toBe(true);
    // No delivery was ever leased, so nothing is stranded across a provider
    // call: the job lease alone is left for the reaper, which is the safe half.
    expect(
      rpcCalls.some(
        (call) => call.name === "claim_project_cancellation_deliveries",
      ),
    ).toBe(false);
    expect(result.outcomes.unknown).toBe(0);
  });

  test("running out of time mid-batch releases the unsent claims back to queued", async () => {
    let clock = 0;
    rpcHandlers = {
      reap_project_cancellation_delivery_leases: () => 0,
      reap_project_cancellation_job_leases: () => ({ released: 0, failed: 0 }),
      claim_project_cancellation_jobs: () => [job()],
      claim_project_cancellation_deliveries: () => [
        delivery({ id: `${DELIVERY_ID}-a` }),
        delivery({ id: `${DELIVERY_ID}-b` }),
      ],
      settle_project_cancellation_delivery: () => "queued",
      finalize_project_cancellation_job: () => ({
        finalized: true,
        status: "pending",
      }),
    };
    // The budget expires only after the first recipient has been dispatched.
    emailBehavior = () => {
      clock += 10_000;
      return {
        outcome: "accepted",
        success: true,
        skipped: false,
        phase: "provider_response",
        messageId: "provider-message-1",
        transport: "resend",
        data: { id: "provider-message-1" },
      };
    };

    const result = await runProjectCancellationWorker({
      deadlineMs: 1_000,
      now: () => clock,
    });

    expect(emailCalls.length).toBe(1);
    expect(result.outcomes.sent).toBe(1);
    // The second claim is released truthfully rather than left to expire into
    // unknown_outcome: nothing was sent for it.
    expect(result.outcomes.retryable).toBe(1);
    expect(result.outcomes.unknown).toBe(0);
    const released = settlements().at(-1);
    expect(released?.p_email_state).toBe("queued");
    expect(released?.p_failure_code).toBe("run_deadline");
    expect(result.deadlineReached).toBe(true);
  });
});

describe("job finalization", () => {
  test("an ambiguous recipient makes the whole job a review item", async () => {
    rpcHandlers = {
      ...singleDeliveryHandlers(),
      finalize_project_cancellation_job: () => ({
        finalized: true,
        status: "needs_review",
        open: 0,
        unknown: 1,
      }),
    };

    const result = await runProjectCancellationWorker({});

    expect(result.jobsNeedingReview).toBe(1);
    expect(result.jobsCompleted).toBe(0);
  });

  test("the audience is snapshotted only when the job has none", async () => {
    rpcHandlers = {
      ...singleDeliveryHandlers(),
      claim_project_cancellation_jobs: () => [
        job({ audience_snapshot_at: null, recipient_count: null }),
      ],
      initialize_project_cancellation_audience: () => ({
        initialized: true,
        recipients: 4,
      }),
    };

    const result = await runProjectCancellationWorker({});

    expect(result.recipientsSnapshotted).toBe(4);
    expect(
      rpcCalls.filter(
        (call) => call.name === "initialize_project_cancellation_audience",
      ).length,
    ).toBe(1);
  });

  test("an already-snapshotted job is never re-initialized", async () => {
    rpcHandlers = singleDeliveryHandlers();

    await runProjectCancellationWorker({});

    expect(
      rpcCalls.some(
        (call) => call.name === "initialize_project_cancellation_audience",
      ),
    ).toBe(false);
  });
});

describe("the run result is aggregate-only", () => {
  test("no identifier of any kind appears in the returned value", async () => {
    rpcHandlers = singleDeliveryHandlers();

    const result = await runProjectCancellationWorker({});
    const serialized = JSON.stringify(result);

    for (const identifier of [
      PROJECT_ID,
      JOB_ID,
      USER_ID,
      SIGNUP_ID,
      DELIVERY_ID,
      DEDUPE_KEY,
      "volunteer@local.test",
      "Beach Cleanup",
      "provider-message-1",
    ]) {
      expect(serialized).not.toContain(identifier);
    }

    // Everything that survives is a count or a boolean.
    for (const value of Object.values(result)) {
      const kind = typeof value;
      expect(kind === "number" || kind === "boolean" || kind === "object").toBe(
        true,
      );
    }
  });
});
