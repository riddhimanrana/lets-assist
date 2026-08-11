import "server-only";

import * as React from "react";

import CertificatePublished from "@/emails/certificate-published";
import { sendEmail } from "@/services/email";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Project } from "@/types";

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

/** Key inside projects.published jsonb for a session's publish state. */
export const getPublishStateKey = (
  project: Pick<Project, "event_type">,
  sessionId: string,
): string => {
  if (project.event_type === "oneTime") {
    return "oneTime";
  } else if (project.event_type === "multiDay") {
    const parts = sessionId.split("-");
    if (parts.length === 5) {
      // New format: YYYY-MM-DD-dayIndex-slotIndex
      const dateKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
      const slotIndex = parts[4];
      return `${dateKey}-${slotIndex}`;
    } else if (parts.length === 4) {
      // Legacy format: YYYY-MM-DD-slotIndex
      return sessionId;
    }
  } else if (project.event_type === "sameDayMultiArea") {
    // For multi-area events, the sessionId is the role name
    return sessionId;
  }
  return sessionId;
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
 * session (paper scans). certificates.signup_id has no unique constraint, so
 * the pre-filter against existing certificates is what makes this idempotent
 * — never skip it. Does not flip the session's published flag: it is
 * already true, and flipping it is the publish flow's job.
 */
export async function issueCertificatesForSignups(options: {
  projectId: string;
  scheduleId: string;
  signupIds: string[];
  actorId: string;
}): Promise<{ issued: number; emailsSent: number; errors: string[] }> {
  const { projectId, scheduleId, signupIds, actorId } = options;
  if (signupIds.length === 0) {
    return { issued: 0, emailsSent: 0, errors: [] };
  }

  const admin = getAdminClient();
  const errors: string[] = [];

  const { data: projectData, error: projectError } = await admin
    .from("projects")
    .select(
      "id, title, location, verification_method, project_timezone, profiles!projects_creator_id_fkey1 (full_name), organization:organizations (name, verified)",
    )
    .eq("id", projectId)
    .single();
  if (projectError || !projectData) {
    return { issued: 0, emailsSent: 0, errors: ["project_not_found"] };
  }
  const creatorName =
    (projectData.profiles as unknown as { full_name: string | null } | null)
      ?.full_name || "Project Organizer";
  const organization = projectData.organization as unknown as {
    name: string | null;
    verified: boolean | null;
  } | null;

  // Idempotency pre-filter: skip any signup that already holds a certificate.
  const { data: existingCerts } = await admin
    .from("certificates")
    .select("signup_id")
    .in("signup_id", signupIds);
  const alreadyIssued = new Set(
    (existingCerts ?? []).map((cert) => cert.signup_id),
  );
  const pendingIds = signupIds.filter((id) => !alreadyIssued.has(id));
  if (pendingIds.length === 0) {
    return { issued: 0, emailsSent: 0, errors: [] };
  }

  const { data: signups, error: signupsError } = await admin
    .from("project_signups")
    .select(
      "id, user_id, anonymous_id, check_in_time, check_out_time, profiles(full_name, email), anonymous_signups(name, email)",
    )
    .in("id", pendingIds)
    .eq("project_id", projectId)
    .eq("status", "attended");
  if (signupsError || !signups || signups.length === 0) {
    return { issued: 0, emailsSent: 0, errors: ["signups_not_found"] };
  }

  const certificatesToInsert = signups
    .filter((signup) => signup.check_in_time && signup.check_out_time)
    .map((signup) => {
      const profile = signup.profiles as unknown as {
        full_name: string | null;
        email: string | null;
      } | null;
      const anon = signup.anonymous_signups as unknown as {
        name: string | null;
        email: string | null;
      } | null;
      return {
        project_id: projectId,
        user_id: signup.user_id,
        signup_id: signup.id,
        volunteer_name: profile?.full_name || anon?.name || "No Name Volunteer",
        volunteer_email: profile?.email || anon?.email || null,
        project_title: projectData.title,
        project_location: projectData.location,
        event_start: signup.check_in_time,
        event_end: signup.check_out_time,
        organization_name: organization?.name ?? null,
        creator_name: creatorName,
        is_certified: organization?.verified ?? false,
        creator_id: actorId,
        type: "verified" as const,
        check_in_method: projectData.verification_method,
        schedule_id: scheduleId,
      };
    });

  if (certificatesToInsert.length === 0) {
    return { issued: 0, emailsSent: 0, errors: [] };
  }

  const { data: insertedCerts, error: insertError } = await admin
    .from("certificates")
    .insert(certificatesToInsert)
    .select(
      "id, user_id, volunteer_name, volunteer_email, project_title, event_start, event_end",
    );
  if (insertError) {
    return {
      issued: 0,
      emailsSent: 0,
      errors: [`certificate_insert_failed:${insertError.code}`],
    };
  }

  const inserted = insertedCerts ?? [];

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
