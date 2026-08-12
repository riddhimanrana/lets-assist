import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => ({ get: () => null }),
}));
mock.module("@/lib/plugins/lifecycle", () => ({ runProjectClone: async () => {} }));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

let rpcResult: { data: unknown; error: unknown };
let projectStatus = "upcoming";
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const directProjectUpdates: unknown[] = [];
const calendarRemovals: string[] = [];

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: USER_ID }, error: null }),
}));

mock.module("./access", () => ({
  getProject: async () => ({
    project: {
      id: PROJECT_ID,
      creator_id: USER_ID,
      organization_id: null,
      organization: null,
      status: projectStatus,
      title: "Cancellation RPC fixture",
    },
    error: null,
  }),
  canUserManageProject: async () => true,
}));

mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async (projectId: string) => {
    calendarRemovals.push(projectId);
  },
}));

function unusedBuilder() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    update: (value: unknown) => {
      directProjectUpdates.push(value);
      return builder;
    },
  };
  return builder;
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
    from: () => unusedBuilder(),
  }),
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: () => unusedBuilder() }),
}));

const { updateProjectStatus } = await import("./lifecycle");

beforeEach(() => {
  rpcCalls.length = 0;
  directProjectUpdates.length = 0;
  calendarRemovals.length = 0;
  projectStatus = "upcoming";
  rpcResult = {
    data: { outcome: "cancelled", jobStatus: "pending", accepted: true },
    error: null,
  };
  process.env.PROJECT_CANCELLATION_WORKER_ENABLED = "false";
});

describe("updateProjectStatus cancellation boundary", () => {
  test("uses one authenticated transactional RPC and no split writes", async () => {
    const result = await updateProjectStatus(
      PROJECT_ID,
      "cancelled",
      "Storm warning",
    );

    expect(result).toMatchObject({
      success: true,
      cancellationNotifications: { enqueued: true },
    });
    expect(rpcCalls).toEqual([
      {
        name: "cancel_project_transactional",
        args: {
          p_project_id: PROJECT_ID,
          p_cancellation_reason: "Storm warning",
        },
      },
    ]);
    expect(directProjectUpdates).toHaveLength(0);
    expect(calendarRemovals).toEqual([PROJECT_ID]);
  });

  test("RPC error cannot produce calendar or queue side effects", async () => {
    rpcResult = { data: null, error: { code: "40001" } };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Storm");
    expect(result).toEqual({ error: "Failed to cancel project" });
    expect(calendarRemovals).toHaveLength(0);
  });

  test("an impossible success envelope is rejected", async () => {
    rpcResult = { data: { accepted: true }, error: null };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Storm");
    expect(result).toEqual({ error: "Failed to cancel project" });
    expect(calendarRemovals).toHaveLength(0);
  });

  test("an inconsistent RPC state combination is rejected", async () => {
    rpcResult = {
      data: { outcome: "cancelled", jobStatus: "completed", accepted: true },
      error: null,
    };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Storm");
    expect(result).toEqual({ error: "Failed to cancel project" });
    expect(calendarRemovals).toHaveLength(0);
  });

  test("idempotent repeat does not rerun calendar cleanup", async () => {
    projectStatus = "cancelled";
    rpcResult = {
      data: {
        outcome: "already_cancelled",
        jobStatus: "processing",
        accepted: true,
      },
      error: null,
    };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Storm");
    expect(result).toMatchObject({ success: true });
    expect(calendarRemovals).toHaveLength(0);
    expect(result.cancellationNotifications?.error).toBeUndefined();
  });

  test("legacy cancelled job reports review without revival", async () => {
    projectStatus = "cancelled";
    rpcResult = {
      data: {
        outcome: "already_cancelled_review_required",
        jobStatus: "needs_review",
        accepted: false,
      },
      error: null,
    };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Storm");
    expect(result).toMatchObject({
      success: true,
      cancellationNotifications: {
        enqueued: false,
        error: "Cancellation notifications require manual review.",
      },
    });
  });
});
