import { afterAll, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const SIGNUP = "44444444-4444-4444-8444-444444444444";
let actor: string | null = USER;
let owner = USER;
let creatorEventId: string | null = "creatorevent";
const directCredentials: unknown[][] = [];
const receiptCalls: Array<Record<string, unknown>> = [];
const updateCalls: Array<Record<string, unknown>> = [];
const networkCalls: unknown[] = [];

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: actor ? { id: actor } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      const row =
        table === "project_signups"
          ? {
              id: SIGNUP,
              user_id: owner,
              project_id: PROJECT,
              schedule_id: "oneTime",
              volunteer_calendar_event_id: "volunteerevent",
            }
          : {
              id: PROJECT,
              creator_id: owner,
              creator_calendar_event_id: creatorEventId,
            };
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: row, error: null }),
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return query;
    },
  }),
}));
const calendar = await import("@/services/calendar");
mock.module("@/services/calendar", () => ({
  ...calendar,
  deleteGoogleCalendarEvent: async (...args: unknown[]) => {
    directCredentials.push(args);
    return true;
  },
}));
const personal = await import("@/services/personal-calendar");
mock.module("@/services/personal-calendar", () => ({
  ...personal,
  updatePersonalCalendarProject: async (input: Record<string, unknown>) => {
    updateCalls.push(input);
    if (creatorEventId === null)
      throw new personal.CalendarSyncError("Calendar event changed", 409);
    return { phase: "synced", eventId: creatorEventId };
  },
  synchronizePersonalCalendar: async (input: Record<string, unknown>) => {
    receiptCalls.push(input);
    if (
      input.userId !== actor ||
      owner !== actor ||
      !["creatorevent", "volunteerevent"].includes(
        String(input.expectedEventId),
      )
    ) {
      throw new personal.CalendarSyncError("Calendar ownership refused", 403);
    }
    return { phase: "removed", eventId: input.expectedEventId };
  },
}));
mock.module("@/services/personal-calendar/cleanup", () => ({
  findPersonalCalendarReceiptEvent: async (actorId: string) =>
    actorId === USER ? "creatorevent" : null,
}));
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  networkCalls.push(args);
  return Response.json(
    { error: "No network allowed in this regression" },
    { status: 503 },
  );
}) as typeof fetch;
const helpers = await import("./calendar-helpers");
beforeEach(() => {
  actor = USER;
  owner = USER;
  creatorEventId = "creatorevent";
  directCredentials.length = 0;
  receiptCalls.length = 0;
  updateCalls.length = 0;
  networkCalls.length = 0;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

test("a forged different-user deletion snapshot never selects that user's credential", async () => {
  const result = await helpers.removeCalendarEventForProject(PROJECT, {
    userId: OTHER,
    calendarEventId: "creatorevent",
  });
  expect(result.success).toBe(false);
  expect(directCredentials).toEqual([]);
  expect(receiptCalls.every((input) => input.userId === USER)).toBe(true);
  expect(networkCalls).toEqual([]);
});

test("a signed-out deletion snapshot cannot start provider cleanup", async () => {
  actor = null;
  const result = await helpers.removeCalendarEventForProject(PROJECT, {
    userId: USER,
    calendarEventId: "creatorevent",
  });
  expect(result.success).toBe(false);
  expect(directCredentials).toEqual([]);
  expect(receiptCalls).toEqual([]);
  expect(networkCalls).toEqual([]);
});

test("another creator's visible project is not cleanup authority", async () => {
  owner = OTHER;
  const result = await helpers.removeCalendarEventForProject(PROJECT);
  expect(result.success).toBe(false);
  expect(directCredentials).toEqual([]);
  expect(networkCalls).toEqual([]);
});

test("a caller cannot exchange the canonical project event for an arbitrary ID", async () => {
  const result = await helpers.removeCalendarEventForProject(PROJECT, {
    userId: USER,
    calendarEventId: "unrelatedevent",
  });
  expect(result.success).toBe(false);
  expect(directCredentials).toEqual([]);
  expect(networkCalls).toEqual([]);
});

test("an organizer session cannot delete a volunteer's personal event", async () => {
  owner = OTHER;
  const result = await helpers.removeCalendarEventForSignup(SIGNUP);
  expect(result.success).toBe(false);
  expect(directCredentials).toEqual([]);
  expect(networkCalls).toEqual([]);
});

test("a missing source marker cannot hide an unresolved update receipt", async () => {
  creatorEventId = null;
  const result = await helpers.updateCalendarEventForProject(PROJECT);
  expect(result.success).toBe(false);
  expect(updateCalls).toHaveLength(1);
  expect(networkCalls).toEqual([]);
});

test("an owned unresolved receipt is reconciled even if the source marker was cleared", async () => {
  creatorEventId = null;
  const result = await helpers.removeCalendarEventForProject(PROJECT);
  expect(result.success).toBe(true);
  expect(receiptCalls).toHaveLength(1);
  expect(receiptCalls[0]).toMatchObject({
    userId: USER,
    sourceId: PROJECT,
    expectedEventId: "creatorevent",
    operation: "remove",
  });
  expect(directCredentials).toEqual([]);
});
