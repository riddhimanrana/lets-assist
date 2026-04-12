import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
// Import React Email template and services
import CertificatePublished from '@/emails/certificate-published';
import * as React from 'react';
import { sendEmail } from '@/services/email';

/**
 * Canonical cron endpoint implementation.
 *
 * This route lives only at /api/cron/auto-publish-hours to avoid duplicate
 * API surfaces and keep GitHub Actions integrations consistent.
 */

// Create a Supabase client for server-side operations without cookies
function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase service credentials are required.");
  }

  return createClient(
    supabaseUrl,
    supabaseKey
  );
}

function getAllowedCronTokens(): string[] {
  const tokens = [process.env.CRON_TOKEN, process.env.AUTO_PUBLISH_SECRET_TOKEN].filter(
    (value): value is string => Boolean(value)
  );

  return tokens;
}

function authorizeCronRequest(
  request: NextRequest
): { ok: true } | { ok: false; response: NextResponse } {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const allowedTokens = getAllowedCronTokens();

  if (allowedTokens.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron auth not configured" },
        { status: 500 }
      ),
    };
  }

  if (!token || !allowedTokens.includes(token)) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true };
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

type SignupProfileRow = {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
};

type SignupAnonymousRow = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
};

type OrganizationRow = {
  name?: string | null;
  verified?: boolean | null;
};

type ProjectCreatorRow = {
  full_name?: string | null;
};

type ProjectRow = {
  id: string;
  title: string;
  location?: string | null;
  published?: Record<string, boolean> | null;
  verification_method?: string | null;
  status?: string | null;
  project_timezone?: string | null;
  creator_id?: string | null;
  profiles?: ProjectCreatorRow | ProjectCreatorRow[] | null;
  organization?: OrganizationRow | OrganizationRow[] | null;
};

type SignupRow = {
  id: string;
  user_id?: string | null;
  anonymous_id?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  profile?: SignupProfileRow | SignupProfileRow[] | null;
  anonymous_signup?: SignupAnonymousRow | SignupAnonymousRow[] | null;
  projects?: ProjectRow | ProjectRow[] | null;
  schedule_id?: string | null;
  project_id?: string | null;
  status?: string | null;
};

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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  
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
        subject: `[Auto-Published] Your volunteer certificate for ${cert.project_title} is ready!`,
        react: React.createElement(CertificatePublished, {
          volunteerName: cert.volunteer_name,
          projectTitle: cert.project_title,
          certificateId: cert.id,
          certificateUrl,
          isAutoPublished: true,
          eventStart: cert.event_start,
          eventEnd: cert.event_end,
          timezone: projectTimezone
        }),
        type: 'transactional'
      });

      if (emailError) {
        console.error(`Error sending email to ${cert.volunteer_email}:`, emailError);
        errors.push(`Failed to send email to ${cert.volunteer_email}: ${emailError}`);
      } else {
        emailsSent++;
        console.log(`Certificate email sent successfully to ${cert.volunteer_email}`);
      }

      // Add a 200ms delay between individual emails to keep Resend/Server happy
      await new Promise(resolve => setTimeout(resolve, 200));
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
  project: ProjectRow,
  sessionId: string,
  signups: SignupRow[],
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
      
      const profile = Array.isArray(signup.profile) ? signup.profile[0] : signup.profile;
      const anonymous = Array.isArray(signup.anonymous_signup)
        ? signup.anonymous_signup[0]
        : signup.anonymous_signup;
      const name = profile?.full_name || anonymous?.name || "Anonymous Volunteer";
      const email = profile?.email || anonymous?.email || null;
      
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
    const creatorProfile = Array.isArray(project.profiles)
      ? project.profiles[0]
      : project.profiles;
    const organization = Array.isArray(project.organization)
      ? project.organization[0]
      : project.organization;
    const creatorName = creatorProfile?.full_name || "Project Organizer";
    const organizationName = organization?.name || null;
    const isOrganizationVerified = organization?.verified || false;

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
      type: 'verified' as const,
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
    const emailResult = await sendCertificatePublishedEmails(
      insertedCerts || [],
      project.project_timezone || undefined
    );
    
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

  } catch (error: unknown) {
    console.error("Unexpected error in processSessionSignups:", error);
    return {
      success: false,
      projectId: project.id,
      sessionId,
      sessionName,
      certificatesCreated: 0,
      emailsSent: 0,
      errors: [error instanceof Error ? error.message : "An unexpected server error occurred"]
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
    const { data, error: signupsError } = await supabase
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

    const eligibleSignups = (data ?? []) as SignupRow[];

    console.log(`Found ${eligibleSignups.length} signups with checkout times in the 48-72 hour window`);

    if (eligibleSignups.length === 0) {
      console.log("No eligible signups found");
      return { processedSessions: 0, successfulSessions: 0, results: [] };
    }

    // Group signups by project_id + schedule_id combination
    const sessionGroups = new Map<string, {
      project: ProjectRow;
      signups: SignupRow[];
      sessionId: string;
      projectId: string;
    }>();

    eligibleSignups.forEach((signup) => {
      const key = `${signup.project_id}-${signup.schedule_id}`;
      
      if (!sessionGroups.has(key)) {
        // Check if this session is already published
        const project = Array.isArray(signup.projects) ? signup.projects[0] : signup.projects;
        if (!project || !signup.schedule_id || !signup.project_id) {
          return;
        }

        const isPublished = Boolean(project.published && project.published[signup.schedule_id]);
        
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
          anonymous_signup: Array.isArray(signup.anonymous_signup)
            ? signup.anonymous_signup[0]
            : signup.anonymous_signup,
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
    const MAX_SESSIONS = 10; // Process at most 10 sessions per run to avoid 429
    let count = 0;

    for (const sessionGroup of sessionGroups.values()) {
      if (count >= MAX_SESSIONS) {
        console.log(`Reached limit of ${MAX_SESSIONS} sessions per run. Skipping remaining sessions.`);
        break;
      }
      count++;
      
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
        
        // Small delay between sessions to avoid rate limiting (Supabase/Rest API)
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: unknown) {
        console.error(`Error processing session ${sessionGroup.sessionId}:`, error);
        results.push({
          success: false,
          projectId: sessionGroup.projectId,
          sessionId: sessionGroup.sessionId,
          sessionName,
          certificatesCreated: 0,
          emailsSent: 0,
          errors: [error instanceof Error ? error.message : "Unknown error"]
        });
      }
    }

    console.log(`Auto-publish process completed: ${successfulSessions}/${sessionGroups.size} sessions processed successfully`);

    return {
      processedSessions: results.length,
      successfulSessions,
      results
    };

  } catch (error: unknown) {
    console.error("Error in processExpiredSessions:", error);
    return { processedSessions: 0, successfulSessions: 0, results: [] };
  }
}

// API Route Handler
export async function POST(request: NextRequest) {
  try {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

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

  } catch (error: unknown) {
    console.error("Error in auto-publish API route:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 }
    );
  }
}

// Also support GET for testing/monitoring
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    return NextResponse.json({
      message: "Auto-publish service is running",
      enabled: process.env.AUTO_PUBLISH_ENABLED === "true",
      timestamp: new Date().toISOString(),
    });
  }

  return POST(request);
}
