/** Preserve each historical reader's rounding when no canonical total exists. */
export function certificateHours(
  certificate: { credited_minutes?: number | null },
  legacyHours: () => number,
): number {
  return typeof certificate.credited_minutes === "number" &&
    Number.isFinite(certificate.credited_minutes) &&
    certificate.credited_minutes >= 0
    ? certificate.credited_minutes / 60
    : legacyHours();
}
