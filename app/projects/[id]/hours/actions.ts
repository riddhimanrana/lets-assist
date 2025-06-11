"use server";

import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import { Project } from "@/types"; // Import Project type

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

// Helper function to get the key for the 'published' JSONB field
const getPublishStateKey = (project: Project, sessionId: string): string => {
  if (project.event_type === "oneTime") {
    return "oneTime";
  } else if (project.event_type === "multiDay") {
    const [_, dayIndex, __, slotIndex] = sessionId.split("-");
    const dateKey = project.schedule.multiDay?.[parseInt(dayIndex)]?.date;
    return `${dateKey}-${slotIndex}`;
  } else if (project.event_type === "sameDayMultiArea") {
    // For multi-area events, the sessionId is the role name
    return sessionId;
  }
  return sessionId; // Fallback
};

// Function to generate certificate published email HTML
const generateCertificatePublishedEmailHtml = (
  volunteerName: string,
  projectTitle: string,
  certificateId: string,
  siteUrl: string
): string => {
  const certificateUrl = `${siteUrl}/certificates/${certificateId}`;
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <title>Your Volunteer Certificate is Ready!</title>
      <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

          * {
              margin: 0;
              padding: 0;
              font-family: 'Inter', 'Arial', sans-serif;
          }
          body {
              background-color: #f9f9f9;
              color: #333;
              line-height: 1.6;
          }
          .email-container {
              background-color: #ffffff;
              overflow: hidden;
          }
          .email-body {
              padding: 32px 24px;
              background-color: #ffffff;
          }
          h1 {
              color: #222;
              font-size: 28px;
              font-weight: 700;
              margin-bottom: 20px;
              letter-spacing: -0.02em;
          }
          p {
              color: #555;
              font-size: 16px;
              margin-bottom: 20px;
          }
          .certificate-button {
              display: inline-block;
              background-color: #16a34a;
              color: #fff !important;
              text-decoration: none;
              padding: 12px 32px;
              border-radius: 6px;
              font-weight: 600;
              font-size: 14px;
              margin: 24px 0;
              transition: background-color 0.2s ease;
              box-shadow: 0 4px 8px rgba(22, 163, 74, 0.15);
              text-align: center;
          }
          .certificate-button:hover {
              background-color: #15803d;
          }
          .event-details {
              background-color: #f8f9fa;
              border-radius: 6px;
              padding: 20px;
              margin: 24px 0;
              border-left: 4px solid #16a34a;
          }
          .detail-row {
              margin-bottom: 8px;
              font-size: 15px;
          }
          .detail-row:last-child {
              margin-bottom: 0;
          }
          .detail-label {
              font-weight: 600;
              color: #374151;
              display: inline-block;
              width: 120px;
          }
          .detail-value {
              color: #555;
          }
          .email-footer {
              padding: 20px 24px;
              text-align: center;
              font-size: 14px;
              color: #777;
              background-color: #f9fafb;
              border-top: 1px solid #f0f0f0;
          }
          .help-text {
              font-size: 14px;
              color: #777;
          }
          .alternative-link {
              word-break: break-all;
              color: #16a34a;
              text-decoration: underline;
          }
          .getting-started {
              margin-top: 28px;
              padding-top: 16px;
              border-top: 1px solid #f0f0f0;
              font-size: 15px;
          }
      </style>
  </head>
  <body>
      <div class="email-container">
          <div class="email-body">
              <h1>🎉 Your Certificate is Ready!</h1>
              <p>Hi ${volunteerName},</p>
              <p>Great news! Your volunteer certificate for <strong>${projectTitle}</strong> has been published and is now available for download.</p>
              
              <div class="event-details">
                  <div class="detail-row">
                      <span class="detail-label">Project:</span>
                      <span class="detail-value">${projectTitle}</span>
                  </div>
                  <div class="detail-row">
                      <span class="detail-label">Certificate ID:</span>
                      <span class="detail-value">${certificateId}</span>
                  </div>
              </div>
              
              <div style="text-align: center;">
                  <a href="${certificateUrl}" class="certificate-button">View My Certificate</a>
              </div>
              
              <p class="help-text">You can view, download, and share your certificate using the link above. This certificate serves as official recognition of your volunteer contribution.</p>
              
              <div class="getting-started">
                  <p><strong>Having trouble with the button?</strong></p>
                  <p class="help-text">You can also use this direct link: <a href="${certificateUrl}" class="alternative-link">${certificateUrl}</a></p>
              </div>
          </div>
          <div class="email-footer">
              <p>&copy; ${new Date().getFullYear()} Let's Assist, LLC. All rights reserved.</p>
              <p>Questions? Contact us at <a href="mailto:support@lets-assist.com" style="color: #16a34a; font-weight: 500;">support@lets-assist.com</a></p>
          </div>
      </div>
  </body>
  </html>
  `;
};

// Function to send certificate published notifications
const sendCertificatePublishedEmails = async (
  certificates: Array<{
    id: string;
    volunteer_name: string | null;
    volunteer_email: string | null;
    project_title: string;
  }>
): Promise<{ success: boolean; emailsSent: number; errors: string[] }> => {
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not configured");
    return { success: false, emailsSent: 0, errors: ["Email service not configured"] };
  }

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  
  let emailsSent = 0;
  const errors: string[] = [];

  for (const cert of certificates) {
    if (!cert.volunteer_email || !cert.volunteer_name) {
      errors.push(`Skipped certificate ${cert.id}: Missing email or name`);
      continue;
    }

    try {
      const emailHtml = generateCertificatePublishedEmailHtml(
        cert.volunteer_name,
        cert.project_title,
        cert.id,
        siteUrl
      );

      const { error: emailError } = await resend.emails.send({
        from: "Let's Assist <certificates@notifications.lets-assist.com>",
        to: [cert.volunteer_email],
        subject: `Your volunteer certificate for ${cert.project_title} is ready!`,
        html: emailHtml,
      });

      if (emailError) {
        console.error(`Error sending email to ${cert.volunteer_email}:`, emailError);
        errors.push(`Failed to send email to ${cert.volunteer_email}: ${emailError.message}`);
      } else {
        emailsSent++;
        console.log(`Certificate email sent successfully to ${cert.volunteer_email}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`Unexpected error sending email to ${cert.volunteer_email}:`, error);
      errors.push(`Unexpected error for ${cert.volunteer_email}: ${errorMessage}`);
    }
  }

  return {
    success: emailsSent > 0,
    emailsSent,
    errors
  };
};


export async function publishVolunteerHours(
  projectId: string,
  sessionId: string,
  sessionData: SessionVolunteerData[]
): Promise<{ success: boolean; error?: string; certificatesCreated?: number }> {
  const cookieStore = cookies();
  const supabase = await createClient();

  try {
    // 1. Verify user authentication and permissions (simplified for brevity)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, error: "Authentication required." };
    }
    // TODO: Add robust permission check (is user the project creator or org admin/staff?)

    // 2. Fetch Project, Organization, and Creator data
    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(`
        *,
        profiles!projects_creator_id_fkey1 (full_name),
        organization:organizations (name, verified) 
      `)
      .eq("id", projectId)
      .single();

    if (projectError || !projectData) {
      console.error("Error fetching project data:", projectError);
      return { success: false, error: "Project not found or error fetching data." };
    }

    // Type assertion after successful fetch
    const project = projectData as Project;
    const creatorName = project.profiles?.full_name || "Project Organizer"; // Fallback name
    const organizationName = project.organization?.name || null;
    const isOrganizationVerified = project.organization?.verified || false;

    // 3. Filter out invalid entries (though client should prevent this)
    const validVolunteers = sessionData.filter(v => v.isValid && v.checkIn && v.checkOut);
    if (validVolunteers.length === 0) {
      return { success: false, error: "No valid volunteer hours data to publish." };
    }

    // 4. Prepare certificate data
    const certificatesToInsert = validVolunteers.map(volunteer => ({
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
      // --- END UPDATED FIELDS ---
      check_in_method: project.verification_method,
      schedule_id: sessionId, // Store the session identifier, sessionId renamed to scheduleId
    }));

    // 5. Insert certificates into the database
    const { error: insertError } = await supabase
      .from("certificates")
      .insert(certificatesToInsert);

    if (insertError) {
        console.log(certificatesToInsert)
      console.error("Error inserting certificates:", insertError);
      return { success: false, error: `Database error inserting certificates: ${insertError.message}` };
    }

    // 6. Update the project's 'published' status
    const publishKey = getPublishStateKey(project, sessionId);
    const currentPublishedState = (project.published || {}) as Record<string, boolean>;
    const updatedPublishedState = {
      ...currentPublishedState,
      [publishKey]: true,
    };

    const { error: updateProjectError } = await supabase
      .from("projects")
      .update({ published: updatedPublishedState })
      .eq("id", projectId);

    if (updateProjectError) {
      console.error("Error updating project published status:", updateProjectError);
      // Even if this fails, certificates were created, so maybe return success but log error?
      // For now, let's return an error to be safe.
      return { success: false, error: `Failed to update project status: ${updateProjectError.message}` };
    }


    console.log(`Successfully created ${certificatesToInsert.length} certificates for project ${projectId}, session ${sessionId}`);
    return { success: true, certificatesCreated: certificatesToInsert.length };

  } catch (error: any) {
    console.error("Unexpected error in publishVolunteerHours:", error);
    return { success: false, error: error.message || "An unexpected server error occurred." };
  }
}
