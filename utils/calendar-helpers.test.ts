import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { CalendarSyncError } from "@/services/personal-calendar/reconcile";

// Synthetic identifiers used only by the mocked session and stores below.
const ACTOR = "10000000-0000-4000-8000-000000000001";
const VICTIM = "10000000-0000-4000-8000-000000000002";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const SIGNUP = "30000000-0000-4000-8000-000000000001";
const OTHER_SIGNUP = "30000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;
let sessionUser: { id: string } | null = { id: ACTOR };
let queryError: { message: string } | null = null;
const projects = new Map<string, Row>();
const signups = new Map<string, Row>();
const queries: string[] = [];
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: sessionUser }, error: null }),
    },
    from: (table: string) => {
      const filters: Record<string, string> = {};
      queries.push(table);
      const rows = table === "projects" ? projects : signups;
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        not: () => builder,
        maybeSingle: async () => ({
          data: queryError ? null : (rows.get(filters.id) ?? null),
          error: queryError,
        }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data: [...rows.values()].filter(
              (row) =>
                row.project_id === filters.project_id &&
                row.volunteer_calendar_event_id,
            ),
            error: queryError,
          }),
      };
      return builder;
    },
  }),
}));

const synchronizePersonalCalendar = mock(async (_input: unknown) => ({
  eventId: null as string | null,
  phase: "removed" as const,
}));
const updatePersonalCalendarProject = mock(
  async (
    _input: unknown,
  ): Promise<{ eventId: string | null; phase: "synced" | "not_synced" }> => ({
    eventId: "ownevent001",
    phase: "synced",
  }),
);
mock.module("@/services/personal-calendar", () => ({
  CalendarSyncError,
  synchronizePersonalCalendar,
  updatePersonalCalendarProject,
}));
const findPersonalCalendarReceiptEvent = mock(
  async (
    _userId: string,
    _sourceKind: string,
    _sourceId: string,
  ): Promise<string | null> => null,
);
mock.module("@/services/personal-calendar/cleanup", () => ({
  findPersonalCalendarReceiptEvent,
}));

const httpRequests: unknown[] = [];
const savedFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown) => {
  httpRequests.push(url);
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}) as typeof fetch;

const {
  updateCalendarEventForProject,
  removeCalendarEventForProject,
  removeCalendarEventForSignup,
  removeAllVolunteerCalendarEvents,
} = await import("./calendar-helpers");
afterAll(() => {
  globalThis.fetch = savedFetch;
  mock.restore();
});

beforeEach(() => {
  sessionUser = { id: ACTOR };
  queryError = null;
  queries.length = 0;
  httpRequests.length = 0;
  projects.clear();
  signups.clear();
  projects.set(PROJECT, {
    id: PROJECT,
    creator_id: ACTOR,
    title: "Fictional park cleanup",
    creator_calendar_event_id: "ownevent001",
  });
  signups.set(SIGNUP, {
    id: SIGNUP,
    project_id: PROJECT,
    user_id: ACTOR,
    volunteer_calendar_event_id: "ownsignup01",
  });
  synchronizePersonalCalendar.mockClear();
  synchronizePersonalCalendar.mockImplementation(async () => ({
    eventId: null,
    phase: "removed",
  }));
  updatePersonalCalendarProject.mockClear();
  updatePersonalCalendarProject.mockImplementation(async () => ({
    eventId: "ownevent001",
    phase: "synced",
  }));
  findPersonalCalendarReceiptEvent.mockClear();
  findPersonalCalendarReceiptEvent.mockImplementation(async () => null);
});

const noProviderWork = () => {
  expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
  expect(updatePersonalCalendarProject).not.toHaveBeenCalled();
  expect(httpRequests).toHaveLength(0);
};

describe("updateCalendarEventForProject", () => {
  test("uses the session actor and the canonical project, with no HTTP hop", async () => {
    const result = await updateCalendarEventForProject(PROJECT);

    expect(result).toEqual({
      success: true,
      message: "Calendar event updated successfully",
    });
    expect(updatePersonalCalendarProject).toHaveBeenCalledTimes(1);
    expect(updatePersonalCalendarProject.mock.calls[0][0]).toEqual({
      userId: ACTOR,
      project: projects.get(PROJECT),
    });
    expect(httpRequests).toHaveLength(0);
  });

  test("a missing session is refused before any read or provider work", async () => {
    sessionUser = null;

    expect(await updateCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      code: "unauthenticated",
    });
    expect(queries).toHaveLength(0);
    noProviderWork();
  });

  test("a non-creator is refused before provider work", async () => {
    projects.get(PROJECT)!.creator_id = VICTIM;

    expect(await updateCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      code: "not_owner",
    });
    noProviderWork();
  });

  test("a never-synced project is decided by the durable claim, not by its empty marker", async () => {
    projects.get(PROJECT)!.creator_calendar_event_id = null;
    updatePersonalCalendarProject.mockImplementation(async () => ({
      eventId: null,
      phase: "not_synced",
    }));

    expect(await updateCalendarEventForProject(PROJECT)).toEqual({
      success: true,
      message: "No calendar event to update",
    });
    expect(updatePersonalCalendarProject).toHaveBeenCalledTimes(1);
    expect(updatePersonalCalendarProject.mock.calls[0][0]).toMatchObject({
      userId: ACTOR,
    });
    expect(synchronizePersonalCalendar).not.toHaveBeenCalled();
    expect(httpRequests).toHaveLength(0);
  });

  test("an empty marker cannot hide a saved receipt the claim refuses", async () => {
    projects.get(PROJECT)!.creator_calendar_event_id = null;
    updatePersonalCalendarProject.mockImplementation(async () => {
      throw new CalendarSyncError("The calendar entry changed.", 409);
    });

    expect(await updateCalendarEventForProject(PROJECT)).toEqual({
      success: false,
      error: "The calendar entry changed.",
      retryable: true,
    });
    expect(updatePersonalCalendarProject).toHaveBeenCalledTimes(1);
  });

  test("another creator's project with an empty marker still reaches no claim", async () => {
    projects.get(PROJECT)!.creator_id = VICTIM;
    projects.get(PROJECT)!.creator_calendar_event_id = null;

    expect(await updateCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      code: "not_owner",
    });
    noProviderWork();
  });

  test("a receipt with nothing to update is not reported as an update", async () => {
    updatePersonalCalendarProject.mockImplementation(async () => ({
      eventId: null,
      phase: "not_synced",
    }));

    expect(await updateCalendarEventForProject(PROJECT)).toEqual({
      success: true,
      message: "No calendar event to update",
    });
  });

  test.each([
    ["not-a-uuid", 0],
    ["20000000-0000-4000-8000-000000000099", 1],
  ])("an unknown project %s is not found", async (projectId, reads) => {
    expect(await updateCalendarEventForProject(projectId)).toMatchObject({
      success: false,
      code: "not_found",
    });
    expect(queries).toHaveLength(reads);
    noProviderWork();
  });

  test("a calendar refusal is returned truthfully with its retry hint", async () => {
    updatePersonalCalendarProject.mockImplementation(async () => {
      throw new CalendarSyncError("Retry to apply the latest details.", 409);
    });
    expect(await updateCalendarEventForProject(PROJECT)).toEqual({
      success: false,
      error: "Retry to apply the latest details.",
      retryable: true,
    });

    updatePersonalCalendarProject.mockImplementation(async () => {
      throw new CalendarSyncError("Project schedule not found", 400);
    });
    expect(await updateCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      retryable: false,
    });
  });

  test("an unexpected failure never returns internal details", async () => {
    updatePersonalCalendarProject.mockImplementation(async () => {
      throw new Error("fictional-secret-token leaked by a provider client");
    });

    const result = await updateCalendarEventForProject(PROJECT);

    expect(result).toEqual({
      success: false,
      error: "Failed to update calendar event",
      retryable: true,
    });
  });
});

describe("removeCalendarEventForProject", () => {
  test("a forged snapshot naming another user is denied before any read or provider work", async () => {
    const result = await removeCalendarEventForProject(PROJECT, {
      userId: VICTIM,
      calendarEventId: "victimevent1",
    });

    expect(result).toMatchObject({ success: false, code: "not_owner" });
    expect(queries).toHaveLength(0);
    expect(findPersonalCalendarReceiptEvent).not.toHaveBeenCalled();
    noProviderWork();
  });

  test("a snapshot cannot claim ownership of another creator's project", async () => {
    projects.get(PROJECT)!.creator_id = VICTIM;

    const result = await removeCalendarEventForProject(PROJECT, {
      userId: ACTOR,
      calendarEventId: "ownevent001",
    });

    expect(result).toMatchObject({ success: false, code: "not_owner" });
    noProviderWork();
  });

  test("a snapshot naming a different event than the canonical marker is refused", async () => {
    const result = await removeCalendarEventForProject(PROJECT, {
      userId: ACTOR,
      calendarEventId: "forgedevent1",
    });

    expect(result).toMatchObject({ success: false, code: "conflict" });
    noProviderWork();
  });

  test("a missing session is refused even with a snapshot", async () => {
    sessionUser = null;

    const result = await removeCalendarEventForProject(PROJECT, {
      userId: VICTIM,
      calendarEventId: "victimevent1",
    });

    expect(result).toMatchObject({ success: false, code: "unauthenticated" });
    expect(queries).toHaveLength(0);
    noProviderWork();
  });

  test.each([
    ["without a snapshot", undefined],
    [
      "with a matching snapshot",
      { userId: ACTOR, calendarEventId: "ownevent001" },
    ],
  ])(
    "the creator's removal %s goes through the durable receipt",
    async (_label, snapshot) => {
      const result = await removeCalendarEventForProject(PROJECT, snapshot);

      expect(result).toEqual({
        success: true,
        message: "Calendar event removed successfully",
      });
      expect(synchronizePersonalCalendar).toHaveBeenCalledTimes(1);
      expect(synchronizePersonalCalendar.mock.calls[0][0]).toEqual({
        userId: ACTOR,
        sourceKind: "project",
        sourceId: PROJECT,
        operation: "remove",
        expectedEventId: "ownevent001",
      });
      expect(httpRequests).toHaveLength(0);
    },
  );

  test("when the project is gone only the actor's own saved receipt names the event", async () => {
    projects.clear();
    findPersonalCalendarReceiptEvent.mockImplementation(
      async () => "receiptevent1",
    );

    const result = await removeCalendarEventForProject(PROJECT, {
      userId: ACTOR,
      calendarEventId: "receiptevent1",
    });

    expect(result.success).toBe(true);
    // The lookup is for this actor's exact source; the snapshot only agrees with it.
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledWith(
      ACTOR,
      "project",
      PROJECT,
    );
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toEqual({
      userId: ACTOR,
      sourceKind: "project",
      sourceId: PROJECT,
      operation: "remove",
      expectedEventId: "receiptevent1",
    });
  });

  test.each([
    ["the project is gone", () => projects.clear()],
    [
      "the project marker was cleared",
      () => {
        projects.get(PROJECT)!.creator_calendar_event_id = null;
      },
    ],
  ])(
    "when %s a snapshot naming a different event than the saved receipt is refused before provider work",
    async (_label, arrange) => {
      arrange();
      findPersonalCalendarReceiptEvent.mockImplementation(
        async () => "receiptevent1",
      );

      const result = await removeCalendarEventForProject(PROJECT, {
        userId: ACTOR,
        calendarEventId: "forgedevent1",
      });

      expect(result).toMatchObject({ success: false, code: "conflict" });
      noProviderWork();
    },
  );

  test("an owned project whose marker was cleared is still reconciled through its saved receipt", async () => {
    projects.get(PROJECT)!.creator_calendar_event_id = null;
    findPersonalCalendarReceiptEvent.mockImplementation(
      async () => "receiptevent1",
    );

    expect(await removeCalendarEventForProject(PROJECT)).toEqual({
      success: true,
      message: "Calendar event removed successfully",
    });
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledWith(
      ACTOR,
      "project",
      PROJECT,
    );
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toMatchObject({
      userId: ACTOR,
      sourceId: PROJECT,
      expectedEventId: "receiptevent1",
    });
  });

  test("another creator's project with a cleared marker reaches no receipt lookup", async () => {
    projects.get(PROJECT)!.creator_id = VICTIM;
    projects.get(PROJECT)!.creator_calendar_event_id = null;

    expect(await removeCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      code: "not_owner",
    });
    expect(findPersonalCalendarReceiptEvent).not.toHaveBeenCalled();
    noProviderWork();
  });

  test("a canonical marker needs no receipt lookup", async () => {
    await removeCalendarEventForProject(PROJECT);

    expect(findPersonalCalendarReceiptEvent).not.toHaveBeenCalled();
    expect(synchronizePersonalCalendar).toHaveBeenCalledTimes(1);
  });

  test("when the project is gone and the exact lookup finds no receipt nothing is removed", async () => {
    projects.clear();

    const result = await removeCalendarEventForProject(PROJECT, {
      userId: ACTOR,
      calendarEventId: "forgedevent1",
    });

    expect(result).toEqual({
      success: true,
      message: "No calendar event to remove",
    });
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledTimes(1);
    noProviderWork();
  });

  test("when the project is gone an unconfirmed receipt lookup is never reported as nothing to remove", async () => {
    projects.clear();
    findPersonalCalendarReceiptEvent.mockImplementation(async () => {
      throw new Error("Calendar cleanup state could not be confirmed.");
    });

    const result = await removeCalendarEventForProject(PROJECT);

    expect(result).toMatchObject({
      success: false,
      retryable: true,
      error: expect.stringContaining("calendar settings"),
    });
    noProviderWork();
  });

  test("a deleted signup follows the same exact receipt lookup", async () => {
    signups.clear();
    findPersonalCalendarReceiptEvent.mockImplementation(
      async () => "signupreceipt1",
    );

    expect(await removeCalendarEventForSignup(SIGNUP)).toMatchObject({
      success: true,
    });
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledWith(
      ACTOR,
      "signup",
      SIGNUP,
    );
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toMatchObject({
      sourceKind: "signup",
      sourceId: SIGNUP,
      expectedEventId: "signupreceipt1",
    });
  });

  test("a project without a marker has nothing to remove only once the exact lookup finds no receipt", async () => {
    projects.get(PROJECT)!.creator_calendar_event_id = null;

    expect(await removeCalendarEventForProject(PROJECT)).toEqual({
      success: true,
      message: "No calendar event to remove",
    });
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledTimes(1);
    noProviderWork();
  });

  test("a project without a marker and an unconfirmed lookup is not reported as nothing to remove", async () => {
    projects.get(PROJECT)!.creator_calendar_event_id = null;
    findPersonalCalendarReceiptEvent.mockImplementation(async () => {
      throw new Error("Calendar cleanup state could not be confirmed.");
    });

    expect(await removeCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      retryable: true,
    });
    noProviderWork();
  });

  test("an unconfirmed removal is reported as a failure", async () => {
    synchronizePersonalCalendar.mockImplementation(async () => {
      throw new CalendarSyncError("Calendar outcome is unconfirmed.", 503);
    });

    expect(await removeCalendarEventForProject(PROJECT)).toEqual({
      success: false,
      error: "Calendar outcome is unconfirmed.",
      retryable: true,
    });
  });

  test("a failed project read is not treated as a missing project", async () => {
    queryError = { message: "unavailable" };

    expect(await removeCalendarEventForProject(PROJECT)).toMatchObject({
      success: false,
      retryable: true,
    });
    expect(findPersonalCalendarReceiptEvent).not.toHaveBeenCalled();
    noProviderWork();
  });
});

describe("removeCalendarEventForSignup", () => {
  test("the volunteer's own signup is removed through its durable receipt", async () => {
    expect(await removeCalendarEventForSignup(SIGNUP)).toMatchObject({
      success: true,
    });
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toEqual({
      userId: ACTOR,
      sourceKind: "signup",
      sourceId: SIGNUP,
      operation: "remove",
      expectedEventId: "ownsignup01",
    });
  });

  test("an organizer cannot remove another volunteer's calendar event", async () => {
    signups.get(SIGNUP)!.user_id = VICTIM;

    expect(await removeCalendarEventForSignup(SIGNUP)).toMatchObject({
      success: false,
      code: "not_owner",
    });
    noProviderWork();
  });

  test("an owned signup whose marker was cleared is still reconciled through its saved receipt", async () => {
    signups.get(SIGNUP)!.volunteer_calendar_event_id = null;
    findPersonalCalendarReceiptEvent.mockImplementation(
      async () => "signupreceipt1",
    );

    expect(await removeCalendarEventForSignup(SIGNUP)).toMatchObject({
      success: true,
    });
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledWith(
      ACTOR,
      "signup",
      SIGNUP,
    );
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toMatchObject({
      userId: ACTOR,
      sourceKind: "signup",
      expectedEventId: "signupreceipt1",
    });
  });

  test("an owned signup without a marker is a no-op only once the exact lookup finds no receipt", async () => {
    signups.get(SIGNUP)!.volunteer_calendar_event_id = null;

    expect(await removeCalendarEventForSignup(SIGNUP)).toEqual({
      success: true,
      message: "No calendar event to remove",
    });
    expect(findPersonalCalendarReceiptEvent).toHaveBeenCalledTimes(1);
    noProviderWork();
  });

  test("another volunteer's signup with a cleared marker reaches no receipt lookup", async () => {
    signups.get(SIGNUP)!.user_id = VICTIM;
    signups.get(SIGNUP)!.volunteer_calendar_event_id = null;

    expect(await removeCalendarEventForSignup(SIGNUP)).toMatchObject({
      success: false,
      code: "not_owner",
    });
    expect(findPersonalCalendarReceiptEvent).not.toHaveBeenCalled();
    noProviderWork();
  });

  test("a missing session is refused before any read", async () => {
    sessionUser = null;

    expect(await removeCalendarEventForSignup(SIGNUP)).toMatchObject({
      success: false,
      code: "unauthenticated",
    });
    expect(queries).toHaveLength(0);
    noProviderWork();
  });
});

describe("removeAllVolunteerCalendarEvents", () => {
  test("a missing session is refused before any read", async () => {
    sessionUser = null;

    expect(await removeAllVolunteerCalendarEvents(PROJECT)).toMatchObject({
      success: false,
    });
    expect(queries).toHaveLength(0);
    noProviderWork();
  });

  test("only the actor's own signup is removed; other volunteers count as failed", async () => {
    signups.set(OTHER_SIGNUP, {
      id: OTHER_SIGNUP,
      project_id: PROJECT,
      user_id: VICTIM,
      volunteer_calendar_event_id: "victimsign01",
    });

    const result = await removeAllVolunteerCalendarEvents(PROJECT);

    expect(result).toMatchObject({
      success: false,
      removedCount: 1,
      failedCount: 1,
    });
    expect(synchronizePersonalCalendar).toHaveBeenCalledTimes(1);
    expect(synchronizePersonalCalendar.mock.calls[0][0]).toMatchObject({
      userId: ACTOR,
      sourceId: SIGNUP,
      expectedEventId: "ownsignup01",
    });
  });
});
