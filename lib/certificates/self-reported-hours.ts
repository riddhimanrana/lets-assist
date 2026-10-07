import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import {
  isStrictCalendarDate,
  isStrictClockTime,
  isValidIanaTimezone,
} from "@/lib/projects/schedule-validation";

const selfReportedHoursSchema = z.object({
  title: z.string().trim().min(1).max(140),
  creatorName: z.string().trim().min(1).max(140),
  organizationName: z.string().trim().max(140).nullish(),
  date: z.string().refine(isStrictCalendarDate),
  startTime: z.string().refine(isStrictClockTime),
  endTime: z.string().refine(isStrictClockTime),
  timeZone: z.string().max(100).refine(isValidIanaTimezone),
  description: z.string().trim().max(5000).nullish(),
});

function localInstant(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const instant = new TZDate(year, month - 1, day, hours, minutes, 0, timeZone);
  // Reject local times that do not exist during a daylight-saving clock jump.
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.getFullYear() !== year ||
    instant.getMonth() !== month - 1 ||
    instant.getDate() !== day ||
    instant.getHours() !== hours ||
    instant.getMinutes() !== minutes
  )
    return null;
  return new Date(instant.getTime());
}

export function parseSelfReportedHours(input: unknown) {
  const parsed = selfReportedHoursSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "Invalid hours. Check the required fields, date, times, and time zone.",
    } as const;
  }
  const data = parsed.data;
  const start = localInstant(data.date, data.startTime, data.timeZone);
  const end = localInstant(data.date, data.endTime, data.timeZone);
  if (!start || !end) {
    return {
      ok: false,
      error: "This local time does not exist in the selected time zone.",
    } as const;
  }
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      error: "End time must be after start time and within 24 hours.",
    } as const;
  }
  return {
    ok: true,
    data,
    eventStart: start.toISOString(),
    eventEnd: end.toISOString(),
  } as const;
}
