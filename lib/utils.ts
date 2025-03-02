import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeTo12Hour(time: string): string {
  if (!time) return "";

  // Parse the time string in HH:MM format
  const [hours, minutes] = time.split(":").map(Number);

  if (isNaN(hours) || isNaN(minutes)) {
    return time; // Return the original if format is unexpected
  }

  // Convert to 12-hour format
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12; // Convert 0 to 12 for 12 AM

  // Format with leading zeros for minutes
  return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
}
