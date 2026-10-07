import { afterAll, describe, expect, mock, test } from "bun:test";
const signupId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const otherProjectId = "33333333-3333-4333-8333-333333333333";
const synchronizePersonalCalendar = mock(async () => ({
  eventId: "event12345",
  phase: "synced",
}));
const tables: string[] = [];
mock.module("@/services/personal-calendar", () => ({
  synchronizePersonalCalendar,
  CalendarSyncError: class extends Error {},
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "synthetic-user" } },
        error: null,
      }),
    },
    from: (table: string) => {
      tables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({
          data: {
            id: signupId,
            project_id: projectId,
            schedule_id: "owned-slot",
          },
          error: null,
        }),
      };
      return builder;
    },
  }),
}));
const { POST } = await import("./route");
afterAll(() => mock.restore());
describe("signup calendar binding", () => {
  test.each([
    { project_id: otherProjectId, schedule_id: "owned-slot" },
    { project_id: projectId, schedule_id: "unrelated-slot" },
  ])(
    "rejects project/schedule supplied independently of the owned signup: %j",
    async (input) => {
      tables.length = 0;
      synchronizePersonalCalendar.mockClear();
      const result = await POST(
        new Request("https://lets-assist.test/api/calendar/add-signup", {
          method: "POST",
          body: JSON.stringify({ signup_id: signupId, ...input }),
        }),
      );
      expect(result.status).toBe(400);
      expect(tables).toEqual(["project_signups"]);
      expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
    },
  );
});
