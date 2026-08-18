import "server-only";

import * as React from "react";

import CertificatePublished from "@/emails/certificate-published";
import { sendEmail } from "@/services/email";
import { getAdminClient } from "@/lib/supabase/admin";
export { getPublishStateKey } from "@/lib/projects/hours-publish-key";

/**
 * Certificate issuance shared between the hours publish flow
 * (publishVolunteerHours / resendCertificateEmails) and the paper signup
 * commit path, which must issue certificates for signups added to a session
 * that was already published.
 */

export type CertificateEmailRow = {
  id: string;
  volunteer_name: string | null;
  volunteer_email: string | null;
  project_title: string;
  event_start?: string;
  event_end?: string;
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

      const { error: emailError } = await sendEmail({
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
          timezone: projectTimezone,
        }),
        type: "transactional",
      });

      if (emailError) {
        console.error(`Error sending certificate ${cert.id}:`, emailError);
        errors.push(`Failed to send certificate ${cert.id}: ${emailError}`);
      } else {
        emailsSent++;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`Unexpected error sending certificate ${cert.id}:`, error);
      errors.push(
        `Unexpected error for certificate ${cert.id}: ${errorMessage}`,
      );
    }
  }

  return {
    success: emailsSent > 0,
    emailsSent,
    errors,
  };
};

/**
 * Supplemental issuance for signups committed onto an already-published
 * session (paper scans). The service-only RPC derives certificate data from
 * the database and uses the verified-signup unique index as its conflict
 * arbiter, so a raced signup cannot discard unaffected rows in the batch.
 * Does not flip the session's published flag: it is already true, and
 * flipping it is the publish flow's job.
 */
export async function issueCertificatesForSignups(options: {
  projectId: string;
  scheduleId: string;
  signupIds: string[];
  actorId: string;
}): Promise<{ issued: number; emailsSent: number; errors: string[] }> {
  const { projectId, scheduleId, signupIds, actorId } = options;
  const requestedSignupIds = [...new Set(signupIds)];
  if (requestedSignupIds.length === 0) {
    return { issued: 0, emailsSent: 0, errors: [] };
  }
  if (requestedSignupIds.length > 500) {
    return { issued: 0, emailsSent: 0, errors: ["too_many_signups"] };
  }

  const admin = getAdminClient();
  const errors: string[] = [];

  const { data: projectData, error: projectError } = await admin
    .from("projects")
    .select("id, title, project_timezone")
    .eq("id", projectId)
    .single();
  if (projectError || !projectData) {
    return { issued: 0, emailsSent: 0, errors: ["project_not_found"] };
  }
  const { data: insertedCerts, error: insertError } = await admin.rpc(
    "issue_supplemental_verified_certificates",
    {
      p_project_id: projectId,
      p_schedule_id: scheduleId,
      p_signup_ids: requestedSignupIds,
      p_actor_id: actorId,
    },
  );
  if (insertError) {
    return {
      issued: 0,
      emailsSent: 0,
      errors: [`certificate_insert_failed:${insertError.code}`],
    };
  }

  const inserted = (insertedCerts ?? []) as Array<
    CertificateEmailRow & { user_id: string | null }
  >;

  // In-app notifications for registered volunteers, matching publishVolunteerHours.
  await Promise.allSettled(
    inserted
      .filter((cert) => cert.user_id)
      .map((cert) =>
        admin.from("notifications").insert({
          user_id: cert.user_id,
          title: "Your Volunteer Hours Have Been Published! 🎉",
          body: `Your volunteer certificate for "${projectData.title}" is now available.`,
          type: "project_updates",
          severity: "success",
          action_url: `/certificates/${cert.id}`,
          displayed: false,
          read: false,
        }),
      ),
  );

  const emailResult = await sendCertificatePublishedEmails(
    inserted.map((cert) => ({
      id: cert.id,
      volunteer_name: cert.volunteer_name,
      volunteer_email: cert.volunteer_email,
      project_title: cert.project_title,
      event_start: cert.event_start ?? undefined,
      event_end: cert.event_end ?? undefined,
    })),
    projectData.project_timezone ?? undefined,
  );
  errors.push(...emailResult.errors);

  return {
    issued: inserted.length,
    emailsSent: emailResult.emailsSent,
    errors,
  };
}
