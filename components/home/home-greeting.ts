export const HOME_GREETING_FALLBACK = "Hi there";

const MAX_FIRST_NAME_LENGTH = 40;
const HOUR_MS = 60 * 60 * 1000;

const weekdayFormatters = new Map<string, Intl.DateTimeFormat | null>();

function weekdayFormatter(timeZone: string) {
  if (!weekdayFormatters.has(timeZone)) {
    let formatter: Intl.DateTimeFormat | null = null;
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone,
      });
    } catch {
      // An unknown IANA name throws a RangeError. The caller gets the fallback.
    }
    weekdayFormatters.set(timeZone, formatter);
  }
  return weekdayFormatters.get(timeZone) ?? null;
}

function validDate(now: Date | number) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The trimmed time zone name when `Intl` accepts it, otherwise `null`. */
export function resolveTimeZone(timeZone: string | null | undefined) {
  const candidate = typeof timeZone === "string" ? timeZone.trim() : "";
  if (!candidate) return null;
  return weekdayFormatter(candidate) ? candidate : null;
}

/**
 * The English weekday name at `now` in `timeZone`, or `null` when either is
 * unusable. The day comes from the named zone only, never from the runtime's
 * own clock zone, so a server in UTC cannot leak its day into the greeting.
 */
export function weekdayInTimeZone(
  now: Date | number,
  timeZone: string | null | undefined,
) {
  const zone = resolveTimeZone(timeZone);
  const date = validDate(now);
  if (!zone || !date) return null;
  return weekdayFormatter(zone)?.format(date) ?? null;
}

/**
 * The first word of a display name. Anything that looks like an email address
 * is rejected so a greeting never shows part of one.
 */
export function greetingFirstName(name: string | null | undefined) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  const first = trimmed.split(/\s+/u)[0];
  if (!first || first.length > MAX_FIRST_NAME_LENGTH) return null;
  return first;
}

/**
 * "Happy <weekday>, <first name>" when both the local weekday and a first
 * name are known. Every other case is the plain fallback.
 */
export function homeGreetingText({
  weekday,
  name,
}: {
  weekday: string | null | undefined;
  name: string | null | undefined;
}) {
  const firstName = greetingFirstName(name);
  if (!weekday || !firstName) return HOME_GREETING_FALLBACK;
  return `Happy ${weekday}, ${firstName}`;
}

export function homeGreeting({
  now,
  timeZone,
  name,
}: {
  now: Date | number;
  timeZone: string | null | undefined;
  name: string | null | undefined;
}) {
  return homeGreetingText({ weekday: weekdayInTimeZone(now, timeZone), name });
}

/**
 * Milliseconds until the weekday may next change in `timeZone`, capped at one
 * hour. The cap keeps the estimate honest across daylight-saving shifts: the
 * caller re-reads the weekday and asks again, so a 23 or 25 hour day corrects
 * itself within the hour. Unusable input also returns the cap.
 */
export function msUntilWeekdayRefresh(
  now: Date | number,
  timeZone: string | null | undefined,
) {
  const zone = resolveTimeZone(timeZone);
  const date = validDate(now);
  if (!zone || !date) return HOUR_MS;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? Number.NaN);
  const elapsed =
    ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000 +
    date.getMilliseconds();
  if (!Number.isFinite(elapsed)) return HOUR_MS;

  const untilMidnight = 24 * HOUR_MS - elapsed;
  return Math.min(Math.max(untilMidnight, 1000), HOUR_MS);
}
