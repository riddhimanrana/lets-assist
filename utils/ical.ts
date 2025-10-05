/**
 * iCal (RFC 5545) generation utility for calendar events
 * Generates .ics files compatible with Apple Calendar, Google Calendar, Outlook, etc.
 */

import {
  Project,
  EventType,
  OneTimeSchedule,
  MultiDayScheduleDay,
  SameDayMultiAreaSchedule,
  SameDayMultiAreaRole,
} from "@/types";

interface ICalEventData {
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime: Date;
  organizerName?: string;
  organizerEmail?: string;
  url?: string;
  uid?: string;
  sequence?: number; // For updates: increment this number
}

/**
 * Formats a date to iCal format (YYYYMMDDTHHMMSSZ)
 */
function formatICalDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Formats current timestamp for DTSTAMP
 */
function getICalTimestamp(): string {
  return formatICalDate(new Date());
}

/**
 * Escapes text for iCal format
 * Reference: RFC 5545 Section 3.3.11
 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Folds long lines to 75 characters as per RFC 5545
 */
function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }

  const lines: string[] = [];
  let currentLine = line.substring(0, 75);
  let remaining = line.substring(75);

  lines.push(currentLine);

  while (remaining.length > 0) {
    const chunk = remaining.substring(0, 74); // 74 because we add a space
    lines.push(" " + chunk);
    remaining = remaining.substring(74);
  }

  return lines.join("\r\n");
}

/**
 * Generates a unique UID for the calendar event
 */
function generateUID(projectId: string, scheduleId?: string): string {
  const uniquePart = scheduleId ? `${projectId}-${scheduleId}` : projectId;
  return `${uniquePart}@letsassist.app`;
}

/**
 * Creates a single iCal event (VEVENT)
 */
function createICalEvent(eventData: ICalEventData): string {
  const lines: string[] = [];

  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${eventData.uid || generateUID(Date.now().toString())}`);
  lines.push(`DTSTAMP:${getICalTimestamp()}`);
  lines.push(`DTSTART:${formatICalDate(eventData.startTime)}`);
  lines.push(`DTEND:${formatICalDate(eventData.endTime)}`);
  lines.push(`SUMMARY:${escapeICalText(eventData.title)}`);
  
  if (eventData.description) {
    lines.push(`DESCRIPTION:${escapeICalText(eventData.description)}`);
  }
  
  if (eventData.location) {
    lines.push(`LOCATION:${escapeICalText(eventData.location)}`);
  }

  if (eventData.organizerName && eventData.organizerEmail) {
    lines.push(`ORGANIZER;CN=${escapeICalText(eventData.organizerName)}:mailto:${eventData.organizerEmail}`);
  }

  if (eventData.url) {
    lines.push(`URL:${eventData.url}`);
  }

  // Add sequence number for updates (0 for new events)
  lines.push(`SEQUENCE:${eventData.sequence || 0}`);

  // Add status
  lines.push("STATUS:CONFIRMED");

  // Add alarm/reminder (15 minutes before)
  lines.push("BEGIN:VALARM");
  lines.push("TRIGGER:-PT15M");
  lines.push("ACTION:DISPLAY");
  lines.push(`DESCRIPTION:Reminder: ${escapeICalText(eventData.title)}`);
  lines.push("END:VALARM");

  lines.push("END:VEVENT");

  return lines.map(foldLine).join("\r\n");
}

/**
 * Creates the full iCal file content
 */
function createICalFile(events: string[]): string {
  const lines: string[] = [];

  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Let's Assist//Calendar Integration//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  // Add all events
  events.forEach((event) => {
    lines.push(event);
  });

  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

/**
 * Parses time string (HH:MM) and date string (YYYY-MM-DD) into a Date object
 */
function parseDateTime(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
}

/**
 * Generates iCal file for a one-time event
 */
function generateOneTimeEventICal(
  project: Project,
  schedule: OneTimeSchedule,
  organizerName?: string,
  organizerEmail?: string
): string {
  const startTime = parseDateTime(schedule.date, schedule.startTime);
  const endTime = parseDateTime(schedule.date, schedule.endTime);

  const eventData: ICalEventData = {
    title: project.title,
    description: project.description,
    location: project.location,
    startTime,
    endTime,
    organizerName,
    organizerEmail,
    url: `${process.env.NEXT_PUBLIC_SITE_URL}/projects/${project.id}`,
    uid: generateUID(project.id, "oneTime"),
  };

  const event = createICalEvent(eventData);
  return createICalFile([event]);
}

/**
 * Generates iCal file for multi-day events
 */
function generateMultiDayEventICal(
  project: Project,
  scheduleId: string,
  organizerName?: string,
  organizerEmail?: string
): string {
  if (!project.schedule.multiDay) {
    throw new Error("Multi-day schedule not found");
  }

  // Find the specific day and slot
  const events: string[] = [];
  
  project.schedule.multiDay.forEach((day, dayIndex) => {
    day.slots.forEach((slot, slotIndex) => {
      const scheduleIdentifier = `${day.date}-${slotIndex}`;
      
      // Only create event for the requested schedule ID or create all if no specific ID
      if (!scheduleId || scheduleId === scheduleIdentifier) {
        const startTime = parseDateTime(day.date, slot.startTime);
        const endTime = parseDateTime(day.date, slot.endTime);

        const eventData: ICalEventData = {
          title: project.title,
          description: project.description,
          location: project.location,
          startTime,
          endTime,
          organizerName,
          organizerEmail,
          url: `${process.env.NEXT_PUBLIC_SITE_URL}/projects/${project.id}`,
          uid: generateUID(project.id, scheduleIdentifier),
        };

        events.push(createICalEvent(eventData));
      }
    });
  });

  return createICalFile(events);
}

/**
 * Generates iCal file for same-day multi-area events
 */
function generateSameDayMultiAreaEventICal(
  project: Project,
  roleScheduleId: string,
  organizerName?: string,
  organizerEmail?: string
): string {
  if (!project.schedule.sameDayMultiArea) {
    throw new Error("Same-day multi-area schedule not found");
  }

  const schedule = project.schedule.sameDayMultiArea;
  const events: string[] = [];

  schedule.roles.forEach((role) => {
    // Only create event for the requested role or create all if no specific ID
    if (!roleScheduleId || roleScheduleId === role.name) {
      const startTime = parseDateTime(schedule.date, role.startTime);
      const endTime = parseDateTime(schedule.date, role.endTime);

      const eventData: ICalEventData = {
        title: `${project.title} - ${role.name}`,
        description: project.description,
        location: project.location,
        startTime,
        endTime,
        organizerName,
        organizerEmail,
        url: `${process.env.NEXT_PUBLIC_SITE_URL}/projects/${project.id}`,
        uid: generateUID(project.id, role.name),
      };

      events.push(createICalEvent(eventData));
    }
  });

  return createICalFile(events);
}

/**
 * Main function to generate iCal file for a project
 * 
 * @param project - The project object
 * @param scheduleId - The specific schedule/slot ID (optional, generates all if not provided)
 * @param organizerName - Name of the event organizer
 * @param organizerEmail - Email of the event organizer
 * @returns iCal file content as string
 */
export function generateProjectICalFile(
  project: Project,
  scheduleId?: string,
  organizerName?: string,
  organizerEmail?: string
): string {
  switch (project.event_type) {
    case "oneTime":
      if (!project.schedule.oneTime) {
        throw new Error("One-time schedule not found");
      }
      return generateOneTimeEventICal(
        project,
        project.schedule.oneTime,
        organizerName,
        organizerEmail
      );

    case "multiDay":
      return generateMultiDayEventICal(
        project,
        scheduleId || "",
        organizerName,
        organizerEmail
      );

    case "sameDayMultiArea":
      return generateSameDayMultiAreaEventICal(
        project,
        scheduleId || "",
        organizerName,
        organizerEmail
      );

    default:
      throw new Error(`Unsupported event type: ${project.event_type}`);
  }
}

/**
 * Creates a Blob from iCal content for downloading
 */
export function createICalBlob(icalContent: string): Blob {
  return new Blob([icalContent], { type: "text/calendar;charset=utf-8" });
}

/**
 * Triggers download of iCal file
 */
export function downloadICalFile(
  icalContent: string,
  filename: string = "event.ics"
): void {
  const blob = createICalBlob(icalContent);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates a suggested filename for the iCal file
 */
export function generateICalFilename(project: Project, scheduleId?: string): string {
  const sanitizedTitle = project.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  
  const schedulePrefix = scheduleId ? `-${scheduleId}` : "";
  
  return `${sanitizedTitle}${schedulePrefix}.ics`;
}
