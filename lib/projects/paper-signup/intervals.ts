import { TZDate, tzOffset } from "@date-fns/tz";

export type AttendanceInterval = {
  checkIn: string | null;
  checkOut: string | null;
};

export function localDateTime(iso: string | null, timezone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  const date = new TZDate(iso, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const dateOffsets = new Map<string, number[]>();
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

function offsetsForLocalDate(value: string, timezone: string): number[] {
  const date = value.slice(0, 10);
  const key = `${timezone}:${date}`;
  const cached = dateOffsets.get(key);
  if (cached) return cached;
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(tzOffset(timezone, new Date(midnight)))) return [];
  const offsets = new Set<number>();
  // Cover the full date's possible UTC instants, including date-line changes.
  // Retain second-based historical offsets returned as fractional minutes.
  for (
    let time = midnight - DAY_MS;
    time <= midnight + 2 * DAY_MS;
    time += MINUTE_MS
  ) {
    const offset = tzOffset(timezone, new Date(time));
    if (Number.isFinite(offset)) offsets.add(Math.round(offset * MINUTE_MS));
  }
  const result = [...offsets];
  if (dateOffsets.size >= 64) {
    const oldest = dateOffsets.keys().next().value;
    if (oldest !== undefined) dateOffsets.delete(oldest);
  }
  dateOffsets.set(key, result);
  return result;
}

// Repeated local clock times require an explicit choice of instant.
export function localDateTimeCandidates(
  value: string,
  timezone: string,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const wallTime = Date.parse(`${value}:00.000Z`);
  if (
    !Number.isFinite(wallTime) ||
    new Date(wallTime).toISOString().slice(0, 16) !== value
  )
    return [];
  return offsetsForLocalDate(value, timezone)
    .map((offset) => wallTime - offset)
    .filter(
      (instant) =>
        instant +
          Math.round(tzOffset(timezone, new Date(instant)) * MINUTE_MS) ===
        wallTime,
    )
    .sort((left, right) => left - right)
    .map((instant) => new Date(instant).toISOString())
    .filter((iso) => localDateTime(iso, timezone) === value);
}

export function inspectAttendanceIntervals(
  intervals: AttendanceInterval[],
  window?: { startsAt: number; endsAt: number } | null,
) {
  const problems: string[] = [];
  let milliseconds = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  if (!intervals.length) problems.push("Add a sign-in and sign-out time.");
  for (const [index, interval] of intervals.entries()) {
    const start = interval.checkIn ? Date.parse(interval.checkIn) : NaN;
    const end = interval.checkOut ? Date.parse(interval.checkOut) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      problems.push(`Visit ${index + 1} needs both times and dates.`);
    } else if (end <= start) {
      problems.push(`Visit ${index + 1} must end after it starts.`);
    } else {
      ranges.push({ start, end });
      milliseconds += end - start;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  if (
    ranges.some(
      (range, index) => index > 0 && range.start < ranges[index - 1].end,
    )
  ) {
    problems.push(
      "Visits overlap. Correct or combine them before recording hours.",
    );
  }
  if (
    ranges.length &&
    ranges[ranges.length - 1].end - ranges[0].start > 86400000
  ) {
    problems.push("Attendance must fit within 24 hours.");
  }
  const minutes = Math.round(milliseconds / 60000);
  if (!problems.length && minutes < 1)
    problems.push("Attendance must total at least one minute.");
  const outsideSession = Boolean(
    window &&
    ranges.some(
      ({ start, end }) => start < window.startsAt || end > window.endsAt,
    ),
  );
  return {
    problems,
    minutes: problems.length ? null : minutes,
    outsideSession,
  };
}

export function readAttendanceIntervals(
  value: unknown,
  start?: string | null,
  end?: string | null,
): AttendanceInterval[] {
  if (Array.isArray(value) && value.length) {
    return value.map((item) => ({
      checkIn: typeof item?.checkIn === "string" ? item.checkIn : null,
      checkOut: typeof item?.checkOut === "string" ? item.checkOut : null,
    }));
  }
  return [{ checkIn: start ?? null, checkOut: end ?? null }];
}
