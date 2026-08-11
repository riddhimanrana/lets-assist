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

async function enqueueEligibleProjects(
  now: number,
): Promise<{ projectsScanned: number; enqueued: number }> {
  const admin = getAdminClient();

  // Coarse candidate filter only: status flips via the timezone-broken
  // process_projects(), so the real decision is getFeedbackEligibleAt's.
  const { data: projects } = await admin
    .from("projects")
    .select(
      "id, title, status, event_type, schedule, project_timezone, published, cancelled_at, organization_id, created_at",
    )
    .eq("status", "completed")
    .gte("created_at", new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(FEEDBACK_WORKER_MAX_PROJECTS_PER_RUN);

  let enqueued = 0;
  const candidates = (projects ?? []) as unknown as WorkerProjectRow[];

  for (const project of candidates) {
    // A slot counts as published when its publish key is set; only slots
    // with attended signups matter for the "hold for hours" rule.
    const published = (project.published ?? {}) as Record<string, boolean>;
    const { data: attendedSlots } = await admin
      .from("project_signups")
      .select("schedule_id")
      .eq("project_id", project.id)
      .eq("status", "attended");
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
    if (!error) enqueued += Number(inserted ?? 0);
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

async function resolveConsentedRecipient(
  claim: ClaimRow,
): Promise<RecipientResolution> {
  const admin = getAdminClient();

  if (claim.user_id) {
    const [{ data: profile }, { data: settings }] = await Promise.all([
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
    const { data: anon } = await admin
      .from("anonymous_signups")
      .select("email, name, email_opt_out_at")
      .eq("id", claim.anonymous_id)
      .maybeSingle();
    if (!anon?.email) return { ok: false, reason: "no_address" };
    if (anon.email_opt_out_at) return { ok: false, reason: "opted_out" };
    return { ok: true, email: anon.email, name: anon.name || "Volunteer" };
  }

  return { ok: false, reason: "no_identity" };
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

  const { data: reapedCount } = await admin.rpc(
    "reap_project_feedback_request_leases",
  );

  const outcomes: FeedbackWorkerOutcomes = {
    sent: 0,
    skipped: 0,
    failed: 0,
    retryable: 0,
    unknown: 0,
  };
  let claimed = 0;
  let deadlineReached = false;

  const { data: claims } = await admin.rpc("claim_project_feedback_requests", {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lease_seconds: FEEDBACK_WORKER_LEASE_SECONDS,
  });

  const settle = async (
    id: string,
    state: string,
    providerMessageId: string | null,
    failureCode: string | null,
  ) => {
    await admin.rpc("settle_project_feedback_request", {
      p_id: id,
      p_worker_id: workerId,
      p_state: state,
      p_provider_message_id: providerMessageId,
      p_failure_code: failureCode,
    });
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

    try {
      const recipient = await resolveConsentedRecipient(claim);
      if (!recipient.ok) {
        await settle(claim.id, "skipped", null, recipient.reason);
        outcomes.skipped += 1;
        continue;
      }

      const { data: projectRow } = await admin
        .from("projects")
        .select(
          "id, title, event_type, schedule, project_timezone, status, cancelled_at, organization:organizations (name)",
        )
        .eq("id", claim.project_id)
        .maybeSingle();
      if (!projectRow) {
        await settle(claim.id, "skipped", null, "project_missing");
        outcomes.skipped += 1;
        continue;
      }
      const project = projectRow as unknown as Project & {
        organization: { name: string | null } | null;
      };

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
      const scheduleIds = listAttendanceScheduleIds(project);
      const firstWindow =
        scheduleIds.length > 0
          ? getAttendanceScheduleWindow(project, scheduleIds[0])
          : null;
      const eventDate = firstWindow
        ? new Date(firstWindow.startsAt).toLocaleDateString("en-US", {
            timeZone: timezone,
            dateStyle: "long",
          })
        : null;

      const titleForSubject =
        project.title.length > 60
          ? `${project.title.slice(0, 57)}…`
          : project.title;

      const result = await sendEmail({
        to: recipient.email,
        subject: `How did volunteering at ${titleForSubject} go?`,
        react: React.createElement(ProjectFeedbackRequest, {
          volunteerName: recipient.name,
          projectTitle: project.title,
          organizationName: project.organization?.name ?? null,
          feedbackUrl,
          unsubscribeUrl,
          eventDate,
        }),
        // userId deliberately omitted: sendEmail's preference gate is
        // unreachable from cron; consent was re-checked above.
        type: "project_updates",
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "kind", value: "project_feedback_request" }],
        idempotencyKey: `project-feedback:${claim.id}:${claim.attempts}`,
      });

      const settlement = settlementForSendResult(result);
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
    } catch (error) {
      // A throw here means we cannot prove the provider was not reached.
      console.error(`Feedback dispatch crashed for ${claim.id}:`, error);
      await settle(claim.id, "unknown_outcome", null, "dispatch_crashed");
      outcomes.unknown += 1;
    }
  }

  return {
    projectsScanned,
    enqueued,
    reaped: Number(reapedCount ?? 0),
    claimed,
    outcomes,
    deadlineReached,
  };
}
