import { beforeEach, describe, expect, mock, test } from "bun:test";

const USER_ID = "draft-owner";
const DRAFT_ID = "draft-1";

let draftData: Record<string, unknown> | null = null;
let createCalls: unknown[] = [];
let deletedDrafts = 0;

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("./create", () => ({
  createBasicProject: async (input: unknown) => {
    createCalls.push(input);
    return { success: true, id: "published-project" };
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: string) => {
      if (table !== "project_drafts") {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: draftData
                  ? { id: DRAFT_ID, user_id: USER_ID, draft_data: draftData }
                  : null,
                error: null,
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: async () => {
            deletedDrafts += 1;
            return { error: null };
          },
        }),
      };
    },
  }),
}));

const { publishDraft } = await import("./drafts");

function completeDraft(overrides: Record<string, unknown> = {}) {
  return {
    step: 3,
    eventType: "oneTime",
    basicInfo: {
      title: "Beach cleanup",
      location: "Local beach",
      description: "<p>Bring gloves.</p>",
      organizationId: null,
      projectTimezone: "America/Los_Angeles",
    },
    schedule: {
      oneTime: {
        date: "2099-06-01",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 5,
      },
      multiDay: [{ date: "", slots: [] }],
      sameDayMultiArea: {
        date: "",
        overallStart: "09:00",
        overallEnd: "17:00",
        roles: [],
      },
    },
    verificationMethod: "qr-code",
    requireLogin: true,
    visibility: "unlisted",
    waiverRequired: false,
    waiverPdfFile: null,
    waiverPdfUrl: null,
    recurrence: {
      enabled: false,
      frequency: "weekly",
      interval: 1,
      endType: "never",
      weekdays: [],
    },
    pluginData: {},
    ...overrides,
  };
}

beforeEach(() => {
  draftData = completeDraft();
  createCalls = [];
  deletedDrafts = 0;
});

describe("publishing a saved draft", () => {
  test("a complete draft is created and then removed", async () => {
    expect(await publishDraft(DRAFT_ID)).toEqual({
      success: true,
      id: "published-project",
    });
    expect(createCalls).toHaveLength(1);
    expect(deletedDrafts).toBe(1);
  });

  const incomplete: Array<{
    name: string;
    overrides: Record<string, unknown>;
    error: string;
  }> = [
    {
      name: "no location",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "",
          description: "<p>Bring gloves.</p>",
          organizationId: null,
        },
      },
      error: "Location is required",
    },
    {
      name: "an empty description",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "Local beach",
          description: "<p></p>",
          organizationId: null,
        },
      },
      error: "Description is required",
    },
    {
      name: "no date yet",
      overrides: {
        schedule: {
          oneTime: {
            date: "",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 0,
          },
        },
      },
      error: "Date is required",
    },
    {
      name: "a date that has passed",
      overrides: {
        schedule: {
          oneTime: {
            date: "2020-06-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 5,
          },
        },
      },
      error: "Start time must be in the future",
    },
    {
      name: "no schedule at all",
      overrides: { schedule: {} },
      error: "Add a date and time for this project.",
    },
  ];

  for (const { name, overrides, error } of incomplete) {
    test(`a draft with ${name} says so and creates nothing`, async () => {
      draftData = completeDraft(overrides);

      expect(await publishDraft(DRAFT_ID)).toEqual({ error });
      expect(createCalls).toHaveLength(0);
      expect(deletedDrafts).toBe(0);
    });
  }

  test("a waiver draft is still sent back to the create flow", async () => {
    draftData = completeDraft({ waiverRequired: true, waiverPdfFile: {} });

    const result = await publishDraft(DRAFT_ID);
    expect(result).toMatchObject({
      error: expect.stringContaining("must be published from the create flow"),
    });
    expect(createCalls).toHaveLength(0);
  });

  test("a draft that is not the caller's is not found", async () => {
    draftData = null;

    expect(await publishDraft(DRAFT_ID)).toEqual({ error: "Draft not found" });
    expect(createCalls).toHaveLength(0);
  });
});
