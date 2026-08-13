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
mock.module("./access-helpers", () => ({
  canUserManageProject: async () => true,
}));

const parentId = "f9200000-0000-4000-8000-000000000001";
const occurrenceIds = [
  "f9210000-0000-4000-8000-000000000001",
  "f9210000-0000-4000-8000-000000000002",
  "f9210000-0000-4000-8000-000000000003",
];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const projectUpdates: Array<{
  payload: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
  selected: string;
  maybeSingleCalled: boolean;
}> = [];
const calendarRemovals: string[] = [];
const lifecycleOperations: string[] = [];
let parentRecurrenceRule: Record<string, unknown> | null = null;
let parentUpdateResult: {
  data: { id: string } | null;
  error: { code: string } | null;
};
let rpcResponses: Array<{
  data: unknown;
  error: { code: string } | null;
  commitsSeriesEnd?: boolean;
}> = [];

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
  let updateRecorded = false;

  const resolve = (maybeSingleCalled = false) => {
    if (operation === "update") {
      if (!updateRecorded) {
        updateRecorded = true;
        lifecycleOperations.push("update-parent");
        projectUpdates.push({
          payload: updatePayload,
          filters: [...filters],
          selected,
          maybeSingleCalled,
        });
      }
      return parentUpdateResult;
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
    order: async () => ({ data: [], error: null }),
    single: async () => resolve(),
    maybeSingle: async () => resolve(true),
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
      lifecycleOperations.push("end-series");
      rpcCalls.push({ name, args });
      const response = rpcResponses.shift();
      if (!response) throw new Error("Missing RPC response fixture");
      if (response.commitsSeriesEnd) parentRecurrenceRule = null;
      return { data: response.data, error: response.error };
    },
  }),
}));

const { updateProject } = await import("./lifecycle");

beforeEach(() => {
  rpcCalls.length = 0;
  projectUpdates.length = 0;
  calendarRemovals.length = 0;
  lifecycleOperations.length = 0;
  parentRecurrenceRule = {
    frequency: "weekly",
    interval: 1,
    end_type: "never",
  };
  parentUpdateResult = { data: { id: parentId }, error: null };
  rpcResponses = [
    {
      data: {
        outcome: "ended",
        endedRecurringSeries: true,
        cancelledOccurrences: 3,
        calendarCleanupProjectIds: occurrenceIds,
      },
      error: null,
      commitsSeriesEnd: true,
    },
  ];
});

describe("recurring-series cancellation integration", () => {
  test("uses the transactional series boundary and skips an ordinary update when only recurrence is cleared", async () => {
    const result = await updateProject(parentId, {
      recurrence_rule: null,
    });

    expect(result).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 3,
    });
    expect(rpcCalls).toEqual([
      {
        name: "end_recurring_project_series_transactional",
        args: { p_project_id: parentId },
      },
    ]);
    expect(calendarRemovals).toEqual(occurrenceIds);
    expect(lifecycleOperations).toEqual(["end-series"]);
    expect(projectUpdates).toHaveLength(0);
    expect(parentRecurrenceRule).toBeNull();
  });

  test("replays calendar cleanup after the transaction committed but its response was lost", async () => {
    rpcResponses = [
      {
        data: null,
        error: { code: "57014" },
        commitsSeriesEnd: true,
      },
      {
        data: {
          outcome: "replayed",
          endedRecurringSeries: true,
          cancelledOccurrences: 0,
          calendarCleanupProjectIds: occurrenceIds,
        },
        error: null,
      },
    ];

    const unknownResponse = await updateProject(parentId, {
      recurrence_rule: null,
    });

    expect(unknownResponse).toEqual({
      error: "Failed to end recurring series",
      endedRecurringSeries: false,
      cancelledOccurrences: 0,
    });
    expect(parentRecurrenceRule).toBeNull();
    expect(calendarRemovals).toEqual([]);
    expect(projectUpdates).toHaveLength(0);

    const retry = await updateProject(parentId, {
      recurrence_rule: null,
    });

    expect(retry).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 0,
    });
    expect(rpcCalls).toEqual([
      {
        name: "end_recurring_project_series_transactional",
        args: { p_project_id: parentId },
      },
      {
        name: "end_recurring_project_series_transactional",
        args: { p_project_id: parentId },
      },
    ]);
    expect(calendarRemovals).toEqual(occurrenceIds);
    expect(projectUpdates).toHaveLength(0);
  });

  test("rejects a malformed transactional receipt", async () => {
    rpcResponses = [
      {
        data: {
          outcome: "ended",
          endedRecurringSeries: true,
          cancelledOccurrences: "3",
          calendarCleanupProjectIds: occurrenceIds,
        },
        error: null,
        commitsSeriesEnd: true,
      },
    ];

    const result = await updateProject(parentId, {
      recurrence_rule: null,
    });

    expect(result).toEqual({
      error: "Failed to end recurring series",
      endedRecurringSeries: false,
      cancelledOccurrences: 0,
    });
    expect(calendarRemovals).toEqual([]);
    expect(projectUpdates).toHaveLength(0);
    expect(parentRecurrenceRule).toBeNull();
  });

  test("requires an exact parent row when updating other sanitized fields", async () => {
    parentUpdateResult = { data: null, error: null };

    const result = await updateProject(parentId, {
      recurrence_rule: null,
      title: "Renamed series",
    });

    expect(result).toEqual({
      error: "Failed to update project",
      endedRecurringSeries: true,
      cancelledOccurrences: 3,
    });
    expect(projectUpdates).toEqual([
      {
        payload: { title: "Renamed series" },
        filters: [{ column: "id", value: parentId }],
        selected: "id",
        maybeSingleCalled: true,
      },
    ]);
    expect(calendarRemovals).toEqual(occurrenceIds);
  });

  test("updates remaining fields without writing recurrence_rule again", async () => {
    const result = await updateProject(parentId, {
      recurrence_rule: null,
      title: "Renamed series",
    });

    expect(result).toEqual({
      success: true,
      endedRecurringSeries: true,
      cancelledOccurrences: 3,
    });
    expect(projectUpdates).toEqual([
      {
        payload: { title: "Renamed series" },
        filters: [{ column: "id", value: parentId }],
        selected: "id",
        maybeSingleCalled: true,
      },
    ]);
  });

  test("fails closed when the transactional RPC returns an error", async () => {
    rpcResponses = [{ data: null, error: { code: "40001" } }];

    const result = await updateProject(parentId, {
      recurrence_rule: null,
      title: "Must not be written",
    });

    expect(result).toEqual({
      error: "Failed to end recurring series",
      endedRecurringSeries: false,
      cancelledOccurrences: 0,
    });
    expect(calendarRemovals).toEqual([]);
    expect(projectUpdates).toHaveLength(0);
    expect(parentRecurrenceRule).not.toBeNull();
  });
});
