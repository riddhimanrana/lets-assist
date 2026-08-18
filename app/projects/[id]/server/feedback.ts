"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { canManageProjectAccess } from "@/lib/projects/management-access";
import { isSuperAdminUser } from "@/lib/auth/super-admin";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { getRequestIp } from "@/lib/ai/parse-project-rate-limit-config";
import { moderateText, notifyAdminFlaggedContent } from "@/services/moderation";
import { headers } from "next/headers";

/**
 * Post-project volunteer feedback. Fully private: readable only by the
 * author and project managers, enforced primarily by RLS
 * (project_feedback policies + app_private guard trigger) — the writes here
 * go through the user-scoped client so the database is the real gate, not
 * this file.
 */

const feedbackInputSchema = z
  .object({
    projectId: z.string().uuid(),
    signupId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

export type ProjectFeedbackEntry = {
  id: string;
  rating: number;
  comment: string | null;
  commentModerationStatus: string;
  volunteerName: string | null;
  submittedVia: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectFeedbackSummary = {
  count: number;
  average: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  attendeeCount: number;
};

async function consumeFeedbackQuota(userId: string): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const requestIp = getRequestIp(requestHeaders);
    const quota = await consumeAiQuota({
      feature: "project-feedback",
      windowSeconds: 3600,
      buckets: [
        { scope: "user", identifier: userId, limit: 10 },
        ...(requestIp
          ? [{ scope: "ip", identifier: requestIp, limit: 30 }]
          : []),
      ],
    });
    return quota.allowed;
  } catch (error) {
    // Metering being down must not block a volunteer's feedback.
    console.error("Feedback rate-limit check failed:", error);
    return true;
  }
}

/**
 * Moderation runs after the row exists so a slow AI call can never lose a
 * volunteer's submission. moderateText fails open (review_required), so an
 * outage degrades to a flagged-for-review comment, never a block.
 */
async function moderateFeedbackComment(
  feedbackId: string,
  comment: string,
  userId: string,
): Promise<void> {
  try {
    const result = await moderateText(comment, userId, feedbackId);
    const status =
      result.action === "blocked"
        ? "blocked"
        : result.flagged || result.action === "review_required"
          ? "flagged"
          : "allowed";

    const admin = getAdminClient();
    const { data: settled, error: settleError } = await admin
      .from("project_feedback")
      .update({
        comment_moderation_status: status,
        comment_flag_reason: status === "allowed" ? null : result.flagReason,
      })
      .eq("id", feedbackId)
      // Bind the asynchronous verdict to the exact text that was moderated.
      // A later edit resets the row to pending, so an older AI response must
      // not settle the newer comment.
      .eq("comment", comment)
      .eq("comment_moderation_status", "pending")
      .select("id")
      .maybeSingle();

    if (settleError) {
      throw settleError;
    }

    if (settled && status !== "allowed") {
      await notifyAdminFlaggedContent(
        feedbackId,
        "project_feedback",
        result.flagReason ?? "flagged",
        result.severity === "high" ? 0.9 : 0.6,
        userId,
      ).catch(() => undefined);
    }
  } catch (error) {
    console.error("Feedback moderation failed:", error);
  }
}

export async function submitProjectFeedback(input: {
  projectId: string;
  signupId: string;
  rating: number;
  comment?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const parsed = feedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid feedback." };
  }
  const { projectId, signupId, rating } = parsed.data;
  const comment = parsed.data.comment?.trim() || null;

  const { user, error: authError } = await getAuthUser({ sensitive: true });
  if (authError || !user) {
    return { success: false, error: "Authentication required." };
  }

  if (!(await consumeFeedbackQuota(user.id))) {
    return {
      success: false,
      error: "Too many submissions right now. Please try again shortly.",
    };
  }

  // User-scoped client: RLS enforces attended-signup eligibility, the
  // completed-project window, and one-rating-per-project.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("project_feedback")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  let feedbackId: string;
  if (existing) {
    const { error: updateError } = await supabase
      .from("project_feedback")
      .update({ rating, comment })
      .eq("id", existing.id);
    if (updateError) {
      return { success: false, error: "Could not update your feedback." };
    }
    feedbackId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("project_feedback")
      .insert({
        project_id: projectId,
        user_id: user.id,
        signup_id: signupId,
        rating,
        comment,
        comment_moderation_status: comment ? "pending" : "not_applicable",
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return {
        success: false,
        error:
          insertError?.code === "42501"
            ? "Feedback opens once the project is completed and only for attendees."
            : "Could not save your feedback.",
      };
    }
    feedbackId = inserted.id;
  }

  if (comment) {
    await moderateFeedbackComment(feedbackId, comment, user.id);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/feedback`);
  return { success: true };
}

const tokenFeedbackSchema = z
  .object({
    requestId: z.string().uuid(),
    token: z.string().min(1).max(4096),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

/**
 * Email-link submission. The HMAC token IS the authorization: nothing from
 * the body is trusted beyond rating and comment, and the write happens with
 * the admin client because the bearer has no session.
 */
export async function submitProjectFeedbackWithToken(input: {
  requestId: string;
  token: string;
  rating: number;
  comment?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const parsed = tokenFeedbackSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid feedback." };
  }
  const { requestId, token, rating } = parsed.data;
  const comment = parsed.data.comment?.trim() || null;

  const { verifyProjectFeedbackToken } =
    await import("@/services/project-feedback-token");
  const payload = verifyProjectFeedbackToken(token);
  if (!payload || payload.requestId !== requestId) {
    return {
      success: false,
      error: "This feedback link is invalid or expired.",
    };
  }

  const admin = getAdminClient();
  const { data: request } = await admin
    .from("project_feedback_requests")
    .select("id, project_id, signup_id, user_id, anonymous_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.project_id !== payload.projectId) {
    return {
      success: false,
      error: "This feedback link is invalid or expired.",
    };
  }
  const subjectMatches =
    payload.subject.kind === "user"
      ? request.user_id === payload.subject.userId
      : request.anonymous_id === payload.subject.anonymousSignupId;
  if (!subjectMatches) {
    return {
      success: false,
      error: "This feedback link is invalid or expired.",
    };
  }

  try {
    const quota = await consumeAiQuota({
      feature: "project-feedback",
      windowSeconds: 3600,
      buckets: [{ scope: "token", identifier: requestId, limit: 10 }],
    });
    if (!quota.allowed) {
      return {
        success: false,
        error: "Too many submissions right now. Please try again shortly.",
      };
    }
  } catch (error) {
    console.error("Token feedback rate-limit check failed:", error);
  }

  const identity = request.user_id
    ? { user_id: request.user_id, anonymous_id: null }
    : { user_id: null, anonymous_id: request.anonymous_id };

  const { data: existing } = await admin
    .from("project_feedback")
    .select("id")
    .eq("project_id", request.project_id)
    .eq(
      request.user_id ? "user_id" : "anonymous_id",
      (request.user_id ?? request.anonymous_id)!,
    )
    .maybeSingle();

  let feedbackId: string;
  if (existing) {
    const { error: updateError } = await admin
      .from("project_feedback")
      .update({
        rating,
        comment,
        // This write uses service_role because the email-link bearer has no
        // session, so the client-edit guard trigger intentionally does not
        // reset moderation for us. Reset first; a moderation outage then
        // leaves the new text pending instead of carrying an old verdict.
        comment_moderation_status: comment ? "pending" : "not_applicable",
        comment_flag_reason: null,
      })
      .eq("id", existing.id);
    if (updateError) {
      return { success: false, error: "Could not update your feedback." };
    }
    feedbackId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await admin
      .from("project_feedback")
      .insert({
        project_id: request.project_id,
        ...identity,
        signup_id: request.signup_id,
        rating,
        comment,
        submitted_via: "email_link",
        comment_moderation_status: comment ? "pending" : "not_applicable",
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return { success: false, error: "Could not save your feedback." };
    }
    feedbackId = inserted.id;
  }

  if (comment) {
    await moderateFeedbackComment(
      feedbackId,
      comment,
      request.user_id ?? request.anonymous_id ?? "anonymous",
    );
  }

  revalidatePath(`/projects/${request.project_id}/feedback`);
  return { success: true };
}

export async function getMyProjectFeedback(projectId: string): Promise<{
  feedback: { rating: number; comment: string | null } | null;
}> {
  "use server";
  const { user, error: authError } = await getAuthUser();
  if (authError || !user) return { feedback: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_feedback")
    .select("rating, comment")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  return { feedback: data ?? null };
}

export async function getProjectFeedbackSummary(projectId: string): Promise<
  | {
      success: true;
      summary: ProjectFeedbackSummary;
      entries: ProjectFeedbackEntry[];
    }
  | { success: false; error: string }
> {
  "use server";
  if (!z.string().uuid().safeParse(projectId).success) {
    return { success: false, error: "Invalid project." };
  }

  const { user, error: authError } = await getAuthUser();
  if (authError || !user) {
    return { success: false, error: "Authentication required." };
  }

  const admin = getAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("creator_id, organization_id, can_be_managed_by_staff")
    .eq("id", projectId)
    .single();
  if (!project) {
    return { success: false, error: "Project not found." };
  }

  let organizationRole: string | null = null;
  if (project.organization_id && project.creator_id !== user.id) {
    const { data: membership } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    organizationRole = membership?.role ?? null;
  }
  if (
    !isSuperAdminUser(user) &&
    !canManageProjectAccess({
      creatorId: project.creator_id,
      userId: user.id,
      organizationRole,
      canBeManagedByStaff: project.can_be_managed_by_staff ?? false,
    })
  ) {
    return { success: false, error: "Not authorized." };
  }

  // Read through the user-scoped client so the SELECT policy is a second
  // gate behind the predicate above.
  const supabase = await createClient();
  const { data: rows, error: rowsError } = await supabase
    .from("project_feedback")
    .select(
      "id, rating, comment, comment_moderation_status, submitted_via, created_at, updated_at, user_id, anonymous_id, profiles(full_name), anonymous_signups(name)",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (rowsError) {
    return { success: false, error: "Could not load feedback." };
  }

  const { count: attendeeCount } = await supabase
    .from("project_signups")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "attended");

  const entries: ProjectFeedbackEntry[] = (rows ?? []).map((row) => {
    const profile = row.profiles as unknown as {
      full_name: string | null;
    } | null;
    const anon = row.anonymous_signups as unknown as {
      name: string | null;
    } | null;
    return {
      id: row.id,
      rating: row.rating,
      // Pending and blocked text fail closed. A pending row can mean the AI
      // verdict could not be durably settled, including after a blocked
      // verdict, so only settled non-blocked states reach organizers.
      comment:
        row.comment_moderation_status === "allowed" ||
        row.comment_moderation_status === "flagged"
          ? row.comment
          : null,
      commentModerationStatus: row.comment_moderation_status,
      volunteerName: profile?.full_name ?? anon?.name ?? null,
      submittedVia: row.submitted_via,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let total = 0;
  for (const entry of entries) {
    const rating = Math.min(Math.max(entry.rating, 1), 5) as 1 | 2 | 3 | 4 | 5;
    distribution[rating] += 1;
    total += rating;
  }

  return {
    success: true,
    summary: {
      count: entries.length,
      average:
        entries.length > 0
          ? Math.round((total / entries.length) * 10) / 10
          : null,
      distribution,
      attendeeCount: attendeeCount ?? 0,
    },
    entries,
  };
}
