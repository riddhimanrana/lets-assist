"use server";

import { createClient } from "@/lib/supabase/server";
import { Project } from "@/types"; // Import Project type
// Import React Email template and React
import CertificatePublished from "@/emails/certificate-published";
import * as React from "react";
import { sendEmail } from "@/services/email";
import { canManageProjectAccess } from "@/lib/projects/management-access";

// Define the structure for session data passed from the client
type SessionVolunteerData = {
  signupId: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  checkIn: string | null;
  checkOut: string | null;
  durationMinutes: number;
  isValid: boolean;
};

type ManageableProject = {
  creator_id: string | null;
  organization_id?: string | null;
  can_be_managed_by_staff?: boolean | null;
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

// Helper function to get the key for the 'published' JSONB field
const getPublishStateKey = (project: Project, sessionId: string): string => {
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
  return sessionId; // Fallback
};

// Function to send certificate published notifications
const sendCertificatePublishedEmails = async (
  certificates: Array<{
    id: string;
    volunteer_name: string | null;
    volunteer_email: string | null;
    project_title: string;
    event_start?: string;
    event_end?: string;
  }>,
  projectTimezone?: string,
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
          isAutoPublished: false,
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

export async function publishVolunteerHours(
  projectId: string,
  sessionId: string,
  sessionData: SessionVolunteerData[],
): Promise<{
  success: boolean;
  error?: string;
  certificatesCreated?: number;
  emailsSent?: number;
  emailErrors?: string[];
}> {
  const supabase = await createClient();

  try {
    // 1. Verify user authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, error: "Authentication required." };
    }

    // 2. Fetch Project, Organization, and Creator data
    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(
        `
        *,
        profiles!projects_creator_id_fkey1 (full_name),
        organization:organizations (name, verified) 
      `,
      )
      .eq("id", projectId)
      .single();

    if (projectError || !projectData) {
      console.error("Error fetching project data:", projectError);
      return {
        success: false,
        error: "Project not found or error fetching data.",
      };
    }

    // Type assertion after successful fetch
    const project = projectData as Project;
    if (!(await canUserManageProjectHours(supabase, user.id, project))) {
      return {
        success: false,
        error: "Unauthorized: You cannot publish hours for this project.",
      };
    }

    const creatorName = project.profiles?.full_name || "Project Organizer"; // Fallback name
    const organizationName = project.organization?.name || null;
    const isOrganizationVerified = project.organization?.verified || false;

    // 3. Filter out invalid entries (though client should prevent this)
    const validVolunteers = sessionData.filter(
      (v) => v.isValid && v.checkIn && v.checkOut,
    );
    if (validVolunteers.length === 0) {
      return {
        success: false,
        error: "No valid volunteer hours data to publish.",
      };
    }

    // 4. Prepare certificate data
    const certificatesToInsert = validVolunteers.map((volunteer) => ({
      project_id: projectId, // check
      user_id: volunteer.userId, // Can be null for anonymous // check
      signup_id: volunteer.signupId,
      volunteer_name: volunteer.name || "No Name Volunteer", // Use provided name or fallback // check
      volunteer_email: volunteer.email, // Can be null // check
      project_title: project.title, // check
      project_location: project.location, // check
      event_start: volunteer.checkIn,
      event_end: volunteer.checkOut,
      //   issued_at: new Date().toISOString(), //handled by database trigger
      organization_name: organizationName, // Use fetched org name
      creator_name: creatorName, // Use fetched creator name
      is_certified: isOrganizationVerified, // Use org verified status
      creator_id: user.id, // Added creator_id
      type: "verified" as const,
      // --- END UPDATED FIELDS ---
      check_in_method: project.verification_method,
      schedule_id: sessionId, // Store the session identifier, sessionId renamed to scheduleId
    }));

    // 5. Insert certificates into the database and get the created certificates for email sending
    const { data: insertedCerts, error: insertError } = (await supabase
      .from("certificates")
      .insert(certificatesToInsert)
      .select(
        "id, volunteer_name, volunteer_email, project_title, event_start, event_end",
      )) as {
      data: Array<{
        id: string;
        volunteer_name: string | null;
        volunteer_email: string | null;
        project_title: string;
        event_start?: string | null;
        event_end?: string | null;
      }> | null;
      error: { message: string } | null;
    };

    if (insertError) {
      console.error("Error inserting certificates:", insertError);
      return {
        success: false,
        error: `Database error inserting certificates: ${insertError.message}`,
      };
    }

    // 6. Update the project's 'published' status
    const publishKey = getPublishStateKey(project, sessionId);
    const currentPublishedState = (project.published || {}) as Record<
      string,
      boolean
    >;
    const updatedPublishedState = {
      ...currentPublishedState,
      [publishKey]: true,
    };

    const { error: updateProjectError } = await supabase
      .from("projects")
      .update({ published: updatedPublishedState })
      .eq("id", projectId);

    if (updateProjectError) {
      console.error(
        "Error updating project published status:",
        updateProjectError,
      );
      // Even if this fails, certificates were created, so maybe return success but log error?
      // For now, let's return an error to be safe.
      return {
        success: false,
        error: `Failed to update project status: ${updateProjectError.message}`,
      };
    }

    // 6.5. Send in-app notifications to volunteers about their published certificates
    if (insertedCerts && insertedCerts.length > 0) {
      const notificationPromises = validVolunteers
        .filter((v) => v.userId) // Only send to registered users
        .map(async (volunteer) => {
          try {
            const certificateData = insertedCerts.find(
              (cert) => cert.volunteer_name === volunteer.name,
            );
            if (!certificateData) return;

            await supabase.from("notifications").insert({
              user_id: volunteer.userId,
              title: "Your Volunteer Hours Have Been Published! 🎉",
              body: `Your volunteer certificate for "${project.title}" is now available. You volunteered for ${Math.floor(volunteer.durationMinutes / 60)} hours and ${volunteer.durationMinutes % 60} minutes.`,
              type: "project_updates",
              severity: "success",
              action_url: `/certificates/${certificateData.id}`,
              displayed: false,
              read: false,
            });
          } catch (error) {
            console.error("Failed to send certificate notification:", error);
          }
        });

      await Promise.allSettled(notificationPromises);
    }

    // 7. Send email notifications
    const emailCertificates = (insertedCerts || []).map((cert) => ({
      ...cert,
      event_start: cert.event_start ?? undefined,
      event_end: cert.event_end ?? undefined,
    }));

    const emailResult = await sendCertificatePublishedEmails(
      emailCertificates,
      project.project_timezone,
    );

    return {
      success: true,
      certificatesCreated: certificatesToInsert.length,
      emailsSent: emailResult.emailsSent,
      emailErrors: emailResult.errors,
    };
  } catch (error) {
    console.error("Unexpected error in publishVolunteerHours:", error);
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected server error occurred.";
    return { success: false, error: message };
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
        "id, creator_id, organization_id, can_be_managed_by_staff, project_timezone",
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

    // 3. Fetch the certificates to resend
    const { data: certificates, error: certError } = await supabase
      .from("certificates")
      .select(
        "id, volunteer_name, volunteer_email, project_title, event_start, event_end",
      )
      .eq("project_id", projectId)
      .eq("schedule_id", sessionId);

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
    };
  } catch (error) {
    console.error("Unexpected error in resendCertificateEmails:", error);
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected server error occurred.";
    return { success: false, error: message };
  }
}
