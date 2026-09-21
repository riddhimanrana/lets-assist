import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { removeSyncedCalendarEvent } from "./calendar-remove-event";
import { removeCalendarEventSchema } from "@/schemas/calendar-schema";

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

test("calendar removal sends the provider ID through the route's DELETE contract", async () => {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: true })));
  const project = {
    id: "database-project",
    creator_calendar_event_id: "google-project-event",
  };
  const signup = {
    id: "database-signup",
    volunteer_calendar_event_id: "google-signup-event",
  };
  await removeSyncedCalendarEvent(project);
  await removeSyncedCalendarEvent(signup);
  for (const [index, [eventId, eventType]] of (
    [
      ["google-project-event", "creator"],
      ["google-signup-event", "volunteer"],
    ] as const
  ).entries()) {
    const [url, options] = fetchSpy.mock.calls[index];
    expect(url).toBe("/api/calendar/remove-event");
    expect(options?.method).toBe("DELETE");
    const payload = JSON.parse(String(options?.body));
    expect(removeCalendarEventSchema.parse(payload)).toEqual({
      event_id: eventId,
      event_type: eventType,
    });
  }
});

test("calendar removal preserves server and transport failures", async () => {
  const event = { creator_calendar_event_id: "google-project-event" };
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ error: "Reconnect your calendar" }), {
      status: 400,
    }),
  );
  await expect(removeSyncedCalendarEvent(event)).rejects.toThrow(
    "Reconnect your calendar",
  );
  fetchSpy.mockRejectedValue(new Error("Network unavailable"));
  await expect(removeSyncedCalendarEvent(event)).rejects.toThrow(
    "Network unavailable",
  );
});
