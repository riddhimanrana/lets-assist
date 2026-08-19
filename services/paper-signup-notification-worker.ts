import "server-only";

import * as React from "react";
import { randomUUID } from "node:crypto";

import PaperSignupRecorded from "@/emails/paper-signup-recorded";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type SendEmailResult } from "@/services/email";
import type { Project } from "@/types";

const MAX_BATCH_SIZE = 50;
const LEASE_SECONDS = 120;

type NotificationClaim = {
  id: string;
  project_id: string;
  recipient_email: string;
  recipient_name: string | null;
  anonymous_id: string | null;
  anonymous_profile_token: string;
  project_title: string;
  organizer_name: string;
  schedule_id: string;
  project_timezone: string;
  idempotency_key: string;
  lease_token: string;
};

export function paperSignupNotificationSettlement(result: SendEmailResult): {
  outcome: string;
  providerMessageId: string | null;
  safeCode: string | null;
} {
  if (result.outcome === "accepted") {
    return {
      outcome: "accepted",
      providerMessageId: result.messageId,
      safeCode: null,
    };
  }
  return {
    outcome: result.outcome,
    providerMessageId: null,
    safeCode: result.code,
  };
}

export function deletedPaperSignupIdentityResult(
  identityExists: boolean,
): SendEmailResult | null {
  if (identityExists) return null;
  return {
    outcome: "skipped",
    success: false,
    skipped: true,
    phase: "preference_check",
    code: "anonymous_identity_deleted",
    reason: "Anonymous volunteer record no longer exists",
  };
}

export async function runPaperSignupNotificationWorker(options?: {
  batchSize?: number;
}) {
  const admin = getAdminClient();
  const workerId = `paper-signup-${randomUUID()}`;
  const batchSize = Math.min(
    Math.max(options?.batchSize ?? 25, 1),
    MAX_BATCH_SIZE,
  );
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const { data: reaped, error: reapError } = await admin.rpc(
    "reap_paper_signup_notification_leases",
  );
  if (reapError) throw new Error("Could not reap paper notification leases.");

  const { data, error: claimError } = await admin.rpc(
    "claim_paper_signup_notifications",
    {
      p_worker_id: workerId,
      p_limit: batchSize,
      p_lease_seconds: LEASE_SECONDS,
    },
  );
  if (claimError) throw new Error("Could not claim paper notifications.");

  const claims = (data ?? []) as NotificationClaim[];
  const outcomes = {
    accepted: 0,
    skipped: 0,
    failed: 0,
    retryable: 0,
    unknown: 0,
  };

  for (const claim of claims) {
    let result: SendEmailResult;
    let dispatchStarted = false;
    try {
      const { data: anonymousIdentity, error: anonymousIdentityError } =
        claim.anonymous_id
          ? await admin
              .from("anonymous_signups")
              .select("id")
              .eq("id", claim.anonymous_id)
              .maybeSingle()
          : { data: null, error: null };
      if (anonymousIdentityError) {
        throw new Error("anonymous_identity_unavailable");
      }

      const deletedIdentityResult = deletedPaperSignupIdentityResult(
        Boolean(anonymousIdentity),
      );
      if (deletedIdentityResult) {
        result = deletedIdentityResult;
      } else {
        const { data: project, error: projectError } = await admin
          .from("projects")
          .select("id, event_type, schedule, project_timezone")
          .eq("id", claim.project_id)
          .single();
        if (projectError || !project) {
          throw new Error("project_unavailable");
        }

        const window = getAttendanceScheduleWindow(
          project as unknown as Project,
          claim.schedule_id,
        );
        const timezone = claim.project_timezone || "America/Los_Angeles";
        const projectDate = window
          ? new Date(window.startsAt).toLocaleDateString("en-US", {
              timeZone: timezone,
              dateStyle: "long",
            })
          : "";
        const projectTime = window
          ? `${new Date(window.startsAt).toLocaleTimeString("en-US", {
              timeZone: timezone,
              hour: "numeric",
              minute: "2-digit",
            })} - ${new Date(window.endsAt).toLocaleTimeString("en-US", {
              timeZone: timezone,
              hour: "numeric",
              minute: "2-digit",
            })}`
          : "";

        const { error: beginError } = await admin.rpc(
          "begin_paper_signup_notification_dispatch",
          {
            p_id: claim.id,
            p_worker_id: workerId,
            p_lease_token: claim.lease_token,
          },
        );
        if (beginError) throw new Error("dispatch_transition_failed");
        dispatchStarted = true;

        result = await sendEmail({
          to: claim.recipient_email,
          subject: `Your volunteering at ${claim.project_title} was recorded`,
          react: React.createElement(PaperSignupRecorded, {
            volunteerName: claim.recipient_name || "Volunteer",
            projectName: claim.project_title,
            organizerName: claim.organizer_name,
            projectDate,
            projectTime,
            anonymousProfileUrl: `${siteUrl}/anonymous/${claim.anonymous_id}?token=${claim.anonymous_profile_token}`,
          }),
          type: "transactional",
          idempotencyKey: claim.idempotency_key,
          tags: [{ name: "feature", value: "paper-signup-recorded" }],
        });
      }
    } catch {
      result = dispatchStarted
        ? {
            outcome: "unknown_outcome",
            success: false,
            skipped: false,
            phase: "provider_request",
            code: "paper_notification_dispatch_exception",
            status: null,
            error: "paper notification dispatch outcome is unknown",
          }
        : {
            outcome: "retryable_pre_send",
            success: false,
            skipped: false,
            phase: "local_validation",
            code: "paper_notification_preparation_failed",
            status: null,
            error: "paper notification preparation failed before dispatch",
          };
    }

    const resolved = paperSignupNotificationSettlement(result);
    const { error: settleError } = await admin.rpc(
      "settle_paper_signup_notification",
      {
        p_id: claim.id,
        p_worker_id: workerId,
        p_lease_token: claim.lease_token,
        p_outcome: resolved.outcome,
        p_provider_message_id: resolved.providerMessageId,
        p_safe_code: resolved.safeCode,
      },
    );
    if (settleError) {
      throw new Error("Could not settle a paper notification outcome.");
    }

    if (result.outcome === "accepted") outcomes.accepted += 1;
    else if (result.outcome === "skipped") outcomes.skipped += 1;
    else if (result.outcome === "retryable_pre_send") outcomes.retryable += 1;
    else if (result.outcome === "unknown_outcome") outcomes.unknown += 1;
    else outcomes.failed += 1;
  }

  return { claimed: claims.length, reaped: Number(reaped ?? 0), outcomes };
}
