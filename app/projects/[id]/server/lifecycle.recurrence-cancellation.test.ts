import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => ({ get: () => null }),
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectCreate: async () => undefined,
  runProjectClone: async () => undefined,
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: () => ({}) }),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: "series-owner" }, error: null }),
}));
mock.module("./access", () => ({
  canUserManageProject: async () => true,
}));

const occurrenceIds = ["occurrence-1", "occurrence-2", "occurrence-3"];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const projectUpdates: Record<string, unknown>[] = [];
const calendarRemovals: string[] = [];

mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async (projectId: string) => {
    calendarRemovals.push(projectId);
  },
}));

function projectBuilder() {
  let operation: "select" | "update" = "select";
  let selected = "";
  let updatePayload: Record<string, unknown> = {};
  const filters: Array<{ column: string; value: unknown }> = [];

  const resolve = () => {
    if (operation === "update") {
      projectUpdates.push(updatePayload);
      return { data: null, error: null };
    }
    if (
      selected === "id" &&
      filters.some(({ column }) => column === "recurrence_parent_id")
    ) {
      return {
        data: occurrenceIds.map((id) => ({ id })),
        error: null,
      };
    }
    return {
      data: {
        creator_id: "series-owner",
        organization_id: null,
        can_be_managed_by_staff: false,
        recurrence_parent_id: null,
        recurrence_rule: {
          frequency: "weekly",
          interval: 1,
          end_type: "never",
        },
        visibility: "unlisted",
      },
      error: null,
    };
  };

  const builder = {
    select(columns: string) {
      selected = columns;
      return builder;
    },
    update(payload: Record<string, unknown>) {
      operation = "update";
      updatePayload = payload;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return builder;
    },
    order() {
      return Promise.resolve(resolve());
    },
    single: async () => resolve(),
    then(
      onfulfilled?: ((value: ReturnType<typeof resolve>) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "projects") throw new Error(`Unexpected table ${table}`);
      return projectBuilder();
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const projectId = args.p_project_id;
      if (projectId === "occurrence-1") {
        return {
          data: { outcome: "cancelled", jobStatus: "pending", accepted: true },
          error: null,
        };
      }
      if (projectId === "occurrence-2") {
        return {
          data: {
            outcome: "already_cancelled",
            jobStatus: "processing",
            accepted: true,
          },
          error: null,
        };
      }
      return { data: null, error: { code: "40001" } };
    },
  }),
}));

const { updateProject } = await import("./lifecycle");

beforeEach(() => {
  rpcCalls.length = 0;
  projectUpdates.length = 0;
  calendarRemovals.length = 0;
});

describe("recurring-series cancellation integration", () => {
  test("uses the sole cancellation RPC and cleans up only a fresh child transition", async () => {
    const result = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(result).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 1,
    });
    expect(rpcCalls).toEqual(
      occurrenceIds.map((id) => ({
        name: "cancel_project_transactional",
        args: {
          p_project_id: id,
          p_cancellation_reason: "Recurring series ended by organizer",
        },
      })),
    );
    expect(calendarRemovals).toEqual(["occurrence-1"]);
    expect(projectUpdates).toHaveLength(1);
    expect(projectUpdates[0]).toEqual({ recurrence_rule: null });
    expect(projectUpdates[0]).not.toHaveProperty("status");
  });
});
