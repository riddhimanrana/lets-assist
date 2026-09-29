import { TZDate } from "@date-fns/tz";
import { localDateTime, localDateTimeCandidates } from "./intervals";

/**
 * Normalization for AI-transcribed paper sheet values.
 *
 * The model returns times as loose strings ("9", "9am", "9:00 AM") and never
 * as timestamps: it has no reliable notion of the event's date or timezone.
 * The server composes real instants here from the resolved slot window in the
 * project's timezone. The reviewer resolves missing or ambiguous times.
 */

const TIME_PATTERN =
  /^\s*([0-9]{1,2})(?:[:.]([0-9]{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?\s*$/i;
const MILITARY_PATTERN = /^\s*([01][0-9]|2[0-3])([0-5][0-9])\s*$/;

/** "9" | "9am" | "9:30 PM" | "0930" -> "HH:MM" (24h), or null when unreadable. */
export function normalizeTimeString(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  const military = MILITARY_PATTERN.exec(value);
  if (military) {
    return `${military[1]}:${military[2]}`;
  }

  const match = TIME_PATTERN.exec(value);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, "");

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) {
    return null;
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    const isPm = meridiem.startsWith("p");
    if (isPm) {
      hours = hours === 12 ? 12 : hours + 12;
    } else {
      hours = hours === 12 ? 0 : hours;
    }
  } else if (hours > 23) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface SlotWindow {
  /** Epoch ms, from getAttendanceScheduleWindow. */
  startsAt: number;
  endsAt: number;
}

export interface ResolvedRowWindow {
  checkInMs: number;
  checkOutMs: number;
}

/**
 * Compose a wall-clock "HH:MM" on the slot's local calendar date into an
 * epoch instant in the project timezone.
 */
export function composeSlotInstant(
  window: SlotWindow,
  timezone: string,
  time: string,
): number | null {
  const normalized = normalizeTimeString(time);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);

  try {
    const slotStart = new TZDate(window.startsAt, timezone);
    return new TZDate(
      slotStart.getFullYear(),
      slotStart.getMonth(),
      slotStart.getDate(),
      hours,
      minutes,
      0,
      timezone,
    ).getTime();
  } catch {
    return null;
  }
}

/** Preserve written times. Missing values and overnight dates require review. */
export function resolveRowWindow(options: {
  window: SlotWindow;
  timezone: string;
  timeIn: string | null;
  timeOut: string | null;
}): ResolvedRowWindow | null {
  const { window, timezone, timeIn, timeOut } = options;
  if (!timeIn || !timeOut) return null;
  const checkInMs = composeSlotInstant(window, timezone, timeIn);
  const checkOutMs = composeSlotInstant(window, timezone, timeOut);
  if (checkInMs === null || checkOutMs === null || checkOutMs <= checkInMs)
    return null;
  return { checkInMs, checkOutMs };
}

/** A bare 1..12 clock hour has no AM/PM evidence and stays unresolved. */
export function transcribedTimeInstant(
  window: SlotWindow,
  timezone: string,
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const normalized = normalizeTimeString(raw);
  if (!normalized) return null;
  const hours = Number(normalized.slice(0, 2));
  if (
    hours >= 1 &&
    hours <= 12 &&
    !/[ap]/i.test(raw) &&
    !/^0\d[:.]|^\d{4}$/.test(raw.trim())
  )
    return null;
  const day = localDateTime(
    new Date(window.startsAt).toISOString(),
    timezone,
  ).slice(0, 10);
  const candidates = localDateTimeCandidates(`${day}T${normalized}`, timezone);
  return candidates.length === 1 ? candidates[0] : null;
}
