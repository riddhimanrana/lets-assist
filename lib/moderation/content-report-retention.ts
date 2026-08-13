import type { SupabaseClient } from "@supabase/supabase-js";

export function formatContentReportReporterLabel(
  reporterReference: string | null | undefined,
): string | null {
  if (!reporterReference) return null;
  return `Reporter ${reporterReference.slice(0, 8).toUpperCase()}`;
}

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
  const { error } = await admin.rpc("detach_content_report_reporter", {
    p_reporter_id: userId,
  });

  if (error) {
    throw new Error(`Failed to detach content reports: ${error.message}`);
  }
}
