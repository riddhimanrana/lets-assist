import "server-only";

import * as React from "react";
import { randomUUID } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/services/email";
import { settlementForSendResult } from "@/services/project-feedback-dispatch";
import { createProjectFeedbackToken } from "@/services/project-feedback-token";
import {
  getFeedbackEligibleAt,
  type FeedbackEligibilityProject,
} from "@/lib/projects/feedback-eligibility";
import {
  getAttendanceScheduleWindow,
  listAttendanceScheduleIds,
} from "@/lib/attendance/challenge";
import ProjectFeedbackRequest from "@/emails/project-feedback-request";
import type { Project } from "@/types";

/**
 * The follow-up email worker: enqueue eligible projects, reap expired
 * leases, then claim -> consent re-check -> send exactly once -> settle.
 *
 * The consent re-check is not optional. sendEmail's own notification_settings
 * gate reads through the cookie-bound client and is a silent no-op from
 * cron, so the worker gates itself with the admin client — and a queue row
 * minted an hour ago must not outlive an opt-out recorded five minutes ago.
 */

export const FEEDBACK_WORKER_MAX_PROJECTS_PER_RUN = 25;
export const FEEDBACK_WORKER_MAX_BATCH_SIZE = 50;
export const FEEDBACK_WORKER_LEASE_SECONDS = 120;

/**
 * Rotate through stable, bounded pages so permanently ineligible projects do
 * not pin every run to the same newest 25. The worker runs hourly; using the
 * UTC hour makes every page reachable without a mutable cursor row.
 */
export function feedbackProjectPageOffset(
  now: number,
  totalProjects: number,
): number {
  if (!Number.isSafeInteger(totalProjects) || totalProjects <= 0) return 0;
  const pageCount = Math.ceil(
    totalProjects / FEEDBACK_WORKER_MAX_PROJECTS_PER_RUN,
  );
  const utcHour = Math.floor(now / (60 * 60 * 1000));
  return (utcHour % pageCount) * FEEDBACK_WORKER_MAX_PROJECTS_PER_RUN;
}

export interface FeedbackWorkerOutcomes {
  sent: number;
  skipped: number;
  failed: number;
  retryable: number;
  unknown: number;
}

export interface FeedbackWorkerRunResult {
  projectsScanned: number;
  enqueued: number;
  reaped: number;
  claimed: number;
  outcomes: FeedbackWorkerOutcomes;
  deadlineReached: boolean;
}

/**
 * Mirrors getPublishStateKey in app/projects/[id]/hours/certificate-issuance
 * (services cannot import from app/). The publish jsonb key for a schedule id.
 */
function publishKeyForScheduleId(
  eventType: string,
  scheduleId: string,
): string {
  if (eventType === "oneTime") return "oneTime";
  if (eventType === "multiDay") {
    const parts = scheduleId.split("-");
    if (parts.length === 5) {
      return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[4]}`;
    }
    return scheduleId;
  }
  return scheduleId;
}

type WorkerProjectRow = FeedbackEligibilityProject &
  Pick<Project, "id" | "title" | "published"> & {
    organization_id: string | null;
  };

type FeedbackAdminClient = ReturnType<typeof getAdminClient>;

class FeedbackDatabaseError extends Error {}

function throwDatabaseError(context: string, error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : null;
  // Database/provider messages can echo row values, addresses, or credentials.
  // Keep failures actionable by operation and bounded code only.
  throw new FeedbackDatabaseError(code ? `${context} (${code})` : context);
}

async function enqueueEligibleProjects(
  now: number,
): Promise<{ projectsScanned: number; enqueued: number }> {
  const admin = getAdminClient();

  // Coarse candidate filter only: status flips via the timezone-broken
  // process_projects(), so the real decision is getFeedbackEligibleAt's.
  // Count first, then rotate through stable pages. A fixed newest-25 query
  // permanently starved older completed projects whenever those 25 remained
  // ineligible or had already been enqueued.
  const { count: completedProjectCount, error: countError } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed");
  if (countError) {
    throwDatabaseError(
      "Failed counting feedback-eligible projects",
      countError,
    );
  }
  const totalProjects = completedProjectCount ?? 0;
  if (totalProjects === 0) return { projectsScanned: 0, enqueued: 0 };

  const offset = feedbackProjectPageOffset(now, totalProjects);
  const { data: projects, error: projectsError } = await admin
    .from("projects")
    .select(
      "id, title, status, event_type, schedule, project_timezone, published, cancelled_at, organization_id, created_at",
    )
    .eq("status", "completed")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(
      offset,
      Math.min(
        offset + FEEDBACK_WORKER_MAX_PROJECTS_PER_RUN - 1,
        totalProjects - 1,
      ),
    );
  if (projectsError) {
    throwDatabaseError(
      "Failed loading feedback-eligible projects",
      projectsError,
    );
  }

  let enqueued = 0;
  const candidates = (projects ?? []) as unknown as WorkerProjectRow[];

  for (const project of candidates) {
    // A slot counts as published when its publish key is set; only slots
    // with attended signups matter for the "hold for hours" rule.
    const published = (project.published ?? {}) as Record<string, boolean>;
    const { data: attendedSlots, error: attendedSlotsError } = await admin
      .from("project_signups")
      .select("schedule_id")
      .eq("project_id", project.id)
      .eq("status", "attended");
    if (attendedSlotsError) {
      throwDatabaseError(
        `Failed loading attended signup slots for project ${project.id}`,
        attendedSlotsError,
      );
    }
    const scheduleIds = new Set(
      (attendedSlots ?? []).map((row) => row.schedule_id),
    );
    if (scheduleIds.size === 0) continue;

    const allPublished = [...scheduleIds].every(
      (scheduleId) =>
        published[publishKeyForScheduleId(project.event_type, scheduleId)] ===
        true,
    );

    const eligibleAt = getFeedbackEligibleAt({
      project,
      allAttendedSlotsPublished: allPublished,
      now,
    });
    if (!eligibleAt) continue;

    const { data: inserted, error } = await admin.rpc(
      "enqueue_project_feedback_requests",
      {
        p_project_id: project.id,
        p_eligible_at: eligibleAt.toISOString(),
      },
    );
    if (error) {
      throwDatabaseError(
        `Failed enqueueing feedback requests for project ${project.id}`,
        error,
      );
    }
    const insertedCount = Number(inserted ?? 0);
    if (!Number.isSafeInteger(insertedCount) || insertedCount < 0) {
      throw new Error(
        `Feedback enqueue returned an invalid count for project ${project.id}`,
      );
    }
    enqueued += insertedCount;
  }

  return { projectsScanned: candidates.length, enqueued };
}

type ClaimRow = {
  id: string;
  project_id: string;
  signup_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  attempts: number;
};

type RecipientResolution =
  { ok: true; email: string; name: string } | { ok: false; reason: string };

type FeedbackProject = Project & {
  organization: { name: string | null } | null;
};

type PreparedFeedbackRequest = {
  kind: "ready";
  recipientEmail: string;
  recipientName: string;
  project: FeedbackProject;
  feedbackUrl: string;
  unsubscribeUrl: string;
  eventDate: string | null;
  titleForSubject: string;
};

type SkippedFeedbackRequest = {
  kind: "skip";
  reason: string;
};

async function resolveConsentedRecipient(
  claim: ClaimRow,
  admin: FeedbackAdminClient,
): Promise<RecipientResolution> {
  if (claim.user_id) {
    const [profileResult, settingsResult] = await Promise.all([
      admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", claim.user_id)
        .maybeSingle(),
      admin
        .from("notification_settings")
        .select("email_notifications, project_updates")
        .eq("user_id", claim.user_id)
        .maybeSingle(),
    ]);
    if (profileResult.error) {
      throwDatabaseError(
        `Failed resolving feedback profile for request ${claim.id}`,
        profileResult.error,
      );
    }
    if (settingsResult.error) {
      throwDatabaseError(
        `Failed resolving feedback consent for request ${claim.id}`,
        settingsResult.error,
      );
    }
    const profile = profileResult.data;
    const settings = settingsResult.data;
    if (!profile?.email) return { ok: false, reason: "no_address" };
    // Absent settings row = default opted in (matching email-send.ts).
    if (
      settings &&
      (settings.email_notifications === false ||
        settings.project_updates === false)
    ) {
      return { ok: false, reason: "notifications_disabled" };
    }
    return {
      ok: true,
      email: profile.email,
      name: profile.full_name || "Volunteer",
    };
  }

  if (claim.anonymous_id) {
    const { data: anon, error: anonError } = await admin
      .from("anonymous_signups")
      .select("email, name, email_opt_out_at")
      .eq("id", claim.anonymous_id)
      .maybeSingle();
    if (anonError) {
      throwDatabaseError(
        `Failed resolving anonymous feedback recipient for request ${claim.id}`,
        anonError,
      );
    }
    if (!anon?.email) return { ok: false, reason: "no_address" };
    if (anon.email_opt_out_at) return { ok: false, reason: "opted_out" };
    return { ok: true, email: anon.email, name: anon.name || "Volunteer" };
  }

  return { ok: false, reason: "no_identity" };
}

async function prepareFeedbackRequest(input: {
  admin: FeedbackAdminClient;
  claim: ClaimRow;
  siteUrl: string;
}): Promise<PreparedFeedbackRequest | SkippedFeedbackRequest> {
  const { admin, claim, siteUrl } = input;
  const recipient = await resolveConsentedRecipient(claim, admin);
  if (!recipient.ok) {
    return { kind: "skip", reason: recipient.reason };
  }

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select(
      "id, title, event_type, schedule, project_timezone, status, cancelled_at, organization:organizations (name)",
    )
    .eq("id", claim.project_id)
    .maybeSingle();
  if (projectError) {
    throwDatabaseError(
      `Failed loading project for feedback request ${claim.id}`,
      projectError,
    );
  }
  if (!projectRow) return { kind: "skip", reason: "project_missing" };
  const project = projectRow as unknown as FeedbackProject;

  const { data: signup, error: signupError } = await admin
    .from("project_signups")
    .select("project_id, schedule_id")
    .eq("id", claim.signup_id)
    .eq("project_id", claim.project_id)
    .maybeSingle();
  if (signupError) {
    throwDatabaseError(
      `Failed loading signup for feedback request ${claim.id}`,
      signupError,
    );
  }
  if (!signup) return { kind: "skip", reason: "signup_missing" };

  const token = createProjectFeedbackToken({
    projectId: claim.project_id,
    requestId: claim.id,
    subject: claim.user_id
      ? { kind: "user", userId: claim.user_id }
      : { kind: "anonymous", anonymousSignupId: claim.anonymous_id! },
  });
  const feedbackUrl = `${siteUrl}/feedback/${claim.id}?token=${encodeURIComponent(token)}`;
  const unsubscribeUrl = `${siteUrl}/feedback/${claim.id}/unsubscribe?token=${encodeURIComponent(token)}`;

  const timezone = project.project_timezone || "America/Los_Angeles";
  const signupScheduleId =
    typeof signup.schedule_id === "string" && signup.schedule_id.length > 0
      ? signup.schedule_id
      : null;
  const exactScheduleWindow = signupScheduleId
    ? getAttendanceScheduleWindow(project, signupScheduleId)
    : null;
  const availableScheduleIds = signupScheduleId
    ? []
    : listAttendanceScheduleIds(project);
  const scheduleWindow =
    exactScheduleWindow ??
    (signupScheduleId === null && availableScheduleIds.length === 1
      ? getAttendanceScheduleWindow(project, availableScheduleIds[0])
      : null);

  // The exact claimed signup is authoritative. A missing/legacy schedule_id
  // may fall back only when the project has exactly one possible schedule;
  // otherwise omit the date rather than fabricating one from a different slot.
  let eventDate: string | null = null;
  if (scheduleWindow) {
    try {
      eventDate = new Date(scheduleWindow.startsAt).toLocaleDateString(
        "en-US",
        {
          timeZone: timezone,
          dateStyle: "long",
        },
      );
    } catch {
      // Invalid legacy timezone/schedule metadata is genuinely ambiguous.
    }
  }

  return {
    kind: "ready",
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    project,
    feedbackUrl,
    unsubscribeUrl,
    eventDate,
    titleForSubject:
      project.title.length > 60
        ? `${project.title.slice(0, 57)}…`
        : project.title,
  };
}

export async function runProjectFeedbackWorker(options: {
  batchSize?: number;
  deadlineMs?: number;
  now?: number;
}): Promise<FeedbackWorkerRunResult> {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const deadlineMs = options.deadlineMs ?? 45_000;
  const batchSize = Math.min(
    Math.max(options.batchSize ?? FEEDBACK_WORKER_MAX_BATCH_SIZE, 1),
    FEEDBACK_WORKER_MAX_BATCH_SIZE,
  );
  const admin = getAdminClient();
  const workerId = `feedback-${randomUUID()}`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";

  const { projectsScanned, enqueued } = await enqueueEligibleProjects(now);

  const { data: reapedCount, error: reapError } = await admin.rpc(
    "reap_project_feedback_request_leases",
  );
  if (reapError) {
    throwDatabaseError("Failed reaping feedback request leases", reapError);
  }
  const normalizedReapedCount = Number(reapedCount ?? 0);
  if (
    !Number.isSafeInteger(normalizedReapedCount) ||
    normalizedReapedCount < 0
  ) {
    throw new Error("Feedback lease reaper returned an invalid count");
  }

  const outcomes: FeedbackWorkerOutcomes = {
    sent: 0,
    skipped: 0,
    failed: 0,
    retryable: 0,
    unknown: 0,
  };
  let claimed = 0;
  let deadlineReached = false;

  const { data: claims, error: claimError } = await admin.rpc(
    "claim_project_feedback_requests_for_preparation",
    {
      p_worker_id: workerId,
      p_limit: batchSize,
      p_lease_seconds: FEEDBACK_WORKER_LEASE_SECONDS,
    },
  );
  if (claimError) {
    throwDatabaseError("Failed claiming feedback requests", claimError);
  }
  if (claims !== null && !Array.isArray(claims)) {
    throw new Error("Feedback claim RPC returned an invalid payload");
  }

  const settle = async (
    id: string,
    state: string,
    providerMessageId: string | null,
    failureCode: string | null,
  ) => {
    const { data, error } = await admin.rpc("settle_project_feedback_request", {
      p_id: id,
      p_worker_id: workerId,
      p_state: state,
      p_provider_message_id: providerMessageId,
      p_failure_code: failureCode,
    });
    if (error) {
      throwDatabaseError(`Failed settling feedback request ${id}`, error);
    }
    if (data !== state) {
      throw new Error(
        `Feedback settlement for ${id} requested ${state} but database reported ${String(data)}`,
      );
    }
  };

  const beginDispatch = async (id: string): Promise<number> => {
    const { data, error } = await admin.rpc(
      "begin_project_feedback_request_dispatch",
      {
        p_id: id,
        p_worker_id: workerId,
        p_lease_seconds: FEEDBACK_WORKER_LEASE_SECONDS,
      },
    );
    if (error) {
      throwDatabaseError(
        `Failed beginning dispatch for feedback request ${id}`,
        error,
      );
    }
    const attempt = Number(data);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 3) {
      throw new Error(
        `Feedback dispatch transition for ${id} returned an invalid attempt`,
      );
    }
    return attempt;
  };

  for (const claim of (claims ?? []) as ClaimRow[]) {
    claimed += 1;

    if (Date.now() - startedAt > deadlineMs) {
      // Out of time: release cleanly instead of letting leases expire into
      // unknown_outcome.
      deadlineReached = true;
      await settle(claim.id, "queued", null, "run_deadline");
      outcomes.retryable += 1;
      continue;
    }

    let prepared: PreparedFeedbackRequest | SkippedFeedbackRequest;

    try {
      prepared = await prepareFeedbackRequest({ admin, claim, siteUrl });
    } catch (error) {
      console.error(`Feedback pre-send preparation failed for ${claim.id}`);
      if (error instanceof FeedbackDatabaseError) {
        await settle(claim.id, "queued", null, "pre_send_database_error");
        outcomes.retryable += 1;
      } else {
        await settle(claim.id, "failed", null, "pre_send_error");
        outcomes.failed += 1;
      }
      continue;
    }

    if (prepared.kind === "skip") {
      await settle(claim.id, "skipped", null, prepared.reason);
      outcomes.skipped += 1;
      continue;
    }

    // This transition is the durable provider boundary. If it fails, no email
    // is sent and the preparation lease remains safely requeueable.
    const dispatchAttempt = await beginDispatch(claim.id);

    let result: Awaited<ReturnType<typeof sendEmail>>;
    try {
      result = await sendEmail({
        to: prepared.recipientEmail,
        subject: `How did volunteering at ${prepared.titleForSubject} go?`,
        react: React.createElement(ProjectFeedbackRequest, {
          volunteerName: prepared.recipientName,
          projectTitle: prepared.project.title,
          organizationName: prepared.project.organization?.name ?? null,
          feedbackUrl: prepared.feedbackUrl,
          unsubscribeUrl: prepared.unsubscribeUrl,
          eventDate: prepared.eventDate,
        }),
        // userId deliberately omitted: sendEmail's preference gate is
        // unreachable from cron; consent was re-checked above.
        type: "project_updates",
        headers: {
          "List-Unsubscribe": `<${prepared.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "kind", value: "project_feedback_request" }],
        idempotencyKey: `project-feedback:${claim.id}:${dispatchAttempt}`,
      });
    } catch {
      console.error(`Feedback dispatch crashed for ${claim.id}`);
      await settle(claim.id, "unknown_outcome", null, "dispatch_crashed");
      outcomes.unknown += 1;
      continue;
    }

    const mappedSettlement = settlementForSendResult(result);
    // A third definite rejection is still safe to classify, but no longer
    // retryable. Settle it explicitly instead of creating a frozen queued row.
    const settlement =
      mappedSettlement.state === "queued" && dispatchAttempt >= 3
        ? {
            state: "failed" as const,
            providerMessageId: null,
            failureCode: "attempts_exhausted",
          }
        : mappedSettlement;
    await settle(
      claim.id,
      settlement.state,
      settlement.providerMessageId,
      settlement.failureCode,
    );
    switch (settlement.state) {
      case "sent":
        outcomes.sent += 1;
        break;
      case "skipped":
        outcomes.skipped += 1;
        break;
      case "failed":
        outcomes.failed += 1;
        break;
      case "queued":
        outcomes.retryable += 1;
        break;
      case "unknown_outcome":
        outcomes.unknown += 1;
        break;
    }
  }

  return {
    projectsScanned,
    enqueued,
    reaped: normalizedReapedCount,
    claimed,
    outcomes,
    deadlineReached,
  };
}
