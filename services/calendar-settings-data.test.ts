import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("./personal-calendar/cleanup", () => ({
  getPersonalCalendarCleanup: async () => [],
}));
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
let legacyReconnectRequired = false;
let creatorRows: unknown[] = [creator];
let signupScheduleId = "oneTime";
let signupProjectOverride: Record<string, unknown> | null = null;
const signupProject = {
  id: "fictional-project",
  title: "Park cleanup",
  event_type: "oneTime" as "oneTime" | "multiDay",
  schedule: {
    oneTime: {
      date: "2039-09-22",
      startTime: "09:00",
      endTime: "10:00",
      volunteers: 10,
    },
  },
  project_timezone: "America/Los_Angeles",
  description: null,
  location: null,
};
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
          const legacy =
            /\b(start_date|end_date|schedule_type|scheduled_start|scheduled_end)\b/.test(
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
                        schedule_id: signupScheduleId,
                        project: [signupProjectOverride ?? signupProject],
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
  hasLegacyGoogleOAuthReconnectRequired: async () => legacyReconnectRequired,
}));
const { getCalendarData } = await import("./calendar-settings-data");
beforeEach(() => {
  reads.length = 0;
  queryError = false;
  legacyReconnectRequired = false;
  creatorRows = [creator];
  signupScheduleId = "oneTime";
  signupProjectOverride = null;
});

test("preserves the reconnect notice for an unbound legacy calendar connection", async () => {
  legacyReconnectRequired = true;
  const result = await getCalendarData("fictional-user");
  expect(result.connection).toBeNull();
  expect(result.legacyReconnectRequired).toBe(true);
});

test("loads creator and signup events from canonical schedule columns within the signed-in user", async () => {
  const result = await getCalendarData("fictional-user");
  expect(result.creatorProjects[0]).toMatchObject({
    start_date: "2039-09-22",
    end_date: "2039-09-24",
    schedule_type: "multiDay",
  });
  expect(result.volunteerSignups[0]).toMatchObject({
    scheduled_start: "2039-09-22T16:00:00.000Z",
    scheduled_end: "2039-09-22T17:00:00.000Z",
    projects: { schedule_type: "oneTime" },
  });
  expect(reads[1].fields).toContain("schedule_id");
  expect(reads[1].fields).toContain("project_timezone");
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

test("keeps incomplete calendar records available for removal without inventing a sync timestamp", async () => {
  const result = await getCalendarData("fictional-user");
  expect(result.creatorProjects[0].creator_calendar_event_id).toBe(
    "fictional-event",
  );
  expect(result.creatorProjects[0].creator_synced_at).toBeNull();
  expect(result.volunteerSignups[0].volunteer_calendar_event_id).toBe(
    "signup-event",
  );
  expect(result.volunteerSignups[0].volunteer_synced_at).toBeNull();
});

test("refuses a signup whose selected schedule no longer exists", async () => {
  signupScheduleId = "removed-slot";
  expect((await getCalendarData("fictional-user")).volunteerSignups).toEqual(
    [],
  );
});

test("uses the selected multi-day signup slot and its project timezone", async () => {
  signupScheduleId = "2039-09-24-1-0";
  signupProjectOverride = {
    ...signupProject,
    event_type: "multiDay",
    schedule: {
      multiDay: [
        {
          date: "2039-09-22",
          slots: [{ startTime: "08:00", endTime: "09:00", volunteers: 10 }],
        },
        {
          date: "2039-09-24",
          slots: [{ startTime: "13:00", endTime: "15:00", volunteers: 10 }],
        },
      ],
    },
  };
  const result = await getCalendarData("fictional-user");
  expect(result.volunteerSignups[0]).toMatchObject({
    scheduled_start: "2039-09-24T20:00:00.000Z",
    scheduled_end: "2039-09-24T22:00:00.000Z",
    projects: { schedule_type: "multiDay" },
  });
});
