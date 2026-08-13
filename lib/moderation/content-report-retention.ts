import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Moderation evidence outlives the reporter's account.
 *
 * Deleting or banning an account used to delete that account's
 * `content_reports` rows, which let a reporter — or an enforcement action
 * against one — erase reports filed about *other* people's content. The
 * retention boundary is: the actor link is removed, the immutable
 * pseudonymous `reporter_reference` and the report body remain, and the
 * database foreign key repeats the same detachment if the auth row is deleted
 * without going through this path.
 */
export async function detachContentReportReporter(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await admin
    .from("content_reports")
    .update({ reporter_id: null })
    .eq("reporter_id", userId);

  if (error) {
    throw new Error(`Failed to detach content reports: ${error.message}`);
  }
}
