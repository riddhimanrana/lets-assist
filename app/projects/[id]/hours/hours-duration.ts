import { parseISO } from "date-fns";

export type HoursDuration = {
  text: string;
  isValid: boolean;
  minutes: number;
};

export function normalizeHoursTimestamp(value: string): string | null {
  const timestamp = parseISO(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

export function calculateHoursDuration(
  checkInISO: string | null,
  checkOutISO: string | null,
): HoursDuration {
  if (!checkInISO || !checkOutISO) {
    return { text: "--:--", isValid: false, minutes: 0 };
  }

  try {
    const checkIn = parseISO(checkInISO);
    const checkOut = parseISO(checkOutISO);
    const diffMilliseconds = checkOut.getTime() - checkIn.getTime();
    const diffMins = Math.round(diffMilliseconds / 60_000);

    if (!Number.isFinite(diffMilliseconds) || !Number.isFinite(diffMins)) {
      return { text: "Error parsing dates", isValid: false, minutes: 0 };
    }

    if (diffMilliseconds <= 0 || diffMins <= 0) {
      return {
        text: "Invalid: Check-out must be after check-in",
        isValid: false,
        minutes: 0,
      };
    }

    if (diffMilliseconds > 24 * 60 * 60 * 1000) {
      return {
        text: `${Math.floor(diffMins / 60)}h ${diffMins % 60}m (Excessive)`,
        isValid: false,
        minutes: diffMins,
      };
    }

    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    return {
      text: `${hours}h ${minutes}m`,
      isValid: true,
      minutes: diffMins,
    };
  } catch {
    return { text: "Error parsing dates", isValid: false, minutes: 0 };
  }
}
