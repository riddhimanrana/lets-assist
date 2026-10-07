import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let userId: string | null;
let storedOwner: string;
let ownershipError: boolean;
let updateError: boolean;
let eventPresent: boolean;
const queries: {
  table: string;
  filters: Record<string, unknown>;
  mutation: boolean;
}[] = [];
const deleteGoogleCalendarEvent = mock(async () => true);
mock.module("@/services/calendar", () => ({ deleteGoogleCalendarEvent }));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      const query = {
        table,
        filters: {} as Record<string, unknown>,
        mutation: false,
      };
      const builder = {
        select: () => builder,
        update: () => {
          query.mutation = true;
          return builder;
        },
        eq: (key: string, value: unknown) => {
          query.filters[key] = value;
          return builder;
        },
        maybeSingle: async () => {
          queries.push(query);
          if (query.mutation ? updateError : ownershipError)
            return { data: null, error: { code: "fixture" } };
          const owner =
            query.filters[table === "projects" ? "creator_id" : "user_id"];
          const id =
            query.filters[
              table === "projects"
                ? "creator_calendar_event_id"
                : "volunteer_calendar_event_id"
            ];
          if (owner !== storedOwner || id !== "event12345" || !eventPresent)
            return { data: null, error: null };
          if (query.mutation) eventPresent = false;
          return { data: { id: "owned-record" }, error: null };
        },
      };
      return builder;
    },
  }),
}));
const { DELETE } = await import("./route");
function request(eventId = "event12345", type = "volunteer") {
  return new Request("https://lets-assist.test/api/calendar/remove-event", {
    method: "DELETE",
    body: JSON.stringify({ event_id: eventId, event_type: type }),
  });
}
beforeEach(() => {
  userId = "synthetic-user";
  storedOwner = userId;
  ownershipError = false;
  updateError = false;
  eventPresent = true;
  queries.length = 0;
  deleteGoogleCalendarEvent.mockClear();
  deleteGoogleCalendarEvent.mockImplementation(async () => true);
});
afterAll(() => mock.restore());

describe("calendar deletion ownership", () => {
  test.each([
    "../../other/events/event",
    "..",
    "%2e%2e%2fother",
    "event/name",
    "event?access=token",
    "event#fragment",
    "event\\name",
  ])(
    "refuses path syntax before database or provider access: %s",
    async (eventId) => {
      expect((await DELETE(request(eventId))).status).toBe(400);
      expect(queries).toHaveLength(0);
      expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
    },
  );
  test("requires a session before provider access", async () => {
    userId = null;
    expect((await DELETE(request())).status).toBe(401);
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });
  test("refuses another user's event and unrelated IDs", async () => {
    storedOwner = "another-user";
    expect((await DELETE(request())).status).toBe(404);
    storedOwner = "synthetic-user";
    expect((await DELETE(request("other12345"))).status).toBe(404);
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });
  test("fails closed when ownership cannot be established", async () => {
    ownershipError = true;
    expect((await DELETE(request())).status).toBe(503);
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });
  test.each(["creator", "volunteer"])(
    "removes only the authorized %s record and does not replay provider deletion",
    async (type) => {
      expect((await DELETE(request("event12345", type))).status).toBe(200);
      expect(deleteGoogleCalendarEvent).toHaveBeenCalledWith(
        "synthetic-user",
        "event12345",
      );
      expect(queries[1]?.filters.id).toBe("owned-record");
      expect((await DELETE(request("event12345", type))).status).toBe(404);
      expect(deleteGoogleCalendarEvent).toHaveBeenCalledTimes(1);
    },
  );
  test("retains local state on an unconfirmed provider delete", async () => {
    deleteGoogleCalendarEvent.mockImplementation(async () => false);
    expect((await DELETE(request())).status).toBe(500);
    expect(queries.some((query) => query.mutation)).toBe(false);
    expect(eventPresent).toBe(true);
  });
  test("reports provider/local partial state instead of false success", async () => {
    updateError = true;
    expect((await DELETE(request())).status).toBe(409);
    expect(deleteGoogleCalendarEvent).toHaveBeenCalledTimes(1);
    expect(eventPresent).toBe(true);
  });
  test("malformed JSON is a client error", async () => {
    expect(
      (
        await DELETE(
          new Request("https://lets-assist.test/", {
            method: "DELETE",
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });
});
