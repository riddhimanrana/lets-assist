import { afterAll, beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
let authorized = true;
let projectError = false;
let failCalendar = false;
const queryCalls: Array<[string, string, unknown[]]> = [];
const project = {
  id: "project-one",
  event_type: "oneTime",
  schedule: {
    oneTime: { date: "2030-01-01", startTime: "10:00", endTime: "12:00" },
  },
};
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const result = () =>
        table === "organizations"
          ? { data: { name: "Synthetic", username: "synthetic" }, error: null }
          : table === "organization_calendar_syncs"
            ? {
                data: {
                  created_by: "owner",
                  calendar_id: "old@example.test",
                  organization_id: "org",
                },
                error: null,
              }
            : {
                data: projectError ? null : [project],
                error: projectError ? {} : null,
              };
      const query = {
        select: (...args: unknown[]) => {
          queryCalls.push([table, "select", args]);
          return query;
        },
        eq: (...args: unknown[]) => {
          queryCalls.push([table, "eq", args]);
          return query;
        },
        neq: (...args: unknown[]) => {
          queryCalls.push([table, "neq", args]);
          return query;
        },
        or: (...args: unknown[]) => {
          queryCalls.push([table, "or", args]);
          return query;
        },
        order: (...args: unknown[]) => {
          queryCalls.push([table, "order", args]);
          return query;
        },
        limit: (...args: unknown[]) => {
          queryCalls.push([table, "limit", args]);
          return query;
        },
        gt: () => query,
        update: (...args: unknown[]) => {
          queryCalls.push([table, "update", args]);
          return query;
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));
const token = mock(async (..._args: unknown[]) => "fictional");
const ensure = mock(async (..._args: unknown[]) =>
  failCalendar
    ? null
    : { calendarId: "canonical@example.test", created: false },
);
mock.module("@/services/calendar", () => ({
  getGoogleAccessTokenForUser: token,
  organizationCalendarGoogleBinding: (organizationId: string) => ({
    organizationId,
    purpose: "organization_calendar",
  }),
  ensureOrganizationCalendar: ensure,
  formatProjectToCalendarEvent: () => ({ summary: "Synthetic event" }),
}));
mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: async () => ({
    allowed: authorized,
  }),
}));
const plans: unknown[] = [];
const reconcile = mock(
  async (options: {
    load: () => Promise<unknown[]>;
    sourceKinds: string[];
    userId: string;
    calendarId: string;
  }) => {
    try {
      plans.push({
        events: await options.load(),
        kinds: options.sourceKinds,
        owner: options.userId,
        calendar: options.calendarId,
      });
      return {
        success: true,
        createdCount: 1,
        updatedCount: 0,
        removedCount: 0,
      };
    } catch {
      return { success: false, error: "Source failed" };
    }
  },
);
mock.module("@/services/organization-calendar/reconcile", () => ({
  reconcileOrganizationCalendar: reconcile,
}));
const csf = mock(async (_options: unknown) => ({
  success: true,
  createdCount: 0,
  updatedCount: 0,
  removedCount: 0,
}));
mock.module("@/lib/organization/csf-calendar-sync", () => ({
  syncCsfCalendarProjections: csf,
}));
const { syncOrganizationCalendarInternal } = await import("./calendar-sync");
beforeEach(() => {
  authorized = true;
  projectError = false;
  failCalendar = false;
  queryCalls.length = 0;
  plans.length = 0;
  token.mockClear();
  ensure.mockClear();
  reconcile.mockClear();
  csf.mockClear();
});
afterAll(() => mock.restore());
test("revoked owner disables sync before acquiring a provider token", async () => {
  authorized = false;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(token).not.toHaveBeenCalled();
  expect(ensure).not.toHaveBeenCalled();
  expect(
    queryCalls.some(
      ([table, method, args]) =>
        table === "organization_calendar_syncs" &&
        method === "update" &&
        (args[0] as { auto_sync: boolean }).auto_sync === false,
    ),
  ).toBe(true);
});
test("project projection keeps tenancy, publication scope, and source kind at the durable boundary", async () => {
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(true);
  expect(plans).toEqual([
    {
      events: [
        {
          source_kind: "project_schedule",
          source_id: "project-one",
          occurrence_key: "oneTime",
          event: { summary: "Synthetic event" },
        },
      ],
      kinds: ["project_schedule"],
      owner: "owner",
      calendar: "canonical@example.test",
    },
  ]);
  expect(ensure.mock.calls[0][3]).toEqual({
    organizationId: "org",
    userId: "owner",
  });
  expect(queryCalls).toContainEqual([
    "projects",
    "eq",
    ["organization_id", "org"],
  ]);
  expect(queryCalls).toContainEqual([
    "projects",
    "or",
    ["workflow_status.is.null,workflow_status.eq.published"],
  ]);
  expect(csf).toHaveBeenCalledTimes(1);
});
test("source load failure cannot report completion or run the other projection lane", async () => {
  projectError = true;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(plans).toEqual([]);
  expect(csf).not.toHaveBeenCalled();
  expect(
    queryCalls.some(
      ([table, method]) =>
        table === "organization_calendar_syncs" && method === "update",
    ),
  ).toBe(false);
});
test("uncertain destination prevents event reconciliation", async () => {
  failCalendar = true;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(reconcile).not.toHaveBeenCalled();
  expect(csf).not.toHaveBeenCalled();
});
