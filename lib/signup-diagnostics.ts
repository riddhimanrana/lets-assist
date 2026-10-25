import { safeConsole } from "./safe-console";
import { safeErrorAttributes } from "./log-privacy";

export function summarizePostgrestError(error: unknown) {
  return safeErrorAttributes(error);
}

export function logSignupDebug(
  traceId: string,
  step: string,
  details: Record<string, unknown> = {},
) {
  const error = details.error;
  safeConsole.debug("Project signup diagnostic", {
    trace_id: traceId,
    signup_step: step,
    slot_capacity: details.slotCapacity ?? details.maxVolunteers,
    active_count:
      details.activeCount ??
      details.activeCountBeforeInsert ??
      details.currentSignups,
    plugin_count: details.installedPluginCount,
    has_user_id: details.hasUser,
    has_waiver_evidence: details.hasWaiverEvidence,
    is_anonymous: details.isAnonymous,
    ...(error && typeof error === "object"
      ? {
          error_kind: (error as Record<string, unknown>).error_kind,
          error_code: (error as Record<string, unknown>).error_code,
        }
      : {}),
  });
}
