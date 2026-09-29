type SyncedCalendarEvent =
  | { creator_calendar_event_id: string }
  | { volunteer_calendar_event_id: string };

export async function removeSyncedCalendarEvent(event: SyncedCalendarEvent) {
  const creator = "creator_calendar_event_id" in event;
  const response = await fetch("/api/calendar/remove-event", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: creator
        ? event.creator_calendar_event_id
        : event.volunteer_calendar_event_id,
      event_type: creator ? "creator" : "volunteer",
    }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to remove event");
  }
}
