import { beforeEach, describe, expect, mock, test } from "bun:test";

const CREATOR_ID = "creator-user";
const OTHER_USER_ID = "other-user";
const PROJECT_ID = "draft-project";
const ORGANIZATION_ID = "organization-1";

let currentUser: { id: string } | null = { id: CREATOR_ID };
let project: Record<string, unknown> | null = null;
let membership: { role: string; status: string } | null = null;
let trustedMember = false;
let updatePayloads: Record<string, unknown>[] = [];
let updateFilters: Array<[string, unknown]> = [];
let updateMatchesRow = true;
let updateError: { code: string; message: string } | null = null;
let waiverPublication: { success?: boolean; error?: string } = {
  success: true,
};
let waiverPublicationCalls: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: currentUser, error: null }),
}));
mock.module("@/app/projects/create/server/create", () => ({
  publishWaiverStagedProject: async (projectId: string) => {
    waiverPublicationCalls.push(projectId);
    return waiverPublication;
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      if (name !== "is_trusted_member") throw new Error(`Unexpected ${name}`);
      return { data: trustedMember, error: null };
    },
    from: (table: string) => {
      if (table === "organization_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: membership, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "trusted_member") {
        return {
          select: () => ({
            or: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table !== "projects") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: project, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          updatePayloads.push(payload);
          const filtered = {
            eq: (column: string, value: unknown) => {
              updateFilters.push([column, value]);
              return filtered;
            },
            select: () => ({
              maybeSingle: async () => ({
                data:
                  updateError || !updateMatchesRow ? null : { id: PROJECT_ID },
                error: updateError,
              }),
            }),
          };
          return filtered;
        },
      };
    },
  }),
}));

const { publishProjectDraft } = await import("./publish-draft");

function draftProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    creator_id: CREATOR_ID,
    organization_id: null,
    can_be_managed_by_staff: true,
    title: "Synthetic park cleanup (Copy)",
    location: "Local park",
    description: "<p>Bring gloves.</p>",
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date: "2099-06-01",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 5,
      },
    },
    project_timezone: "America/Los_Angeles",
    recurrence_rule: null,
    waiver_required: false,
    workflow_status: "draft",
    visibility: "unlisted",
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = { id: CREATOR_ID };
  project = draftProject();
  membership = null;
  trustedMember = false;
  updatePayloads = [];
  updateFilters = [];
  updateMatchesRow = true;
  updateError = null;
  waiverPublication = { success: true };
  waiverPublicationCalls = [];
});

function expectNothingWritten() {
  expect(updatePayloads).toEqual([]);
  expect(waiverPublicationCalls).toEqual([]);
}

describe("publishProjectDraft authorization", () => {
  test("a signed-out caller is refused before the project is read", async () => {
    currentUser = null;

    expect(await publishProjectDraft(PROJECT_ID)).toMatchObject({
      success: false,
      code: "unauthenticated",
    });
    expectNothingWritten();
  });

  test("a caller who cannot manage the project is refused", async () => {
    currentUser = { id: OTHER_USER_ID };

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: false,
      code: "forbidden",
      error: "You don't have permission to publish this project.",
    });
    expectNothingWritten();
  });

  test("a missing project gets the same answer as a forbidden one", async () => {
    project = null;

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: false,
      code: "forbidden",
      error: "You don't have permission to publish this project.",
    });
    expectNothingWritten();
  });

  test("organization staff are refused when the project is not staff managed", async () => {
    currentUser = { id: OTHER_USER_ID };
    project = draftProject({
      organization_id: ORGANIZATION_ID,
      can_be_managed_by_staff: false,
    });
    membership = { role: "staff", status: "active" };

    expect(await publishProjectDraft(PROJECT_ID)).toMatchObject({
      success: false,
      code: "forbidden",
    });
    expectNothingWritten();
  });

  test("an inactive organization admin is refused", async () => {
    currentUser = { id: OTHER_USER_ID };
    project = draftProject({ organization_id: ORGANIZATION_ID });
    membership = { role: "admin", status: "inactive" };

    expect(await publishProjectDraft(PROJECT_ID)).toMatchObject({
      success: false,
      code: "forbidden",
    });
    expectNothingWritten();
  });

  test("organization staff may publish a staff-managed project", async () => {
    currentUser = { id: OTHER_USER_ID };
    project = draftProject({
      organization_id: ORGANIZATION_ID,
      can_be_managed_by_staff: true,
    });
    membership = { role: "staff", status: "active" };

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: true,
      projectId: PROJECT_ID,
    });
  });

  test("a public draft needs a Trusted Member", async () => {
    project = draftProject({ visibility: "public" });

    const refused = await publishProjectDraft(PROJECT_ID);
    expect(refused).toMatchObject({ success: false, code: "forbidden" });
    expectNothingWritten();

    trustedMember = true;
    expect(await publishProjectDraft(PROJECT_ID)).toMatchObject({
      success: true,
    });
  });
});

describe("publishProjectDraft state and validation", () => {
  test("a project that is not a draft is refused", async () => {
    project = draftProject({ workflow_status: "published" });

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: false,
      code: "not_draft",
      error: "This project is already published.",
    });
    expectNothingWritten();

    project = draftProject({ workflow_status: "archived" });
    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: false,
      code: "not_draft",
      error: "Only a draft project can be published.",
    });
    expectNothingWritten();
  });

  const invalidRows: Array<{
    name: string;
    overrides: Record<string, unknown>;
    error: string;
  }> = [
    {
      name: "a first slot in the past",
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
      name: "an end time before the start time",
      overrides: {
        schedule: {
          oneTime: {
            date: "2099-06-01",
            startTime: "12:00",
            endTime: "09:00",
            volunteers: 5,
          },
        },
      },
      error: "End time must be after start time",
    },
    {
      name: "no volunteers",
      overrides: {
        schedule: {
          oneTime: {
            date: "2099-06-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 0,
          },
        },
      },
      error: "At least 1 volunteer is required",
    },
    {
      name: "a date that is not on the calendar",
      overrides: {
        schedule: {
          oneTime: {
            date: "2099-02-31",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 5,
          },
        },
      },
      error:
        "The schedule is not valid: date must be a real calendar date in YYYY-MM-DD format.",
    },
    {
      name: "a missing schedule",
      overrides: { schedule: {} },
      error: "Add a date and time for this project.",
    },
    {
      name: "an empty description",
      overrides: { description: "<p></p>" },
      error: "Description is required",
    },
    {
      name: "an unknown time zone",
      overrides: { project_timezone: "Not/A/Zone" },
      error: "Choose a time zone for this project before publishing.",
    },
  ];

  for (const { name, overrides, error } of invalidRows) {
    test(`${name} is refused with its own message`, async () => {
      project = draftProject(overrides);

      expect(await publishProjectDraft(PROJECT_ID)).toEqual({
        success: false,
        code: "invalid_project",
        error,
      });
      expectNothingWritten();
    });
  }
});

describe("publishProjectDraft publication", () => {
  test("a draft without a waiver is stored the way a new project is", async () => {
    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: true,
      projectId: PROJECT_ID,
    });

    expect(updatePayloads).toEqual([
      { status: "upcoming", workflow_status: "published" },
    ]);
    // Only this row, and only while it is still a draft.
    expect(updateFilters).toEqual([
      ["id", PROJECT_ID],
      ["workflow_status", "draft"],
    ]);
    expect(waiverPublicationCalls).toEqual([]);
  });

  test("a waiver draft is published only by the waiver proof", async () => {
    project = draftProject({ waiver_required: true });

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: true,
      projectId: PROJECT_ID,
    });

    // The action itself never writes workflow_status for a waiver project.
    expect(updatePayloads).toEqual([{ status: "upcoming" }]);
    expect(waiverPublicationCalls).toEqual([PROJECT_ID]);
  });

  test("a repeating waiver draft is published by the same waiver proof", async () => {
    project = draftProject({
      waiver_required: true,
      recurrence_rule: { frequency: "weekly", interval: 1, end_type: "never" },
    });

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: true,
      projectId: PROJECT_ID,
    });

    expect(updatePayloads).toEqual([{ status: "upcoming" }]);
    expect(waiverPublicationCalls).toEqual([PROJECT_ID]);
  });

  test("a waiver blocker is surfaced with its message", async () => {
    project = draftProject({ waiver_required: true });
    waiverPublication = {
      error: "Configure the waiver signature placements before publishing.",
    };

    expect(await publishProjectDraft(PROJECT_ID)).toEqual({
      success: false,
      code: "waiver_blocked",
      error: "Configure the waiver signature placements before publishing.",
    });
    expect(updatePayloads).toEqual([{ status: "upcoming" }]);
  });

  test("a row published by someone else in the meantime is not reported as success", async () => {
    updateMatchesRow = false;

    expect(await publishProjectDraft(PROJECT_ID)).toMatchObject({
      success: false,
      code: "not_draft",
    });
  });

  test("a schedule the database refuses gets a specific message, not the raw error", async () => {
    updateError = {
      code: "23514",
      message: "Published projects require a valid schedule and timezone.",
    };
    const originalError = console.error;
    console.error = () => undefined;

    try {
      const result = await publishProjectDraft(PROJECT_ID);
      expect(result).toMatchObject({ success: false, code: "failed" });
      expect(result.success ? "" : result.error).toContain("schedule");
      expect(JSON.stringify(result)).not.toContain("Published projects");
    } finally {
      console.error = originalError;
    }
  });
});
