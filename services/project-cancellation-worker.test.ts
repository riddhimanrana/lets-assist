import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/emails/project-cancellation", () => ({ default: () => null }));

type Row = Record<string, unknown>;
type RpcCall = { name: string; args: Row };

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const ORG_A = "33333333-3333-4333-8333-333333333333";
const ORG_B = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

type JobState = {
  id: string;
  project_id: string;
  organization_id: string | null;
  project_title: string;
  cancelled_at: string;
  cancellation_reason: string;
  attempts: number;
  audience_snapshot_at: string | null;
  recipient_count: number | null;
  status: "pending" | "processing" | "completed" | "needs_review" | "failed";
  lease_owner: string | null;
};

type DeliveryState = {
  id: string;
  job_id: string;
  project_id: string;
  organization_id: string | null;
  signup_id_snapshot: string;
  user_id: string | null;
  recipient_kind: "registered" | "anonymous";
  recipient_email: string | null;
  notification_dedupe_key: string;
  email_state:
    | "not_owed"
    | "queued"
    | "sending"
    | "accepted"
    | "failed"
    | "unknown_outcome";
  notification_state:
    "not_owed" | "queued" | "delivered" | "replayed" | "failed";
  work_state: "idle" | "leased";
  lease_owner: string | null;
  email_attempts: number;
  notification_attempts: number;
};

const rpcCalls: RpcCall[] = [];
const emailCalls: Row[] = [];
const notificationCalls: Array<{
  notification: Row;
  userId: string;
  options: Row;
}> = [];

let emailBehaviors: Array<() => unknown> = [];
let notificationBehaviors: Array<() => unknown> = [];

function acceptedEmail() {
  return {
    outcome: "accepted",
    success: true,
    skipped: false,
    phase: "provider_response",
    messageId: "provider-message-1",
    transport: "resend",
    data: { id: "provider-message-1" },
  };
}

function retryableEmail() {
  return {
    outcome: "retryable_pre_send",
    success: false,
    skipped: false,
    phase: "transport_setup",
    code: "resend_client_setup_failed",
    status: null,
    error: "transport unavailable",
  };
}

function unknownEmail() {
  return {
    outcome: "unknown_outcome",
    success: false,
    skipped: false,
    phase: "provider_request",
    code: "provider_request_aborted",
    status: null,
    error: "outcome unknown",
  };
}

function missingTransport() {
  return {
    outcome: "skipped",
    success: false,
    skipped: true,
    phase: "transport_setup",
    code: "transport_disabled",
    reason: "transport_disabled",
  };
}

class StatefulCancellationStore {
  jobs: JobState[] = [];
  deliveries: DeliveryState[] = [];
  failures = new Map<string, number>();
  malformed = new Map<string, unknown>();
  applyThenFail = new Set<string>();
  deliveryClaimOrder: string[] = [];

  fail(operation: string, count = 1) {
    this.failures.set(operation, count);
  }

  shouldFail(operation: string) {
    const remaining = this.failures.get(operation) ?? 0;
    if (remaining <= 0) return false;
    this.failures.set(operation, remaining - 1);
    return true;
  }

  addJob({
    id,
    projectId,
    organizationId,
    deliveries = 1,
    registered = true,
  }: {
    id: string;
    projectId: string;
    organizationId: string | null;
    deliveries?: number;
    registered?: boolean;
  }) {
    this.jobs.push({
      id,
      project_id: projectId,
      organization_id: organizationId,
      project_title: `Project ${projectId.slice(0, 4)}`,
      cancelled_at: "2026-08-11T20:00:00.000Z",
      cancellation_reason: "Storm warning",
      attempts: 0,
      audience_snapshot_at: "2026-08-11T20:00:00.000Z",
      recipient_count: deliveries,
      status: "pending",
      lease_owner: null,
    });

    for (let index = 0; index < deliveries; index += 1) {
      const suffix = String(index + 1).padStart(12, "0");
      this.deliveries.push({
        id: `${projectId.slice(0, 24)}${suffix}`,
        job_id: id,
        project_id: projectId,
        organization_id: organizationId,
        signup_id_snapshot: `${id.slice(0, 24)}${suffix}`,
        user_id: registered ? USER_ID : null,
        recipient_kind: registered ? "registered" : "anonymous",
        recipient_email: `volunteer-${index}@local.test`,
        notification_dedupe_key: `project-cancelled:${projectId}`,
        email_state: "queued",
        notification_state: registered ? "queued" : "not_owed",
        work_state: "idle",
        lease_owner: null,
        email_attempts: 0,
        notification_attempts: 0,
      });
    }
  }

  jobReceipt(job: JobState) {
    return {
      id: job.id,
      project_id: job.project_id,
      organization_id: job.organization_id,
      project_title: job.project_title,
      cancelled_at: job.cancelled_at,
      cancellation_reason: job.cancellation_reason,
      attempts: job.attempts,
      audience_snapshot_at: job.audience_snapshot_at,
      recipient_count: job.recipient_count,
    };
  }

  deliveryReceipt(delivery: DeliveryState) {
    return {
      id: delivery.id,
      project_id: delivery.project_id,
      organization_id: delivery.organization_id,
      signup_id_snapshot: delivery.signup_id_snapshot,
      user_id: delivery.user_id,
      recipient_kind: delivery.recipient_kind,
      recipient_email: delivery.recipient_email,
      notification_dedupe_key: delivery.notification_dedupe_key,
      email_state: delivery.email_state,
      notification_state: delivery.notification_state,
      email_attempts: delivery.email_attempts,
      notification_attempts: delivery.notification_attempts,
    };
  }

  execute(name: string, args: Row): unknown {
    if (this.malformed.has(name)) return this.malformed.get(name);

    switch (name) {
      case "reap_project_cancellation_delivery_leases":
        return { released: 0, unknown: 0 };
      case "reap_project_cancellation_job_leases":
        return { released: 0, failed: 0 };
      case "redact_project_cancellation_destinations":
        return 0;
      case "claim_project_cancellation_jobs": {
        const worker = String(args.p_worker_id);
        const limit = Number(args.p_limit);
        return this.jobs
          .filter((job) => job.status === "pending" && job.attempts < 5)
          .slice(0, limit)
          .map((job) => {
            job.status = "processing";
            job.lease_owner = worker;
            job.attempts += 1;
            return this.jobReceipt(job);
          });
      }
      case "claim_project_cancellation_deliveries": {
        const jobId = String(args.p_job_id);
        const worker = String(args.p_worker_id);
        const limit = Number(args.p_limit);
        this.deliveryClaimOrder.push(jobId);
        const job = this.jobs.find(
          (candidate) =>
            candidate.id === jobId &&
            candidate.status === "processing" &&
            candidate.lease_owner === worker,
        );
        if (!job) return [];
        return this.deliveries
          .filter(
            (delivery) =>
              delivery.job_id === jobId &&
              delivery.work_state === "idle" &&
              ((delivery.email_state === "queued" &&
                delivery.email_attempts < 3) ||
                (delivery.notification_state === "queued" &&
                  delivery.notification_attempts < 3)),
          )
          .slice(0, limit)
          .map((delivery) => {
            delivery.work_state = "leased";
            delivery.lease_owner = worker;
            if (delivery.email_state === "queued") delivery.email_attempts += 1;
            if (delivery.notification_state === "queued") {
              delivery.notification_attempts += 1;
            }
            return this.deliveryReceipt(delivery);
          });
      }
      case "mark_project_cancellation_email_sending": {
        const delivery = this.ownedDelivery(args);
        if (!delivery || delivery.email_state !== "queued") {
          return { started: false, emailState: null };
        }
        delivery.email_state = "sending";
        return { started: true, emailState: "sending" };
      }
      case "settle_project_cancellation_delivery": {
        const delivery = this.ownedDelivery(args);
        if (!delivery) return { settled: false, reason: "lease_lost" };
        const email = args.p_email_outcome;
        const notification = args.p_notification_outcome;
        if (email !== null && email !== undefined) {
          if (delivery.email_state !== "sending") {
            return { settled: false, reason: "invalid_email_state" };
          }
          delivery.email_state =
            email === "retryable_pre_send"
              ? delivery.email_attempts >= 3
                ? "failed"
                : "queued"
              : (email as DeliveryState["email_state"]);
        }
        if (notification !== null && notification !== undefined) {
          delivery.notification_state =
            notification === "retryable"
              ? delivery.notification_attempts >= 3
                ? "failed"
                : "queued"
              : (notification as DeliveryState["notification_state"]);
        }
        delivery.work_state = "idle";
        delivery.lease_owner = null;
        return {
          settled: true,
          emailState: delivery.email_state,
          notificationState: delivery.notification_state,
          terminal:
            !["queued", "sending"].includes(delivery.email_state) &&
            delivery.notification_state !== "queued",
        };
      }
      case "release_project_cancellation_delivery": {
        const delivery = this.ownedDelivery(args);
        if (!delivery) return { released: false };
        if (
          ["queued", "sending"].includes(delivery.email_state) &&
          delivery.email_attempts >= 3
        ) {
          delivery.email_state = "failed";
        } else if (delivery.email_state === "sending") {
          delivery.email_state = "queued";
        }
        if (
          delivery.notification_state === "queued" &&
          delivery.notification_attempts >= 3
        ) {
          delivery.notification_state = "failed";
        }
        delivery.work_state = "idle";
        delivery.lease_owner = null;
        return {
          released: true,
          emailState: delivery.email_state,
          notificationState: delivery.notification_state,
        };
      }
      case "finalize_project_cancellation_job": {
        const job = this.jobs.find(
          (candidate) =>
            candidate.id === args.p_job_id &&
            candidate.status === "processing" &&
            candidate.lease_owner === args.p_worker_id,
        );
        if (!job) return { finalized: false, reason: "lease_lost" };
        const deliveries = this.deliveries.filter(
          (delivery) => delivery.job_id === job.id,
        );
        const open = deliveries.some(
          (delivery) =>
            delivery.work_state === "leased" ||
            ["queued", "sending"].includes(delivery.email_state) ||
            delivery.notification_state === "queued",
        );
        const unknown = deliveries.some(
          (delivery) => delivery.email_state === "unknown_outcome",
        );
        const failed = deliveries.some(
          (delivery) =>
            delivery.email_state === "failed" ||
            delivery.notification_state === "failed",
        );
        job.status = open
          ? "pending"
          : unknown || failed
            ? "needs_review"
            : "completed";
        job.lease_owner = null;
        return { finalized: true, status: job.status };
      }
      default:
        throw new Error(`Unhandled RPC ${name}`);
    }
  }

  ownedDelivery(args: Row) {
    return this.deliveries.find(
      (delivery) =>
        delivery.id === args.p_delivery_id &&
        delivery.work_state === "leased" &&
        delivery.lease_owner === args.p_worker_id,
    );
  }

  rpc(name: string, args: Row) {
    rpcCalls.push({ name, args });
    const failBefore = this.shouldFail(name);
    if (failBefore && !this.applyThenFail.has(name)) {
      return { data: null, error: { code: "TEST", message: "transient" } };
    }
    const data = this.execute(name, args);
    if (failBefore) {
      return { data: null, error: { code: "TEST", message: "lost response" } };
    }
    return { data, error: null };
  }
}

let store = new StatefulCancellationStore();

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Row = {}) => store.rpc(name, args),
  }),
}));

mock.module("@/services/email", () => ({
  sendEmail: async (payload: Row) => {
    emailCalls.push(payload);
    return (emailBehaviors.shift() ?? acceptedEmail)();
  },
}));

mock.module("@/services/notifications-server", () => ({
  createNotificationForUser: async (
    notification: Row,
    userId: string,
    options: Row,
  ) => {
    notificationCalls.push({ notification, userId, options });
    return (notificationBehaviors.shift() ?? (() => ({ success: true })))();
  },
}));

const {
  CANCELLATION_WORKER_DELIVERY_QUANTUM,
  CANCELLATION_WORKER_MAX_BATCH_SIZE,
  CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
  CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
  runProjectCancellationWorker,
} = await import("@/services/project-cancellation-worker");

beforeEach(() => {
  store = new StatefulCancellationStore();
  rpcCalls.length = 0;
  emailCalls.length = 0;
  notificationCalls.length = 0;
  emailBehaviors = [];
  notificationBehaviors = [];
});

function addSingleJob() {
  store.addJob({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectId: PROJECT_A,
    organizationId: ORG_A,
  });
}

describe("checked persistence boundaries", () => {
  test("recovery and retention run before claims even with no work", async () => {
    const result = await runProjectCancellationWorker();
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "reap_project_cancellation_delivery_leases",
      "reap_project_cancellation_job_leases",
      "redact_project_cancellation_destinations",
      "claim_project_cancellation_jobs",
    ]);
    expect(result.jobsClaimed).toBe(0);
  });

  for (const operation of [
    "reap_project_cancellation_delivery_leases",
    "reap_project_cancellation_job_leases",
    "redact_project_cancellation_destinations",
    "claim_project_cancellation_jobs",
    "claim_project_cancellation_deliveries",
  ]) {
    test(`${operation} error aborts before any provider send`, async () => {
      addSingleJob();
      store.fail(operation);
      await expect(runProjectCancellationWorker()).rejects.toThrow(
        "Project cancellation persistence failed",
      );
      expect(emailCalls).toHaveLength(0);
    });
  }

  test("a missing snapshot/count receipt is rejected before send", async () => {
    addSingleJob();
    store.jobs[0].audience_snapshot_at = null;
    await expect(runProjectCancellationWorker()).rejects.toThrow(
      "claim_project_cancellation_jobs",
    );
    expect(emailCalls).toHaveLength(0);
  });

  test("a lost mark response is safely released before send", async () => {
    addSingleJob();
    store.applyThenFail.add("mark_project_cancellation_email_sending");
    store.fail("mark_project_cancellation_email_sending");

    await expect(runProjectCancellationWorker()).rejects.toThrow();

    expect(emailCalls).toHaveLength(0);
    expect(store.deliveries[0].email_state).toBe("queued");
    expect(store.deliveries[0].work_state).toBe("idle");
  });

  test("three pre-send persistence failures terminalize after safe job revival", async () => {
    addSingleJob();
    store.fail("mark_project_cancellation_email_sending", 3);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(runProjectCancellationWorker()).rejects.toThrow();
      expect(emailCalls).toHaveLength(0);
      // Models the bounded job-lease reaper after each aborted invocation. It
      // revives the job only; the delivery attempt evidence is never reset.
      store.jobs[0].status = "pending";
      store.jobs[0].lease_owner = null;
    }

    expect(store.deliveries[0].email_attempts).toBe(3);
    expect(store.deliveries[0].email_state).toBe("failed");
    expect(store.deliveries[0].notification_state).toBe("failed");

    const review = await runProjectCancellationWorker();
    expect(review.deliveriesClaimed).toBe(0);
    expect(review.jobsNeedingReview).toBe(1);
    expect(emailCalls).toHaveLength(0);
  });
});

describe("stateful owed-channel behavior", () => {
  test("notification error retries/dedupes without re-sending accepted email", async () => {
    addSingleJob();
    notificationBehaviors = [
      () => ({ error: new Error("transient") }),
      () => ({ success: true, replayed: true }),
    ];

    const result = await runProjectCancellationWorker();

    expect(emailCalls).toHaveLength(1);
    expect(notificationCalls).toHaveLength(2);
    expect(notificationCalls[0].options).toEqual({ respectPreferences: false });
    expect(store.deliveries[0].email_state).toBe("accepted");
    expect(store.deliveries[0].notification_state).toBe("replayed");
    expect(result.notifications.retryable).toBe(1);
    expect(result.notifications.replayed).toBe(1);
    expect(result.jobsCompleted).toBe(1);
  });

  test("three safe pre-send failures terminalize and never spin when rerun", async () => {
    addSingleJob();
    emailBehaviors = [retryableEmail, retryableEmail, retryableEmail];

    const first = await runProjectCancellationWorker();

    expect(emailCalls).toHaveLength(3);
    expect(store.deliveries[0].email_attempts).toBe(3);
    expect(store.deliveries[0].email_state).toBe("failed");
    expect(first.outcomes.retryable).toBe(2);
    expect(first.outcomes.failed).toBe(1);
    expect(first.jobsNeedingReview).toBe(1);

    await runProjectCancellationWorker();
    expect(emailCalls).toHaveLength(3);
  });

  test("unknown provider outcome is terminal and never resent", async () => {
    addSingleJob();
    emailBehaviors = [unknownEmail];

    const first = await runProjectCancellationWorker();
    expect(first.outcomes.unknown).toBe(1);
    expect(store.deliveries[0].email_state).toBe("unknown_outcome");
    expect(first.jobsNeedingReview).toBe(1);

    await runProjectCancellationWorker();
    expect(emailCalls).toHaveLength(1);
  });

  test("missing transport is failed owed email, never completed", async () => {
    addSingleJob();
    emailBehaviors = [missingTransport];
    const result = await runProjectCancellationWorker();
    expect(store.deliveries[0].email_state).toBe("failed");
    expect(result.jobsCompleted).toBe(0);
    expect(result.jobsNeedingReview).toBe(1);
  });

  test("deleted registered identity still sends frozen email but fails owed notification", async () => {
    addSingleJob();
    store.deliveries[0].user_id = null;
    const result = await runProjectCancellationWorker();
    expect(emailCalls).toHaveLength(1);
    expect(notificationCalls).toHaveLength(0);
    expect(store.deliveries[0].email_state).toBe("accepted");
    expect(store.deliveries[0].notification_state).toBe("failed");
    expect(result.jobsNeedingReview).toBe(1);
  });

  test("provider key is stable across proven pre-send retries", async () => {
    addSingleJob();
    emailBehaviors = [retryableEmail, acceptedEmail];
    await runProjectCancellationWorker();
    expect(emailCalls).toHaveLength(2);
    expect(emailCalls[0].idempotencyKey).toBe(emailCalls[1].idempotencyKey);
    expect(emailCalls[0].idempotencyKey).toBe(
      `project-cancellation:${store.deliveries[0].id}`,
    );
  });
});

describe("fair bounded draining", () => {
  test("jobs alternate by a per-job quantum under the global budget", async () => {
    const jobA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const jobB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    store.addJob({
      id: jobA,
      projectId: PROJECT_A,
      organizationId: ORG_A,
      deliveries: CANCELLATION_WORKER_DELIVERY_QUANTUM + 1,
      registered: false,
    });
    store.addJob({
      id: jobB,
      projectId: PROJECT_B,
      organizationId: ORG_B,
      deliveries: CANCELLATION_WORKER_DELIVERY_QUANTUM + 1,
      registered: false,
    });

    const result = await runProjectCancellationWorker({
      batchSize: CANCELLATION_WORKER_MAX_BATCH_SIZE,
      maxJobs: CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
    });

    expect(store.deliveryClaimOrder.slice(0, 4)).toEqual([
      jobA,
      jobB,
      jobA,
      jobB,
    ]);
    const limits = rpcCalls
      .filter((call) => call.name === "claim_project_cancellation_deliveries")
      .map((call) => call.args.p_limit);
    expect(limits.every((limit) => Number(limit) <= 25)).toBe(true);
    expect(result.deliveriesClaimed).toBe(52);
    expect(result.deliveriesClaimed).toBeLessThanOrEqual(
      CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
    );
  });

  test("caller batch and job values remain clamped", async () => {
    addSingleJob();
    await runProjectCancellationWorker({ batchSize: 99_999, maxJobs: 99_999 });
    const jobClaim = rpcCalls.find(
      (call) => call.name === "claim_project_cancellation_jobs",
    );
    const deliveryClaim = rpcCalls.find(
      (call) => call.name === "claim_project_cancellation_deliveries",
    );
    expect(jobClaim?.args.p_limit).toBe(CANCELLATION_WORKER_MAX_JOBS_PER_RUN);
    expect(deliveryClaim?.args.p_limit).toBe(
      CANCELLATION_WORKER_DELIVERY_QUANTUM,
    );
  });
});

describe("privacy", () => {
  test("aggregate result contains no job, project, recipient, or provider identity", async () => {
    addSingleJob();
    const result = await runProjectCancellationWorker();
    const serialized = JSON.stringify(result);
    for (const secret of [
      PROJECT_A,
      ORG_A,
      USER_ID,
      store.jobs[0].id,
      store.deliveries[0].id,
      "volunteer-0@local.test",
      "provider-message-1",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
