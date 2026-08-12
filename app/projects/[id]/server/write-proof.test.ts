/**
 * Behavioral proof for project/sign-up mutation boundaries. The mocks retain
 * row state across calls so retries exercise the actions' real predicates
 * instead of tests manually inventing a second zero-row result.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

type WriteResult = { data: { id: string } | null; error: unknown };
type RpcResult = { data: unknown; error: unknown };

let mockUser: { id: string } | null;
let mockAuthError: unknown;
let mockProject: Record<string, unknown> | null;
let mockProjectSelectError: unknown;
let mockOrgMember: { role: string; status?: string | null } | null;
let mockOrgMemberError: unknown;
let mockSignupRow: Record<string, unknown> | null;
let mockSignupSelectError: unknown;
let mockSignupFollowupError: unknown;
let signupSelectCount: number;
let mockProjectUpdateResult: WriteResult;
let mockProjectDeleteResult: WriteResult;
let mockSignupUpdateResult: WriteResult;
let mockUnrejectRpcResult: RpcResult;
let mockCancellationRpcResult: RpcResult | null;
let mockSignedWaiverCount: number | null;
let mockSignedWaiverError: unknown;
let mockStorageListError: unknown;
let mockStorageRemovalErrors: Record<string, unknown>;
let anonymousAccessAllowed: boolean;

const calendarProjectRemovals: string[] = [];
const calendarSignupRemovals: string[] = [];
const cancellationRpcCalls: Record<string, unknown>[] = [];
const unrejectRpcCalls: Record<string, unknown>[] = [];
const revalidatedPaths: string[] = [];
const storageRemovals: Array<{ bucket: string; paths: string[] }> = [];
const anonymousProfileDeletes: string[] = [];
const eventLog: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  revalidatePath: (path: string) => revalidatedPaths.push(path),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => null }),
}));
mock.module("@/lib/logger", () => ({
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
}));
mock.module("@/lib/turnstile", () => ({
  isTurnstileEnabled: () => false,
  verifyTurnstileToken: async () => false,
}));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => ({ get: () => null }),
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectCreate: async () => {},
  runProjectClone: async () => {},
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/services/notifications-server", () => ({
  createNotificationForUser: async () => {},
}));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/lib/anonymous-signup-access", () => ({
  getAnonymousSignupAccessRecord: async () =>
    anonymousAccessAllowed
      ? { data: { id: "anonymous-1" }, error: null }
      : { data: null, error: "not-found" },
  normalizeAnonymousSignupToken: (token: string) => token,
}));
mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async (projectId: string) => {
    eventLog.push("calendar:project");
    calendarProjectRemovals.push(projectId);
  },
  removeCalendarEventForSignup: async (signupId: string) => {
    eventLog.push("calendar:signup");
    calendarSignupRemovals.push(signupId);
  },
}));

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };

function rowMatches(row: Record<string, unknown> | null, filters: Filter[]) {
  if (!row) return false;
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    return filter.values.includes(row[filter.column]);
  });
}

function makeChain(table: string) {
  let operation: "select" | "update" | "delete" = "select";
  let payload: Record<string, unknown> = {};
  const filters: Filter[] = [];

  function resolveSelect() {
    if (table === "projects") {
      return { data: mockProject, error: mockProjectSelectError };
    }
    if (table === "organization_members") {
      return { data: mockOrgMember, error: mockOrgMemberError };
    }
    if (table === "project_signups") {
      signupSelectCount += 1;
      return {
        data: mockSignupRow,
        error:
          signupSelectCount > 1
            ? (mockSignupFollowupError ?? mockSignupSelectError)
            : mockSignupSelectError,
      };
    }
    return { data: null, error: null };
  }

  function resolveMutation() {
    if (table === "projects" && operation === "update") {
      if (mockProjectUpdateResult.error || !mockProjectUpdateResult.data) {
        return mockProjectUpdateResult;
      }
      if (!rowMatches(mockProject, filters)) {
        return { data: null, error: null };
      }
      eventLog.push("db:project-update");
      mockProject = { ...(mockProject ?? {}), ...payload };
      return mockProjectUpdateResult;
    }

    if (table === "projects" && operation === "delete") {
      if (mockProjectDeleteResult.error || !mockProjectDeleteResult.data) {
        return mockProjectDeleteResult;
      }
      if (!rowMatches(mockProject, filters)) {
        return { data: null, error: null };
      }
      eventLog.push("db:project-delete");
      mockProject = null;
      return mockProjectDeleteResult;
    }

    if (table === "project_signups" && operation === "update") {
      if (mockSignupUpdateResult.error || !mockSignupUpdateResult.data) {
        return mockSignupUpdateResult;
      }
      if (!rowMatches(mockSignupRow, filters)) {
        return { data: null, error: null };
      }
      eventLog.push("db:signup-update");
      mockSignupRow = { ...(mockSignupRow ?? {}), ...payload };
      return mockSignupUpdateResult;
    }

    if (table === "anonymous_signups" && operation === "delete") {
      const idFilter = filters.find(
        (filter) => filter.kind === "eq" && filter.column === "id",
      );
      const anonymousId =
        idFilter?.kind === "eq" && typeof idFilter.value === "string"
          ? idFilter.value
          : null;
      if (anonymousId) {
        anonymousProfileDeletes.push(anonymousId);
        eventLog.push("db:anonymous-delete");
      }
      return { data: anonymousId ? { id: anonymousId } : null, error: null };
    }

    return { data: null, error: null };
  }

  const chain = {
    select() {
      return chain;
    },
    update(nextPayload: Record<string, unknown>) {
      operation = "update";
      payload = nextPayload;
      return chain;
    },
    delete() {
      operation = "delete";
      return chain;
    },
    insert() {
      return chain;
    },
    eq(column: string, value: unknown) {
      filters.push({ kind: "eq", column, value });
      return chain;
    },
    in(column: string, values: unknown[]) {
      filters.push({ kind: "in", column, values });
      return chain;
    },
    or() {
      return chain;
    },
    is() {
      return chain;
    },
    gte() {
      return chain;
    },
    then(
      onfulfilled?: ((value: unknown) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) {
      const result =
        table === "waiver_signatures" && operation === "select"
          ? {
              data: null,
              count: mockSignedWaiverCount,
              error: mockSignedWaiverError,
            }
          : operation === "select"
            ? { data: null, count: 0, error: null }
            : resolveMutation();
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
    async single() {
      return operation === "select" ? resolveSelect() : resolveMutation();
    },
    async maybeSingle() {
      return operation === "select" ? resolveSelect() : resolveMutation();
    },
  };

  return chain;
}

function buildMockClient() {
  return {
    from: (table: string) => makeChain(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cancel_project_transactional") {
        cancellationRpcCalls.push(args);
        eventLog.push("db:cancel-rpc");
        const wasCancelled = mockProject?.status === "cancelled";
        const result =
          mockCancellationRpcResult ??
          (wasCancelled
            ? {
                data: {
                  outcome: "already_cancelled",
                  jobStatus: "processing",
                  accepted: true,
                },
                error: null,
              }
            : {
                data: {
                  outcome: "cancelled",
                  jobStatus: "pending",
                  accepted: true,
                },
                error: null,
              });

        if (
          !result.error &&
          (result.data as { outcome?: string } | null)?.outcome === "cancelled"
        ) {
          mockProject = { ...(mockProject ?? {}), status: "cancelled" };
        }
        return result;
      }
      if (name === "unreject_project_signup_with_capacity") {
        unrejectRpcCalls.push(args);
        eventLog.push("db:unreject-rpc");
        const row = (
          mockUnrejectRpcResult.data as Array<{ outcome?: string }> | null
        )?.[0];
        if (!mockUnrejectRpcResult.error && row?.outcome === "approved") {
          mockSignupRow = {
            ...(mockSignupRow ?? {}),
            status: "approved",
          };
        }
        return mockUnrejectRpcResult;
      }
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        list: async () => ({
          data: [
            { name: `project_${PROJECT_ID}_guide.pdf` },
            { name: "other-project.pdf" },
          ],
          error: mockStorageListError,
        }),
        remove: async (paths: string[]) => {
          eventLog.push(`storage:${bucket}`);
          storageRemovals.push({ bucket, paths });
          return {
            data: null,
            error: mockStorageRemovalErrors[bucket] ?? null,
          };
        },
      }),
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => buildMockClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => buildMockClient(),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: mockUser, error: mockAuthError }),
}));

const { updateProjectStatus, deleteProject } = await import("./lifecycle");
const { unrejectSignup, cancelSignup } = await import("./cancellation");

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const ORG_ID = "00000000-0000-4000-8000-000000000003";
const SIGNUP_ID = "00000000-0000-4000-8000-000000000004";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000005";
const ANONYMOUS_ID = "00000000-0000-4000-8000-000000000006";

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    creator_id: USER_ID,
    organization_id: ORG_ID,
    organization: {
      id: ORG_ID,
      name: "Org",
      username: "org",
      logo_url: null,
      verified: false,
      type: "nonprofit",
      allowed_email_domains: [],
    },
    can_be_managed_by_staff: false,
    status: "upcoming",
    workflow_status: "published",
    visibility: "public",
    title: "Test Project",
    schedule: {
      oneTime: {
        date: "2026-09-01",
        startTime: "10:00",
        endTime: "12:00",
      },
    },
    event_type: "oneTime",
    documents: [],
    cover_image_url: null,
    start_time: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    end_time: new Date(
      Date.now() + 2 * 24 * 3600 * 1000 + 7200000,
    ).toISOString(),
    ...overrides,
  };
}

function baseSignup(overrides: Record<string, unknown> = {}) {
  return {
    id: SIGNUP_ID,
    project_id: PROJECT_ID,
    user_id: PARTICIPANT_ID,
    anonymous_id: null,
    status: "approved",
    ...overrides,
  };
}

beforeEach(() => {
  calendarProjectRemovals.length = 0;
  calendarSignupRemovals.length = 0;
  cancellationRpcCalls.length = 0;
  unrejectRpcCalls.length = 0;
  revalidatedPaths.length = 0;
  storageRemovals.length = 0;
  anonymousProfileDeletes.length = 0;
  eventLog.length = 0;
  mockUser = { id: USER_ID };
  mockAuthError = null;
  mockProject = baseProject();
  mockProjectSelectError = null;
  mockOrgMember = null;
  mockOrgMemberError = null;
  mockSignupRow = baseSignup();
  mockSignupSelectError = null;
  mockSignupFollowupError = null;
  signupSelectCount = 0;
  mockProjectUpdateResult = { data: { id: PROJECT_ID }, error: null };
  mockProjectDeleteResult = { data: { id: PROJECT_ID }, error: null };
  mockSignupUpdateResult = { data: { id: SIGNUP_ID }, error: null };
  mockUnrejectRpcResult = {
    data: [{ outcome: "approved", project_id: PROJECT_ID }],
    error: null,
  };
  mockCancellationRpcResult = null;
  mockSignedWaiverCount = 0;
  mockSignedWaiverError = null;
  mockStorageListError = null;
  mockStorageRemovalErrors = {};
  anonymousAccessAllowed = false;
});

describe("updateProjectStatus", () => {
  test("a creator cancellation proves one transactional receipt before side effects", async () => {
    const result = await updateProjectStatus(
      PROJECT_ID,
      "cancelled",
      "No longer needed",
    );

    expect(result).toMatchObject({ success: true });
    expect(mockProject?.status).toBe("cancelled");
    expect(calendarProjectRemovals).toEqual([PROJECT_ID]);
    expect(cancellationRpcCalls).toEqual([
      {
        p_project_id: PROJECT_ID,
        p_cancellation_reason: "No longer needed",
      },
    ]);
    expect(eventLog.slice(0, 2)).toEqual(["db:cancel-rpc", "calendar:project"]);
  });

  test("repeat cancellation is idempotent without repeating calendar or notification work", async () => {
    const first = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");
    const second = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");

    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true });
    expect(calendarProjectRemovals).toEqual([PROJECT_ID]);
    expect(cancellationRpcCalls).toHaveLength(2);
    expect(eventLog).toEqual([
      "db:cancel-rpc",
      "calendar:project",
      "db:cancel-rpc",
    ]);
  });

  test("a same-status rewrite is not a transition", async () => {
    const result = await updateProjectStatus(PROJECT_ID, "upcoming");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(eventLog).toHaveLength(0);
  });

  test("a reverse completed-to-upcoming transition is refused", async () => {
    mockProject = baseProject({ status: "completed" });
    const result = await updateProjectStatus(PROJECT_ID, "upcoming");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(eventLog).toHaveLength(0);
  });

  test("a CAS loser reports failure with no cancellation side effects", async () => {
    mockProjectUpdateResult = { data: null, error: null };
    const result = await updateProjectStatus(PROJECT_ID, "in-progress");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(cancellationRpcCalls).toHaveLength(0);
  });

  test("an explicit write error has no cancellation side effects", async () => {
    mockProjectUpdateResult = {
      data: null,
      error: { message: "db error", code: "PGRST500" },
    };
    const result = await updateProjectStatus(PROJECT_ID, "in-progress");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(cancellationRpcCalls).toHaveLength(0);
  });

  test("a mismatched affected-row proof has no cancellation side effects", async () => {
    mockProjectUpdateResult = {
      data: { id: "different-project" },
      error: null,
    };

    const result = await updateProjectStatus(PROJECT_ID, "in-progress");

    expect(result).toEqual({ error: "Failed to update project status" });
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(cancellationRpcCalls).toHaveLength(0);
  });

  test("project-read and authentication faults fail before the write", async () => {
    mockProjectSelectError = { message: "project read failed" };
    expect(
      await updateProjectStatus(PROJECT_ID, "cancelled", "Reason"),
    ).toMatchObject({ error: expect.any(String) });
    expect(eventLog).toHaveLength(0);

    mockProjectSelectError = null;
    mockAuthError = { message: "claims failed" };
    expect(
      await updateProjectStatus(PROJECT_ID, "cancelled", "Reason"),
    ).toMatchObject({ error: expect.any(String) });
    expect(eventLog).toHaveLength(0);
  });

  test("a transactional queue error cannot report a transition or run cleanup", async () => {
    mockCancellationRpcResult = {
      data: null,
      error: { message: "queue unavailable", code: "40001" },
    };

    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");

    expect(result).toEqual({ error: "Failed to cancel project" });
    expect(mockProject?.status).toBe("upcoming");
    expect(calendarProjectRemovals).toHaveLength(0);
  });

  test("organization access honors admin, staff opt-in, and nullable opt-out", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "admin" };
    expect(await updateProjectStatus(PROJECT_ID, "in-progress")).toMatchObject({
      success: true,
    });

    eventLog.length = 0;
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: null,
    });
    mockOrgMember = { role: "staff" };
    expect(await updateProjectStatus(PROJECT_ID, "in-progress")).toMatchObject({
      error: expect.any(String),
    });
    expect(eventLog).toHaveLength(0);

    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: true,
    });
    expect(await updateProjectStatus(PROJECT_ID, "in-progress")).toMatchObject({
      success: true,
    });
  });

  test("a forward non-cancellation transition has no cancellation effects", async () => {
    const result = await updateProjectStatus(PROJECT_ID, "in-progress");

    expect(result).toMatchObject({ success: true });
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(cancellationRpcCalls).toHaveLength(0);
  });

  test("unauthenticated callers cannot write", async () => {
    mockUser = null;
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(eventLog).toHaveLength(0);
  });
});

describe("unrejectSignup", () => {
  beforeEach(() => {
    mockSignupRow = baseSignup({ status: "rejected" });
  });

  test("the creator delegates the transition to the capacity RPC", async () => {
    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toMatchObject({ success: true });
    expect(unrejectRpcCalls).toEqual([{ p_signup_id: SIGNUP_ID }]);
    expect(mockSignupRow?.status).toBe("approved");
    expect(revalidatedPaths).toContain(`/projects/${PROJECT_ID}/signups`);
  });

  test("a capacity refusal changes nothing and revalidates nothing", async () => {
    mockUnrejectRpcResult = {
      data: [{ outcome: "slot_full", project_id: PROJECT_ID }],
      error: null,
    };
    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toMatchObject({ error: expect.stringContaining("full") });
    expect(mockSignupRow?.status).toBe("rejected");
    expect(revalidatedPaths).toHaveLength(0);
  });

  test("a non-rejected signup never reaches the RPC", async () => {
    mockSignupRow = {
      ...mockSignupRow,
      status: "approved",
    };
    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(unrejectRpcCalls).toHaveLength(0);
    expect(revalidatedPaths).toHaveLength(0);
  });

  test("an RPC error remains private and has no visible side effect", async () => {
    mockUnrejectRpcResult = {
      data: null,
      error: { message: "internal constraint detail", code: "23514" },
    };
    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toEqual({ error: "Failed to unreject signup" });
    expect(JSON.stringify(result)).not.toContain("internal constraint detail");
    expect(revalidatedPaths).toHaveLength(0);
  });

  test("permission is rechecked by the RPC after the service precheck", async () => {
    mockUnrejectRpcResult = {
      data: [{ outcome: "refused", project_id: null }],
      error: null,
    };

    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toEqual({ error: "Failed to unreject signup" });
    expect(mockSignupRow?.status).toBe("rejected");
    expect(revalidatedPaths).toHaveLength(0);
  });

  test("malformed, duplicate, and cross-project RPC results are refused", async () => {
    const invalidResults = [
      [],
      [
        { outcome: "approved", project_id: PROJECT_ID },
        { outcome: "approved", project_id: PROJECT_ID },
      ],
      [{ outcome: "approved", project_id: "different-project" }],
      [{ outcome: "unexpected", project_id: PROJECT_ID }],
    ];

    for (const data of invalidResults) {
      mockSignupRow = baseSignup({ status: "rejected" });
      mockUnrejectRpcResult = { data, error: null };
      expect(await unrejectSignup(SIGNUP_ID)).toEqual({
        error: "Failed to unreject signup",
      });
    }

    expect(revalidatedPaths).toHaveLength(0);
  });

  test("relationship-free project lookup errors fail closed before the RPC", async () => {
    mockProjectSelectError = { message: "project lookup failed" };

    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(unrejectRpcCalls).toHaveLength(0);
  });

  test("organization management uses the canonical staff flag semantics", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "admin" };
    expect(await unrejectSignup(SIGNUP_ID)).toMatchObject({ success: true });

    mockSignupRow = baseSignup({ status: "rejected" });
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: null,
    });
    mockOrgMember = { role: "staff" };
    expect(await unrejectSignup(SIGNUP_ID)).toMatchObject({
      error: expect.any(String),
    });

    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: true,
    });
    expect(await unrejectSignup(SIGNUP_ID)).toMatchObject({ success: true });
  });

  test("inactive or unreadable organization membership cannot authorize", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: true,
    });
    mockOrgMember = { role: "admin", status: "inactive" };
    expect(await unrejectSignup(SIGNUP_ID)).toMatchObject({
      error: expect.any(String),
    });

    mockOrgMember = { role: "admin" };
    mockOrgMemberError = { message: "membership read failed" };
    expect(await unrejectSignup(SIGNUP_ID)).toMatchObject({
      error: expect.any(String),
    });
    expect(unrejectRpcCalls).toHaveLength(0);
  });

  test("unauthenticated callers never reach the RPC", async () => {
    mockUser = null;
    const result = await unrejectSignup(SIGNUP_ID);

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(unrejectRpcCalls).toHaveLength(0);
  });
});

describe("cancelSignup", () => {
  beforeEach(() => {
    mockUser = { id: PARTICIPANT_ID };
    mockSignupRow = baseSignup({ user_id: PARTICIPANT_ID });
  });

  test("a participant cancellation writes before calendar cleanup", async () => {
    const result = await cancelSignup(SIGNUP_ID);

    expect(result).toEqual({
      success: true,
      removedAnonymousProfile: false,
    });
    expect(mockSignupRow?.status).toBe("cancelled");
    expect(eventLog.slice(0, 2)).toEqual([
      "db:signup-update",
      "calendar:signup",
    ]);
  });

  test("a real repeated call is idempotent without another calendar effect", async () => {
    const first = await cancelSignup(SIGNUP_ID);
    const second = await cancelSignup(SIGNUP_ID);

    expect(first).toMatchObject({ success: true });
    expect(second).toEqual({
      success: true,
      removedAnonymousProfile: false,
    });
    expect(mockSignupRow?.status).toBe("cancelled");
    expect(calendarSignupRemovals).toEqual([SIGNUP_ID]);
  });

  test("a silent RLS zero row is not confused with idempotence", async () => {
    mockSignupUpdateResult = { data: null, error: null };
    const result = await cancelSignup(SIGNUP_ID);

    expect(result).toEqual({ error: "Failed to cancel signup" });
    expect(mockSignupRow?.status).toBe("approved");
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("an explicit write error does not remove the calendar event", async () => {
    mockSignupUpdateResult = {
      data: null,
      error: { message: "internal write error" },
    };
    const result = await cancelSignup(SIGNUP_ID);

    expect(result).toEqual({ error: "Failed to cancel signup" });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("a mismatched affected-row result cannot trigger calendar cleanup", async () => {
    mockSignupUpdateResult = {
      data: { id: "different-signup" },
      error: null,
    };

    const result = await cancelSignup(SIGNUP_ID);

    expect(result).toEqual({ error: "Failed to cancel signup" });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("an idempotency proof read error fails closed", async () => {
    mockSignupUpdateResult = { data: null, error: null };
    mockSignupFollowupError = { message: "follow-up read failed" };

    const result = await cancelSignup(SIGNUP_ID);

    expect(result).toEqual({ error: "Failed to cancel signup" });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("authentication and exact signup-read faults stop before mutation", async () => {
    mockAuthError = { message: "claims failed" };
    expect(await cancelSignup(SIGNUP_ID)).toEqual({
      error: "Failed to cancel signup",
    });
    expect(eventLog).toHaveLength(0);

    mockAuthError = null;
    mockSignupRow = baseSignup({ id: "different-signup" });
    expect(await cancelSignup(SIGNUP_ID)).toEqual({
      error: "Signup not found",
    });
    expect(eventLog).toHaveLength(0);
  });

  test("the atomic precondition refuses attended and rejected rows", async () => {
    for (const status of ["attended", "rejected"]) {
      mockSignupRow = baseSignup({ user_id: PARTICIPANT_ID, status });
      const result = await cancelSignup(SIGNUP_ID);
      expect(result).toEqual({ error: "Failed to cancel signup" });
    }
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("a valid anonymous token keeps its soft-cancelled profile for retention", async () => {
    mockUser = null;
    anonymousAccessAllowed = true;
    mockSignupRow = baseSignup({
      user_id: null,
      anonymous_id: ANONYMOUS_ID,
      status: "pending",
    });

    const result = await cancelSignup(SIGNUP_ID, ANONYMOUS_ID, "valid-token");

    expect(result).toEqual({
      success: true,
      removedAnonymousProfile: false,
    });
    expect(mockSignupRow).toMatchObject({
      anonymous_id: ANONYMOUS_ID,
      status: "cancelled",
    });
    expect(anonymousProfileDeletes).toHaveLength(0);
  });

  test("an invalid anonymous token cannot write or touch the calendar", async () => {
    mockUser = null;
    mockSignupRow = baseSignup({
      user_id: null,
      anonymous_id: ANONYMOUS_ID,
    });

    const result = await cancelSignup(SIGNUP_ID, ANONYMOUS_ID, "bad-token");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(mockSignupRow?.status).toBe("approved");
    expect(calendarSignupRemovals).toHaveLength(0);
  });
});

describe("cancelSignup organizer authorization", () => {
  beforeEach(() => {
    mockUser = { id: USER_ID };
    mockSignupRow = baseSignup();
    mockProject = baseProject({ creator_id: USER_ID, organization_id: null });
  });

  test("the creator can cancel a participant signup", async () => {
    expect(await cancelSignup(SIGNUP_ID)).toMatchObject({ success: true });
    expect(calendarSignupRemovals).toEqual([SIGNUP_ID]);
  });

  test("admin succeeds while staff null/false are denied by the shared helper", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "admin" };
    expect(await cancelSignup(SIGNUP_ID)).toMatchObject({ success: true });

    calendarSignupRemovals.length = 0;
    mockSignupRow = baseSignup();
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: null,
    });
    mockOrgMember = { role: "staff" };
    expect(await cancelSignup(SIGNUP_ID)).toMatchObject({
      error: expect.any(String),
    });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("an organizer project-read error cannot authorize cancellation", async () => {
    mockProjectSelectError = { message: "project lookup failed" };

    const result = await cancelSignup(SIGNUP_ID);

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(mockSignupRow?.status).toBe("approved");
    expect(calendarSignupRemovals).toHaveLength(0);
  });
});

describe("deleteProject", () => {
  test("a proven delete precedes retained-path storage and calendar cleanup", async () => {
    mockProject = baseProject({
      documents: [{ name: "guide.pdf" }],
      cover_image_url:
        "https://example.test/storage/project-images/project-cover.png",
    });

    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({ success: true });
    expect(eventLog).toEqual([
      "db:project-delete",
      "storage:project-documents",
      "storage:project-images",
      "calendar:project",
    ]);
    expect(storageRemovals).toEqual([
      {
        bucket: "project-documents",
        paths: [`project_${PROJECT_ID}_guide.pdf`],
      },
      { bucket: "project-images", paths: ["project-cover.png"] },
    ]);
  });

  test("an RLS zero-row delete performs no external cleanup", async () => {
    mockProject = baseProject({
      documents: [{ name: "guide.pdf" }],
      cover_image_url: "https://example.test/project-cover.png",
    });
    mockProjectDeleteResult = { data: null, error: null };

    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({ error: "Failed to delete project" });
    expect(storageRemovals).toHaveLength(0);
    expect(calendarProjectRemovals).toHaveLength(0);
  });

  test("an explicit delete error performs no external cleanup", async () => {
    mockProject = baseProject({ documents: [{ name: "guide.pdf" }] });
    mockProjectDeleteResult = {
      data: null,
      error: { message: "foreign key refusal" },
    };

    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({ error: "Failed to delete project" });
    expect(storageRemovals).toHaveLength(0);
    expect(calendarProjectRemovals).toHaveLength(0);
  });

  test("a mismatched delete result performs no external cleanup", async () => {
    mockProject = baseProject({ documents: [{ name: "guide.pdf" }] });
    mockProjectDeleteResult = {
      data: { id: "different-project" },
      error: null,
    };

    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({ error: "Failed to delete project" });
    expect(storageRemovals).toHaveLength(0);
    expect(calendarProjectRemovals).toHaveLength(0);
  });

  test("signed waiver retention blocks the database delete and cleanup", async () => {
    mockSignedWaiverCount = 1;
    const result = await deleteProject(PROJECT_ID);

    expect(result).toMatchObject({
      error: expect.stringContaining("signed waivers"),
    });
    expect(eventLog).toHaveLength(0);
  });

  test("a waiver-state read error fails closed", async () => {
    mockSignedWaiverError = { message: "count failed" };
    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({
      error: "Unable to verify the project's waiver-retention state",
    });
    expect(eventLog).toHaveLength(0);
  });

  test("a missing exact waiver count fails closed", async () => {
    mockSignedWaiverCount = null;

    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({
      error: "Unable to verify the project's waiver-retention state",
    });
    expect(eventLog).toHaveLength(0);
  });

  test("a checked storage-list fault happens only after database truth", async () => {
    mockProject = baseProject({ documents: [{ name: "guide.pdf" }] });
    mockStorageListError = { message: "storage unavailable" };

    const result = await deleteProject(PROJECT_ID);

    expect(result).toEqual({ success: true });
    expect(eventLog).toEqual(["db:project-delete", "calendar:project"]);
    expect(storageRemovals).toHaveLength(0);
  });
});
