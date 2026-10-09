import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { CalendarSyncError } from "@/services/personal-calendar/reconcile";
let userId: string | null;
const synchronizePersonalCalendar = mock(async (_input: unknown) => ({
  eventId: "event12345",
  phase: "removed",
}));
mock.module("@/services/personal-calendar", () => ({
  CalendarSyncError,
  synchronizePersonalCalendar,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  }),
}));
const { DELETE } = await import("./route");
function request(eventId = "event12345", type = "volunteer") {
  return new Request("https://lets-assist.test/api/calendar/remove-event", {
    method: "DELETE",
    body: JSON.stringify({
      event_id: eventId,
      event_type: type,
      userId: "forged-actor",
    }),
  });
}
beforeEach(() => {
  userId = "synthetic-user";
  synchronizePersonalCalendar.mockClear();
  synchronizePersonalCalendar.mockImplementation(async () => ({
    eventId: "event12345",
    phase: "removed",
  }));
});
afterAll(() => mock.restore());
describe("calendar removal boundary", () => {
  test.each([
    "../../other/events/event",
    "..",
    "%2e%2e%2fother",
    "event/name",
    "event?access=token",
    "event#fragment",
    "event\\name",
  ])(
    "refuses unsafe path syntax before invoking the receipt: %s",
    async (id) => {
      expect((await DELETE(request(id))).status).toBe(400);
      expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
    },
  );
  test("requires authentication before requesting an owned receipt", async () => {
    userId = null;
    expect((await DELETE(request())).status).toBe(401);
    expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
  });
  test.each(["creator", "volunteer"])(
    "passes only the session actor and requested %s event",
    async (kind) => {
      expect((await DELETE(request("event12345", kind))).status).toBe(200);
      expect(synchronizePersonalCalendar).toHaveBeenCalledWith({
        userId,
        sourceKind: kind === "creator" ? "project" : "signup",
        operation: "remove",
        expectedEventId: "event12345",
      });
    },
  );
  test.each([403, 404, 409, 503])(
    "preserves receipt denial or uncertainty HTTP%d",
    async (status) => {
      synchronizePersonalCalendar.mockImplementation(async () => {
        throw new CalendarSyncError("Unconfirmed", status);
      });
      expect((await DELETE(request())).status).toBe(status);
    },
  );
  test("rejects invalid event kinds", async () => {
    expect((await DELETE(request("event12345", "other"))).status).toBe(400);
    expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
  });
});
