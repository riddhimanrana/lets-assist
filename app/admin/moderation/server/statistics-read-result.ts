import "server-only";

import { safeConsole } from "@/lib/safe-console";
import { safeErrorAttributes } from "@/lib/log-privacy";

export type StatisticsReadResult<T> =
  { data: T; error?: never } | { data?: never; error: string };

type StatisticsResult = {
  error: unknown;
  data: unknown;
  count?: number | null;
};

/** An absent count or row response is unknown, even when no error was supplied. */
export function hasStatisticsResult(
  result: StatisticsResult,
  kind: "count" | "rows" | "completeRows",
) {
  if (result.error != null) return false;
  const validCount =
    typeof result.count === "number" &&
    Number.isSafeInteger(result.count) &&
    result.count >= 0;
  if (kind === "count") return validCount;
  if (!Array.isArray(result.data)) return false;
  return kind === "rows" || (validCount && result.count === result.data.length);
}

/** Compatibility applies to absent schema, never permissions/auth/timeouts. */
export function isMissingModerationStatisticsView(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return ["42P01", "42703", "PGRST205"].includes(String(error.code));
}

export function statisticsReadFailure(
  scope: "reports" | "moderation",
  error: unknown,
) {
  // The existing privacy sink retains reviewed codes, never backend context,
  // provider text or rows. Static event names distinguish the two readers.
  safeConsole.error(
    scope === "reports"
      ? "Report statistics read failed"
      : "Moderation statistics read failed",
    safeErrorAttributes(error),
  );
  return {
    error:
      scope === "reports"
        ? "Unable to load report statistics. Please try again."
        : "Unable to load moderation statistics. Please try again.",
  };
}
