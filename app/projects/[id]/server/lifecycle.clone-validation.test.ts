import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async () => undefined,
}));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => ({ get: () => undefined }),
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectCreate: async () => undefined,
  runProjectClone: async () => undefined,
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/lib/plugins/access-role", () => ({
  toOrganizationPluginAccessRole: () => null,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: () => ({}) }),
}));
mock.module("@/app/projects/[id]/server/access", () => ({
  getProject: async () => ({ project: null, error: null }),
}));
mock.module("@/app/projects/[id]/server/access-helpers", () => ({
  canUserManageProject: async () => true,
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: "clone-user" }, error: null }),
}));

const VALID_SOURCE: Record<string, unknown> = {
  id: "source-project",
  creator_id: "clone-user",
  title: "Source Project",
  description: "Synthetic source",
  location: "Local",
  location_data: { text: "Local" },
  event_type: "oneTime",
  schedule: {
    oneTime: {
      date: "2026-09-15",
      startTime: "09:00",
      endTime: "11:00",
      volunteers: 5,
    },
    multiDay: [],
  },
  verification_method: "manual",
  require_login: true,
  enable_volunteer_comments: true,
  show_attendees_publicly: false,
  waiver_required: false,
  waiver_allow_upload: true,
  waiver_disable_esignature: false,
  cover_image_url: "https://example.invalid/cover.png",
  documents: [{ name: "synthetic.pdf" }],
  organization_id: null,
  visibility: "unlisted",
  can_be_managed_by_staff: true,
  project_timezone: "UTC",
  restrict_to_org_domains: false,
  signup_form_schema: null,
  recurrence_rule: {
    frequency: "weekly",
    interval: 1,
    end_type: "after_occurrences",
    end_occurrences: 5,
    weekdays: ["monday"],
  },
  recurrence_parent_id: "old-parent",
  recurrence_sequence: 12,
  recurrence_occurrence_date: "2026-09-15",
  session_id: "old-session",
  status: "upcoming",
  workflow_status: "published",
  created_at: "2026-01-01T00:00:00Z",
  reviewed_by: "reviewer",
  reviewed_at: "2026-01-02T00:00:00Z",
  published: { oneTime: true },
  cancelled_at: "2026-01-03T00:00:00Z",
  cancellation_reason: "Historical cancellation",
  cancellation_tenant_id: "source-project",
  audience_snapshot_at: "2026-01-03T00:00:00Z",
  recipient_count: 12,
  lease_owner: "legacy-worker",
  lease_expires_at: "2026-01-03T00:05:00Z",
  last_attempted_at: "2026-01-03T00:01:00Z",
  attempts: 4,
  last_error: "legacy failure",
  completed_at: "2026-01-03T00:02:00Z",
};

let source: Record<string, unknown> = structuredClone(VALID_SOURCE);
let insertedPayload: Record<string, unknown> | null = null;
let updatedPayload: Record<string, unknown> | null = null;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "projects") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: source, error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          insertedPayload = payload;
          return {
            select: () => ({
              single: async () => ({
                data: { id: "cloned-project" },
                error: null,
              }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          updatedPayload = payload;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { id: "source-project" },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    },
  }),
}));

const { cloneProject, updateProject } =
  await import("@/app/projects/[id]/server/lifecycle");

beforeEach(() => {
  source = structuredClone(VALID_SOURCE);
  insertedPayload = null;
  updatedPayload = null;
});

describe("cloneProject validation and identity reset", () => {
  test("copies only allowlisted configuration and clears lineage", async () => {
    const sourceRule = source.recurrence_rule;
    const result = await cloneProject("source-project");

    expect(result).toEqual({ success: true, newProjectId: "cloned-project" });
    expect(insertedPayload).not.toBeNull();
    expect(insertedPayload).toMatchObject({
      title: "Source Project (Copy)",
      creator_id: "clone-user",
      status: "draft",
      workflow_status: "draft",
      recurrence_parent_id: null,
      recurrence_sequence: null,
      recurrence_occurrence_date: null,
      project_timezone: "UTC",
      schedule: {
        oneTime: {
          date: "2026-09-15",
          startTime: "09:00",
          endTime: "11:00",
          volunteers: 5,
        },
      },
    });
    expect(insertedPayload?.recurrence_rule).not.toBe(sourceRule);
    for (const forbidden of [
      "id",
      "session_id",
      "created_at",
      "reviewed_by",
      "reviewed_at",
      "published",
      "creator_calendar_event_id",
      "creator_synced_at",
      "cancelled_at",
      "cancellation_reason",
      "cancellation_tenant_id",
      "audience_snapshot_at",
      "recipient_count",
      "lease_owner",
      "lease_expires_at",
      "last_attempted_at",
      "attempts",
      "last_error",
      "completed_at",
    ]) {
      expect(insertedPayload).not.toHaveProperty(forbidden);
    }
  });

  test("refuses an invalid source schedule before insert", async () => {
    source.schedule = {
      oneTime: {
        date: "2026-02-30",
        startTime: "99:99",
        endTime: "11:00",
        volunteers: 5,
      },
    };

    const result = await cloneProject("source-project");

    expect(result.error).toMatch(/invalid schedule/i);
    expect(insertedPayload).toBeNull();
  });

  test("refuses an invalid source timezone before insert", async () => {
    source.project_timezone = "Not/A/Timezone";

    const result = await cloneProject("source-project");

    expect(result.error).toMatch(/invalid project timezone/i);
    expect(insertedPayload).toBeNull();
  });

  test("refuses an invalid or non-strict recurrence rule before insert", async () => {
    source.recurrence_rule = {
      frequency: "weekly",
      interval: 1,
      end_type: "never",
      unexpected: true,
    };

    const result = await cloneProject("source-project");

    expect(result.error).toMatch(/invalid recurrence rule/i);
    expect(insertedPayload).toBeNull();
  });

  test("updateProject persists the parsed recurrence object", async () => {
    const suppliedRule = {
      frequency: "daily" as const,
      interval: 2,
      end_type: "on_date" as const,
      end_date: "2026-12-31",
      weekdays: ["monday" as const],
    };

    const result = await updateProject("source-project", {
      recurrence_rule: suppliedRule,
    });

    expect(result.success).toBe(true);
    expect(updatedPayload?.recurrence_rule).toEqual(suppliedRule);
    expect(updatedPayload?.recurrence_rule).not.toBe(suppliedRule);
  });

  test("updateProject cannot bypass cancellation or recurrence identity authorities", async () => {
    const result = await updateProject("source-project", {
      title: "Reviewed title",
      status: "cancelled",
      cancelled_at: "2026-02-01T00:00:00Z",
      cancellation_reason: "Client supplied",
      cancellation_tenant_id: "client-tenant",
      recurrence_parent_id: "client-parent",
      recurrence_sequence: 99,
      recurrence_occurrence_date: "2026-02-01",
    } as never);

    expect(result.success).toBe(true);
    expect(updatedPayload?.title).toBe("Reviewed title");
    for (const protectedField of [
      "status",
      "cancelled_at",
      "cancellation_reason",
      "cancellation_tenant_id",
      "recurrence_parent_id",
      "recurrence_sequence",
      "recurrence_occurrence_date",
    ]) {
      expect(updatedPayload).not.toHaveProperty(protectedField);
    }
  });
});
