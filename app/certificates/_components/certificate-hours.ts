import { safeConsole } from "@/lib/safe-console";

import { differenceInMinutes, endOfDay, parseISO, startOfDay } from "date-fns";

export interface Certificate {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "platform" | "self-reported"; // Optional for backward compatibility
  event_start: string;
  event_end: string;
  credited_minutes?: number | null;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  projects?: {
    project_timezone?: string;
  };
}

export interface CertificatesListProps {
  certificates: Certificate[];
  user: {
    name: string;
    email: string;
  };
}

export type CertificateWithHours = Certificate & { hours: number };
export type DateFilter = "all" | "6months" | "year" | "custom";
export type SortKey = "date" | "hours" | "name";

export function formatTotalDuration(totalHours: number): string {
  if (totalHours <= 0) return "0m"; // Handle zero or negative hours

  // Convert decimal hours to total minutes, rounding to nearest minute
  const totalMinutes = Math.round(totalHours * 60);

  if (totalMinutes === 0) return "0m"; // Handle cases that round down to 0

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  let result = "";
  if (hours > 0) {
    result += `${hours}h`;
  }
  if (remainingMinutes > 0) {
    // Add space if hours were also added
    if (hours > 0) {
      result += " ";
    }
    result += `${remainingMinutes}m`;
  }

  // Fallback in case result is somehow empty
  return result || (totalMinutes > 0 ? "1m" : "0m");
}

// Helper to calculate duration in decimal hours
export function calculateDecimalHours(
  startTimeISO: string,
  endTimeISO: string,
): number {
  try {
    const start = parseISO(startTimeISO);
    const end = parseISO(endTimeISO);
    const minutes = differenceInMinutes(end, start);
    return minutes > 0 ? minutes / 60 : 0;
  } catch (e) {
    safeConsole.error("Error calculating duration:", e);
    return 0; // Return 0 if parsing fails
  }
}

// Calculate hours for a certificate
export const calculateHours = (startTime: string, endTime: string): number => {
  try {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    return Math.round((differenceInMinutes(end, start) / 60) * 10) / 10; // Round to 1 decimal place
  } catch {
    return 0;
  }
};

/** Whether a certificate's issue date falls inside the chosen date range. */
export function isWithinDateFilter(
  issuedAt: string,
  dateFilter: DateFilter,
  startDate: Date | undefined,
  endDate: Date | undefined,
): boolean {
  const issuedDate = new Date(issuedAt);
  const now = new Date();
  switch (dateFilter) {
    case "6months": {
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - 6);
      if (issuedDate < cutoff) return false;
      break;
    }
    case "year": {
      const cutoff = new Date(now);
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      if (issuedDate < cutoff) return false;
      break;
    }
    case "custom": {
      if (startDate) {
        // Use startOfDay to ensure we include the entire start date
        if (issuedDate < startOfDay(startDate)) return false;
      }
      if (endDate) {
        // Use endOfDay to ensure we include the entire end date
        if (issuedDate > endOfDay(endDate)) return false;
      }
      break;
    }
    // "all" or default: no filtering
  }
  return true;
}
