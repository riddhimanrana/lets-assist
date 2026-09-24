"use server";

import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyProjectFeedbackToken } from "@/services/project-feedback-token";
import { experienceFeedbackChangeSchema } from "@/lib/feedback/experience";

export async function saveExperienceFeedbackWithToken(
  requestId: string,
  token: string,
  input: unknown,
) {
  const change = experienceFeedbackChangeSchema.safeParse(input);
  if (!z.string().uuid().safeParse(requestId).success || !change.success) {
    return {
      success: false,
      error: "Check your rating or comment and try again.",
    };
  }
  const payload = verifyProjectFeedbackToken(token);
  if (!payload || payload.requestId !== requestId)
    return { success: false, error: "This feedback link has expired." };
  try {
    const admin = getAdminClient();
    const { data: request, error } = await admin
      .from("project_feedback_requests")
      .select("project_id, user_id, anonymous_id, purpose")
      .eq("id", requestId)
      .maybeSingle();
    if (
      error ||
      !request ||
      request.purpose !== "platform_experience" ||
      request.project_id !== payload.projectId ||
      (payload.subject.kind === "user"
        ? request.user_id !== payload.subject.userId
        : request.anonymous_id !== payload.subject.anonymousSignupId)
    ) {
      return { success: false, error: "This feedback link is not available." };
    }
    const result = await admin.rpc("save_platform_experience_from_request", {
      p_request_id: requestId,
      p_rating: "rating" in change.data ? change.data.rating : null,
      p_comment: "comment" in change.data ? change.data.comment : null,
      p_update_comment: "comment" in change.data,
    });
    return result.error
      ? { success: false, error: "Could not save your feedback. Try again." }
      : { success: true };
  } catch {
    return {
      success: false,
      error: "Could not save your feedback. Try again.",
    };
  }
}
