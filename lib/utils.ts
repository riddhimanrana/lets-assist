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

/**
 * Format bytes to human readable format
 * @param bytes The number of bytes
 * @returns Formatted string (e.g., "1.2 MB")
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Safely strip HTML tags from a string
 * This function properly handles edge cases that simple regex replacement misses
 * @param html The HTML string to strip
 * @returns Plain text with all HTML removed
 */
export function stripHtml(html: string): string {
  if (typeof html !== 'string') return '';
  
  // Replace common HTML entities first
  let text = html
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  
  // Remove all HTML tags - multiple passes to handle nested/malformed tags
  let previousText = '';
  while (previousText !== text) {
    previousText = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  
  // Remove any remaining < or > characters that might be leftover
  text = text.replace(/[<>]/g, '');
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}
