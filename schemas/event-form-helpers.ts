/**
 * Pure helpers shared by the browser form and the server actions, so both
 * sides measure a description and judge "in the past" the same way.
 */

/** Longest rich-text markup the form accepts, whatever its text length. */
export const DESCRIPTION_MARKUP_MAX = 50_000;
export const DESCRIPTION_TEXT_MAX = 2000;

/**
 * The text a reader sees in a rich-text description. Tags are dropped before
 * entities are decoded, so typed text such as "&lt;b&gt;" stays text.
 */
export function richTextToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export type WallClock = { date: string; time: string };

function readWallClock(now: Date, timeZone?: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/**
 * The calendar date and 24-hour time it is right now in a timezone. An unknown
 * timezone falls back to the runtime's own zone.
 */
export function getWallClockInTimeZone(
  now: Date = new Date(),
  timeZone?: string,
): WallClock {
  if (timeZone) {
    try {
      return readWallClock(now, timeZone);
    } catch {
      // Fall through to the runtime zone.
    }
  }
  return readWallClock(now);
}

/**
 * Whether a YYYY-MM-DD date and HH:mm time, read in the project's timezone,
 * is already behind us.
 */
export function isDateTimeInPast(
  date: string,
  time: string,
  timeZone?: string,
  now: Date = new Date(),
): boolean {
  if (!date || !time) return false;
  const current = getWallClockInTimeZone(now, timeZone);
  return `${date}T${time}` < `${current.date}T${current.time}`;
}

/** The weekday name for a date in a timezone, for example "Thursday". */
export function getWeekdayInTimeZone(
  now: Date = new Date(),
  timeZone?: string,
): string {
  const format = (zone?: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
    }).format(now);

  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // Fall through to the runtime zone.
    }
  }
  return format();
}
