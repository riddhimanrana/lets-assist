import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";


// Create a Supabase client for server-side operations without cookies
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Types specific to auto-publish functionality
interface AutoPublishResult {
  success: boolean;
  projectId: string;
  sessionId: string;
  sessionName: string;
  certificatesCreated: number;
  emailsSent: number;
  errors: string[];
}

// Calculate duration in minutes with validation
function calculateDuration(checkInISO: string | null, checkOutISO: string | null): {
  isValid: boolean;
  minutes: number;
} {
  if (!checkInISO || !checkOutISO) {
    return { isValid: false, minutes: 0 };
  }
  
  try {
    const checkIn = new Date(checkInISO);
    const checkOut = new Date(checkOutISO);
    
    const diffMs = checkOut.getTime() - checkIn.getTime();
    const diffMins = Math.round(diffMs / (1000 * 60));
    
    // Validation checks
    if (diffMins < 0) return { isValid: false, minutes: 0 };
    if (diffMins > 24 * 60) return { isValid: false, minutes: diffMins }; // More than 24 hours
    
    return { isValid: true, minutes: diffMins };
  } catch {
    return { isValid: false, minutes: 0 };
  }
}

// Generate certificate published email HTML
function generateCertificatePublishedEmailHtml(
  volunteerName: string,
  projectTitle: string,
  certificateId: string,
  siteUrl: string,
  eventStart?: string,
  eventEnd?: string,
  projectTimezone?: string
): string {
  const certificateUrl = `${siteUrl}/certificates/${certificateId}`;
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <title>Your Volunteer Certificate is Ready!</title>
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
          .auto-publish-note {
              background-color: #f0f9ff;
              border: 1px solid #0ea5e9;
              border-radius: 6px;
              padding: 16px;
              margin: 20px 0;
          }
      </style>
  </head>
  <body>
      <div class="email-container">
          <div class="email-body">
              <h1>🎉 Your Certificate is Ready!</h1>
              <p>Hi ${volunteerName},</p>
              <p>Great news! Your volunteer certificate for <strong>${projectTitle}</strong> has been automatically published and is now available to view.</p>
              
              <div class="auto-publish-note">
                  <p style="margin: 0; color: #0369a1; font-weight: 500;">📅 Automatic Publishing</p>
                  <p style="margin: 4px 0 0 0; color: #0369a1; font-size: 14px;">This certificate was automatically generated 48 hours after the event ended, as no manual adjustments were needed.</p>
              </div>
              
              <div class="event-details">
                  <div class="detail-row">
                      <span class="detail-label">Project:</span>
                      <span class="detail-value">${projectTitle}</span>
                  </div>
                  ${eventStart && eventEnd ? (() => {
                    try {
                      const timezone = projectTimezone || 'America/Los_Angeles';
                      const startDate = new Date(eventStart);
                      const endDate = new Date(eventEnd);
                      
                      // Format date
                      const dateStr = startDate.toLocaleDateString('en-US', { 
                        timeZone: timezone,
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      });
                      
                      // Format times with timezone abbreviation
                      const startTimeStr = startDate.toLocaleTimeString('en-US', { 
                        timeZone: timezone,
                        hour: 'numeric', 
                        minute: '2-digit',
                        timeZoneName: 'short'
                      });
                      
                      const endTimeStr = endDate.toLocaleTimeString('en-US', { 
                        timeZone: timezone,
                        hour: 'numeric', 
                        minute: '2-digit',
                        timeZoneName: 'short'
                      });
                      
                      return `
                        <div class="detail-row">
                            <span class="detail-label">Date:</span>
                            <span class="detail-value">${dateStr}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Time:</span>
                            <span class="detail-value">${startTimeStr} - ${endTimeStr}</span>
                        </div>`;
                    } catch {
                      return '';
                    }
                  })() : ''}
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
              <p>&copy; ${new Date().getFullYear()} Riddhiman Rana. All rights reserved.</p>
              <p>Questions? Contact us at <a href="mailto:support@lets-assist.com" style="color: #16a34a; font-weight: 500;">support@lets-assist.com</a></p>
          </div>
      </div>
  </body>
  </html>
  `;
}

// Send certificate published notifications
async function sendCertificatePublishedEmails(
  certificates: Array<{
    id: string;
    volunteer_name: string | null;
    volunteer_email: string | null;
    project_title: string;
    event_start?: string;
    event_end?: string;
  }>,
  projectTimezone?: string
): Promise<{ success: boolean; emailsSent: number; errors: string[] }> {
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
        siteUrl,
        cert.event_start,
        cert.event_end,
        projectTimezone
      );

      const { error: emailError } = await resend.emails.send({
        from: "Let's Assist <certificates@notifications.lets-assist.com>",
        to: [cert.volunteer_email],
        subject: `[Auto-Published] Your volunteer certificate for ${cert.project_title} is ready!`,
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
}

// Process signups directly into certificates
async function processSessionSignups(
  project: any,
  sessionId: string,
  signups: any[],
  sessionName: string
): Promise<AutoPublishResult> {
  const supabase = createServiceClient();
  
  try {
    console.log(`Processing ${signups.length} signups for session ${sessionId}`);
    
    // Process volunteers and validate hours
    const validVolunteers = [];
    
    for (const signup of signups) {
      if (!signup.check_in_time || !signup.check_out_time) {
        continue; // Skip if no valid times
      }
      
      const duration = calculateDuration(signup.check_in_time, signup.check_out_time);
      if (!duration.isValid) {
        continue; // Skip invalid durations
      }
      
      const name = signup.profile?.full_name || signup.anonymous_signup?.name || "Anonymous Volunteer";
      const email = signup.profile?.email || signup.anonymous_signup?.email || null;
      
      validVolunteers.push({
        signupId: signup.id,
        userId: signup.user_id || null,
        name,
        email,
        checkIn: signup.check_in_time,
        checkOut: signup.check_out_time,
        durationMinutes: duration.minutes,
      });
    }
    
    if (validVolunteers.length === 0) {
      console.log(`No valid volunteer hours found for session ${sessionId}`);
      return {
        success: false,
        projectId: project.id,
        sessionId,
        sessionName,
        certificatesCreated: 0,
        emailsSent: 0,
        errors: ["No valid volunteer hours data to publish"]
      };
    }

    console.log(`Processing ${validVolunteers.length} volunteers with valid hours`);

    // Get organization info for certificate generation
    const creatorName = project.profiles?.full_name || "Project Organizer";
    const organizationName = project.organization?.name || null;
    const isOrganizationVerified = project.organization?.verified || false;

    // Prepare certificate data
    const certificatesToInsert = validVolunteers.map(volunteer => ({
      project_id: project.id,
      user_id: volunteer.userId,
      signup_id: volunteer.signupId,
      volunteer_name: volunteer.name,
      volunteer_email: volunteer.email,
      project_title: project.title,
      project_location: project.location,
      event_start: volunteer.checkIn,
      event_end: volunteer.checkOut,
      organization_name: organizationName,
      creator_name: creatorName,
      is_certified: isOrganizationVerified,
      creator_id: project.creator_id,
      check_in_method: project.verification_method,
      schedule_id: sessionId,
    }));

    // Insert certificates into the database
    const { data: insertedCerts, error: insertError } = await supabase
      .from("certificates")
      .insert(certificatesToInsert)
      .select("id, volunteer_name, volunteer_email, project_title, event_start, event_end");

    if (insertError) {
      console.error("Error inserting certificates:", insertError);
      return {
        success: false,
        projectId: project.id,
        sessionId,
        sessionName,
        certificatesCreated: 0,
        emailsSent: 0,
        errors: [`Database error inserting certificates: ${insertError.message}`]
      };
    }

    console.log(`Successfully created ${certificatesToInsert.length} certificates`);

    // Send in-app notifications to volunteers about their published certificates
    if (insertedCerts && insertedCerts.length > 0) {
      console.log(`Sending ${insertedCerts.length} notifications to volunteers`);
      
      const notificationPromises = validVolunteers
        .filter(v => v.userId) // Only send to registered users
        .map(async (volunteer) => {
          try {
            const certificateData = insertedCerts.find(cert => cert.volunteer_name === volunteer.name);
            if (!certificateData) return;

            await supabase
              .from('notifications')
              .insert({
                user_id: volunteer.userId,
                title: "Your Volunteer Hours Have Been Published! 🎉",
                body: `Your volunteer certificate for "${project.title}" is now available. You volunteered for ${Math.floor(volunteer.durationMinutes / 60)} hours and ${volunteer.durationMinutes % 60} minutes.`,
                type: 'project_updates',
                severity: 'success',
                action_url: `/certificates/${certificateData.id}`,
                displayed: false,
                read: false
              });
          } catch (error) {
            console.error(`Failed to send notification to user ${volunteer.userId}:`, error);
          }
        });

      await Promise.allSettled(notificationPromises);
      console.log('Finished sending notifications');
    }

    // Update the project's 'published' status
    const currentPublishedState = (project.published || {}) as Record<string, boolean>;
    const updatedPublishedState = {
      ...currentPublishedState,
      [sessionId]: true,
    };

    const { error: updateProjectError } = await supabase
      .from("projects")
      .update({ published: updatedPublishedState })
      .eq("id", project.id);

    if (updateProjectError) {
      console.error("Error updating project published status:", updateProjectError);
      return {
        success: false,
        projectId: project.id,
        sessionId,
        sessionName,
        certificatesCreated: certificatesToInsert.length,
        emailsSent: 0,
        errors: [`Failed to update project status: ${updateProjectError.message}`]
      };
    }

    console.log(`Updated project published status for session ${sessionId}`);

    // Send email notifications
    const emailResult = await sendCertificatePublishedEmails(insertedCerts || [], project.project_timezone);
    
    console.log(`Email sending completed: ${emailResult.emailsSent} sent, ${emailResult.errors.length} errors`);

    return {
      success: true,
      projectId: project.id,
      sessionId,
      sessionName,
      certificatesCreated: certificatesToInsert.length,
      emailsSent: emailResult.emailsSent,
      errors: emailResult.errors
    };

  } catch (error: any) {
    console.error("Unexpected error in processSessionSignups:", error);
    return {
      success: false,
      projectId: project.id,
      sessionId,
      sessionName,
      certificatesCreated: 0,
      emailsSent: 0,
      errors: [error.message || "An unexpected server error occurred"]
    };
  }
}

// Main function to process signups from 48-72 hours ago
async function processExpiredSessions(): Promise<{
  processedSessions: number;
  successfulSessions: number;
  results: AutoPublishResult[];
}> {
  try {
    const supabase = createServiceClient();
    console.log("Starting auto-publish process...");
    
    // Calculate the time window: volunteers who checked out between 48-72 hours ago
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - (48 * 60 * 60 * 1000));
    const seventyTwoHoursAgo = new Date(now.getTime() - (72 * 60 * 60 * 1000));
    
    console.log(`Looking for signups with check-out times between: ${seventyTwoHoursAgo.toISOString()} and ${fortyEightHoursAgo.toISOString()}`);
    
    // Find signups with check_out_times in the 48-72 hour window
    const { data: eligibleSignups, error: signupsError } = await supabase
      .from("project_signups")
      .select(`
        *,
        profile:profiles!left (
          id,
          full_name,
          email
        ),
        anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey (
          id,
          name,
          email
        ),
        projects!inner (
          *,
          profiles!projects_creator_id_fkey1 (full_name),
          organization:organizations (name, verified)
        )
      `)
      .not("check_out_time", "is", null)
      .not("check_in_time", "is", null)
      .gte("check_out_time", seventyTwoHoursAgo.toISOString())
      .lte("check_out_time", fortyEightHoursAgo.toISOString())
      .in("status", ["attended", "approved"]);

    if (signupsError) {
      console.error("Error fetching eligible signups:", signupsError);
      return { processedSessions: 0, successfulSessions: 0, results: [] };
    }

    console.log(`Found ${eligibleSignups?.length || 0} signups with checkout times in the 48-72 hour window`);

    if (!eligibleSignups || eligibleSignups.length === 0) {
      console.log("No eligible signups found");
      return { processedSessions: 0, successfulSessions: 0, results: [] };
    }

    // Group signups by project_id + schedule_id combination
    const sessionGroups = new Map<string, {
      project: any;
      signups: any[];
      sessionId: string;
      projectId: string;
    }>();

    eligibleSignups.forEach((signup: any) => {
      const key = `${signup.project_id}-${signup.schedule_id}`;
      
      if (!sessionGroups.has(key)) {
        // Check if this session is already published
        const project = signup.projects;
        const isPublished = project.published && project.published[signup.schedule_id];
        
        if (!isPublished && project.verification_method && ['manual', 'qr-code'].includes(project.verification_method) && project.status !== 'cancelled') {
          sessionGroups.set(key, {
            project: {
              ...project,
              profiles: Array.isArray(project.profiles) ? project.profiles[0] : project.profiles,
              organization: Array.isArray(project.organization) ? project.organization[0] : project.organization,
            },
            signups: [],
            sessionId: signup.schedule_id,
            projectId: signup.project_id
          });
        }
      }

      if (sessionGroups.has(key)) {
        sessionGroups.get(key)!.signups.push({
          ...signup,
          profile: Array.isArray(signup.profile) ? signup.profile[0] : signup.profile,
          anonymous_signup: Array.isArray(signup.anonymous_signup) ? signup.anonymous_signup[0] : signup.anonymous_signup,
        });
      }
    });

    console.log(`Found ${sessionGroups.size} unique sessions to process`);

    if (sessionGroups.size === 0) {
      console.log("No unpublished sessions found");
      return { processedSessions: 0, successfulSessions: 0, results: [] };
    }

    // Process each session group
    const results: AutoPublishResult[] = [];
    let successfulSessions = 0;

    for (const [, sessionGroup] of sessionGroups) {
      const sessionName = `${sessionGroup.project.title} - ${sessionGroup.sessionId}`;
      console.log(`Processing session: ${sessionName} (${sessionGroup.signups.length} signups)`);
      
      try {
        const result = await processSessionSignups(sessionGroup.project, sessionGroup.sessionId, sessionGroup.signups, sessionName);
        results.push(result);
        
        if (result.success) {
          successfulSessions++;
          console.log(`✅ Successfully processed session ${sessionGroup.sessionId}: ${result.certificatesCreated} certificates, ${result.emailsSent} emails`);
        } else {
          console.log(`❌ Failed to process session ${sessionGroup.sessionId}: ${result.errors.join(', ')}`);
        }
        
        // Small delay only if we're sending emails to avoid rate limiting
        if (result.emailsSent > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        console.error(`Error processing session ${sessionGroup.sessionId}:`, error);
        results.push({
          success: false,
          projectId: sessionGroup.projectId,
          sessionId: sessionGroup.sessionId,
          sessionName,
          certificatesCreated: 0,
          emailsSent: 0,
          errors: [error.message || "Unknown error"]
        });
      }
    }

    console.log(`Auto-publish process completed: ${successfulSessions}/${sessionGroups.size} sessions processed successfully`);

    return {
      processedSessions: sessionGroups.size,
      successfulSessions,
      results
    };

  } catch (error: any) {
    console.error("Error in processExpiredSessions:", error);
    return { processedSessions: 0, successfulSessions: 0, results: [] };
  }
}

// API Route Handler
export async function POST(request: NextRequest) {
  try {
    // Simple authentication - check for a secret token
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.AUTO_PUBLISH_SECRET_TOKEN;
    
    if (!expectedToken) {
      console.error("AUTO_PUBLISH_SECRET_TOKEN not configured");
      return NextResponse.json(
        { error: "Auto-publish service not configured" },
        { status: 500 }
      );
    }
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      console.log("Unauthorized auto-publish attempt");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if auto-publish is enabled
    if (process.env.AUTO_PUBLISH_ENABLED !== 'true') {
      console.log("Auto-publish is disabled");
      return NextResponse.json(
        { message: "Auto-publish is disabled", processed: 0, successful: 0 },
        { status: 200 }
      );
    }

    console.log("Auto-publish process initiated");
    const startTime = Date.now();
    
    // Process expired sessions
    const result = await processExpiredSessions();
    
    const executionTime = Date.now() - startTime;
    console.log(`Auto-publish process completed in ${executionTime}ms`);

    return NextResponse.json({
      message: "Auto-publish process completed",
      processedSessions: result.processedSessions,
      successfulSessions: result.successfulSessions,
      executionTimeMs: executionTime,
      results: result.results
    }, { status: 200 });

  } catch (error: any) {
    console.error("Error in auto-publish API route:", error);
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    );
  }
}

// Also support GET for testing/monitoring
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.AUTO_PUBLISH_SECRET_TOKEN;
  
  if (!expectedToken || !authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    message: "Auto-publish service is running",
    enabled: process.env.AUTO_PUBLISH_ENABLED === 'true',
    timestamp: new Date().toISOString()
  });
}