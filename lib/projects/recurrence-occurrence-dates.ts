import { addDays, addMonths, addWeeks, addYears, isAfter } from "date-fns";

/** Upper bound on the occurrence index a search may reach for one series. */
const MAX_OCCURRENCE_INDEX = 1_000_000;

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  end_type: "never" | "on_date" | "after_occurrences";
  end_date?: string | null;
  end_occurrences?: number | null;
  weekdays?: string[];
}

/**
 * The calendar date (YYYY-MM-DD) it is at `instant` where the project takes
 * place. A recurring series is dated in its own zone, so "today" for a series
 * is never the worker host's date. Falls back to UTC only when the zone is
 * missing or is not one the runtime knows.
 */
export function getProjectCalendarDate(
  instant: Date,
  timeZone: string | null | undefined,
): string {
  const dateIn = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const part = (type: string) =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  if (typeof timeZone === "string" && timeZone) {
    try {
      return dateIn(timeZone);
    } catch {
      // Not an IANA zone: use UTC below.
    }
  }
  return dateIn("UTC");
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * The date of an occurrence, counted from the series' first date.
 *
 * Index 0 is the first date itself and index N is N steps after it. Every
 * occurrence is computed from the first date, never from the one before it, so
 * a short month only affects its own occurrence: a series that starts on
 * January 31 lands on February 28, March 31, April 30, and a series that
 * starts on February 29 returns to February 29 in the next leap year.
 *
 * A weekly rule with weekdays visits each chosen weekday left in the first
 * date's week (Sunday to Saturday), then every chosen weekday of each
 * `interval`-th week after it.
 */
export function getOccurrenceDate(
  firstDate: Date,
  rule: RecurrenceRule,
  occurrenceIndex: number,
): Date | null {
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) return null;
  if (occurrenceIndex === 0) return firstDate;

  // Validation ensures the interval is a positive integer before this is
  // reached; anything else is treated as 1.
  const interval =
    typeof rule.interval === "number" && rule.interval >= 1 ? rule.interval : 1;

  switch (rule.frequency) {
    case "daily":
      return addDays(firstDate, occurrenceIndex * interval);
    case "weekly": {
      const targetDays = [
        ...new Set(
          (rule.weekdays ?? [])
            .map((day) => WEEKDAY_INDEX[day.toLowerCase()])
            .filter((day) => day !== undefined),
        ),
      ].sort((left, right) => left - right);
      if (targetDays.length === 0) {
        return addWeeks(firstDate, occurrenceIndex * interval);
      }

      const firstDay = firstDate.getDay();
      const weekStart = addDays(firstDate, -firstDay);
      const laterThisWeek = targetDays.filter((day) => day > firstDay);
      if (occurrenceIndex <= laterThisWeek.length) {
        return addDays(weekStart, laterThisWeek[occurrenceIndex - 1]);
      }

      const offset = occurrenceIndex - laterThisWeek.length - 1;
      const week = 1 + Math.floor(offset / targetDays.length);
      return addDays(
        weekStart,
        7 * interval * week + targetDays[offset % targetDays.length],
      );
    }
    case "monthly":
      return addMonths(firstDate, occurrenceIndex * interval);
    case "yearly":
      return addYears(firstDate, occurrenceIndex * interval);
    default:
      return null;
  }
}

/**
 * The first occurrence index, at or above `minimumIndex`, whose date is after
 * `boundary`. Occurrence dates only move forward, so a doubling search finds
 * it without walking years of history one occurrence at a time.
 */
export function firstOccurrenceIndexAfter(
  firstDate: Date,
  rule: RecurrenceRule,
  boundary: Date,
  minimumIndex = 1,
): number | null {
  const isPastBoundary = (index: number): boolean | null => {
    const date = getOccurrenceDate(firstDate, rule, index);
    return date ? isAfter(date, boundary) : null;
  };

  const atMinimum = isPastBoundary(minimumIndex);
  if (atMinimum === null) return null;
  if (atMinimum) return minimumIndex;

  let low = minimumIndex;
  let high = minimumIndex + 1;
  for (let step = 1; ; step *= 2) {
    if (high > MAX_OCCURRENCE_INDEX) return null;
    const past = isPastBoundary(high);
    if (past === null) return null;
    if (past) break;
    low = high;
    high += step * 2;
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (isPastBoundary(middle)) high = middle;
    else low = middle;
  }

  return high;
}
