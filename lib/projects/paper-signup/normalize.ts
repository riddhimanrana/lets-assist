import { TZDate } from "@date-fns/tz";

/**
 * Normalization for AI-transcribed paper sheet values.
 *
 * The model returns times as loose strings ("9", "9am", "9:00 AM") and never
 * as timestamps: it has no reliable notion of the event's date or timezone.
 * The server composes real instants here from the resolved slot window in the
 * project's timezone, mirroring the clamping the commit RPC applies again as
 * the authoritative pass.
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

/**
 * Resolve a transcribed in/out pair against the slot window.
 *
 * - A missing time falls back to the slot boundary.
 * - An out-time at or before the in-time is treated as overnight (+1 day),
 *   matching private.resolve_project_schedule_slot.
 * - Both instants are clamped inside the window; a window that collapses to
 *   nothing after clamping is unusable and returns null.
 */
export function resolveRowWindow(options: {
  window: SlotWindow;
  timezone: string;
  timeIn: string | null;
  timeOut: string | null;
}): ResolvedRowWindow | null {
  const { window, timezone, timeIn, timeOut } = options;

  let checkInMs =
    timeIn === null ? window.startsAt : composeSlotInstant(window, timezone, timeIn);
  let checkOutMs =
    timeOut === null ? window.endsAt : composeSlotInstant(window, timezone, timeOut);

  if (checkInMs === null || checkOutMs === null) return null;

  if (checkOutMs <= checkInMs) {
    checkOutMs += 24 * 60 * 60 * 1000;
  }

  checkInMs = Math.max(checkInMs, window.startsAt);
  checkOutMs = Math.min(checkOutMs, window.endsAt);

  if (checkOutMs <= checkInMs) return null;

  return { checkInMs, checkOutMs };
}
