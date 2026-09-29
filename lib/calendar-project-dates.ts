import type { EventType, ProjectSchedule } from "@/types";
import { isStrictCalendarDate } from "@/lib/projects/schedule-validation";

export function getCalendarProjectDates(
  eventType: EventType,
  schedule: ProjectSchedule | null,
): { start_date: string; end_date: string } | null {
  if (!schedule) return null;
  const dates =
    eventType === "oneTime"
      ? [schedule.oneTime?.date]
      : eventType === "sameDayMultiArea"
        ? [schedule.sameDayMultiArea?.date]
        : eventType === "multiDay" && Array.isArray(schedule.multiDay)
          ? schedule.multiDay.map((day) => day.date)
          : [];
  if (
    !dates.length ||
    dates.some(
      (date) => typeof date !== "string" || !isStrictCalendarDate(date),
    )
  )
    return null;
  const sorted = (dates as string[]).toSorted();
  return { start_date: sorted[0], end_date: sorted[sorted.length - 1] };
}
