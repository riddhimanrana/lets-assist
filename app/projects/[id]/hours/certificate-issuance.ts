import "server-only";

import * as React from "react";

import CertificatePublished from "@/emails/certificate-published";
import { sendEmail } from "@/services/email";
import { drainPublicationEmails } from "@/lib/projects/hours-publication-email-service";
import { recoverSupplementalCertificates } from "@/lib/projects/hours-publication-service";
export { getPublishStateKey } from "@/lib/projects/hours-publish-key";

/**
 * Certificate issuance shared between the hours publish flow
 * (publishVolunteerHours / resendCertificateEmails) and the paper signup
 * commit path, which must issue certificates for signups added to a session
 * that was already published.
 *
 * sendCertificatePublishedEmails is the explicit organizer resend for legacy
 * awards that have no email ledger. Nothing automatic calls it.
 */

export type CertificateEmailRow = {
  id: string;
  volunteer_name: string | null;
  volunteer_email: string | null;
  project_title: string;
  event_start?: string;
  event_end?: string;
  credited_minutes?: number | null;
};

export const sendCertificatePublishedEmails = async (
  certificates: CertificateEmailRow[],
  projectTimezone?: string,
  isAutoPublished = false,
): Promise<{ success: boolean; emailsSent: number; errors: string[] }> => {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  let emailsSent = 0;
  const errors: string[] = [];

  for (const cert of certificates) {
    if (!cert.volunteer_email || !cert.volunteer_name) {
      errors.push(`Skipped certificate ${cert.id}: Missing email or name`);
      continue;
    }

    try {
      const certificateUrl = `${siteUrl}/certificates/${cert.id}`;

      const delivery = await sendEmail({
        to: cert.volunteer_email,
        subject: `Your volunteer certificate for ${cert.project_title} is ready!`,
        react: React.createElement(CertificatePublished, {
          volunteerName: cert.volunteer_name,
          projectTitle: cert.project_title,
          certificateId: cert.id,
          certificateUrl,
          isAutoPublished,
          eventStart: cert.event_start,
          eventEnd: cert.event_end,
          creditedMinutes: cert.credited_minutes,
          timezone: projectTimezone,
        }),
        type: "transactional",
      });

      if (delivery.outcome === "accepted") {
        emailsSent++;
      } else {
        errors.push(
          `Certificate ${cert.id}: ${delivery.outcome} (${delivery.code})`,
        );
      }
    } catch {
      errors.push(
        `Certificate ${cert.id}: delivery outcome could not be confirmed`,
      );
    }
  }

  return {
    success: emailsSent > 0,
    emailsSent,
    errors,
  };
};

export type SupplementalIssuanceResult = {
  issued: number;
  emailsSent: number;
  errors: string[];
  // True when every requested award that exists has ledger-tracked delivery,
  // so a repeat that issues nothing is a completed retry, not a failure.
  deliveryDurable: boolean;
};

/**
 * Supplemental issuance for signups committed onto an already-published
 * session (paper scans). One service-only transaction issues the missing
 * awards, their in-app notifications, and their durable email work, using the
 * verified-signup unique index as its conflict arbiter. Email then goes
 * through the same ledger drain as publication, never a direct send.
 * Does not flip the session's published flag: it is already true, and
 * flipping it is the publish flow's job.
 */
export async function issueCertificatesForSignups(options: {
  projectId: string;
  scheduleId: string;
  signupIds: string[];
  actorId: string;
}): Promise<SupplementalIssuanceResult> {
  const { projectId, scheduleId, signupIds, actorId } = options;
  const requestedSignupIds = [...new Set(signupIds)];
  if (requestedSignupIds.length === 0) {
    return { issued: 0, emailsSent: 0, errors: [], deliveryDurable: false };
  }
  if (requestedSignupIds.length > 500) {
    return {
      issued: 0,
      emailsSent: 0,
      errors: ["too_many_signups"],
      deliveryDurable: false,
    };
  }

  // The helper repeats the request once when the response is lost. The
  // repeat issues nothing new and returns the first call's deliveries.
  const transaction = await recoverSupplementalCertificates({
    actorId,
    projectId,
    scheduleId,
    signupIds: requestedSignupIds,
  });
  if (!transaction.publication) {
    return {
      issued: 0,
      emailsSent: 0,
      errors: [
        transaction.invalidResponse
          ? "certificate_recovery_invalid_response"
          : `certificate_insert_failed:${transaction.errorCode ?? "unknown"}`,
      ],
      deliveryDurable: false,
    };
  }

  const recovery = transaction.publication;
  const errors: string[] = [];
  let emailsSent = 0;
  if (recovery.publication) {
    const delivery = await drainPublicationEmails(recovery.publication);
    emailsSent = delivery.emailsSent;
    errors.push(...delivery.errors);
  }
  // An older award with no ledger entry may or may not have been emailed.
  // It is reported for review and never sent from here.
  if (recovery.recoveryRequired) {
    errors.push("certificate_delivery_review_required");
  }

  return {
    issued: recovery.issued,
    emailsSent,
    errors,
    deliveryDurable:
      !recovery.recoveryRequired &&
      recovery.publication !== null &&
      recovery.publication.deliveries.length > 0,
  };
}
