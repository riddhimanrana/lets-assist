"use server";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { canManageProjectAccess } from "@/lib/projects/management-access";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { hoursPublicationOutcome } from "@/lib/projects/hours-publication-delivery";
import {
  drainPublicationEmails,
  loadDurablePublicationForRetry,
} from "@/lib/projects/hours-publication-email-service";
import { publishVolunteerHoursTransaction } from "@/lib/projects/hours-publication-service";
import {
  getPublishStateKey,
  sendCertificatePublishedEmails,
} from "./certificate-issuance";
import { normalizeHoursTimestamp } from "./hours-duration";
import type { ProjectSchedule } from "@/types";

// Define the structure for session data passed from the client
type SessionVolunteerData = {
  signupId: string;
  checkIn: string | null;
  checkOut: string | null;
  isValid: boolean;
};

type ManageableProject = {
  creator_id: string | null;
  organization_id?: string | null;
  can_be_managed_by_staff?: boolean | null;
};

type ResendProject = ManageableProject & {
  event_type: "oneTime" | "multiDay" | "sameDayMultiArea";
  title: string;
  project_timezone: string | null;
  schedule: ProjectSchedule;
};

export type HoursPublicationOutcome =
  "accepted" | "replayed" | "partial" | "rejected";

export type HoursPublicationResult = {
  outcome: HoursPublicationOutcome;
  success: boolean;
  error?: string;
  certificatesCreated?: number;
  emailsSent?: number;
  emailErrors?: string[];
  requestKey?: string;
  receiptId?: string;
};

async function canUserManageProjectHours(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  project: ManageableProject,
): Promise<boolean> {
  let organizationRole: string | null = null;

  if (project.organization_id && project.creator_id !== userId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", project.organization_id)
      .eq("status", "active")
      .maybeSingle();

    organizationRole = membership?.role ?? null;
  }

  return canManageProjectAccess({
    creatorId: project.creator_id,
    userId,
    organizationRole,
    canBeManagedByStaff: project.can_be_managed_by_staff,
  });
}

function publicationRequestKey(
  projectId: string,
  sessionId: string,
  entries: Array<{ signupId: string; checkIn: string; checkOut: string }>,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ projectId, sessionId, entries }))
    .digest("hex");
  return `hours-publication:v1:${digest}`;
}

export async function publishVolunteerHours(
  projectId: string,
  sessionId: string,
  sessionData: SessionVolunteerData[],
): Promise<HoursPublicationResult> {
  const supabase = await createClient();

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return {
        outcome: "rejected",
        success: false,
        error: "Authentication required.",
      };
    }

    if (!Array.isArray(sessionData) || sessionData.length > 1000) {
      return {
        outcome: "rejected",
        success: false,
        error: "A publication can contain at most 1,000 volunteers.",
      };
    }

    const entries = sessionData
      .filter((v) => v.isValid && v.checkIn && v.checkOut)
      .map((volunteer) => {
        const checkIn = normalizeHoursTimestamp(volunteer.checkIn!);
        const checkOut = normalizeHoursTimestamp(volunteer.checkOut!);
        return checkIn && checkOut
          ? { signupId: volunteer.signupId, checkIn, checkOut }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => left.signupId.localeCompare(right.signupId));

    if (entries.length === 0) {
      return {
        outcome: "rejected",
        success: false,
        error: "No valid volunteer hours data to publish.",
      };
    }

    const requestKey = publicationRequestKey(projectId, sessionId, entries);
    const transaction = await publishVolunteerHoursTransaction({
      actorId: user.id,
      projectId,
      scheduleId: sessionId,
      entries,
      requestKey,
    });

    if (!transaction.publication && !transaction.invalidResponse) {
      logWarn("Volunteer-hours publication rejected", {
        project_id: projectId,
        request_key_suffix: requestKey.slice(-12),
        error_code: transaction.errorCode ?? undefined,
        rpc_attempt_count: transaction.attempts,
      });
      return {
        outcome: "rejected",
        success: false,
        error:
          transaction.errorCode === "42501"
            ? "Unauthorized: You cannot publish hours for this project."
            : "The hours could not be published. Refresh the project and verify the session data before trying again.",
        requestKey,
      };
    }

    if (!transaction.publication) {
      logError(
        "Volunteer-hours publication returned an invalid receipt",
        new Error("invalid transactional publication result"),
        {
          project_id: projectId,
          request_key_suffix: requestKey.slice(-12),
          rpc_attempt_count: transaction.attempts,
        },
      );
      return {
        outcome: "rejected",
        success: false,
        error:
          "The publication receipt was invalid. No provider retry was attempted.",
        requestKey,
      };
    }

    const data = transaction.publication;
    const emailResult = await drainPublicationEmails(data);
    const outcome: HoursPublicationOutcome = hoursPublicationOutcome(
      data.outcome,
      emailResult.partial,
    );

    logInfo("Volunteer-hours publication committed", {
      project_id: projectId,
      receipt_id: data.receiptId,
      outcome,
      certificate_count: data.certificatesCreated,
      email_accepted_count: emailResult.emailsSent,
      email_error_count: emailResult.errors.length,
    });

    return {
      outcome,
      success: true,
      certificatesCreated: data.certificatesCreated,
      emailsSent: emailResult.emailsSent,
      emailErrors: emailResult.errors,
      requestKey: data.requestKey,
      receiptId: data.receiptId,
    };
  } catch (error) {
    logError("Unexpected volunteer-hours publication failure", error, {
      project_id: projectId,
    });
    return {
      outcome: "rejected",
      success: false,
      error: "An unexpected server error occurred.",
    };
  }
}

/**
 * Resend certificate emails to specific volunteers
 * Used for corrections or when organizers need to resend to volunteers who didn't receive it initially
 */
export async function resendCertificateEmails(
  projectId: string,
  sessionId: string,
): Promise<{
  success: boolean;
  error?: string;
  emailsSent?: number;
  emailErrors?: string[];
  deliveryMode?: "durable-retry" | "manual-resend";
}> {
  const supabase = await createClient();

  try {
    if (!sessionId.trim()) {
      return { success: false, error: "A project session is required." };
    }

    // 1. Verify user authentication and permissions
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, error: "Authentication required." };
    }

    // 2. Verify user has permission on this project
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select(
        "id, creator_id, organization_id, can_be_managed_by_staff, event_type, title, project_timezone, schedule",
      )
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return { success: false, error: "Project not found." };
    }

    if (!(await canUserManageProjectHours(supabase, user.id, project))) {
      return {
        success: false,
        error: "Unauthorized: You cannot resend certificates for this project.",
      };
    }

    const typedProject = project as ResendProject;
    const publishKey = getPublishStateKey(typedProject, sessionId);
    const legacyScheduleIds =
      publishKey === sessionId ? [sessionId] : [sessionId, publishKey];
    try {
      const admin = getAdminClient();
      const durablePublication = await loadDurablePublicationForRetry(admin, {
        projectId,
        publishKey,
        projectTitle: typedProject.title,
        projectTimezone: typedProject.project_timezone,
      });
      if (durablePublication) {
        const delivery = await drainPublicationEmails(durablePublication);
        return {
          success: true,
          emailsSent: delivery.emailsSent,
          emailErrors: delivery.errors,
          deliveryMode: "durable-retry",
        };
      }
    } catch (error) {
      logError("Durable certificate delivery retry failed closed", error, {
        project_id: projectId,
        publish_key: publishKey,
      });
      return {
        success: false,
        error: "The durable email ledger could not be checked safely.",
      };
    }

    // 3. Fetch the certificates to resend
    const { data: certificates, error: certError } = await supabase
      .from("certificates")
      .select(
        "id, volunteer_name, volunteer_email, project_title, event_start, event_end",
      )
      .eq("project_id", projectId)
      .in("schedule_id", legacyScheduleIds);

    if (certError || !certificates) {
      return { success: false, error: "Failed to fetch certificates." };
    }

    // 4. Filter out certificates without email addresses
    const certificatesToEmail = certificates.filter(
      (cert) => cert.volunteer_email && cert.volunteer_name,
    );

    if (certificatesToEmail.length === 0) {
      return {
        success: false,
        error: "No valid certificates with email addresses found to resend.",
      };
    }

    // 5. Send emails
    const emailResult = await sendCertificatePublishedEmails(
      certificatesToEmail,
      project.project_timezone,
    );

    return {
      success: true,
      emailsSent: emailResult.emailsSent,
      emailErrors: emailResult.errors,
      deliveryMode: "manual-resend",
    };
  } catch (error) {
    logError("Unexpected certificate resend failure", error, {
      project_id: projectId,
    });
    return { success: false, error: "An unexpected server error occurred." };
  }
}
