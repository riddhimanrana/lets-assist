import { TZDate } from "@date-fns/tz";

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

// Return all possible instants so repeated autumn clock times need a choice.
export function localDateTimeCandidates(
  value: string,
  timezone: string,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  const instant = new TZDate(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    timezone,
  ).getTime();
  if (!Number.isFinite(instant)) return [];
  return [
    ...new Set(
      [-3600000, -1800000, 0, 1800000, 3600000].map((delta) =>
        new Date(instant + delta).toISOString(),
      ),
    ),
  ]
    .filter((iso) => localDateTime(iso, timezone) === value)
    .sort();
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
