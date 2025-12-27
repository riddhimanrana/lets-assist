"use server";

import { createClient } from "@/utils/supabase/server";
import { canCancelProject, getProjectStatus, isProjectVisible } from "@/utils/project";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
// Make sure AnonymousSignup is imported from the correct types definition
import { type Profile, type Project, type AnonymousSignupData, type ProjectSignup, type SignupStatus, type AnonymousSignup } from "@/types";
import crypto from 'crypto';
// Import centralized email service
import { sendEmail } from '@/services/email';
// Import date-fns utilities
import { parseISO, isAfter } from 'date-fns';
// Remove the import for the email template component
// import AnonymousSignupConfirmationEmail from '@/emails/AnonymousSignupConfirmationEmail';

import { NotificationService } from "@/services/notifications";
import { removeCalendarEventForSignup, removeCalendarEventForProject } from "@/utils/calendar-helpers";

// Define your site URL (replace with environment variable ideally)
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// Function to generate the HTML email content
const generateConfirmationEmailHtml = (
  confirmationUrl: string,
  projectName: string,
  userName: string
): string => {
  // Remove /confirm and token query from the confirmationUrl for display/profile link
  // confirmationUrl is like: `${siteUrl}/anonymous/${anonymousSignupId}/confirm?token=${confirmationToken}`
  // We want just: `${siteUrl}/anonymous/${anonymousSignupId}`
  const urlObj = new URL(confirmationUrl);
  // The anonymousSignupId is the second-to-last segment
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  const anonymousSignupId = pathParts[1]; // e.g., /anonymous/{id}/confirm

  const anonymousProfileUrl = `${siteUrl}/anonymous/${anonymousSignupId}`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <title>Confirm Your Signup</title>
      <style>
          // @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

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
          .confirm-button {
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
          .confirm-button:hover {
              background-color: #15803d;
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
              text-decoration: none;
              font-weight: 500;
              font-size: 13px;
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
              <h1>You're Almost In!</h1>
              <p>Hi ${userName},</p>
              <p>Thanks for signing up to volunteer for <strong>${projectName}</strong>! Please confirm your email address to complete your signup.</p>
              
              <div style="text-align: center;">
                  <a href="${confirmationUrl}" class="confirm-button">Confirm Your Signup</a>
              </div>
              
              <p class="help-text">Having trouble with the button? You can also use this link:</p>
              <p><a href="${confirmationUrl}" style="color:#16a34a" class="alternative-link">${confirmationUrl}</a></p>

              <p class="help-text">For future reference, here's a link to your anonymous profile:</p>
              <p><a href="${anonymousProfileUrl}" style="color:#16a34a" class="alternative-link">${anonymousProfileUrl}</a></p>
              
              <div class="getting-started">
                  <p>If you did not sign up for this project on Let's Assist, you can safely ignore this email.</p>
              </div>
          </div>
          <div class="email-footer">
              <p>&copy; ${new Date().getFullYear()} Riddhiman Rana. All rights reserved.</p>
              <p>Questions? Contact us at <a href="mailto:support@lets-assist.com" style="color: #16a34a; font-weight: 500;">support@lets-assist.com</a></p>
          </div>
      </div>
  </body>
  </html>
  `;
};

// Function to generate signup confirmation email for logged-in users
const generateLoggedInUserConfirmationEmailHtml = (
  projectName: string,
  userName: string,
  projectDate: string,
  projectTime: string,
  projectLocation: string,
  projectUrl: string
): string => {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <title>Signup Confirmed</title>
      <style>
          // @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

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
          .view-event-button {
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
          .view-event-button:hover {
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
              width: 80px;
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
              <h1>Signup Confirmed!</h1>
              <p>Hi ${userName},</p>
              <p>Your signup for <strong>${projectName}</strong> has been confirmed. We're excited to have you volunteer with us!</p>
              
              <div class="event-details">
                  <div class="detail-row">
                      <span class="detail-label">Event:</span>
                      <span class="detail-value">${projectName}</span>
                  </div>
                  <div class="detail-row">
                      <span class="detail-label">Date:</span>
                      <span class="detail-value">${projectDate}</span>
                  </div>
                  ${projectTime ? `
                  <div class="detail-row">
                      <span class="detail-label">Time:</span>
                      <span class="detail-value">${projectTime}</span>
                  </div>` : ''}
                  <div class="detail-row">
                      <span class="detail-label">Location:</span>
                      <span class="detail-value">${projectLocation}</span>
                  </div>
              </div>
              
              <div style="text-align: center;">
                  <a href="${projectUrl}" class="view-event-button">View Event Details</a>
              </div>
              
              <div class="getting-started">
                  <p><strong>What's next?</strong></p>
                  <ul style="margin-top: 12px; padding-left: 20px;">
                      <li>Mark your calendar for the event date</li>
                      <li>Check your email for any updates from the organizers</li>
                      <li>Visit the event page for additional information</li>
                  </ul>
              </div>
          </div>
          <div class="email-footer">
              <p>&copy; ${new Date().getFullYear()} Riddhiman Rana. All rights reserved.</p>
              <p>Questions? Contact us at <a href="mailto:support@lets-assist.com" style="color: #16a34a; font-weight: 500;">support@lets-assist.com</a></p>
          </div>
      </div>
  </body>
  </html>
  `;
};



// Function to extract schedule details for email notifications
function getScheduleDetails(project: Project, scheduleId: string) {
  if (project.event_type === "oneTime") {
    const schedule = project.schedule.oneTime;
    if (!schedule) return { date: "TBD", time: "TBD", timeRange: "TBD" };

    const date = new Date(schedule.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const timeRange = schedule.startTime && schedule.endTime
      ? `${schedule.startTime} - ${schedule.endTime}`
      : schedule.startTime || "TBD";

    return {
      date,
      time: schedule.startTime || "TBD",
      timeRange
    };
  } else if (project.event_type === "multiDay") {
    const parts = scheduleId.split("-");
    if (parts.length >= 2) {
      const slotIndexStr = parts.pop();
      const dateStr = parts.join("-");

      const day = project.schedule.multiDay?.find(d => d.date === dateStr);
      if (!day) return { date: "TBD", time: "TBD", timeRange: "TBD" };

      const slotIndex = parseInt(slotIndexStr!, 10);
      const slot = day.slots[slotIndex];
      if (!slot) return { date: "TBD", time: "TBD", timeRange: "TBD" };

      const date = new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const timeRange = slot.startTime && slot.endTime
        ? `${slot.startTime} - ${slot.endTime}`
        : slot.startTime || "TBD";

      return {
        date,
        time: slot.startTime || "TBD",
        timeRange
      };
    }
  } else if (project.event_type === "sameDayMultiArea") {
    const schedule = project.schedule.sameDayMultiArea;
    if (!schedule) return { date: "TBD", time: "TBD", timeRange: "TBD" };

    const date = new Date(schedule.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const role = schedule.roles.find(r => r.name === scheduleId);
    const timeRange = role?.startTime && role?.endTime
      ? `${role.startTime} - ${role.endTime}`
      : role?.startTime || schedule.overallStart || "TBD";

    return {
      date,
      time: role?.startTime || schedule.overallStart || "TBD",
      timeRange
    };
  }

  return { date: "TBD", time: "TBD", timeRange: "TBD" };
}

export async function isProjectCreator(projectId: string) {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return false;
    }

    // Check project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id")
      .eq("id", projectId)
      .single();

    return project?.creator_id === user.id;
  } catch (error) {
    return false;
  }
}

export async function getProject(projectId: string) {
  const supabase = await createClient();

  // Get the current user if logged in
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch the project
  const { data: project, error } = await supabase
    .from("projects")
    .select(`
      *,
      organization:organizations (
        id,
        name,
        username,
        logo_url,
        verified,
        type,
        allowed_email_domains
      )
    `)
    .eq("id", projectId)
    .single();

  if (error) {
    console.error("Error fetching project:", error);
    return { error: "Failed to fetch project" };
  }

  // Calculate and update the project status
  if (project) {


    // Check if the project is organization-only and the user has permission to view it
    if (project.visibility === 'organization_only') {
      // If it's an organization-only project, check user's organization memberships
      if (!user) {
        return { error: "unauthorized", project: null };
      }

      // Get user's organization memberships
      const { data: userOrgs } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id);

      // Check if user is a member of the project's organization
      const hasAccess = isProjectVisible(project, user.id, userOrgs || []);

      if (!hasAccess) {
        return { error: "unauthorized", project: null };
      }
    }
  }

  return { project };
}

export async function getCreatorProfile(userId: string) {
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Error fetching creator profile:", error);
    return { error: "Failed to fetch creator profile" };
  }

  return { profile };
}

// Fix: Remove async keyword as this function doesn't perform async operations
function getSlotDetails(project: Project, scheduleId: string) {
  console.log("Server: Getting slot details for", { scheduleId, projectType: project.event_type });

  if (project.event_type === "oneTime") {
    return project.schedule.oneTime;
  } else if (project.event_type === "multiDay") {
    // Improved parsing for multi-day schedules
    const parts = scheduleId.split("-");
    if (parts.length >= 2) {
      const slotIndexStr = parts.pop(); // Get last element (slot index)
      const date = parts.join("-"); // Rejoin the rest as the date

      console.log("Server: Parsing multiDay scheduleId:", { date, slotIndexStr });

      const day = project.schedule.multiDay?.find(d => d.date === date);
      if (!day) {
        console.error("Server: Day not found for multiDay event:", { date, scheduleId });
        return null;
      }

      const slotIndex = parseInt(slotIndexStr!, 10);
      if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= day.slots.length) {
        console.error("Server: Invalid slot index for multiDay event:", {
          slotIndexStr, slotIndex, slotsLength: day.slots.length
        });
        return null;
      }

      return day.slots[slotIndex];
    } else {
      console.error("Server: Invalid multiDay scheduleId format:", scheduleId);
      return null;
    }
  } else if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === scheduleId);
    return role;
  }

  return null;
}

async function getCurrentSignups(projectId: string, scheduleId: string): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("project_signups")
    .select("*", { count: 'exact', head: true })
    .eq("project_id", projectId)
    .eq("schedule_id", scheduleId)
    .in("status", ["approved", "attended"]);

  return count || 0;
}

export async function togglePauseSignups(projectId: string, pauseState: boolean) {
  const supabase = await createClient();

  try {
    // Check if user has permission
    const isAllowed = await isProjectCreator(projectId);

    if (!isAllowed) {
      return { error: "You don't have permission to modify this project" };
    }

    // Update the pause state
    const { error } = await supabase
      .from("projects")
      .update({ pause_signups: pauseState })
      .eq("id", projectId);

    if (error) {
      console.error("Error updating pause state:", error);
      return { error: "Failed to update signup status" };
    }

    // Revalidate paths to refresh data
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error toggling pause state:", error);
    return { error: "An unexpected error occurred" };
  }
}

export async function signUpForProject(
  projectId: string,
  scheduleId: string,
  anonymousData?: AnonymousSignupData
) {
  const supabase = await createClient();
  const isAnonymous = !!anonymousData;
  let createdSignupId: string | undefined = undefined; // Track the created signup ID

  try {
    console.log("Starting signup process:", { projectId, scheduleId, isAnonymous });

    // Get project details
    const { project, error: projectError } = await getProject(projectId);

    if (!project || projectError) {
      return { error: "Project not found" };
    }

    // Check if signups are paused
    if (project.pause_signups) {
      return { error: "Signups for this project are temporarily paused by the organizer" };
    }

    // Check if project is available for signup
    // Check if project is available for signup
    if (project.status === "cancelled") {
      return { error: "This project has been cancelled" };
    }

    if (project.status === "completed") {
      return { error: "This project has been completed" };
    }

    // --- Domain Restriction Check ---
    if (project.restrict_to_org_domains && project.organization?.allowed_email_domains && project.organization.allowed_email_domains.length > 0) {
      const allowedDomains = project.organization.allowed_email_domains as string[];
      let hasValidEmail = false;
      const userEmailToCheck = isAnonymous ? anonymousData?.email : (await supabase.auth.getUser()).data.user?.email;

      // Helper to check domain
      const checkDomain = (email: string) => {
        const domain = email.split('@')[1]?.toLowerCase();
        return domain && allowedDomains.includes(domain);
      };

      if (isAnonymous) {
        if (userEmailToCheck && checkDomain(userEmailToCheck)) {
          hasValidEmail = true;
        }
      } else {
        // Logged in user
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // 1. Check primary email
          if (user.email && checkDomain(user.email)) {
            hasValidEmail = true;
          } else {
            // 2. Check secondary verified emails
            const { data: secondaryEmails } = await supabase
              .from('user_emails')
              .select('email')
              .eq('user_id', user.id)
              .not('verified_at', 'is', null);

            if (secondaryEmails) {
              for (const record of secondaryEmails) {
                if (checkDomain(record.email)) {
                  hasValidEmail = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (!hasValidEmail) {
        return {
          error: `This project is restricted to users with the following email domains: ${allowedDomains.join(', ')}. Please use a verified email with one of these domains.`
        };
      }
    }

    // For multiDay events, validate that the specific day/slot hasn't passed
    if (project.event_type === "multiDay" && project.schedule.multiDay) {
      const parts = scheduleId.split("-");
      if (parts.length >= 2) {
        const slotIndexStr = parts.pop();
        const date = parts.join("-");

        const day = project.schedule.multiDay.find((d: { date: string; slots: Array<{ endTime: string }> }) => d.date === date);
        if (day && slotIndexStr) {
          const slotIdx = parseInt(slotIndexStr, 10);
          if (!isNaN(slotIdx) && slotIdx >= 0 && slotIdx < day.slots.length) {
            const slot = day.slots[slotIdx];
            const dayDate = parseISO(date);
            const [hours, minutes] = slot.endTime.split(':').map(Number);
            const slotEndDateTime = new Date(dayDate);
            slotEndDateTime.setHours(hours, minutes, 0, 0);

            if (isAfter(new Date(), slotEndDateTime)) {
              return { error: "This time slot has already passed" };
            }
          }
        }
      }
    }

    // Fix: Don't await getSlotDetails since it's no longer async
    const slotDetails = getSlotDetails(project, scheduleId);
    if (!slotDetails) {
      console.error("Invalid schedule slot:", { scheduleId, projectId });
      return { error: "Invalid schedule slot" };
    }

    // Check if slot is full (only count 'approved/attended' signups towards capacity)
    const currentSignups = await getCurrentSignups(projectId, scheduleId);
    console.log("Current signups:", { currentSignups, maxVolunteers: slotDetails.volunteers });

    if (currentSignups >= slotDetails.volunteers) {
      return { error: "This slot is full" };
    }

    // Handle user authentication
    const { data: { user } } = await supabase.auth.getUser();

    // If project requires login but user isn't logged in
    if (project.require_login && !user) {
      return { error: "You must be logged in to sign up for this project" };
    }

    // --- Check for existing signups ---
    if (user) { // Logged-in user check
      try {
        // First, check if user was previously rejected for this project
        const { data: previousRejection } = await supabase
          .from("project_signups")
          .select("id")
          .eq("project_id", projectId)
          .eq("schedule_id", scheduleId)
          .eq("user_id", user.id)
          .eq("status", "rejected")
          .maybeSingle();

        if (previousRejection) {
          return { error: "You have been rejected for this project and cannot sign up again." };
        }

        const { data: existingSignup } = await supabase
          .from("project_signups")
          .select("id")
          .eq("project_id", projectId)
          .eq("schedule_id", scheduleId)
          .eq("user_id", user.id)
          .in("status", ["approved", "pending"]) // Check for approved or pending
          .maybeSingle();

        if (existingSignup) {
          return { error: "You have already signed up for this slot" };
        }

        // Create project signup record for logged-in user (status 'approved')
        const signupData: Omit<ProjectSignup, "id" | "created_at"> = {
          project_id: projectId,
          schedule_id: scheduleId,
          user_id: user.id,
          status: "approved", // Logged-in users are approved by default
          anonymous_id: null,
        };

        const { data: insertedSignup, error: signupError } = await supabase
          .from("project_signups")
          .insert(signupData)
          .select()
          .single();

        if (signupError || !insertedSignup) {
          console.error("Error creating signup for registered user:", signupError);
          return { error: "Failed to sign up. Please try again." };
        }

        // Store the signup ID for return
        createdSignupId = insertedSignup.id;
        // Send confirmation email to logged-in user
        try {
          // Get user profile for email
          const { data: userProfile } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", user.id)
            .single();

          if (userProfile?.email) {
            // Get schedule details for email
            const { date, time, timeRange } = getScheduleDetails(project, scheduleId);
            const projectUrl = `${siteUrl}/projects/${projectId}`;

            const emailHtml = generateLoggedInUserConfirmationEmailHtml(
              project.title,
              userProfile.full_name || 'Volunteer',
              date,
              timeRange,
              project.location,
              projectUrl
            );

            const { data: emailData, error: emailError } = await sendEmail({
              to: userProfile.email,
              subject: `Signup confirmed for ${project.title}`,
              html: emailHtml,
              userId: user.id,
              type: 'transactional' // Signup confirmation is transactional
            });

            if (emailError) {
              console.error("Error sending confirmation email to logged-in user:", emailError);
              // Don't fail the signup if email fails
            } else {
              console.log("Confirmation email sent to logged-in user successfully:", emailData);
            }
          }
        } catch (emailError) {
          console.error("Error in email sending process for logged-in user:", emailError);
          // Don't fail the signup if email fails
        }

        // Explicitly log success for debugging
        console.log("Successfully created signup for registered user:", {
          userId: user.id,
          projectId,
          scheduleId
        });

      } catch (error) {
        console.error("Error in user signup process:", error);
        return { error: "An error occurred during signup" };
      }
    } else if (isAnonymous && anonymousData) { // Anonymous user check
      // First, check if a registered Let's Assist account exists with this email
      const { data: existingProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('email', anonymousData.email?.toLowerCase())
        .maybeSingle();

      if (existingProfile) {
        return { error: "This email is associated with an existing Let's Assist account. Please log in to sign up for this project." };
      }
      if (profileError) {
        console.error("Error checking for existing profile:", profileError);
        return { error: "An error occurred while checking email availability." };
      }

      // Check for an existing anonymous signup for this specific slot with this email for any status
      const emailToCheck = (anonymousData.email ?? "").toLowerCase();
      console.log("Checking for existing anonymous signup with email:", emailToCheck);

      // Attempt to retrieve an existing anonymous signup record for the project and email
      const { data: existingAnonSignup } = await supabase
        .from('project_signups')
        .select('id, status, anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey(id, email)')
        .eq('project_id', projectId)
        .eq('schedule_id', scheduleId)
        .not('anonymous_id', 'is', null)
        .eq('anonymous_signup.email', emailToCheck)
        .limit(1)
        .maybeSingle();

      const signupStatus = existingAnonSignup?.status;

      if (signupStatus) {
        if (signupStatus === "pending") {
          return { error: "An unconfirmed signup with this email already exists for this slot. Please check your email." };
        } else if (signupStatus === "approved") {
          return { error: "This email has already signed up and confirmed for this slot." };
        } else if (signupStatus === "rejected") {
          return { error: "This email has been rejected by the project coordinator. Contact them for more details." };
        }
      }

      // Proceed to create new anonymous signup records
      let anonymousSignupId: string | null = null;
      let confirmationToken: string | null = null;

      // Check if a registered account exists with this email using listUsers
      const { data: userResponse, error: listUsersError } = await supabase.auth.admin.listUsers();
      const registeredUser = userResponse?.users?.find((u) => u.email === (anonymousData.email || "")) || null;
      if (registeredUser) {
        return { error: "This email is associated with an existing Let's Assist account. Please log in to sign up." };
      }

      confirmationToken = crypto.randomUUID();
      const anonSignupData: Omit<AnonymousSignup, "id" | "created_at" | "signup_id" | "confirmed_at"> = {
        project_id: projectId,
        email: anonymousData.email ?? "",
        name: anonymousData.name,
        phone_number: anonymousData.phone || null,
        token: confirmationToken,
      };

      console.log("Inserting anonSignupData:", anonSignupData);
      const { data: insertedAnonSignup, error: anonInsertError } = await supabase
        .from("anonymous_signups")
        .insert(anonSignupData)
        .select("id")
        .single();

      if (anonInsertError || !insertedAnonSignup) {
        console.error("Error creating anonymous signup record:", anonInsertError);
        return { error: "Failed to initiate anonymous signup. Please try again." };
      }
      anonymousSignupId = insertedAnonSignup.id;
      console.log("Anonymous Signup ID:", anonymousSignupId);

      const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
        project_id: projectId,
        schedule_id: scheduleId,
        user_id: null,
        status: "pending", // Anonymous signups start as pending
        anonymous_id: anonymousSignupId,
      };

      const { data: insertedProjectSignup, error: projectSignupInsertError } = await supabase
        .from("project_signups")
        .insert(projectSignupData)
        .select("id")
        .single();

      if (projectSignupInsertError || !insertedProjectSignup) {
        console.error("Error creating project signup record for anonymous:", projectSignupInsertError);
        await supabase.from("anonymous_signups").delete().eq("id", anonymousSignupId);
        return { error: "Failed to complete signup. Please try again." };
      }

      // Store the signup ID for anonymous users too
      createdSignupId = insertedProjectSignup.id;

      const { error: anonUpdateError } = await supabase
        .from("anonymous_signups")
        .update({ signup_id: insertedProjectSignup.id })
        .eq("id", anonymousSignupId);

      if (anonUpdateError) {
        console.error("Failed to update anonymous signup with project signup ID:", anonUpdateError);
        return { error: "Signup partially completed, but encountered an issue. Please contact support." };
      }

      const { data: verifyUpdate, error: verifyError } = await supabase
        .from("anonymous_signups")
        .select("id, signup_id")
        .eq("id", anonymousSignupId)
        .single();

      if (verifyError || !verifyUpdate || verifyUpdate.signup_id !== insertedProjectSignup.id) {
        console.error("Failed to verify anonymous signup update");
        return { error: "Signup partially completed, but encountered an issue. Please contact support." };
      }

      if (anonymousData.email && confirmationToken && anonymousSignupId) {
        const confirmationUrl = `${siteUrl}/anonymous/${anonymousSignupId}/confirm?token=${confirmationToken}`;
        try {
          const emailHtml = generateConfirmationEmailHtml(
            confirmationUrl,
            project.title,
            anonymousData.name
          );

          const { data, error: emailError } = await sendEmail({
            to: anonymousData.email,
            subject: `Confirm your signup for ${project.title}`,
            html: emailHtml,
            type: 'transactional'
          });

          if (emailError) {
            console.error("Resend error:", emailError);
          } else {
            console.log("Confirmation email sent successfully:", data);
          }
        } catch (error) {
          console.error("Error sending confirmation email:", error);
        }
      } else {
        console.warn("Could not send confirmation email: Missing email, token, or anonymousSignupId.");
      }
    } else if (user) {
      // Create project signup record for logged-in user (status 'approved')
      const signupData: Omit<ProjectSignup, "id" | "created_at"> = {
        project_id: projectId,
        schedule_id: scheduleId,
        user_id: (user as { id: string }).id,
        status: "approved", // Logged-in users are approved by default
        anonymous_id: null,
      };

      const { error: signupError } = await supabase
        .from("project_signups")
        .insert(signupData);

      if (signupError) {
        console.error("Error creating signup for registered user:", signupError);
        return { error: "Failed to sign up. Please try again." };
      }
    } else {
      // Should not happen if require_login logic is correct, but handle defensively
      return { error: "Cannot sign up without user login or anonymous details." };
    }

    // --- Revalidate paths ---
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/signups`); // Revalidate signups page too
    if (project.organization_id) {
      revalidatePath(`/organization/${project.organization_id}`);
    }
    if (user) {
      revalidatePath(`/profile/${user.id}`);
    }

    // --- Return success with signup ID for calendar integration ---
    return {
      success: true,
      needsConfirmation: isAnonymous,
      signupId: createdSignupId,
      projectId: project.id
    };
  } catch (error) {
    console.error("Error in signUpForProject:", error);
    return { error: "An unexpected error occurred during signup." };
  }
}

// Add this new function to unreject a signup
export async function unrejectSignup(signupId: string) {
  const supabase = await createClient();

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    // Get signup details
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("*, project:projects(creator_id, organization_id)")
      .eq("id", signupId)
      .single();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Permission check: Only project creator or org admin/staff can unreject
    let hasPermission = false;
    if (user) {
      if (signup.project?.creator_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.organization_id) {
        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", signup.project.organization_id)
          .eq("user_id", user.id)
          .single();
        if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
          hasPermission = true;
        }
      }
    }

    if (!hasPermission) {
      return { error: "You don't have permission to unreject this signup" };
    }

    // Update signup status to 'approved'
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({ status: "approved" as SignupStatus })
      .eq("id", signupId);

    if (updateError) {
      throw updateError;
    }

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error unrejecting signup:", error);
    return { error: "Failed to unreject signup" };
  }
}

interface NotificationResult {
  success?: boolean;
  error?: string;
}

export async function createRejectionNotification(
  userId: string,
  projectId: string,
  signupId: string
): Promise<NotificationResult> {
  "use server";
  const supabase = await createClient();

  try {
    // Fetch the project title before creating the notification
    const { data: projectData, error: projectFetchError } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .single();

    if (projectFetchError || !projectData) {
      throw new Error("Failed to fetch project title");
    }

    const projectTitle = projectData.title;

    // Create notification directly
    await NotificationService.createNotification({
      title: "Project Status Update",
      body: `Your signup to volunteer for "${projectTitle}" has been rejected`,
      type: "project_updates",
      severity: "warning",
      actionUrl: `/projects/${projectId}`,
      data: { projectId, signupId }
    }, userId);

    return { success: true };
  } catch (error) {
    console.error("Server notification error:", error);
    return { error: "Failed to send notification" };
  }
}

export async function cancelSignup(signupId: string) {
  const supabase = await createClient();

  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    // Get signup details, including anonymous_id
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("*") // Fetch all signup details without join alias
      .eq("id", signupId)
      .maybeSingle();


    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Permission check: User who signed up OR project creator/org admin/staff
    let hasPermission = false;
    if (user) {
      if (signup.user_id === user.id) {
        hasPermission = true;
      } else {
        // Check if user is creator or org admin/staff
        const { data: project } = await supabase
          .from("projects")
          .select("creator_id, organization_id")
          .eq("id", signup.project_id)
          .single();

        if (project?.creator_id === user.id) {
          hasPermission = true;
        } else if (project?.organization_id) {
          const { data: orgMember } = await supabase
            .from("organization_members")
            .select("role")
            .eq("organization_id", project.organization_id)
            .eq("user_id", user.id)
            .single();
          if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
            hasPermission = true;
          }
        }
      }
    } else {
      // How can an unauthenticated user cancel?
      // Maybe via a link sent to the anonymous email? Requires a token mechanism.
      // For now, only logged-in users can cancel via the UI.
      return { error: "Authentication required to cancel signup." };
    }

    if (!hasPermission) {
      return { error: "You don't have permission to cancel this signup" };
    }

    // Remove calendar event if it exists (non-blocking)
    try {
      await removeCalendarEventForSignup(signupId);
    } catch (calendarError) {
      console.error("Error removing calendar event:", calendarError);
      // Don't fail the cancellation if calendar removal fails
    }

    const { error: deleteError } = await supabase
      .from("project_signups")
      .delete()
      .eq("id", signupId);

    if (deleteError) {
      console.error("Failed to delete signup:", deleteError);
    } else {
      console.log("Signup record deleted successfully.");
    }

    // Optional: If it was an anonymous signup, maybe update the anonymous_signups table too?
    // e.g., mark it as cancelled? Depends on desired behavior.

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error cancelling signup:", error);
    return { error: "Failed to cancel signup" };
  }
}

export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  cancellationReason?: string
) {
  const supabase = await createClient();

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    return { error: "You must be logged in to update project status" };
  }

  // Verify user has permission to update the project
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if user has permission
  let hasPermission = project.creator_id === user.id;
  if (project.organization && !hasPermission) {
    const { data: orgMember } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization.id)
      .eq("user_id", user.id)
      .single();

    if (orgMember?.role) {
      hasPermission = ["admin", "staff"].includes(orgMember.role);
    }
  }

  if (!hasPermission) {
    return { error: "You don't have permission to update this project" };
  }

  // If cancelling, validate cancellation is allowed
  if (newStatus === "cancelled") {
    if (!canCancelProject(project)) {
      return { error: "Project can only be cancelled within 24 hours of start time" };
    }
    if (!cancellationReason) {
      return { error: "Cancellation reason is required" };
    }
  }

  // Update project status
  const updateData: {
    status: string;
    cancelled_at?: string;
    cancellation_reason?: string;
  } = { status: newStatus };
  if (newStatus === "cancelled") {
    updateData.cancelled_at = new Date().toISOString();
    updateData.cancellation_reason = cancellationReason;
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update(updateData)
    .eq("id", projectId);

  if (updateError) {
    console.error("Error updating project status:", updateError);
    return { error: "Failed to update project status" };
  }

  // If cancelling, remove calendar events (non-blocking)
  if (newStatus === "cancelled") {
    try {
      // Remove creator's calendar event
      await removeCalendarEventForProject(projectId);

      // --- SEND CANCELLATION EMAILS ---
      // Fetch all approved signups with user/anonymous details
      const { data: signups } = await supabase
        .from("project_signups")
        .select(`
          id, 
          user_id, 
          anonymous_id,
          user:profiles!user_id(email, full_name),
          anonymous_signup:anonymous_signups!anonymous_id(email, name)
        `)
        .eq("project_id", projectId)
        .eq("status", "approved");

      if (signups && signups.length > 0) {
        console.log(`Sending cancellation emails to ${signups.length} participants`);

        // Prepare email content
        const emailSubject = `Project Cancelled: ${project.title}`;

        // Send emails in parallel
        await Promise.all(signups.map(async (signup) => {
          let email: string | null = null;
          let name: string = "Volunteer";
          let userId: string | undefined = undefined;

          if (signup.user_id && signup.user) {
            // @ts-ignore - Supabase types might be tricky with joins
            email = signup.user.email;
            // @ts-ignore
            name = signup.user.full_name || "Volunteer";
            userId = signup.user_id;
          } else if (signup.anonymous_id && signup.anonymous_signup) {
            // @ts-ignore
            email = signup.anonymous_signup.email;
            // @ts-ignore
            name = signup.anonymous_signup.name || "Volunteer";
          }

          if (email) {
            const emailHtml = `
              <!DOCTYPE html>
              <html>
              <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #e11d48;">Project Cancelled</h2>
                  <p>Hi ${name},</p>
                  <p>We regret to inform you that the project <strong>${project.title}</strong> has been cancelled.</p>
                  
                  <div style="background-color: #fff1f2; border-left: 4px solid #e11d48; padding: 15px; margin: 20px 0;">
                    <p style="margin: 0; font-weight: bold;">Reason for cancellation:</p>
                    <p style="margin: 5px 0 0 0;">${cancellationReason || "No reason provided."}</p>
                  </div>

                  <p>We apologize for any inconvenience this may cause.</p>
                  
                  <p>Best regards,<br>The Let's Assist Team</p>
                </div>
              </body>
              </html>
            `;

            await sendEmail({
              to: email,
              subject: emailSubject,
              html: emailHtml,
              userId: userId,
              type: 'project_updates' // This allows users to opt-out if they really want, or we could force it as transactional
            });
          }
        }));
      }

    } catch (calendarError) {
      console.error("Error in cancellation cleanup (calendar/email):", calendarError);
      // Don't fail the cancellation if cleanup fails
    }
  }

  // Revalidate project pages
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/organization/${project.organization?.id}`);
  revalidatePath('/home');

  return { success: true };
}

export async function deleteProject(projectId: string) {
  const supabase = await createClient();

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    return { error: "You must be logged in to delete a project" };
  }

  // Verify user has permission to delete the project
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if user has permission
  let hasPermission = project.creator_id === user.id;
  if (project.organization && !hasPermission) {
    const { data: orgMember } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization.id)
      .eq("user_id", user.id)
      .single();

    if (orgMember?.role) {
      hasPermission = orgMember.role === "admin"; // Only admins can delete projects
    }
  }

  if (!hasPermission) {
    return { error: "You don't have permission to delete this project" };
  }

  // Delete project documents from storage if they exist
  if (project.documents?.length > 0) {
    const { data: storageData, error: storageError } = await supabase.storage
      .from('project-documents')
      .list();

    if (storageData) {
      const projectFiles = storageData.filter(file =>
        file.name.startsWith(`project_${projectId}`)
      );

      if (projectFiles.length > 0) {
        await supabase.storage
          .from('project-documents')
          .remove(projectFiles.map(file => file.name));
      }
    }
  }

  // Delete cover image if it exists
  if (project.cover_image_url) {
    const fileName = project.cover_image_url.split('/').pop();
    if (fileName) {
      await supabase.storage
        .from('project-images')
        .remove([fileName]);
    }
  }

  // Remove calendar event if it exists (non-blocking)
  try {
    await removeCalendarEventForProject(projectId);
  } catch (calendarError) {
    console.error("Error removing calendar event:", calendarError);
    // Don't fail the deletion if calendar removal fails
  }

  // Delete project from database
  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (deleteError) {
    console.error("Error deleting project:", deleteError);
    return { error: "Failed to delete project" };
  }

  // Revalidate paths
  revalidatePath('/home');
  if (project.organization) {
    revalidatePath(`/organization/${project.organization.id}`);
  }

  return { success: true };
}

export async function updateProject(projectId: string, updates: Partial<Project>) {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { error: "Unauthorized" };
    }

    // Verify project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id")
      .eq("id", projectId)
      .single();

    if (!project || project.creator_id !== user.id) {
      return { error: "Unauthorized" };
    }

    // Update the project
    const { error: updateError } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", projectId);

    if (updateError) throw updateError;

    return { success: true };
  } catch (error) {
    console.error("Error updating project:", error);
    return { error: "Failed to update project" };
  }
}

/**
 * Manually check in a participant by the project creator
 */
export async function checkInParticipant(
  signupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    // Get the signup to verify it exists
    const { data: signup, error: fetchError } = await supabase
      .from("project_signups")
      .select("id, project_id")
      .eq("id", signupId)
      .single();

    if (fetchError || !signup) {
      return {
        success: false,
        error: "Signup record not found"
      };
    }

    // Update the check-in time
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({ check_in_time: now })
      .eq("id", signupId);

    if (updateError) {
      return {
        success: false,
        error: "Failed to update check-in time"
      };
    }

    // Revalidate the project page to reflect the changes
    revalidatePath(`/projects/${signup.project_id}`);

    return { success: true };
  } catch (error) {
    console.error("Error checking in participant:", error);
    return {
      success: false,
      error: "An unexpected error occurred"
    };
  }
}

export async function getUserProfile() {
  const supabase = await createClient();

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "Not authenticated" };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return { error: "Failed to fetch profile" };
    }

    return {
      profile: {
        full_name: profile.full_name || null,
        email: user.email || null,
        phone: profile.phone || null,
      }
    };
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return { error: "An unexpected error occurred" };
  }
}

