export const NOTIFICATION_DEDUPE_INDEX = "notifications_user_dedupe_key_unique";

type PostgrestErrorLike = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

/**
 * Classify only the unique violation raised by the notification dedupe index.
 * SQLSTATE 23505 alone is too broad: other notification constraints must keep
 * surfacing as errors instead of being mislabeled as successful replays.
 */
export function isNotificationDedupeConflict(
  error: unknown,
  dedupeKey: string | undefined,
): boolean {
  if (!dedupeKey || !error || typeof error !== "object") return false;

  const candidate = error as PostgrestErrorLike;
  if (candidate.code !== "23505") return false;

  return [candidate.message, candidate.details].some(
    (value) =>
      typeof value === "string" && value.includes(NOTIFICATION_DEDUPE_INDEX),
  );
}
