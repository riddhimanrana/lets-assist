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
  userTimezone?: string
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
 * Common project timezones for selection
 */
export const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona Time (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'Europe/London', label: 'Greenwich Mean Time (GMT)' },
  { value: 'Europe/Paris', label: 'Central European Time (CET)' },
  { value: 'Asia/Tokyo', label: 'Japan Time (JST)' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time (AET)' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
];