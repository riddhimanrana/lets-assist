import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/services/email";
import ProjectCancellation from "@/emails/project-cancellation";
import * as React from "react";

type JobStatus = "pending" | "processing" | "completed" | "failed";

type CancellationJobRow = {
  id: string;
  project_id: string;
  cancelled_at: string;
  cancellation_reason: string;
  status: JobStatus;
  cursor: number;
  attempts: number;
  last_error: string | null;
  created_at?: string;
};

type SignupRow = {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  // Join aliases; shapes depend on PostgREST response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anonymous_signup?: any;
};

type NotificationSettingsRow = {
  user_id: string;
  email_notifications: boolean | null;
  project_updates: boolean | null;
};

function isAuthorized(request: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  const allowedTokens = [expectedToken, cronSecret].filter(
    (value): value is string => Boolean(value)
  );

  if (allowedTokens.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron auth not configured" },
        { status: 500 }
      ),
    };
  }

  if (!authHeader) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  if (!allowedTokens.includes(token)) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true };
}

function isWorkerEnabled(): boolean {
  return process.env.PROJECT_CANCELLATION_WORKER_ENABLED === "true";
}

async function processOneJob(job: CancellationJobRow) {
  const supabase = getAdminClient();
  const nowIso = new Date().toISOString();
  const batchSize = Number(process.env.PROJECT_CANCELLATION_WORKER_BATCH_SIZE ?? "50");

  // Mark as processing (best-effort)
  await supabase
    .from("project_cancellation_jobs")
    .update({
      status: "processing",
      processing_started_at: nowIso,
      attempts: (job.attempts ?? 0) + 1,
      updated_at: nowIso,
    })
    .eq("id", job.id);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", job.project_id)
    .single();

  if (projectError || !project) {
    await supabase
      .from("project_cancellation_jobs")
      .update({
        status: "failed",
        last_error: projectError?.message ?? "Project not found",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      projectId: job.project_id,
      processed: 0,
      emailsSent: 0,
      notificationsCreated: 0,
      errors: [projectError?.message ?? "Project not found"],
    };
  }

  const { data: signups, error: signupsError } = await supabase
    .from("project_signups")
    .select(
      `
        id,
        user_id,
        anonymous_id,
        user:profiles!user_id(email, full_name),
        anonymous_signup:anonymous_signups!anonymous_id(email, name)
      `
    )
    .eq("project_id", job.project_id)
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .range(job.cursor, job.cursor + batchSize - 1);

  if (signupsError) {
    await supabase
      .from("project_cancellation_jobs")
      .update({
        status: "failed",
        last_error: signupsError.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      projectId: job.project_id,
      processed: 0,
      emailsSent: 0,
      notificationsCreated: 0,
      errors: [signupsError.message],
    };
  }

  const signupRows = (signups ?? []) as SignupRow[];
  if (signupRows.length === 0) {
    await supabase
      .from("project_cancellation_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      projectId: job.project_id,
      processed: 0,
      emailsSent: 0,
      notificationsCreated: 0,
      errors: [],
    };
  }

  const userIds = Array.from(
    new Set(signupRows.map((s) => s.user_id).filter((id): id is string => !!id))
  );

  const settingsByUserId = new Map<string, NotificationSettingsRow>();
  if (userIds.length > 0) {
    const { data: settingsRows, error: settingsError } = await supabase
      .from("notification_settings")
      .select("user_id, email_notifications, project_updates")
      .in("user_id", userIds);

    if (!settingsError && settingsRows) {
      for (const row of settingsRows as NotificationSettingsRow[]) {
        settingsByUserId.set(row.user_id, row);
      }
    }
  }

  let emailsSent = 0;
  let notificationsCreated = 0;
  const errors: string[] = [];

  // Process sequentially so we can checkpoint the cursor and reduce duplicate sends on retries.
  for (let i = 0; i < signupRows.length; i++) {
    const signup = signupRows[i];

    let email: string | null = null;
    let name = "Volunteer";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userJoin: any = (signup as any).user;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anonJoin: any = (signup as any).anonymous_signup;

    if (signup.user_id && userJoin) {
      email = userJoin.email ?? null;
      name = userJoin.full_name ?? "Volunteer";
    } else if (signup.anonymous_id && anonJoin) {
      email = anonJoin.email ?? null;
      name = anonJoin.name ?? "Volunteer";
    }

    // Respect settings for in-app notifications (emails are always sent for cancellations).
    const prefs = signup.user_id ? settingsByUserId.get(signup.user_id) : undefined;
    const allowProjectUpdates = prefs?.project_updates !== false;

    // In-app notification (registered users only)
    if (signup.user_id && allowProjectUpdates) {
      const { error: notifError } = await supabase.from("notifications").insert({
        user_id: signup.user_id,
        title: "Project Cancelled",
        body: `The project "${project.title}" has been cancelled.${job.cancellation_reason ? ` Reason: ${job.cancellation_reason}` : ""}`,
        type: "project_updates",
        severity: "warning",
        action_url: `/projects/${job.project_id}`,
        data: {
          projectId: job.project_id,
          event: "project_cancelled",
          cancelledAt: job.cancelled_at,
        },
        displayed: false,
      });

      if (notifError) {
        errors.push(`Notification insert failed for user ${signup.user_id}: ${notifError.message}`);
      } else {
        notificationsCreated++;
      }
    }

    // Email notification (cancellation is treated as transactional)
    const shouldSendEmail = !!email;
    if (shouldSendEmail && email) {
      try {
        const subject = `Project Cancelled: ${project.title}`;

        const { error: emailError } = await sendEmail({
          to: email,
          subject,
          react: React.createElement(ProjectCancellation, {
            volunteerName: name,
            projectName: project.title,
            cancellationReason: job.cancellation_reason,
          }),
          type: "transactional",
        });

        if (emailError) {
          errors.push(`Email send failed for ${email}: ${String(emailError)}`);
        } else {
          emailsSent++;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown email error";
        errors.push(`Email send threw for ${email}: ${message}`);
      }
    }

    // Checkpoint cursor after each processed row to minimize duplicate sends if the worker crashes mid-batch.
    const newCursor = job.cursor + i + 1;
    await supabase
      .from("project_cancellation_jobs")
      .update({ cursor: newCursor, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  }

  const finalCursor = job.cursor + signupRows.length;
  const isComplete = signupRows.length < batchSize;

  await supabase
    .from("project_cancellation_jobs")
    .update({
      status: isComplete ? "completed" : "pending",
      completed_at: isComplete ? new Date().toISOString() : null,
      processing_started_at: null,
      last_error: errors.length ? errors[errors.length - 1] : null,
      updated_at: new Date().toISOString(),
      cursor: finalCursor,
    })
    .eq("id", job.id);

  return {
    jobId: job.id,
    projectId: job.project_id,
    processed: signupRows.length,
    emailsSent,
    notificationsCreated,
    errors,
    cursorStart: job.cursor,
    cursorEnd: finalCursor,
    completed: isComplete,
  };
}

async function processPendingJobs() {
  const supabase = getAdminClient();
  const maxJobs = Number(process.env.PROJECT_CANCELLATION_WORKER_MAX_JOBS ?? "3");

  const { data: jobs, error } = await supabase
    .from("project_cancellation_jobs")
    .select("id, project_id, cancelled_at, cancellation_reason, status, cursor, attempts, last_error, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(maxJobs);

  if (error) {
    return { processedJobs: 0, results: [], error: error.message };
  }

  const results = [];
  for (const job of (jobs ?? []) as CancellationJobRow[]) {
    const res = await processOneJob(job);
    results.push(res);
  }

  return { processedJobs: results.length, results };
}

export async function POST(request: NextRequest) {
  const auth = isAuthorized(request);
  if (!auth.ok) return auth.response;

  if (!isWorkerEnabled()) {
    return NextResponse.json(
      { message: "Project cancellation worker is disabled" },
      { status: 200 }
    );
  }

  try {
    const start = Date.now();
    const result = await processPendingJobs();

    return NextResponse.json(
      {
        message: "Project cancellation worker run complete",
        executionTimeMs: Date.now() - start,
        ...result,
      },
      { status: 200 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Internal server error", message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") {
    const auth = isAuthorized(request);
    if (!auth.ok) return auth.response;

    return NextResponse.json(
      {
        message: "Project cancellation worker is running",
        enabled: isWorkerEnabled(),
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  return POST(request);
}
