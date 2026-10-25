// Existing recurring instances append a date/time suffix to the base event ID.
export const GOOGLE_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{5,1024}$/;

export function googleCalendarEventUrl(
  calendarId: string,
  eventId?: string,
): string {
  if (
    !/^[A-Za-z0-9_.@#-]{1,1024}$/.test(calendarId) ||
    calendarId === "." ||
    calendarId === ".."
  )
    throw new Error("Invalid Google calendar identifier");
  if (eventId !== undefined && !GOOGLE_EVENT_ID_PATTERN.test(eventId)) {
    throw new Error("Invalid Google event identifier");
  }
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId === undefined
    ? base
    : `${base}/${encodeURIComponent(eventId)}`;
}
