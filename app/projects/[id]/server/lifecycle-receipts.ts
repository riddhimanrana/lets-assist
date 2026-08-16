import "server-only";

/**
 * Exact receipt shapes returned by the project lifecycle RPCs.
 *
 * A receipt is only trusted when every field matches one of the sanctioned
 * combinations, so a partial or unexpected payload is treated as no receipt
 * at all rather than a successful transition.
 */

export type CancellationReceipt = {
  outcome:
    "cancelled" | "already_cancelled" | "already_cancelled_review_required";
  jobStatus:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "needs_review"
    | "missing";
  accepted: boolean;
};

export function getExactCancellationReceipt(
  value: unknown,
): CancellationReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const outcome = Reflect.get(value, "outcome");
  const jobStatus = Reflect.get(value, "jobStatus");
  const accepted = Reflect.get(value, "accepted");
  const valid =
    (outcome === "cancelled" && jobStatus === "pending" && accepted === true) ||
    (outcome === "already_cancelled" &&
      ["pending", "processing", "completed"].includes(String(jobStatus)) &&
      accepted === true) ||
    (outcome === "already_cancelled_review_required" &&
      ["needs_review", "failed", "missing"].includes(String(jobStatus)) &&
      accepted === false);

  return valid
    ? ({ outcome, jobStatus, accepted } as CancellationReceipt)
    : null;
}

export type RecurringSeriesEndReceipt = {
  outcome: "ended" | "replayed" | "unchanged";
  endedRecurringSeries: boolean;
  cancelledOccurrences: number;
  calendarCleanupProjectIds: string[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getExactRecurringSeriesEndReceipt(
  value: unknown,
): RecurringSeriesEndReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const outcome = Reflect.get(value, "outcome");
  const endedRecurringSeries = Reflect.get(value, "endedRecurringSeries");
  const cancelledOccurrences = Reflect.get(value, "cancelledOccurrences");
  const calendarCleanupProjectIds = Reflect.get(
    value,
    "calendarCleanupProjectIds",
  );

  if (
    (outcome !== "ended" &&
      outcome !== "replayed" &&
      outcome !== "unchanged") ||
    typeof endedRecurringSeries !== "boolean" ||
    !Number.isSafeInteger(cancelledOccurrences) ||
    (cancelledOccurrences as number) < 0 ||
    !Array.isArray(calendarCleanupProjectIds) ||
    !calendarCleanupProjectIds.every(
      (projectId) =>
        typeof projectId === "string" && UUID_PATTERN.test(projectId),
    )
  ) {
    return null;
  }

  if (
    (outcome === "ended" &&
      (endedRecurringSeries !== true ||
        cancelledOccurrences !== calendarCleanupProjectIds.length)) ||
    (outcome === "replayed" &&
      (endedRecurringSeries !== true || cancelledOccurrences !== 0)) ||
    (outcome === "unchanged" &&
      (endedRecurringSeries !== false ||
        cancelledOccurrences !== 0 ||
        calendarCleanupProjectIds.length !== 0))
  ) {
    return null;
  }

  return {
    outcome,
    endedRecurringSeries,
    cancelledOccurrences: cancelledOccurrences as number,
    calendarCleanupProjectIds,
  };
}
