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

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type LocalInstant =
  | { status: "ok"; instant: Date }
  | { status: "nonexistent" }
  /** The wall-clock span that repeats, as UTC-field milliseconds. */
  | { status: "ambiguous"; repeatsFrom: number; repeatsUntil: number };

/** The zone's wall clock at an instant, encoded as if it were UTC. */
function wallClockAt(instant: number, timeZone: string): number {
  const zoned = new TZDate(instant, timeZone);
  return Date.UTC(
    zoned.getFullYear(),
    zoned.getMonth(),
    zoned.getDate(),
    zoned.getHours(),
    zoned.getMinutes(),
    zoned.getSeconds(),
  );
}

/**
 * Resolves a wall time to the instants it names in the zone: none when clocks
 * jump over it, two when clocks fall back across it, otherwise exactly one.
 */
function localInstant(
  date: string,
  time: string,
  timeZone: string,
): LocalInstant {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  if (!Number.isFinite(wall)) return { status: "nonexistent" };

  // A day either side is past any clock change that could touch this wall
  // time, so these are the zone's offsets before and after it.
  const candidates = [
    ...new Set(
      [wall - DAY_MS, wall + DAY_MS].map(
        (probe) => wall - (wallClockAt(probe, timeZone) - probe),
      ),
    ),
  ]
    // Keep only the instants that really read as this wall time in the zone.
    .filter((instant) => wallClockAt(instant, timeZone) === wall)
    .sort((left, right) => left - right);

  if (candidates.length === 0) return { status: "nonexistent" };
  if (candidates.length === 1) {
    return { status: "ok", instant: new Date(candidates[0]) };
  }

  // The clocks change somewhere after the first reading and no later than the
  // second. Find that minute; the hour that repeats starts on its new reading.
  const [first, second] = candidates;
  const offsetBefore = wall - first;
  let before = first;
  let changed = second;
  while (changed - before > MINUTE_MS) {
    const middle =
      before + Math.floor((changed - before) / 2 / MINUTE_MS) * MINUTE_MS;
    if (wallClockAt(middle, timeZone) - middle === offsetBefore) {
      before = middle;
    } else {
      changed = middle;
    }
  }
  return {
    status: "ambiguous",
    repeatsFrom: wallClockAt(changed, timeZone),
    repeatsUntil: changed + offsetBefore,
  };
}

function clockLabel(wall: number): string {
  const value = new Date(wall);
  const hours = value.getUTCHours();
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

function ambiguousTimeError(
  date: string,
  ambiguous: Extract<LocalInstant, { status: "ambiguous" }>,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const dayStart = Date.UTC(year, month - 1, day);
  // A repeat that touches midnight leaves only one side of it on this date.
  const choices = [
    ...(ambiguous.repeatsFrom > dayStart
      ? [`before ${clockLabel(ambiguous.repeatsFrom)}`]
      : []),
    ...(ambiguous.repeatsUntil < dayStart + DAY_MS
      ? [`after ${clockLabel(ambiguous.repeatsUntil)}`]
      : []),
  ];
  return (
    "That time happens twice on this date because clocks change. " +
    (choices.length > 0
      ? `Enter a time ${choices.join(" or ")}, or split the entry.`
      : "Split the entry.")
  );
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
  if (start.status === "nonexistent" || end.status === "nonexistent") {
    return {
      ok: false,
      error: "This local time does not exist in the selected time zone.",
    } as const;
  }
  // Either reading of a repeated hour would be a guess about hours worked.
  if (start.status === "ambiguous") {
    return { ok: false, error: ambiguousTimeError(data.date, start) } as const;
  }
  if (end.status === "ambiguous") {
    return { ok: false, error: ambiguousTimeError(data.date, end) } as const;
  }
  const duration = end.instant.getTime() - start.instant.getTime();
  if (duration <= 0 || duration > 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      error: "End time must be after start time and within 24 hours.",
    } as const;
  }
  return {
    ok: true,
    data,
    eventStart: start.instant.toISOString(),
    eventEnd: end.instant.toISOString(),
  } as const;
}
