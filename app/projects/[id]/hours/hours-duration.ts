import { differenceInSeconds, parseISO } from "date-fns";

export type HoursDuration = {
  text: string;
  isValid: boolean;
  minutes: number;
};

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
    const diffSeconds = differenceInSeconds(checkOut, checkIn);
    const diffMins = Math.round(diffSeconds / 60);

    if (!Number.isFinite(diffSeconds) || !Number.isFinite(diffMins)) {
      return { text: "Error parsing dates", isValid: false, minutes: 0 };
    }

    if (diffSeconds <= 0 || diffMins <= 0) {
      return {
        text: "Invalid: Check-out must be after check-in",
        isValid: false,
        minutes: 0,
      };
    }

    if (diffMins > 24 * 60) {
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
