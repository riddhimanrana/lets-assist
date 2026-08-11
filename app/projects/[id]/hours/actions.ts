"use server";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import CertificatePublished from "@/emails/certificate-published";
import * as React from "react";
import { render } from "react-email";
import { sendEmail } from "@/services/email";
import { canManageProjectAccess } from "@/lib/projects/management-access";
import { logError, logInfo, logWarn } from "@/lib/logger";
import {
  hoursEmailSettlement,
  hoursPublicationOutcome,
  parseHoursEmailPayloadSnapshot,
  settleHoursDeliveryWithRetry,
} from "@/lib/projects/hours-publication-delivery";
import {
  getPublishStateKey,
  sendCertificatePublishedEmails,
} from "./certificate-issuance";

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

type PublicationDelivery = {
  deliveryId: string;
  state: string;
  payloadPrepared: boolean;
  idempotencyKey: string;
  certificateId: string;
  volunteerName: string | null;
  volunteerEmail: string | null;
  eventStart: string;
  eventEnd: string;
};

type TransactionalPublication = {
  outcome: "accepted" | "replayed";
  receiptId: string;
  requestKey: string;
  certificatesCreated: number;
  projectTitle: string;
  projectTimezone: string | null;
  deliveries: PublicationDelivery[];
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

function isTransactionalPublication(
  value: unknown,
): value is TransactionalPublication {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.outcome === "accepted" || candidate.outcome === "replayed") &&
    typeof candidate.receiptId === "string" &&
    typeof candidate.requestKey === "string" &&
    typeof candidate.certificatesCreated === "number" &&
    typeof candidate.projectTitle === "string" &&
    Array.isArray(candidate.deliveries)
  );
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

type DeliverySummary = {
  emailsSent: number;
  errors: string[];
  partial: boolean;
};

async function pauseBeforeSettlementRetry(attemptNumber: number) {
  await new Promise((resolve) => setTimeout(resolve, attemptNumber * 75));
}

async function loadDurablePublicationForRetry(
  admin: ReturnType<typeof getAdminClient>,
  projectId: string,
  publishKey: string,
  project: Pick<ResendProject, "title" | "project_timezone">,
): Promise<TransactionalPublication | null> {
  const { data: receipt, error: receiptError } = await admin
    .from("hours_publication_receipts")
    .select("id, request_key, certificate_count")
    .eq("project_id", projectId)
    .eq("publish_key", publishKey)
    .maybeSingle();

  if (receiptError) {
    throw new Error("durable publication receipt lookup failed");
  }
  if (!receipt) return null;

  const { data: outboxRows, error: outboxError } = await admin
    .from("hours_publication_email_outbox")
    .select("id, state, idempotency_key, certificate_id, payload_prepared_at")
    .eq("receipt_id", receipt.id)
    .order("created_at", { ascending: true });
  if (outboxError || !outboxRows) {
    throw new Error("durable publication delivery lookup failed");
  }

  const certificateIds = outboxRows.map((row) => row.certificate_id);
  const { data: certificates, error: certificateError } = certificateIds.length
    ? await admin
        .from("certificates")
        .select("id, volunteer_name, volunteer_email, event_start, event_end")
        .in("id", certificateIds)
    : { data: [], error: null };
  if (certificateError || !certificates) {
    throw new Error("durable publication certificate lookup failed");
  }

  const certificatesById = new Map(
    certificates.map((certificate) => [certificate.id, certificate]),
  );
  const deliveries: PublicationDelivery[] = outboxRows.map((row) => {
    const certificate = certificatesById.get(row.certificate_id);
    if (!certificate) {
      throw new Error("durable publication certificate is missing");
    }
    return {
      deliveryId: row.id,
      state: row.state,
      payloadPrepared: row.payload_prepared_at !== null,
      idempotencyKey: row.idempotency_key,
      certificateId: certificate.id,
      volunteerName: certificate.volunteer_name,
      volunteerEmail: certificate.volunteer_email,
      eventStart: certificate.event_start,
      eventEnd: certificate.event_end,
    };
  });

  return {
    outcome: "replayed",
    receiptId: receipt.id,
    requestKey: receipt.request_key,
    certificatesCreated: receipt.certificate_count,
    projectTitle: project.title,
    projectTimezone: project.project_timezone,
    deliveries,
  };
}

async function preparePublicationEmailPayload(
  admin: ReturnType<typeof getAdminClient>,
  publication: TransactionalPublication,
  delivery: PublicationDelivery,
  siteUrl: string,
) {
  let sender: string | null = null;
  let subject: string | null = null;
  let html: string | null = null;

  // Once any provider attempt can have started, recovery asks the database for
  // the first-writer-wins snapshot without rendering today's template or
  // reading today's deployment configuration.
  if (!delivery.payloadPrepared) {
    sender =
      process.env.EMAIL_FROM?.trim() ||
      "Let's Assist <projects@notifications.lets-assist.com>";
    subject = `Your volunteer certificate for ${publication.projectTitle} is ready!`;
    html = await render(
      React.createElement(CertificatePublished, {
        volunteerName: delivery.volunteerName!,
        projectTitle: publication.projectTitle,
        certificateId: delivery.certificateId,
        certificateUrl: `${siteUrl}/certificates/${delivery.certificateId}`,
        isAutoPublished: false,
        eventStart: delivery.eventStart,
        eventEnd: delivery.eventEnd,
        timezone: publication.projectTimezone ?? undefined,
      }),
    );
  }

  const { data, error } = await admin.rpc(
    "prepare_hours_publication_email_delivery",
    {
      p_delivery_id: delivery.deliveryId,
      p_sender: sender,
      p_subject: subject,
      p_html: html,
    },
  );
  if (error) {
    throw new Error("durable provider payload preparation failed");
  }

  const payload = parseHoursEmailPayloadSnapshot(data, publication.receiptId);
  if (!payload) {
    throw new Error("durable provider payload was invalid");
  }
  return payload;
}

async function drainPublicationEmails(
  publication: TransactionalPublication,
): Promise<DeliverySummary> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  let emailsSent = publication.deliveries.filter(
    (delivery) => delivery.state === "accepted",
  ).length;
  let partial = false;
  const errors: string[] = [];
  let admin: ReturnType<typeof getAdminClient> | null = null;

  for (const delivery of publication.deliveries) {
    if (delivery.state === "accepted") {
      continue;
    }
    if (delivery.state === "skipped") {
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: email recipient missing`,
      );
      continue;
    }
    if (
      delivery.state === "definitive_failure" ||
      delivery.state === "unknown_outcome"
    ) {
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: email ${delivery.state.replaceAll("_", " ")}`,
      );
      continue;
    }
    if (
      !delivery.payloadPrepared &&
      (!delivery.volunteerEmail || !delivery.volunteerName)
    ) {
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: email recipient missing`,
      );
      continue;
    }

    if (!admin) {
      try {
        admin = getAdminClient();
      } catch (error) {
        logError(
          "Volunteer-hours publication committed without an email worker",
          error,
          {
            receipt_id: publication.receiptId,
            outcome: "partial",
          },
        );
        errors.push(
          "Email delivery could not start; durable work remains queued for safe follow-up",
        );
        return { emailsSent, errors, partial: true };
      }
    }

    let providerPayload;
    try {
      providerPayload = await preparePublicationEmailPayload(
        admin,
        publication,
        delivery,
        siteUrl,
      );
    } catch (error) {
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: delivery payload preparation failed`,
      );
      logError("Volunteer-hours email payload preparation failed", error, {
        receipt_id: publication.receiptId,
        delivery_id: delivery.deliveryId,
      });
      continue;
    }

    const claimToken = randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_hours_publication_email_delivery",
      {
        p_delivery_id: delivery.deliveryId,
        p_claim_token: claimToken,
      },
    );
    if (claimError) {
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: delivery claim failed`,
      );
      logError(
        "Volunteer-hours email delivery claim failed",
        new Error("durable delivery claim failed"),
        {
          receipt_id: publication.receiptId,
          delivery_id: delivery.deliveryId,
          error_code: claimError.code,
        },
      );
      continue;
    }
    if (claimed !== true) {
      // Another invocation claimed or settled it. SQL owns the bounded stale
      // recovery and refuses work outside the provider idempotency window.
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: delivery already in progress`,
      );
      continue;
    }

    let settlementState:
      | "accepted"
      | "retryable_failure"
      | "definitive_failure"
      | "unknown_outcome"
      | "skipped";
    let providerMessageId: string | null = null;
    let safeCode: string | null = null;

    try {
      const result = await sendEmail({
        to: providerPayload.to,
        from: providerPayload.from,
        subject: providerPayload.subject,
        html: providerPayload.html,
        type: "transactional",
        idempotencyKey: delivery.idempotencyKey,
        tags: providerPayload.tags,
      });

      const settlement = hoursEmailSettlement(result);
      settlementState = settlement.state;
      providerMessageId = settlement.providerMessageId;
      safeCode = settlement.safeCode;
      partial ||= settlement.partial;
      if (settlement.accepted) {
        emailsSent++;
      }
    } catch (error) {
      // A throw outside the email service's bounded result contract may have
      // happened after provider contact. Never retry it automatically.
      settlementState = "unknown_outcome";
      safeCode = "unhandled_dispatch_error";
      partial = true;
      logError("Volunteer-hours email dispatch threw", error, {
        receipt_id: publication.receiptId,
        delivery_id: delivery.deliveryId,
        outcome: settlementState,
      });
    }

    const settlementResult = await settleHoursDeliveryWithRetry(
      async () =>
        admin!.rpc("settle_hours_publication_email_delivery", {
          p_delivery_id: delivery.deliveryId,
          p_claim_token: claimToken,
          p_state: settlementState,
          p_provider_message_id: providerMessageId,
          p_safe_code: safeCode,
        }),
      { pause: pauseBeforeSettlementRetry },
    );

    if (!settlementResult.settled) {
      partial = true;
      errors.push(
        `Certificate ${delivery.certificateId}: delivery settlement failed`,
      );
      logError(
        "Volunteer-hours email delivery settlement failed",
        new Error("durable delivery settlement failed"),
        {
          receipt_id: publication.receiptId,
          delivery_id: delivery.deliveryId,
          outcome: settlementState,
          error_code: settlementResult.errorCode ?? undefined,
          settlement_attempts: settlementResult.attempts,
        },
      );
      continue;
    }

    if (settlementState !== "accepted") {
      errors.push(
        `Certificate ${delivery.certificateId}: email ${settlementState.replaceAll("_", " ")}`,
      );
    }
  }

  return { emailsSent, errors, partial };
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

    if (!Array.isArray(sessionData) || sessionData.length > 500) {
      return {
        outcome: "rejected",
        success: false,
        error: "A publication can contain at most 500 volunteers.",
      };
    }

    const entries = sessionData
      .filter((v) => v.isValid && v.checkIn && v.checkOut)
      .map((volunteer) => ({
        signupId: volunteer.signupId,
        checkIn: volunteer.checkIn!,
        checkOut: volunteer.checkOut!,
      }))
      .sort((left, right) => left.signupId.localeCompare(right.signupId));

    if (entries.length === 0) {
      return {
        outcome: "rejected",
        success: false,
        error: "No valid volunteer hours data to publish.",
      };
    }

    const requestKey = publicationRequestKey(projectId, sessionId, entries);
    const { data, error } = await supabase.rpc(
      "publish_volunteer_hours_transactional",
      {
        p_project_id: projectId,
        p_schedule_id: sessionId,
        p_entries: entries,
        p_request_key: requestKey,
      },
    );

    if (error) {
      logWarn("Volunteer-hours publication rejected", {
        project_id: projectId,
        request_key_suffix: requestKey.slice(-12),
        error_code: error.code,
      });
      return {
        outcome: "rejected",
        success: false,
        error:
          error.code === "42501"
            ? "Unauthorized: You cannot publish hours for this project."
            : "The hours could not be published. Refresh the project and verify the session data before trying again.",
        requestKey,
      };
    }

    if (!isTransactionalPublication(data)) {
      logError(
        "Volunteer-hours publication returned an invalid receipt",
        new Error("invalid transactional publication result"),
        { project_id: projectId, request_key_suffix: requestKey.slice(-12) },
      );
      return {
        outcome: "rejected",
        success: false,
        error:
          "The publication receipt was invalid. No provider retry was attempted.",
        requestKey,
      };
    }

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
        "id, creator_id, organization_id, can_be_managed_by_staff, event_type, title, project_timezone",
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
    let admin: ReturnType<typeof getAdminClient>;
    try {
      admin = getAdminClient();
      const durablePublication = await loadDurablePublicationForRetry(
        admin,
        projectId,
        publishKey,
        typedProject,
      );
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
      .eq("schedule_id", publishKey);

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
