import "server-only";

import * as React from "react";
import { randomUUID } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/services/email";
import { createNotificationForUser } from "@/services/notifications-server";
import {
  settlementForCancellationNotification,
  settlementForCancellationSend,
  type CancellationEmailState,
  type CancellationNotificationState,
} from "@/services/project-cancellation-dispatch";
import ProjectCancellation from "@/emails/project-cancellation";

/**
 * The durable project-cancellation worker.
 *
 * Every run does the same four things in the same order, whether or not there
 * is a single pending job:
 *
 *   1. reap expired DELIVERY leases into unknown_outcome (terminal, never re-sent);
 *   2. reap expired JOB leases back to pending, and terminalize exhausted ones;
 *   3. claim a bounded set of jobs with FOR UPDATE SKIP LOCKED;
 *   4. snapshot the audience once, drain it by keyset, finalize.
 *
 * Step 1 and step 2 run unconditionally and are the whole reason recovery is
 * discoverable: an operator does not have to manufacture a pending row to find
 * out that a lease is stuck, and a crashed run heals on the next tick without
 * anyone re-driving it by hand.
 *
 * The overlapping inline kick from the cancelling Server Action and the
 * scheduled cron run are no longer a hazard. They race for the same claim RPC,
 * and exactly one of them wins each job.
 */

export const CANCELLATION_WORKER_MAX_JOBS_PER_RUN = 5;
export const CANCELLATION_WORKER_MAX_BATCH_SIZE = 50;
export const CANCELLATION_WORKER_JOB_LEASE_SECONDS = 150;
export const CANCELLATION_WORKER_DELIVERY_LEASE_SECONDS = 90;

/** Hard stop on how much a single run may drain, independent of the clock. */
export const CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN = 500;

export interface CancellationEmailOutcomes {
  sent: number;
  skipped: number;
  failed: number;
  retryable: number;
  unknown: number;
}

export interface CancellationNotificationOutcomes {
  delivered: number;
  replayed: number;
  skipped: number;
  failed: number;
}

export interface CancellationWorkerRunResult {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsNeedingReview: number;
  jobsReleased: number;
  recipientsSnapshotted: number;
  deliveriesClaimed: number;
  outcomes: CancellationEmailOutcomes;
  notifications: CancellationNotificationOutcomes;
  reapedDeliveryLeases: number;
  reapedJobLeases: number;
  failedExhaustedJobs: number;
  deadlineReached: boolean;
}

type ClaimedJob = {
  id: string;
  project_id: string;
  cancelled_at: string;
  cancellation_reason: string;
  attempts: number;
  audience_snapshot_at: string | null;
  recipient_count: number | null;
};

type ClaimedDelivery = {
  id: string;
  project_id: string;
  signup_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  notification_dedupe_key: string;
  notification_state: string;
  attempts: number;
};

type CancelledProject = {
  id: string;
  title: string;
  status: string;
};

type RecipientResolution =
  | { ok: true; email: string | null; name: string }
  | { ok: false; reason: string };

function emptyResult(): CancellationWorkerRunResult {
  return {
    jobsClaimed: 0,
    jobsCompleted: 0,
    jobsNeedingReview: 0,
    jobsReleased: 0,
    recipientsSnapshotted: 0,
    deliveriesClaimed: 0,
    outcomes: { sent: 0, skipped: 0, failed: 0, retryable: 0, unknown: 0 },
    notifications: { delivered: 0, replayed: 0, skipped: 0, failed: 0 },
    reapedDeliveryLeases: 0,
    reapedJobLeases: 0,
    failedExhaustedJobs: 0,
    deadlineReached: false,
  };
}

type AdminClient = ReturnType<typeof getAdminClient>;

/**
 * Re-resolve the recipient at send time.
 *
 * The audience was frozen when the job was initialized, but authorization and
 * contactability are not frozen with it: the signup may have been deleted, the
 * address may have changed or been removed, and — the case that matters for
 * isolation — a ledger row must still belong to the project its job names.
 * Membership is deliberately NOT re-decided here; see the migration's note on
 * why a withdrawal after the snapshot still gets the notice.
 */
async function resolveRecipient(
  admin: AdminClient,
  job: ClaimedJob,
  delivery: ClaimedDelivery,
): Promise<RecipientResolution> {
  const { data: signup } = await admin
    .from("project_signups")
    .select("id, project_id, user_id, anonymous_id")
    .eq("id", delivery.signup_id)
    .maybeSingle();

  if (!signup) return { ok: false, reason: "signup_missing" };
  // Cross-project (and therefore cross-organization) guard: a ledger row may
  // only ever address the project whose cancellation produced it.
  if (signup.project_id !== job.project_id) {
    return { ok: false, reason: "signup_project_mismatch" };
  }

  if (delivery.user_id) {
    if (signup.user_id !== delivery.user_id) {
      return { ok: false, reason: "signup_identity_mismatch" };
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", delivery.user_id)
      .maybeSingle();
    return {
      ok: true,
      email: profile?.email ?? null,
      name: profile?.full_name || "Volunteer",
    };
  }

  if (delivery.anonymous_id) {
    if (signup.anonymous_id !== delivery.anonymous_id) {
      return { ok: false, reason: "signup_identity_mismatch" };
    }
    const { data: anon } = await admin
      .from("anonymous_signups")
      .select("email, name, project_id")
      .eq("id", delivery.anonymous_id)
      .maybeSingle();
    if (!anon) return { ok: false, reason: "anonymous_signup_missing" };
    if (anon.project_id !== job.project_id) {
      return { ok: false, reason: "signup_project_mismatch" };
    }
    // email_opt_out_at is deliberately not consulted. That flag governs
    // non-obligatory project mail; a cancellation is transactional and is owed
    // to anyone who was going to show up.
    return {
      ok: true,
      email: anon.email ?? null,
      name: anon.name || "Volunteer",
    };
  }

  return { ok: false, reason: "no_identity" };
}

/**
 * Deliver the in-app notice. Registered recipients only, and idempotent: the
 * deterministic dedupe key carries a unique index per recipient, so a repeat
 * run — or a retry after an ambiguous email — replays instead of duplicating.
 */
async function deliverNotification(
  job: ClaimedJob,
  delivery: ClaimedDelivery,
  project: CancelledProject,
): Promise<CancellationNotificationState | null> {
  if (!delivery.user_id) return null;

  const reason = job.cancellation_reason?.trim();
  const result = await createNotificationForUser(
    {
      title: "Project Cancelled",
      body: `The project "${project.title}" has been cancelled.${
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
  );

  return settlementForCancellationNotification(result);
}

async function sendCancellationEmail(
  job: ClaimedJob,
  delivery: ClaimedDelivery,
  project: CancelledProject,
  recipient: { email: string; name: string },
) {
  const titleForSubject =
    project.title.length > 60
      ? `${project.title.slice(0, 57)}…`
      : project.title;

  return sendEmail({
    to: recipient.email,
    subject: `Project Cancelled: ${titleForSubject}`,
    react: React.createElement(ProjectCancellation, {
      volunteerName: recipient.name,
      projectName: project.title,
      cancellationReason: job.cancellation_reason,
    }),
    // A cancellation is obligatory transactional mail, so no preference gate.
    // sendEmail's own gate is a silent no-op from cron anyway.
    type: "transactional",
    tags: [{ name: "kind", value: "project_cancellation" }],
    // Attempt-scoped: a released pre-send failure gets a fresh key, while a
    // duplicate delivery of the same attempt is collapsed by the provider.
    idempotencyKey: `project-cancellation:${delivery.id}:${delivery.attempts}`,
  });
}

export async function runProjectCancellationWorker(
  options: {
    batchSize?: number;
    maxJobs?: number;
    deadlineMs?: number;
    /** Injectable clock. The deadline path is otherwise untestable without sleeping. */
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
  const maxJobs = Math.min(
    Math.max(options.maxJobs ?? CANCELLATION_WORKER_MAX_JOBS_PER_RUN, 1),
    CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
  );

  const admin = getAdminClient();
  const workerId = `cancellation-${randomUUID()}`;
  const result = emptyResult();

  const outOfTime = () => now() - startedAt > deadlineMs;

  const settle = async (
    deliveryId: string,
    emailState: CancellationEmailState,
    notificationState: CancellationNotificationState | null,
    providerMessageId: string | null,
    failureCode: string | null,
  ) => {
    await admin.rpc("settle_project_cancellation_delivery", {
      p_id: deliveryId,
      p_worker_id: workerId,
      p_email_state: emailState,
      p_notification_state: notificationState,
      p_provider_message_id: providerMessageId,
      p_failure_code: failureCode,
    });
  };

  const countEmail = (state: CancellationEmailState) => {
    if (state === "sent") result.outcomes.sent += 1;
    else if (state === "skipped") result.outcomes.skipped += 1;
    else if (state === "failed") result.outcomes.failed += 1;
    else if (state === "queued") result.outcomes.retryable += 1;
    else result.outcomes.unknown += 1;
  };

  const countNotification = (state: CancellationNotificationState | null) => {
    if (state === null) return;
    result.notifications[state] += 1;
  };

  // --- 1 & 2: recovery first, and always. ------------------------------------
  const { data: reapedDeliveries } = await admin.rpc(
    "reap_project_cancellation_delivery_leases",
  );
  result.reapedDeliveryLeases = Number(reapedDeliveries ?? 0);

  const { data: reapedJobs } = await admin.rpc(
    "reap_project_cancellation_job_leases",
  );
  const jobReap = (reapedJobs ?? {}) as { released?: number; failed?: number };
  result.reapedJobLeases = Number(jobReap.released ?? 0);
  result.failedExhaustedJobs = Number(jobReap.failed ?? 0);

  // --- 3: bounded, fair, atomic job claim. -----------------------------------
  const { data: claimedJobs } = await admin.rpc(
    "claim_project_cancellation_jobs",
    {
      p_worker_id: workerId,
      p_limit: maxJobs,
      p_lease_seconds: CANCELLATION_WORKER_JOB_LEASE_SECONDS,
    },
  );

  let deliveriesThisRun = 0;

  for (const job of (claimedJobs ?? []) as ClaimedJob[]) {
    result.jobsClaimed += 1;

    if (outOfTime()) {
      // Leave the lease to the reaper rather than starting work we cannot
      // finish. A job lease expiring is safe; only a delivery lease is not.
      result.deadlineReached = true;
      break;
    }

    if (!job.audience_snapshot_at) {
      const { data: snapshot } = await admin.rpc(
        "initialize_project_cancellation_audience",
        { p_job_id: job.id, p_worker_id: workerId },
      );
      const snapshotResult = (snapshot ?? {}) as { recipients?: number };
      result.recipientsSnapshotted += Number(snapshotResult.recipients ?? 0);
    }

    const { data: projectRow } = await admin
      .from("projects")
      .select("id, title, status")
      .eq("id", job.project_id)
      .maybeSingle();
    const project = projectRow as CancelledProject | null;

    // --- 4: keyset drain. ----------------------------------------------------
    let drained = true;
    while (drained && !outOfTime()) {
      if (deliveriesThisRun >= CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN)
        break;

      const remainingBudget =
        CANCELLATION_WORKER_MAX_DELIVERIES_PER_RUN - deliveriesThisRun;
      const { data: claims } = await admin.rpc(
        "claim_project_cancellation_deliveries",
        {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_limit: Math.min(batchSize, remainingBudget),
          p_lease_seconds: CANCELLATION_WORKER_DELIVERY_LEASE_SECONDS,
        },
      );

      const batch = (claims ?? []) as ClaimedDelivery[];
      drained = batch.length > 0;
      deliveriesThisRun += batch.length;
      result.deliveriesClaimed += batch.length;

      for (const delivery of batch) {
        if (outOfTime()) {
          // Release cleanly. Nothing was sent for this row, so 'queued' is the
          // truthful state — letting the lease expire would libel it as
          // ambiguous and strand it forever.
          result.deadlineReached = true;
          await settle(delivery.id, "queued", null, null, "run_deadline");
          countEmail("queued");
          continue;
        }

        try {
          if (!project) {
            await settle(delivery.id, "skipped", null, null, "project_missing");
            countEmail("skipped");
            continue;
          }
          if (project.status !== "cancelled") {
            // The organizer reinstated the project after the job was queued.
            // Announcing a cancellation now would be false.
            await settle(
              delivery.id,
              "skipped",
              null,
              null,
              "project_not_cancelled",
            );
            countEmail("skipped");
            continue;
          }

          const recipient = await resolveRecipient(admin, job, delivery);
          if (!recipient.ok) {
            await settle(delivery.id, "skipped", null, null, recipient.reason);
            countEmail("skipped");
            continue;
          }

          // In-app first: it is idempotent, so it costs nothing to repeat and
          // still lands when the email is skipped or ambiguous.
          const notificationState = await deliverNotification(
            job,
            delivery,
            project,
          );
          countNotification(notificationState);

          if (!recipient.email) {
            await settle(
              delivery.id,
              "skipped",
              notificationState,
              null,
              "no_address",
            );
            countEmail("skipped");
            continue;
          }

          const sendResult = await sendCancellationEmail(
            job,
            delivery,
            project,
            {
              email: recipient.email,
              name: recipient.name,
            },
          );
          const settlement = settlementForCancellationSend(sendResult);
          await settle(
            delivery.id,
            settlement.state,
            notificationState,
            settlement.providerMessageId,
            settlement.failureCode,
          );
          countEmail(settlement.state);
        } catch (error) {
          // A throw anywhere in here means we cannot prove the provider was
          // not reached. Say so, terminally.
          console.error(
            `Cancellation dispatch crashed for delivery ${delivery.id}:`,
            error,
          );
          await settle(
            delivery.id,
            "unknown_outcome",
            null,
            null,
            "dispatch_crashed",
          );
          countEmail("unknown_outcome");
        }
      }
    }

    const { data: finalized } = await admin.rpc(
      "finalize_project_cancellation_job",
      { p_job_id: job.id, p_worker_id: workerId },
    );
    const finalState = (finalized ?? {}) as { status?: string };
    if (finalState.status === "completed") result.jobsCompleted += 1;
    else if (finalState.status === "needs_review")
      result.jobsNeedingReview += 1;
    else if (finalState.status === "pending") result.jobsReleased += 1;
  }

  return result;
}
