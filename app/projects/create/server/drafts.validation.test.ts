import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (v: string) => v,
}));
mock.module("@/lib/projects/waiver-validation", () => ({
  getWaiverPdfRequirementError: () => null,
  getWaiverConfigurationError: () => null,
}));

/**
 * Behavioral: updateDraft validates timezone and recurrence before writing.
 * A corrupt recurrence rule or invalid timezone must return an error without
 * performing any database write.
 */

const USER_ID = "user-draft-test-1";
const PROJECT_ID = "proj-draft-test-1";

function makeSupabaseClient(
  opts: {
    updateCalled?: { value: boolean };
  } = {},
) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: (_col: string, _val: string) => ({
          eq: (_col2: string, _val2: string) => ({
            single: async () => ({
              data: {
                id: PROJECT_ID,
                creator_id: USER_ID,
                workflow_status: "draft",
                visibility: "unlisted",
              },
              error: null,
            }),
          }),
          single: async () => ({
            data: {
              id: PROJECT_ID,
              creator_id: USER_ID,
              workflow_status: "draft",
              visibility: "unlisted",
            },
            error: null,
          }),
        }),
      }),
      update: (_vals: unknown) => {
        if (opts.updateCalled) opts.updateCalled.value = true;
        return {
          eq: () => ({ data: { id: PROJECT_ID }, error: null }),
          select: () => ({
            single: async () => ({ data: { id: PROJECT_ID }, error: null }),
          }),
        };
      },
      insert: (_vals: unknown) => ({
        select: () => ({
          single: async () => ({ data: { id: "new-id" }, error: null }),
        }),
      }),
    }),
  };
}

describe("updateDraft — validation before write", () => {
  test("corrupt recurrence rule (interval 0) returns error without writing to DB", async () => {
    const updateCalled = { value: false };
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => makeSupabaseClient({ updateCalled }),
    }));

    const { updateDraft } = await import("@/app/projects/create/server/drafts");

    const result = await updateDraft(PROJECT_ID, {
      basicInfo: {
        title: "Test",
        location: "Somewhere",
        description: "A test",
        organizationId: null,
        projectTimezone: "America/Los_Angeles",
      },
      eventType: "oneTime",
      schedule: {
        oneTime: {
          date: "2027-06-01",
          startTime: "09:00",
          endTime: "11:00",
          volunteers: 10,
        },
        multiDay: [],
        sameDayMultiArea: {
          date: "",
          overallStart: "09:00",
          overallEnd: "11:00",
          roles: [],
        },
      },
      recurrence: {
        enabled: true,
        frequency: "weekly",
        interval: 0, // Invalid: must be >= 1
        endType: "never",
        weekdays: [],
      },
    } as never);

    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.error).toMatch(/interval/i);
    expect(updateCalled.value).toBe(false);
  });

  test("invalid timezone returns error without writing to DB", async () => {
    const updateCalled = { value: false };
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => makeSupabaseClient({ updateCalled }),
    }));

    const { updateDraft } = await import("@/app/projects/create/server/drafts");

    const result = await updateDraft(PROJECT_ID, {
      basicInfo: {
        title: "Test",
        location: "Somewhere",
        description: "A test",
        organizationId: null,
        projectTimezone: "Not/A/Valid/Timezone",
      },
      eventType: "oneTime",
      schedule: {
        oneTime: {
          date: "2027-06-01",
          startTime: "09:00",
          endTime: "11:00",
          volunteers: 10,
        },
        multiDay: [],
        sameDayMultiArea: {
          date: "",
          overallStart: "09:00",
          overallEnd: "11:00",
          roles: [],
        },
      },
    } as never);

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/timezone/i);
    expect(updateCalled.value).toBe(false);
  });

  test("corrupt end_date in recurrence rule returns error without writing", async () => {
    const updateCalled = { value: false };
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => makeSupabaseClient({ updateCalled }),
    }));

    const { updateDraft } = await import("@/app/projects/create/server/drafts");

    const result = await updateDraft(PROJECT_ID, {
      basicInfo: {
        title: "Test",
        location: "Somewhere",
        description: "A test",
        organizationId: null,
        projectTimezone: "America/Los_Angeles",
      },
      eventType: "oneTime",
      schedule: {
        oneTime: {
          date: "2027-06-01",
          startTime: "09:00",
          endTime: "11:00",
          volunteers: 10,
        },
        multiDay: [],
        sameDayMultiArea: {
          date: "",
          overallStart: "09:00",
          overallEnd: "11:00",
          roles: [],
        },
      },
      recurrence: {
        enabled: true,
        frequency: "daily",
        interval: 1,
        endType: "on_date",
        endDate: "12/31/2027", // Wrong format: MM/DD/YYYY not YYYY-MM-DD
        weekdays: [],
      },
    } as never);

    expect(result.error).toBeDefined();
    expect(updateCalled.value).toBe(false);
  });
});
