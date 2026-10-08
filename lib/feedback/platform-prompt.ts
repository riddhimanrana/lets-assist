import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { safeConsole } from "@/lib/safe-console";

export type PlatformRatingContextKind =
  "organizer_project" | "volunteer_signup" | "volunteer_hours";

export type PlatformRatingContext = {
  contextKind: PlatformRatingContextKind;
  contextId: string;
};

/** The database checks context eligibility and the 90-day quiet period. */
export async function getPlatformRatingPromptState(
  userId: string | null | undefined,
  context: PlatformRatingContext,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await getAdminClient().rpc(
      "get_platform_experience_prompt_state",
      {
        p_user_id: userId,
        p_context_kind: context.contextKind,
        p_context_id: context.contextId,
      },
    );
    if (error) {
      safeConsole.error("Platform rating prompt state failed:", error);
      return false;
    }
    return data === true;
  } catch (error) {
    safeConsole.error("Platform rating prompt state failed:", error);
    return false;
  }
}
