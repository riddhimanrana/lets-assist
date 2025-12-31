/**
 * Timezone utility functions for handling project times across different timezones
 */

import { parse, format } from 'date-fns';

export interface ProjectScheduleTime {
  date: string; // YYYY-MM-DD format
  startTime: string; // HH:mm format (24-hour)
  endTime: string; // HH:mm format (24-hour)
}

export interface DisplayTime {
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  isNextDay?: boolean; // If the time conversion pushes to next day
}

/**
 * Get user's current timezone
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.error('Error getting user timezone:', error);
    return 'UTC'; // Fallback to UTC
  }
}

/**
 * Check if user is in a different timezone than the project
 * @param projectTimezone - Project's timezone
 * @param userTimezone - User's timezone (optional, will auto-detect)
 * @returns True if user should see timezone badge
 */
export function shouldShowTimezoneBadge(projectTimezone: string, userTimezone?: string): boolean {
  const currentTimezone = userTimezone || getUserTimezone();
  return currentTimezone !== projectTimezone;
}

/**
 * Convert project time (stored in project timezone) to user's timezone for display
 * 
 * @param scheduleTime - The time data from project schedule
 * @param projectTimezone - Timezone where the project is happening (e.g., 'America/Los_Angeles')
 * @param userTimezone - User's current timezone (defaults to detected timezone)
 * @returns DisplayTime object with converted times
 */
export function convertProjectTimeToUserTimezone(
  scheduleTime: ProjectScheduleTime,
  projectTimezone: string,
  _userTimezone?: string
): DisplayTime {
  return {
    ...scheduleTime,
    timezone: projectTimezone,
    isNextDay: false,
  };
}

/**
 * Format time in 12-hour format with AM/PM
 */
export function formatTime12Hour(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const adjustedHours = hours % 12 || 12;
  return `${adjustedHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format date for display
 */
export function formatDateForDisplay(dateString: string): string {
  try {
    const date = parse(dateString, 'yyyy-MM-dd', new Date());
    return format(date, 'EEEE, MMMM d, yyyy');
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString;
  }
}

/**
 * Get timezone abbreviation (e.g., EST, PST)
 */
export function getTimezoneAbbreviation(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    
    const parts = formatter.formatToParts(now);
    const timeZoneName = parts.find(part => part.type === 'timeZoneName');
    return timeZoneName?.value || timezone;
  } catch (error) {
    console.error('Error getting timezone abbreviation:', error);
    return timezone;
  }
}

/**
 * Format complete schedule display with timezone conversion
 * 
 * @param scheduleTime - Original project schedule time
 * @param projectTimezone - Project timezone
 * @param userTimezone - User timezone (optional)
 * @param showOriginal - Whether to show original time in parentheses
 * @returns Formatted string like "2:00 PM - 5:00 PM EST (3:00 PM - 6:00 PM EDT original)"
 */
export function formatScheduleDisplay(
  scheduleTime: ProjectScheduleTime,
  projectTimezone: string,
  userTimezone?: string,
  showOriginal: boolean = false
): string {
  const displayTime = convertProjectTimeToUserTimezone(
    scheduleTime,
    projectTimezone,
    userTimezone
  );
  
  const userTzAbbr = getTimezoneAbbreviation(displayTime.timezone);
  const startTime12 = formatTime12Hour(displayTime.startTime);
  const endTime12 = formatTime12Hour(displayTime.endTime);
  
  let result = `${startTime12} - ${endTime12} ${userTzAbbr}`;
  
  // Add date change indicator
  if (displayTime.isNextDay) {
    result += ' (next day)';
  }
  
  // Add original time if requested and different timezone
  if (showOriginal && projectTimezone !== displayTime.timezone) {
    const projectTzAbbr = getTimezoneAbbreviation(projectTimezone);
    const originalStart = formatTime12Hour(scheduleTime.startTime);
    const originalEnd = formatTime12Hour(scheduleTime.endTime);
    result += ` (${originalStart} - ${originalEnd} ${projectTzAbbr} local)`;
  }
  
  return result;
}

/**
 * Common project timezones for selection - simplified list
 */
export const COMMON_TIMEZONES = [
  // US Timezones
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  // International
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'China (CST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'UTC', label: 'UTC' },
];

/**
 * Map of timezone aliases to help match user's detected timezone to our list
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  'America/Detroit': 'America/New_York',
  'America/Indiana/Indianapolis': 'America/New_York',
  'America/Kentucky/Louisville': 'America/New_York',
  'America/Toronto': 'America/New_York',
  'America/Montreal': 'America/New_York',
  'America/Winnipeg': 'America/Chicago',
  'America/Edmonton': 'America/Denver',
  'America/Vancouver': 'America/Los_Angeles',
  'America/Tijuana': 'America/Los_Angeles',
  'Europe/Berlin': 'Europe/Paris',
  'Europe/Amsterdam': 'Europe/Paris',
  'Europe/Rome': 'Europe/Paris',
  'Europe/Madrid': 'Europe/Paris',
  'Europe/Brussels': 'Europe/Paris',
  'Asia/Bangalore': 'Asia/Kolkata',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Singapore': 'Asia/Shanghai',
  'Asia/Hong_Kong': 'Asia/Shanghai',
  'Asia/Seoul': 'Asia/Tokyo',
  'Australia/Melbourne': 'Australia/Sydney',
  'Australia/Brisbane': 'Australia/Sydney',
};

/**
 * Get the best matching timezone from our list based on user's detected timezone
 */
export function getBestMatchingTimezone(detectedTimezone: string): string {
  // Check if it's directly in our list
  if (COMMON_TIMEZONES.some(tz => tz.value === detectedTimezone)) {
    return detectedTimezone;
  }
  
  // Check aliases
  if (TIMEZONE_ALIASES[detectedTimezone]) {
    return TIMEZONE_ALIASES[detectedTimezone];
  }
  
  // Fallback: try to match by region
  if (detectedTimezone.startsWith('America/')) {
    return 'America/New_York'; // Default US timezone
  }
  if (detectedTimezone.startsWith('Europe/')) {
    return 'Europe/London';
  }
  if (detectedTimezone.startsWith('Asia/')) {
    // Check for India specifically
    if (detectedTimezone.includes('Kolkata') || detectedTimezone.includes('India')) {
      return 'Asia/Kolkata';
    }
    // Check for other major Asian timezones
    if (detectedTimezone.includes('Shanghai') || detectedTimezone.includes('Hong_Kong') || detectedTimezone.includes('Singapore')) {
      return 'Asia/Shanghai';
    }
    if (detectedTimezone.includes('Tokyo') || detectedTimezone.includes('Seoul')) {
      return 'Asia/Tokyo';
    }
    // Default to Tokyo for other Asian timezones
    return 'Asia/Tokyo';
  }
  if (detectedTimezone.startsWith('Australia/') || detectedTimezone.startsWith('Pacific/')) {
    return 'Australia/Sydney';
  }
  
  return 'UTC';
}
