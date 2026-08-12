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
const lifecycleOperations: string[] = [];
const cancelledOccurrenceIds = new Set<string>();
let occurrenceReadError: { code: string } | null = null;
let cancellationFailures = new Set<string>();
let parentRecurrenceRule: Record<string, unknown> | null = null;
let parentUpdateError: { code: string } | null = null;

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
      lifecycleOperations.push("update-parent");
      projectUpdates.push(updatePayload);
      if (
        !parentUpdateError &&
        Object.prototype.hasOwnProperty.call(updatePayload, "recurrence_rule")
      ) {
        parentRecurrenceRule =
          (updatePayload.recurrence_rule as Record<string, unknown> | null) ??
          null;
      }
      return { data: null, error: parentUpdateError };
    }
    if (
      selected === "id" &&
      filters.some(({ column }) => column === "recurrence_parent_id")
    ) {
      return {
        data: occurrenceReadError
          ? null
          : occurrenceIds
              .filter((id) => !cancelledOccurrenceIds.has(id))
              .map((id) => ({ id })),
        error: occurrenceReadError,
      };
    }
    return {
      data: {
        creator_id: "series-owner",
        organization_id: null,
        can_be_managed_by_staff: false,
        recurrence_parent_id: null,
        recurrence_rule: parentRecurrenceRule,
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
      lifecycleOperations.push(`cancel-${String(args.p_project_id)}`);
      rpcCalls.push({ name, args });
      const projectId = String(args.p_project_id);
      if (cancellationFailures.has(projectId)) {
        return { data: null, error: { code: "40001" } };
      }
      if (cancelledOccurrenceIds.has(projectId)) {
        return {
          data: {
            outcome: "already_cancelled",
            jobStatus: "processing",
            accepted: true,
          },
          error: null,
        };
      }
      cancelledOccurrenceIds.add(projectId);
      return {
        data: { outcome: "cancelled", jobStatus: "pending", accepted: true },
        error: null,
      };
    },
  }),
}));

const { updateProject } = await import("./lifecycle");

beforeEach(() => {
  rpcCalls.length = 0;
  projectUpdates.length = 0;
  calendarRemovals.length = 0;
  lifecycleOperations.length = 0;
  cancelledOccurrenceIds.clear();
  occurrenceReadError = null;
  cancellationFailures = new Set();
  parentUpdateError = null;
  parentRecurrenceRule = {
    frequency: "weekly",
    interval: 1,
    end_type: "never",
  };
});

describe("recurring-series cancellation integration", () => {
  test("cancels every child before clearing the parent recurrence rule", async () => {
    const result = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(result).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 3,
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
    expect(calendarRemovals).toEqual(occurrenceIds);
    expect(lifecycleOperations).toEqual([
      "cancel-occurrence-1",
      "cancel-occurrence-2",
      "cancel-occurrence-3",
      "update-parent",
    ]);
    expect(projectUpdates).toHaveLength(1);
    expect(projectUpdates[0]).toEqual({ recurrence_rule: null });
    expect(projectUpdates[0]).not.toHaveProperty("status");
  });

  test("keeps the parent discoverable when child discovery fails", async () => {
    occurrenceReadError = { code: "57014" };

    const result = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(result).toEqual({
      error: "Failed to read recurring occurrences",
      endedRecurringSeries: false,
      cancelledOccurrences: 0,
    });
    expect(rpcCalls).toHaveLength(0);
    expect(projectUpdates).toHaveLength(0);
    expect(parentRecurrenceRule).not.toBeNull();
  });

  test("reports a partial cancellation and a retry finishes remaining children", async () => {
    cancellationFailures.add("occurrence-2");

    const first = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(first).toEqual({
      error: "Failed to cancel all recurring occurrences",
      endedRecurringSeries: false,
      cancelledOccurrences: 2,
    });
    expect(projectUpdates).toHaveLength(0);
    expect(parentRecurrenceRule).not.toBeNull();
    expect(cancelledOccurrenceIds).toEqual(
      new Set(["occurrence-1", "occurrence-3"]),
    );

    cancellationFailures.clear();
    rpcCalls.length = 0;
    calendarRemovals.length = 0;

    const retry = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(retry).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 1,
    });
    expect(rpcCalls).toEqual([
      {
        name: "cancel_project_transactional",
        args: {
          p_project_id: "occurrence-2",
          p_cancellation_reason: "Recurring series ended by organizer",
        },
      },
    ]);
    expect(calendarRemovals).toEqual(["occurrence-2"]);
    expect(projectUpdates).toEqual([{ recurrence_rule: null }]);
    expect(parentRecurrenceRule).toBeNull();
  });

  test("keeps the parent discoverable when clearing its rule fails", async () => {
    parentUpdateError = { code: "40001" };

    const first = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(first).toEqual({
      error: "Failed to end recurring series",
      endedRecurringSeries: false,
      cancelledOccurrences: 3,
    });
    expect(cancelledOccurrenceIds).toEqual(new Set(occurrenceIds));
    expect(parentRecurrenceRule).not.toBeNull();

    parentUpdateError = null;
    projectUpdates.length = 0;

    const retry = await updateProject("series-parent", {
      recurrence_rule: null,
    });

    expect(retry).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 0,
    });
    expect(projectUpdates).toEqual([{ recurrence_rule: null }]);
    expect(parentRecurrenceRule).toBeNull();
  });
});
