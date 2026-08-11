export type ServerCheckoutTimeResult =
  | { ok: true; checkOutTime: string }
  | {
      ok: false;
      reason: "missing_check_in" | "invalid_check_in" | "check_in_in_future";
    };

/**
 * Derives participant checkout time exclusively from the server clock.
 * The injected clock is for deterministic tests and is never exposed by a
 * Server Action.
 */
export function resolveServerCheckoutTime(
  checkInTime: string | null | undefined,
  now = new Date(),
): ServerCheckoutTimeResult {
  if (!checkInTime) {
    return { ok: false, reason: "missing_check_in" };
  }

  const checkInDate = new Date(checkInTime);
  if (Number.isNaN(checkInDate.getTime())) {
    return { ok: false, reason: "invalid_check_in" };
  }

  if (checkInDate.getTime() > now.getTime()) {
    return { ok: false, reason: "check_in_in_future" };
  }

  return { ok: true, checkOutTime: now.toISOString() };
}
