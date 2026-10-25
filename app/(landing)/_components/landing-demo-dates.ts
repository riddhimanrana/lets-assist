import { isStrictCalendarDate } from "@/lib/projects/schedule-validation";

/** Calendar arithmetic on the server's serialized date, independent of DST. */
export function landingDemoDate(anchor: string, offsetDays: number): string {
  if (
    !isStrictCalendarDate(anchor) ||
    !Number.isInteger(offsetDays) ||
    offsetDays < 0 ||
    offsetDays > 366
  )
    throw new Error("Invalid landing demo calendar date.");
  const date = new Date(`${anchor}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function landingDemoSaturday(anchor: string): Date {
  const date = new Date(`${landingDemoDate(anchor, 31)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  return date;
}
