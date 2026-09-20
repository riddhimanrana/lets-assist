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
import {
  publishVolunteerHoursTransaction,
  requestCorrectedCertificateDelivery,
} from "@/lib/projects/hours-publication-service";
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
  intervals?: Array<{ checkIn: string | null; checkOut: string | null }>;
  attendanceRevision?: number;
  timeExceptionReason?: string;
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
  entries: Parameters<typeof publishVolunteerHoursTransaction>[0]["entries"],
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

    const entries: Parameters<
      typeof publishVolunteerHoursTransaction
    >[0]["entries"] = [];
    for (const volunteer of sessionData.filter((row) => row.isValid)) {
      const sourceIntervals = volunteer.intervals ?? [
        { checkIn: volunteer.checkIn, checkOut: volunteer.checkOut },
      ];
      if (
        !Array.isArray(sourceIntervals) ||
        sourceIntervals.length < 1 ||
        sourceIntervals.length > 50
      ) {
        return {
          outcome: "rejected",
          success: false,
          error: "Enter between 1 and 50 complete attendance intervals.",
        };
      }
      const intervals: Array<{ checkIn: string; checkOut: string }> = [];
      for (const interval of sourceIntervals) {
        const checkIn =
          typeof interval.checkIn === "string"
            ? normalizeHoursTimestamp(interval.checkIn)
            : null;
        const checkOut =
          typeof interval.checkOut === "string"
            ? normalizeHoursTimestamp(interval.checkOut)
            : null;
        if (!checkIn || !checkOut) {
          return {
            outcome: "rejected",
            success: false,
            error:
              "Resolve every selected volunteer's missing attendance times before publishing.",
          };
        }
        intervals.push({ checkIn, checkOut });
      }
      intervals.sort((left, right) =>
        left.checkIn.localeCompare(right.checkIn),
      );
      entries.push({
        signupId: volunteer.signupId,
        checkIn: intervals[0].checkIn,
        checkOut: intervals[intervals.length - 1].checkOut,
        ...(volunteer.intervals ? { intervals } : {}),
        ...(volunteer.attendanceRevision !== undefined
          ? { attendanceRevision: volunteer.attendanceRevision }
          : {}),
        ...(volunteer.timeExceptionReason?.trim()
          ? { timeExceptionReason: volunteer.timeExceptionReason.trim() }
          : {}),
      });
    }
    entries.sort((left, right) => left.signupId.localeCompare(right.signupId));

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
        "id, volunteer_name, volunteer_email, project_title, event_start, event_end, credited_minutes",
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

async function saveVolunteerAttendance(
  projectId: string,
  signupId: string,
  expectedRevision: number,
  reason: string,
  intervals: Array<{ checkIn: string | null; checkOut: string | null }>,
  requestId: string,
  operation: "correct_project_attendance" | "record_project_attendance",
): Promise<{
  success: boolean;
  error?: string;
  attendanceRevision?: number;
  creditedMinutes?: number;
  certificateId?: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user)
    return { success: false, error: "Authentication required." };
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > 1000 ||
    !Array.isArray(intervals) ||
    intervals.length < 1 ||
    intervals.length > 50 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  ) {
    return {
      success: false,
      error: "Provide complete attendance intervals and a correction reason.",
    };
  }
  const normalized = intervals.map((interval) => ({
    checkIn:
      typeof interval.checkIn === "string"
        ? normalizeHoursTimestamp(interval.checkIn)
        : null,
    checkOut:
      typeof interval.checkOut === "string"
        ? normalizeHoursTimestamp(interval.checkOut)
        : null,
  }));
  if (normalized.some((interval) => !interval.checkIn || !interval.checkOut)) {
    return {
      success: false,
      error: "Resolve every missing attendance time before saving.",
    };
  }
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("creator_id, organization_id, can_be_managed_by_staff")
    .eq("id", projectId)
    .maybeSingle();
  if (
    projectError ||
    !project ||
    !(await canUserManageProjectHours(supabase, user.id, project))
  ) {
    return {
      success: false,
      error: "You cannot edit attendance for this project.",
    };
  }
  const admin = getAdminClient();
  const { data: signup, error: signupError } = await admin
    .from("project_signups")
    .select("id")
    .eq("id", signupId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (signupError || !signup)
    return { success: false, error: "Attendance record not found." };
  const { data, error } = await admin.rpc(operation, {
    p_signup_id: signupId,
    p_expected_revision: expectedRevision,
    p_reason: reason.trim(),
    p_intervals: normalized,
    p_request_id: requestId,
    p_actor_id: user.id,
  });
  if (error)
    return {
      success: false,
      error:
        error.code === "40001"
          ? "Attendance changed. Refresh before saving again."
          : error.code === "42501"
            ? "You cannot correct attendance for this project."
            : "The correction could not be saved. Check the intervals for overlaps and try again.",
    };
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.attendanceRevision !== "number" ||
    typeof data.creditedMinutes !== "number"
  ) {
    return {
      success: false,
      error:
        "The correction receipt could not be verified. Retry with the same request.",
    };
  }
  return {
    success: true,
    attendanceRevision: data.attendanceRevision,
    creditedMinutes: data.creditedMinutes,
    certificateId: data.certificateId ?? null,
  };
}

export async function correctVolunteerAttendance(
  projectId: string,
  signupId: string,
  expectedRevision: number,
  reason: string,
  intervals: Array<{ checkIn: string | null; checkOut: string | null }>,
  requestId: string,
) {
  return saveVolunteerAttendance(
    projectId,
    signupId,
    expectedRevision,
    reason,
    intervals,
    requestId,
    "correct_project_attendance",
  );
}

export async function recordVolunteerAttendance(
  projectId: string,
  signupId: string,
  expectedRevision: number,
  reason: string,
  intervals: Array<{ checkIn: string | null; checkOut: string | null }>,
  requestId: string,
) {
  return saveVolunteerAttendance(
    projectId,
    signupId,
    expectedRevision,
    reason,
    intervals,
    requestId,
    "record_project_attendance",
  );
}

export async function sendCorrectedCertificateEmail(
  projectId: string,
  certificateId: string,
  expectedRevision: number,
  requestId: string,
): Promise<{
  success: boolean;
  error?: string;
  emailsSent?: number;
  emailErrors?: string[];
  receiptId?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return { success: false, error: "Authentication required." };
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  ) {
    return {
      success: false,
      error: "Refresh the corrected certificate before sending.",
    };
  }
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("creator_id, organization_id, can_be_managed_by_staff")
    .eq("id", projectId)
    .maybeSingle();
  if (
    projectError ||
    !project ||
    !(await canUserManageProjectHours(supabase, user.id, project))
  ) {
    return {
      success: false,
      error: "You cannot send certificates for this project.",
    };
  }
  const transaction = await requestCorrectedCertificateDelivery({
    actorId: user.id,
    projectId,
    certificateId,
    expectedRevision,
    requestId,
  });
  if (!transaction.publication)
    return {
      success: false,
      error:
        transaction.errorCode === "40001"
          ? "The certificate changed. Refresh before sending."
          : "The corrected certificate could not be queued. Save an award correction before sending it.",
    };
  const delivery = await drainPublicationEmails(transaction.publication);
  return {
    success: true,
    emailsSent: delivery.emailsSent,
    emailErrors: delivery.errors,
    receiptId: transaction.publication.receiptId,
  };
}
