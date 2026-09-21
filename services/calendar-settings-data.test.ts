import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const creator = {
  id: "fictional-project",
  title: "Park cleanup",
  description: null,
  event_type: "multiDay",
  schedule: {
    multiDay: [
      { date: "2039-09-24", slots: [] },
      { date: "2039-09-22", slots: [] },
    ],
  },
  location: null,
  creator_calendar_event_id: "fictional-event",
  creator_synced_at: null,
};
let queryError = false;
let creatorRows: unknown[] = [creator];
const reads: { table: string; fields: string; filters: string[][] }[] = [];
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const read = { table, fields: "", filters: [] as string[][] };
      reads.push(read);
      const query = {
        select(fields: string) {
          read.fields = fields;
          return query;
        },
        eq(key: string, value: string) {
          read.filters.push([key, value]);
          return query;
        },
        not() {
          return query;
        },
        then(resolve: (result: unknown) => unknown) {
          const legacy = /\b(start_date|end_date|schedule_type)\b/.test(
            read.fields,
          );
          return Promise.resolve(
            resolve({
              error: queryError || legacy ? { code: "42703" } : null,
              data:
                table === "projects"
                  ? creatorRows
                  : [
                      {
                        id: "fictional-signup",
                        volunteer_calendar_event_id: "signup-event",
                        volunteer_synced_at: null,
                        scheduled_start: "2039-09-22T16:00:00Z",
                        scheduled_end: "2039-09-22T17:00:00Z",
                        project: [
                          {
                            id: "fictional-project",
                            title: "Park cleanup",
                            event_type: "oneTime",
                            description: null,
                            location: null,
                          },
                        ],
                      },
                    ],
            }),
          );
        },
      };
      return query;
    },
  }),
}));
mock.module("@/services/calendar", () => ({
  getCalendarConnection: async () => null,
  hasLegacyGoogleOAuthReconnectRequired: async () => false,
}));
const { getCalendarData } = await import("./calendar-settings-data");
beforeEach(() => {
  reads.length = 0;
  queryError = false;
  creatorRows = [creator];
});

test("loads creator and signup events from canonical schedule columns within the signed-in user", async () => {
  const result = await getCalendarData("fictional-user");
  expect(result.creatorProjects[0]).toMatchObject({
    start_date: "2039-09-22",
    end_date: "2039-09-24",
    schedule_type: "multiDay",
  });
  expect(result.volunteerSignups[0].projects.schedule_type).toBe("oneTime");
  expect(reads[0].filters).toContainEqual(["creator_id", "fictional-user"]);
  expect(reads[1].filters).toContainEqual(["user_id", "fictional-user"]);
});

test("surfaces a failed query instead of showing an empty synced list", async () => {
  queryError = true;
  expect(getCalendarData("fictional-user")).rejects.toThrow(
    "Synced calendar events could not be loaded.",
  );
});

test("does not invent event dates for missing or malformed schedules", async () => {
  creatorRows = [
    { ...creator, schedule: null },
    { ...creator, schedule: { multiDay: [{ date: "2039-02-30" }] } },
  ];
  expect((await getCalendarData("fictional-user")).creatorProjects).toEqual([]);
});
