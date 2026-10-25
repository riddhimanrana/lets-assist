import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { CalendarSyncError } from "@/services/personal-calendar/reconcile";
const userId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
let owner = userId;
const synchronizePersonalCalendar = mock(async (_input: unknown) => ({
  eventId: "event12345",
  phase: "synced",
}));
mock.module("@/services/personal-calendar", () => ({
  CalendarSyncError,
  synchronizePersonalCalendar,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({
          data: {
            id: projectId,
            creator_id: owner,
            creator_calendar_event_id: "event12345",
            creator_synced_at: null,
          },
          error: null,
        }),
      };
      return builder;
    },
  }),
}));
const { POST } = await import("./route");
beforeEach(() => {
  owner = userId;
  synchronizePersonalCalendar.mockClear();
  synchronizePersonalCalendar.mockImplementation(async () => ({
    eventId: "event12345",
    phase: "synced",
  }));
});
afterAll(() => mock.restore());
const request = (body: unknown) =>
  new Request("https://lets-assist.test/api/calendar/sync-project", {
    method: "POST",
    body: JSON.stringify(body),
  });
describe("creator calendar receipt boundary", () => {
  test("resumes an incomplete stored event instead of rejecting an existing marker", async () => {
    const response = await POST(request({ projectId, userId: "forged" }));
    expect(response.status).toBe(200);
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toMatchObject({
      userId,
      sourceId: projectId,
      sourceKind: "project",
      operation: "sync",
    });
  });
  test("rejects a different project owner before requesting a receipt", async () => {
    owner = "another-actor";
    expect((await POST(request({ project_id: projectId }))).status).toBe(403);
    expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
  });
  test("retains retryable partial progress status", async () => {
    synchronizePersonalCalendar.mockImplementation(async () => {
      throw new CalendarSyncError("Retry to finish", 503);
    });
    expect((await POST(request({ project_id: projectId }))).status).toBe(503);
  });
  test("malformed JSON returns a validation error", async () => {
    const response = await POST(
      new Request("https://lets-assist.test/api/calendar/sync-project", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
  });
});
