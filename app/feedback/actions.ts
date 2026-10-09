"use server";

import "server-only";
import { z } from "zod";
import { headers } from "next/headers";

import { safeConsole } from "@/lib/safe-console";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { getRequestIp } from "@/lib/ai/parse-project-rate-limit-config";
import { experienceFeedbackChangeSchema } from "@/lib/feedback/experience";

const contextSchema = z
  .object({
    contextKind: z.enum([
      "organizer_project",
      "volunteer_signup",
      "volunteer_hours",
    ]),
    contextId: z.string().uuid(),
  })
  .strict();

const INVALID = "Check your rating or comment and try again.";
const FAILED = "Could not save your feedback. Try again.";

async function withinQuota(userId: string): Promise<boolean> {
  try {
    const requestIp = getRequestIp(await headers());
    const quota = await consumeAiQuota({
      feature: "platform-experience",
      windowSeconds: 3600,
      buckets: [
        { scope: "user", identifier: userId, limit: 20 },
        ...(requestIp
          ? [{ scope: "ip", identifier: requestIp, limit: 60 }]
          : []),
      ],
    });
    return quota.allowed;
  } catch (error) {
    safeConsole.error("Platform rating rate-limit check failed:", error);
    return false;
  }
}

/**
 * Saves an in-app rating of Let's Assist for the signed-in user. The user id
 * always comes from the session. The database function rechecks that the
 * context belongs to that user before it writes.
 */
export async function savePlatformExperience(input: unknown) {
  const { contextKind, contextId, ...rest } =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const context = contextSchema.safeParse({ contextKind, contextId });
  const change = experienceFeedbackChangeSchema.safeParse(rest);
  if (!context.success || !change.success) {
    return { success: false, error: INVALID };
  }
  let auth;
  try {
    auth = await getAuthUser();
  } catch (error) {
    safeConsole.error("Platform rating authentication failed:", error);
    return { success: false, error: FAILED };
  }
  const { user, error: authError } = auth;
  if (authError || !user) {
    return { success: false, error: "Sign in to share feedback." };
  }
  // The hours context is the user's own id; never trust the client's copy.
  if (
    context.data.contextKind === "volunteer_hours" &&
    context.data.contextId !== user.id
  ) {
    return { success: false, error: INVALID };
  }
  if (!(await withinQuota(user.id))) {
    return {
      success: false,
      error: "Too many submissions right now. Please try again shortly.",
    };
  }
  try {
    const result = await getAdminClient().rpc(
      "save_platform_experience_for_user",
      {
        p_user_id: user.id,
        p_context_kind: context.data.contextKind,
        p_context_id: context.data.contextId,
        p_rating: "rating" in change.data ? change.data.rating : null,
        p_comment: "comment" in change.data ? change.data.comment : null,
        p_update_comment: "comment" in change.data,
      },
    );
    if (result.error) {
      safeConsole.error("Platform rating save failed:", result.error);
      return { success: false, error: FAILED };
    }
    return { success: true };
  } catch (error) {
    safeConsole.error("Platform rating save failed:", error);
    return { success: false, error: FAILED };
  }
}
