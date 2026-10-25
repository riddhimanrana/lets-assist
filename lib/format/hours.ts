/**
 * Decimal hours as "1h 30m". Zero reads "0h" so an empty total sits in the
 * same unit as the totals beside it, and a whole number of hours drops the
 * minutes. Rounds to the nearest minute. Safe to import from client modules.
 */
export function formatHoursDuration(totalHours: number): string {
  if (!Number.isFinite(totalHours) || totalHours <= 0) return "0h";

  const totalMinutes = Math.round(totalHours * 60);
  if (totalMinutes === 0) return "0h";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
