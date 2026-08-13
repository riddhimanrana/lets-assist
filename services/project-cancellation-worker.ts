import "server-only";

import * as React from "react";
import { randomUUID } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type SendEmailParams } from "@/services/email";
import { createNotificationForUser } from "@/services/notifications-server";
import {
  settlementForCancellationNotification,
  settlementForCancellationSend,
  type CancellationEmailOutcome,
  type CancellationNotificationOutcome,
} from "@/services/project-cancellation-dispatch";
import ProjectCancellation from "@/emails/project-cancellation";

export const CANCELLATION_WORKER_MAX_JOBS_PER_RUN = 5;
export const CANCELLATION_WORKER_MAX_BATCH_SIZE = 50;
export const CANCELLATION_WORKER_DELIVERY_QUANTUM = 25;
export const CANCELLATION_WORKER_JOB_LEASE_SECONDS = 150;
export const CANCELLATION_WORKER_DELIVERY_LEASE_SECONDS = 90;
export const CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN = 500;
export const CANCELLATION_WORKER_REAPER_LIMIT = 200;

export interface CancellationEmailOutcomes {
  sent: number;
  failed: number;
  retryable: number;
  unknown: number;
}

export interface CancellationNotificationOutcomes {
  delivered: number;
  replayed: number;
  retryable: number;
  failed: number;
}

export interface CancellationWorkerRunResult {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsNeedingReview: number;
  jobsFailed: number;
  jobsReleased: number;
  recipientsSnapshotted: number;
  deliveriesClaimed: number;
  outcomes: CancellationEmailOutcomes;
  notifications: CancellationNotificationOutcomes;
  reapedDeliveryLeases: number;
  reapedUnknownDeliveries: number;
  reapedJobLeases: number;
  failedExhaustedJobs: number;
  redactedDestinations: number;
  deadlineReached: boolean;
}

type ClaimedJob = {
  id: string;
  project_id: string;
  organization_id: string | null;
  project_title: string;
  cancelled_at: string;
  cancellation_reason: string;
  attempts: number;
  audience_snapshot_at: string;
  recipient_count: number;
};

type ClaimedDelivery = {
  id: string;
  project_id: string;
  organization_id: string | null;
  signup_id_snapshot: string;
  user_id: string | null;
  recipient_kind: "registered" | "anonymous";
  recipient_email: string | null;
  notification_dedupe_key: string;
  email_state:
    "not_owed" | "queued" | "accepted" | "failed" | "unknown_outcome";
  notification_state:
    "not_owed" | "queued" | "delivered" | "replayed" | "failed";
  email_attempts: number;
  notification_attempts: number;
};

type SettlementReceipt = {
  settled: true;
  emailState: ClaimedDelivery["email_state"];
  notificationState: ClaimedDelivery["notification_state"];
  terminal: boolean;
};

type ReleaseReceipt = {
  released: true;
  emailState: ClaimedDelivery["email_state"];
  notificationState: ClaimedDelivery["notification_state"];
};

type FinalizeReceipt = {
  finalized: true;
  status: "pending" | "completed" | "needs_review" | "failed";
};

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof getAdminClient>;

class CancellationPersistenceError extends Error {
  constructor(operation: string) {
    super(`Project cancellation persistence failed at ${operation}`);
    this.name = "CancellationPersistenceError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return requiredString(value) ?? undefined;
}

function boundedCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

async function rpcData(
  admin: AdminClient,
  operation: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await admin.rpc(operation, args);
  if (error || data === null || data === undefined) {
    throw new CancellationPersistenceError(operation);
  }
  return data;
}

function parseCountRecord(
  value: unknown,
  operation: string,
  fields: readonly string[],
): Record<string, number> {
  if (!isRecord(value)) throw new CancellationPersistenceError(operation);
  const parsed: Record<string, number> = {};
  for (const field of fields) {
    const count = boundedCount(value[field]);
    if (count === null) throw new CancellationPersistenceError(operation);
    parsed[field] = count;
  }
  return parsed;
}

function parseClaimedJobs(value: unknown): ClaimedJob[] {
  if (!Array.isArray(value)) {
    throw new CancellationPersistenceError("claim_project_cancellation_jobs");
  }

  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new CancellationPersistenceError("claim_project_cancellation_jobs");
    }
    const organizationId = nullableString(candidate.organization_id);
    const recipientCount = boundedCount(candidate.recipient_count);
    const attempts = boundedCount(candidate.attempts);
    const parsed = {
      id: requiredString(candidate.id),
      project_id: requiredString(candidate.project_id),
      organization_id: organizationId,
      project_title: requiredString(candidate.project_title),
      cancelled_at: requiredString(candidate.cancelled_at),
      cancellation_reason: requiredString(candidate.cancellation_reason),
      attempts,
      audience_snapshot_at: requiredString(candidate.audience_snapshot_at),
      recipient_count: recipientCount,
    };
    if (
      !parsed.id ||
      !parsed.project_id ||
      organizationId === undefined ||
      !parsed.project_title ||
      !parsed.cancelled_at ||
      !parsed.cancellation_reason ||
      attempts === null ||
      !parsed.audience_snapshot_at ||
      recipientCount === null
    ) {
      throw new CancellationPersistenceError("claim_project_cancellation_jobs");
    }
    return parsed as ClaimedJob;
  });
}

const EMAIL_STATES = new Set<ClaimedDelivery["email_state"]>([
  "not_owed",
  "queued",
  "accepted",
  "failed",
  "unknown_outcome",
]);
const NOTIFICATION_STATES = new Set<ClaimedDelivery["notification_state"]>([
  "not_owed",
  "queued",
  "delivered",
  "replayed",
  "failed",
]);

function parseClaimedDeliveries(value: unknown): ClaimedDelivery[] {
  if (!Array.isArray(value)) {
    throw new CancellationPersistenceError(
      "claim_project_cancellation_deliveries",
    );
  }

  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new CancellationPersistenceError(
        "claim_project_cancellation_deliveries",
      );
    }
    const organizationId = nullableString(candidate.organization_id);
    const userId = nullableString(candidate.user_id);
    const recipientEmail = nullableString(candidate.recipient_email);
    const emailAttempts = boundedCount(candidate.email_attempts);
    const notificationAttempts = boundedCount(candidate.notification_attempts);
    const emailState = candidate.email_state;
    const notificationState = candidate.notification_state;
    const recipientKind = candidate.recipient_kind;

    if (
      !requiredString(candidate.id) ||
      !requiredString(candidate.project_id) ||
      organizationId === undefined ||
      !requiredString(candidate.signup_id_snapshot) ||
      userId === undefined ||
      recipientEmail === undefined ||
      !requiredString(candidate.notification_dedupe_key) ||
      (recipientKind !== "registered" && recipientKind !== "anonymous") ||
      !EMAIL_STATES.has(emailState as ClaimedDelivery["email_state"]) ||
      !NOTIFICATION_STATES.has(
        notificationState as ClaimedDelivery["notification_state"],
      ) ||
      emailAttempts === null ||
      emailAttempts > 3 ||
      notificationAttempts === null ||
      notificationAttempts > 3 ||
      (emailState === "queued" && recipientEmail === null)
    ) {
      throw new CancellationPersistenceError(
        "claim_project_cancellation_deliveries",
      );
    }

    return {
      id: candidate.id,
      project_id: candidate.project_id,
      organization_id: organizationId,
      signup_id_snapshot: candidate.signup_id_snapshot,
      user_id: userId,
      recipient_kind: recipientKind,
      recipient_email: recipientEmail,
      notification_dedupe_key: candidate.notification_dedupe_key,
      email_state: emailState,
      notification_state: notificationState,
      email_attempts: emailAttempts,
      notification_attempts: notificationAttempts,
    } as ClaimedDelivery;
  });
}

function emptyResult(): CancellationWorkerRunResult {
  return {
    jobsClaimed: 0,
    jobsCompleted: 0,
    jobsNeedingReview: 0,
    jobsFailed: 0,
    jobsReleased: 0,
    recipientsSnapshotted: 0,
    deliveriesClaimed: 0,
    outcomes: { sent: 0, failed: 0, retryable: 0, unknown: 0 },
    notifications: { delivered: 0, replayed: 0, retryable: 0, failed: 0 },
    reapedDeliveryLeases: 0,
    reapedUnknownDeliveries: 0,
    reapedJobLeases: 0,
    failedExhaustedJobs: 0,
    redactedDestinations: 0,
    deadlineReached: false,
  };
}

function cancellationEmailPayload(
  job: ClaimedJob,
  delivery: ClaimedDelivery,
): SendEmailParams {
  const titleForSubject =
    job.project_title.length > 60
      ? `${job.project_title.slice(0, 57)}…`
      : job.project_title;

  return {
    to: delivery.recipient_email!,
    subject: `Project Cancelled: ${titleForSubject}`,
    react: React.createElement(ProjectCancellation, {
      volunteerName: "Volunteer",
      projectName: job.project_title,
      cancellationReason: job.cancellation_reason,
    }),
    type: "transactional",
    tags: [{ name: "kind", value: "project_cancellation" }],
    // Stable for the logical delivery, including any retry that was proven to
    // fail before provider acceptance.
    idempotencyKey: `project-cancellation:${delivery.id}`,
  };
}

async function notificationOutcome(
  job: ClaimedJob,
  delivery: ClaimedDelivery,
): Promise<CancellationNotificationOutcome | null> {
  if (delivery.notification_state !== "queued") return null;
  if (!delivery.user_id) return "failed";

  try {
    const reason = job.cancellation_reason.trim();
    const notification = await createNotificationForUser(
      {
        title: "Project Cancelled",
        body: `The project "${job.project_title}" has been cancelled.${
          reason ? ` Reason: ${reason}` : ""
        }`,
        type: "project_updates",
        severity: "warning",
        actionUrl: `/projects/${job.project_id}`,
        data: {
          projectId: job.project_id,
          event: "project_cancelled",
          cancelledAt: job.cancelled_at,
        },
        dedupeKey: delivery.notification_dedupe_key,
      },
      delivery.user_id,
      { respectPreferences: false },
    );
    return settlementForCancellationNotification(notification);
  } catch {
    // Notification inserts are protected by the unique dedupe key. Even an
    // ambiguous client response can be retried without creating a second row.
    return "retryable";
  }
}

function expectedEmailState(
  delivery: ClaimedDelivery,
  outcome: CancellationEmailOutcome | null,
): ClaimedDelivery["email_state"] {
  if (outcome === null) return delivery.email_state;
  if (outcome === "retryable_pre_send") {
    return delivery.email_attempts >= 3 ? "failed" : "queued";
  }
  return outcome;
}

function expectedNotificationState(
  delivery: ClaimedDelivery,
  outcome: CancellationNotificationOutcome | null,
): ClaimedDelivery["notification_state"] {
  if (outcome === null) return delivery.notification_state;
  if (outcome === "retryable") {
    return delivery.notification_attempts >= 3 ? "failed" : "queued";
  }
  return outcome;
}

function parseSettlement(value: unknown): SettlementReceipt {
  if (
    !isRecord(value) ||
    value.settled !== true ||
    !EMAIL_STATES.has(value.emailState as ClaimedDelivery["email_state"]) ||
    !NOTIFICATION_STATES.has(
      value.notificationState as ClaimedDelivery["notification_state"],
    ) ||
    typeof value.terminal !== "boolean"
  ) {
    throw new CancellationPersistenceError(
      "settle_project_cancellation_delivery",
    );
  }
  const receipt = value as SettlementReceipt;
  const terminal =
    !["queued", "sending"].includes(receipt.emailState) &&
    receipt.notificationState !== "queued";
  if (receipt.terminal !== terminal) {
    throw new CancellationPersistenceError(
      "settle_project_cancellation_delivery",
    );
  }
  return receipt;
}

function parseRelease(
  value: unknown,
  delivery: ClaimedDelivery,
): ReleaseReceipt {
  if (
    !isRecord(value) ||
    value.released !== true ||
    !EMAIL_STATES.has(value.emailState as ClaimedDelivery["email_state"]) ||
    !NOTIFICATION_STATES.has(
      value.notificationState as ClaimedDelivery["notification_state"],
    )
  ) {
    throw new CancellationPersistenceError(
      "release_project_cancellation_delivery",
    );
  }

  const receipt = value as ReleaseReceipt;
  const expectedEmail =
    delivery.email_state === "queued" && delivery.email_attempts >= 3
      ? "failed"
      : delivery.email_state;
  const expectedNotification =
    delivery.notification_state === "queued" &&
    delivery.notification_attempts >= 3
      ? "failed"
      : delivery.notification_state;
  if (
    receipt.emailState !== expectedEmail ||
    receipt.notificationState !== expectedNotification
  ) {
    throw new CancellationPersistenceError(
      "release_project_cancellation_delivery",
    );
  }
  return receipt;
}

async function processDelivery(
  admin: AdminClient,
  workerId: string,
  job: ClaimedJob,
  delivery: ClaimedDelivery,
  result: CancellationWorkerRunResult,
): Promise<void> {
  const notification = await notificationOutcome(job, delivery);
  let email: CancellationEmailOutcome | null = null;
  let providerMessageId: string | null = null;
  let failureCode: string | null =
    notification === "failed" ? "registered_identity_deleted" : null;
  let providerInvoked = false;

  try {
    if (delivery.email_state === "queued") {
      // Render and locally validate the complete payload before changing the DB
      // state to sending. A transient failure before this boundary is safe.
      const payload = cancellationEmailPayload(job, delivery);
      const marked = await rpcData(
        admin,
        "mark_project_cancellation_email_sending",
        { p_delivery_id: delivery.id, p_worker_id: workerId },
      );
      if (
        !isRecord(marked) ||
        marked.started !== true ||
        marked.emailState !== "sending"
      ) {
        throw new CancellationPersistenceError(
          "mark_project_cancellation_email_sending",
        );
      }

      providerInvoked = true;
      const sendResult = await sendEmail(payload);
      const settlement = settlementForCancellationSend(sendResult);
      email = settlement.outcome;
      providerMessageId = settlement.providerMessageId;
      failureCode = settlement.failureCode ?? failureCode;
    }

    const receipt = parseSettlement(
      await rpcData(admin, "settle_project_cancellation_delivery", {
        p_delivery_id: delivery.id,
        p_worker_id: workerId,
        p_email_outcome: email,
        p_notification_outcome: notification,
        p_provider_message_id: providerMessageId,
        p_failure_code: failureCode,
      }),
    );

    const expectedEmail = expectedEmailState(delivery, email);
    const expectedNotification = expectedNotificationState(
      delivery,
      notification,
    );
    if (
      receipt.emailState !== expectedEmail ||
      receipt.notificationState !== expectedNotification
    ) {
      throw new CancellationPersistenceError(
        "settle_project_cancellation_delivery",
      );
    }

    if (email === "accepted") result.outcomes.sent += 1;
    else if (email === "retryable_pre_send") {
      if (receipt.emailState === "failed") result.outcomes.failed += 1;
      else result.outcomes.retryable += 1;
    } else if (email === "failed") result.outcomes.failed += 1;
    else if (email === "unknown_outcome") result.outcomes.unknown += 1;

    if (notification === "delivered") result.notifications.delivered += 1;
    else if (notification === "replayed") result.notifications.replayed += 1;
    else if (notification === "retryable") {
      if (receipt.notificationState === "failed") {
        result.notifications.failed += 1;
      } else {
        result.notifications.retryable += 1;
      }
    } else if (notification === "failed") result.notifications.failed += 1;
  } catch (error) {
    if (providerInvoked && email !== null) {
      // The provider returned a classified result; retry only the durable write,
      // never the email. If the first settlement committed and only its response
      // was lost, this retry reports lease_lost and the run stops with the
      // already-correct terminal/queued state intact.
      try {
        const retryReceipt = await rpcData(
          admin,
          "settle_project_cancellation_delivery",
          {
            p_delivery_id: delivery.id,
            p_worker_id: workerId,
            p_email_outcome: email,
            p_notification_outcome: notification,
            p_provider_message_id: providerMessageId,
            p_failure_code: failureCode,
          },
        );
        if (!(
          isRecord(retryReceipt) &&
          retryReceipt.settled === false &&
          retryReceipt.reason === "lease_lost"
        )) {
          parseSettlement(retryReceipt);
        }
      } catch {
        // The lease reaper preserves the conservative truth if persistence is
        // still unavailable.
      }
      throw new CancellationPersistenceError(
        "settle_project_cancellation_delivery",
      );
    }

    if (providerInvoked) {
      // A throw after invocation is ambiguous regardless of where it came from.
      // Settle terminally; if settlement itself is unavailable, leave the lease
      // for the bounded reaper, which reaches the same unknown_outcome truth.
      try {
        const receipt = parseSettlement(
          await rpcData(admin, "settle_project_cancellation_delivery", {
            p_delivery_id: delivery.id,
            p_worker_id: workerId,
            p_email_outcome: "unknown_outcome",
            p_notification_outcome: notification,
            p_provider_message_id: null,
            p_failure_code: "dispatch_crashed",
          }),
        );
        if (receipt.emailState !== "unknown_outcome") {
          throw new CancellationPersistenceError(
            "settle_project_cancellation_delivery",
          );
        }
        result.outcomes.unknown += 1;
      } catch {
        throw new CancellationPersistenceError(
          "settle_project_cancellation_delivery",
        );
      }
      return;
    }

    // No provider call began. Returning the lease to idle is truthful, including
    // the case where the mark RPC committed but its response was lost.
    parseRelease(
      await rpcData(admin, "release_project_cancellation_delivery", {
        p_delivery_id: delivery.id,
        p_worker_id: workerId,
        p_failure_code: "pre_send_persistence_error",
      }),
      delivery,
    );
    throw error;
  }
}

function parseFinalize(value: unknown): FinalizeReceipt {
  if (
    !isRecord(value) ||
    value.finalized !== true ||
    !["pending", "completed", "needs_review", "failed"].includes(
      String(value.status),
    )
  ) {
    throw new CancellationPersistenceError("finalize_project_cancellation_job");
  }
  return value as FinalizeReceipt;
}

export async function runProjectCancellationWorker(
  options: {
    batchSize?: number;
    maxJobs?: number;
    maxDeliveries?: number;
    deadlineMs?: number;
    now?: () => number;
  } = {},
): Promise<CancellationWorkerRunResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadlineMs = options.deadlineMs ?? 45_000;
  const batchSize = Math.min(
    Math.max(options.batchSize ?? CANCELLATION_WORKER_MAX_BATCH_SIZE, 1),
    CANCELLATION_WORKER_MAX_BATCH_SIZE,
  );
  const quantum = Math.min(batchSize, CANCELLATION_WORKER_DELIVERY_QUANTUM);
  const maxJobs = Math.min(
    Math.max(options.maxJobs ?? CANCELLATION_WORKER_MAX_JOBS_PER_RUN, 1),
    CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
  );
  const maxDeliveries = Math.min(
    Math.max(
      options.maxDeliveries ?? CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
      1,
    ),
    CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN,
  );
  const outOfTime = () => now() - startedAt > deadlineMs;

  const admin = getAdminClient();
  const workerId = `cancellation-${randomUUID()}`;
  const result = emptyResult();

  const deliveryReap = parseCountRecord(
    await rpcData(admin, "reap_project_cancellation_delivery_leases", {
      p_limit: CANCELLATION_WORKER_REAPER_LIMIT,
    }),
    "reap_project_cancellation_delivery_leases",
    ["released", "unknown"],
  );
  result.reapedDeliveryLeases = deliveryReap.released;
  result.reapedUnknownDeliveries = deliveryReap.unknown;

  const jobReap = parseCountRecord(
    await rpcData(admin, "reap_project_cancellation_job_leases", {
      p_limit: CANCELLATION_WORKER_REAPER_LIMIT,
    }),
    "reap_project_cancellation_job_leases",
    ["released", "failed"],
  );
  result.reapedJobLeases = jobReap.released;
  result.failedExhaustedJobs = jobReap.failed;

  const redacted = boundedCount(
    await rpcData(admin, "redact_project_cancellation_destinations", {
      p_limit: CANCELLATION_WORKER_REAPER_LIMIT,
    }),
  );
  if (redacted === null) {
    throw new CancellationPersistenceError(
      "redact_project_cancellation_destinations",
    );
  }
  result.redactedDestinations = redacted;

  const jobs = parseClaimedJobs(
    await rpcData(admin, "claim_project_cancellation_jobs", {
      p_worker_id: workerId,
      p_limit: maxJobs,
      p_lease_seconds: CANCELLATION_WORKER_JOB_LEASE_SECONDS,
    }),
  );
  result.jobsClaimed = jobs.length;
  result.recipientsSnapshotted = jobs.reduce(
    (sum, job) => sum + job.recipient_count,
    0,
  );

  const active = new Set(jobs.map((job) => job.id));
  let deliveriesThisRun = 0;

  while (active.size > 0 && deliveriesThisRun < maxDeliveries && !outOfTime()) {
    for (const job of jobs) {
      if (!active.has(job.id)) continue;
      if (outOfTime() || deliveriesThisRun >= maxDeliveries) {
        result.deadlineReached = outOfTime();
        break;
      }

      const remaining = maxDeliveries - deliveriesThisRun;
      const deliveries = parseClaimedDeliveries(
        await rpcData(admin, "claim_project_cancellation_deliveries", {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_limit: Math.min(quantum, remaining),
          p_lease_seconds: CANCELLATION_WORKER_DELIVERY_LEASE_SECONDS,
        }),
      );

      if (deliveries.length === 0) {
        active.delete(job.id);
        continue;
      }

      deliveriesThisRun += deliveries.length;
      result.deliveriesClaimed += deliveries.length;

      for (const delivery of deliveries) {
        if (outOfTime()) {
          result.deadlineReached = true;
          const released = parseRelease(
            await rpcData(admin, "release_project_cancellation_delivery", {
              p_delivery_id: delivery.id,
              p_worker_id: workerId,
              p_failure_code: "run_deadline",
            }),
            delivery,
          );
          if (delivery.email_state === "queued") {
            if (released.emailState === "failed") result.outcomes.failed += 1;
            else result.outcomes.retryable += 1;
          }
          if (delivery.notification_state === "queued") {
            if (released.notificationState === "failed") {
              result.notifications.failed += 1;
            } else {
              result.notifications.retryable += 1;
            }
          }
          continue;
        }
        await processDelivery(admin, workerId, job, delivery, result);
      }
    }
  }

  if (outOfTime()) result.deadlineReached = true;

  // Finalization releases every still-owned job lease. It may complete, park for
  // review, or return pending when the global budget left owed channel work for
  // a later fair pass. Abandoned leases retain their provisional failure attempt
  // and are exhausted only by the bounded job reaper.
  for (const job of jobs) {
    const receipt = parseFinalize(
      await rpcData(admin, "finalize_project_cancellation_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
      }),
    );
    if (receipt.status === "completed") result.jobsCompleted += 1;
    else if (receipt.status === "needs_review") {
      result.jobsNeedingReview += 1;
    } else if (receipt.status === "failed") result.jobsFailed += 1;
    else result.jobsReleased += 1;
  }

  return result;
}
