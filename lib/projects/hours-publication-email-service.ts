import "server-only";

import { randomUUID } from "node:crypto";
import * as React from "react";
import { render } from "react-email";
import CertificatePublished from "@/emails/certificate-published";
import { logError } from "@/lib/logger";
import {
  hoursEmailSettlement,
  parseHoursEmailPayloadSnapshot,
  settleHoursDeliveryWithRetry,
} from "@/lib/projects/hours-publication-delivery";
import type {
  PublicationDelivery,
  TransactionalPublication,
} from "@/lib/projects/hours-publication-service";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/services/email";

export type HoursPublicationDeliverySummary = {
  emailsSent: number;
  errors: string[];
  partial: boolean;
};

async function pauseBeforeSettlementRetry(attemptNumber: number) {
  await new Promise((resolve) => setTimeout(resolve, attemptNumber * 75));
}

async function preparePublicationEmailPayload(
  admin: ReturnType<typeof getAdminClient>,
  publication: TransactionalPublication,
  delivery: PublicationDelivery,
  siteUrl: string,
  isAutoPublished: boolean,
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
        isAutoPublished,
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

export async function drainPublicationEmails(
  publication: TransactionalPublication,
  options: { isAutoPublished?: boolean } = {},
): Promise<HoursPublicationDeliverySummary> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  let emailsSent = publication.deliveries.filter(
    (delivery) => delivery.state === "accepted",
  ).length;
  let partial = false;
  const errors: string[] = [];
  let admin: ReturnType<typeof getAdminClient> | null = null;

  for (const delivery of publication.deliveries) {
    if (delivery.state === "accepted") continue;

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
          { receipt_id: publication.receiptId, outcome: "partial" },
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
        options.isAutoPublished === true,
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
      if (settlement.accepted) emailsSent++;
    } catch (error) {
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
