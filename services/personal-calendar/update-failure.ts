import { CalendarSyncError } from "./reconcile";
import type { PersonalCalendarUpdateFailure } from "./provider";

/** Provider response bodies and account identifiers never enter these messages. */
export function calendarUpdateFailure(reason: PersonalCalendarUpdateFailure) {
  const messages: Record<PersonalCalendarUpdateFailure, string> = {
    calendar_access:
      "Google Calendar ownership could not be verified. Check the connected account and calendar access in Account > Calendar before retrying.",
    event_missing:
      "The saved Google Calendar event could not be read. Check whether it was deleted or moved before retrying.",
    event_identity:
      "The saved event no longer matches this project's sync receipt. Check the entry in Account > Calendar before making another change.",
    event_version:
      "Google did not return a usable event version. Retry when Google Calendar is available.",
    provider_auth:
      "Google rejected the Calendar connection. Reconnect Google in Account > Calendar, then retry this update.",
    provider_permission:
      "Google denied permission to update this calendar. Check the connected Google account and its calendar permissions, then reconnect if needed.",
    provider_conflict:
      "The Google Calendar event changed during this update. Retry to read its latest version and apply the saved project details.",
    provider_rejected:
      "Google rejected the calendar update. The project is saved, but the event remains unconfirmed. Check Account > Calendar before retrying.",
    unconfirmed:
      "Calendar outcome is unconfirmed. Retry to reconcile the same events.",
  };
  return new CalendarSyncError(messages[reason], 503);
}
