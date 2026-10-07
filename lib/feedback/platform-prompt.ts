import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

export const PLATFORM_RATING_QUIET_DAYS = 90;

export type PlatformRatingContextKind =
  "organizer_project" | "volunteer_signup" | "volunteer_hours";

type AdminClient = ReturnType<typeof getAdminClient>;

function quietCutoff(now: Date) {
  return new Date(
    now.getTime() - PLATFORM_RATING_QUIET_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

async function hasRecentRating(admin: AdminClient, userId: string, now: Date) {
  // updated_at, not created_at: the hours context reuses one row per user, so a
  // later answer must restart the quiet period.
  const { data, error } = await admin
    .from("feedback")
    .select("id")
    .eq("purpose", "platform_experience")
    .eq("user_id", userId)
    .gte("updated_at", quietCutoff(now))
    .limit(1);
  if (error) throw new Error("Could not read platform rating state.");
  return (data ?? []).length > 0;
}

/**
 * Whether to ask this signed-in user to rate Let's Assist. False when they
 * answered any platform rating in the last 90 days. Fails closed: a read error
 * hides the prompt instead of breaking the page.
 */
export async function getPlatformRatingPromptState(
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!userId) return false;
  try {
    return !(await hasRecentRating(getAdminClient(), userId, now));
  } catch (error) {
    console.error("Platform rating prompt state failed:", error);
    return false;
  }
}

/**
 * Organizer variant. Also false when the project already has a rating, since
 * only the first manager to answer may rate a project.
 */
export async function getOrganizerRatingPromptState(
  userId: string | null | undefined,
  projectId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!userId) return false;
  try {
    const admin = getAdminClient();
    const [recent, existing] = await Promise.all([
      hasRecentRating(admin, userId, now),
      admin
        .from("feedback")
        .select("id")
        .eq("purpose", "platform_experience")
        .eq("context_kind", "organizer_project")
        .eq("context_id", projectId)
        .limit(1),
    ]);
    if (existing.error) throw new Error("Could not read project rating state.");
    return !recent && (existing.data ?? []).length === 0;
  } catch (error) {
    console.error("Organizer rating prompt state failed:", error);
    return false;
  }
}
