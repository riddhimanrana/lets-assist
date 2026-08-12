/**
 * Behavioral write-proof tests for project-status and signup-cancellation server
 * actions. Each scenario drives the real action code through a faithful Supabase
 * mock so that the test exercises actual control flow rather than source text.
 *
 * Coverage targets (per task spec):
 *   - RLS 0-row/no-error silent update (the primary bug class)
 *   - Explicit DB error
 *   - Authorized success paths (creator, org-admin, organizer cancel)
 *   - Side-effect order: calendar removal and job enqueue only after proven write
 *   - can_be_managed_by_staff=false denies staff
 *   - Repeat/idempotent cancellation returns an error, no side effects
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Module mocks (must precede any dynamic import) ─────────────────────────

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
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
  runProjectClone: async () => {},
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/services/notifications-server", () => ({
  createNotificationForUser: async () => {},
}));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (s: string) => s,
}));
mock.module("@/lib/anonymous-signup-access", () => ({
  getAnonymousSignupAccessRecord: async () => ({
    data: null,
    error: "not-found",
  }),
  normalizeAnonymousSignupToken: (t: string) => t,
}));

// ── Shared mutable test state ───────────────────────────────────────────────

let mockUser: { id: string } | null = null;
let mockProject: Record<string, unknown> | null = null;
let mockOrgMember: { role: string } | null = null;
let mockSignupRow: Record<string, unknown> | null = null;

// Results for UPDATE operations; null data simulates RLS 0-row
let mockProjectUpdateResult: { data: { id: string } | null; error: unknown } = {
  data: { id: "project-1" },
  error: null,
};
let mockSignupUpdateResult: { data: { id: string } | null; error: unknown } = {
  data: { id: "signup-1" },
  error: null,
};

// Side-effect tracking
const calendarProjectRemovals: string[] = [];
const calendarSignupRemovals: string[] = [];
const adminJobUpserts: Array<{ project_id: string }> = [];

mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async (projectId: string) => {
    calendarProjectRemovals.push(projectId);
  },
  removeCalendarEventForSignup: async (signupId: string) => {
    calendarSignupRemovals.push(signupId);
  },
}));

// ── Mock Supabase client factory ────────────────────────────────────────────

function makeChain(table: string) {
  let isUpdate = false;

  const resolveForUpdate = () => {
    if (table === "projects") return mockProjectUpdateResult;
    if (table === "project_signups") return mockSignupUpdateResult;
    return { data: null, error: null };
  };

  const resolveForSelect = () => {
    if (table === "projects") return { data: mockProject, error: null };
    if (table === "organization_members")
      return { data: mockOrgMember, error: null };
    if (table === "project_signups")
      return { data: mockSignupRow, error: null };
    return { data: null, error: null };
  };

  const chain: Record<string, unknown> = {
    select() {
      return chain;
    },
    update() {
      isUpdate = true;
      return chain;
    },
    delete() {
      isUpdate = true;
      return chain;
    },
    insert() {
      return chain;
    },
    upsert(data: Record<string, unknown>) {
      if (table === "project_cancellation_jobs") {
        adminJobUpserts.push(data as { project_id: string });
      }
      return Promise.resolve({ error: null });
    },
    eq() {
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
    // Direct await (e.g., count queries, delete)
    then(
      onfulfilled?: ((v: unknown) => unknown) | null,
      onrejected?: ((r: unknown) => unknown) | null,
    ) {
      const res = isUpdate
        ? resolveForUpdate()
        : { data: null, count: 0, error: null };
      return Promise.resolve(res).then(onfulfilled, onrejected);
    },
    async single() {
      return isUpdate ? resolveForUpdate() : resolveForSelect();
    },
    async maybeSingle() {
      return isUpdate ? resolveForUpdate() : resolveForSelect();
    },
  };

  return chain;
}

function buildMockClient() {
  return { from: (table: string) => makeChain(table) };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => buildMockClient(),
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => buildMockClient(),
}));

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: mockUser, error: null }),
}));

// ── Dynamic import AFTER all mocks are registered ──────────────────────────

const { updateProjectStatus } = await import("./lifecycle");
const { unrejectSignup, cancelSignup } = await import("./cancellation");

// ── Shared test fixtures ────────────────────────────────────────────────────

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const ORG_ID = "00000000-0000-4000-8000-000000000003";
const SIGNUP_ID = "00000000-0000-4000-8000-000000000004";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000005";

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
      oneTime: { date: "2026-09-01", startTime: "10:00", endTime: "12:00" },
    },
    event_type: "oneTime",
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
  adminJobUpserts.length = 0;
  mockUser = { id: USER_ID };
  mockProject = baseProject();
  mockOrgMember = null;
  mockSignupRow = baseSignup();
  mockProjectUpdateResult = { data: { id: PROJECT_ID }, error: null };
  mockSignupUpdateResult = { data: { id: SIGNUP_ID }, error: null };
});

// ══ updateProjectStatus ═══════════════════════════════════════════════════════

describe("updateProjectStatus", () => {
  test("creator can cancel their project", async () => {
    mockProject = baseProject({ creator_id: USER_ID });
    const result = await updateProjectStatus(
      PROJECT_ID,
      "cancelled",
      "No longer needed",
    );
    expect(result).toMatchObject({ success: true });
  });

  test("org admin can cancel regardless of can_be_managed_by_staff", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "admin" };
    const result = await updateProjectStatus(
      PROJECT_ID,
      "cancelled",
      "Admin decision",
    );
    expect(result).toMatchObject({ success: true });
  });

  test("staff denied when can_be_managed_by_staff is false", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "staff" };
    const result = await updateProjectStatus(
      PROJECT_ID,
      "cancelled",
      "Staff attempt",
    );
    expect("success" in result).toBe(false);
    expect("error" in result).toBe(true);
    // Side effects must be absent regardless of which guard stopped execution
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(adminJobUpserts).toHaveLength(0);
  });

  test("staff permitted when can_be_managed_by_staff is true", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: true,
    });
    mockOrgMember = { role: "staff" };
    const result = await updateProjectStatus(
      PROJECT_ID,
      "cancelled",
      "Staff-managed",
    );
    expect(result).toMatchObject({ success: true });
  });

  test("RLS 0-row no-error returns failure with no side effects", async () => {
    // Auth passes but the DB silently touches 0 rows (RLS filtered)
    mockProject = baseProject({ creator_id: USER_ID });
    mockProjectUpdateResult = { data: null, error: null };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");
    expect(result).toMatchObject({ error: expect.any(String) });
    // Calendar removal and job enqueue must not happen
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(adminJobUpserts).toHaveLength(0);
  });

  test("explicit DB error returns failure with no side effects", async () => {
    mockProject = baseProject({ creator_id: USER_ID });
    mockProjectUpdateResult = {
      data: null,
      error: { message: "db error", code: "PGRST500" },
    };
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(adminJobUpserts).toHaveLength(0);
  });

  test("calendar removal and job enqueue only happen after proven write", async () => {
    mockProject = baseProject({ creator_id: USER_ID });
    mockProjectUpdateResult = { data: { id: PROJECT_ID }, error: null };
    await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");
    // Both side effects should fire after the proven write
    expect(calendarProjectRemovals).toContain(PROJECT_ID);
    expect(adminJobUpserts).toHaveLength(1);
    expect(adminJobUpserts[0]).toMatchObject({ project_id: PROJECT_ID });
  });

  test("non-cancellation status update does not touch calendar or jobs", async () => {
    mockProject = baseProject({ creator_id: USER_ID });
    await updateProjectStatus(PROJECT_ID, "in-progress");
    expect(calendarProjectRemovals).toHaveLength(0);
    expect(adminJobUpserts).toHaveLength(0);
  });

  test("unauthenticated caller is rejected before any DB write", async () => {
    mockUser = null;
    const result = await updateProjectStatus(PROJECT_ID, "cancelled", "Reason");
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarProjectRemovals).toHaveLength(0);
  });
});

// ══ unrejectSignup ════════════════════════════════════════════════════════════

describe("unrejectSignup", () => {
  beforeEach(() => {
    mockSignupRow = {
      ...baseSignup({ status: "rejected" }),
      project: {
        creator_id: USER_ID,
        organization_id: ORG_ID,
        can_be_managed_by_staff: false,
      },
    };
  });

  test("project creator can unreject a signup", async () => {
    const result = await unrejectSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
  });

  test("org admin can unreject regardless of can_be_managed_by_staff", async () => {
    mockSignupRow = {
      ...baseSignup({ status: "rejected" }),
      project: {
        creator_id: "other",
        organization_id: ORG_ID,
        can_be_managed_by_staff: false,
      },
    };
    mockOrgMember = { role: "admin" };
    const result = await unrejectSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
  });

  test("staff denied when can_be_managed_by_staff is false", async () => {
    mockSignupRow = {
      ...baseSignup({ status: "rejected" }),
      project: {
        creator_id: "other",
        organization_id: ORG_ID,
        can_be_managed_by_staff: false,
      },
    };
    mockOrgMember = { role: "staff" };
    const result = await unrejectSignup(SIGNUP_ID);
    expect("success" in result).toBe(false);
    expect("error" in result).toBe(true);
  });

  test("staff permitted when can_be_managed_by_staff is true", async () => {
    mockSignupRow = {
      ...baseSignup({ status: "rejected" }),
      project: {
        creator_id: "other",
        organization_id: ORG_ID,
        can_be_managed_by_staff: true,
      },
    };
    mockOrgMember = { role: "staff" };
    const result = await unrejectSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
  });

  test("RLS 0-row no-error returns failure, no false success", async () => {
    mockSignupUpdateResult = { data: null, error: null };
    const result = await unrejectSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  test("explicit DB error during update propagates as failure", async () => {
    mockSignupUpdateResult = {
      data: null,
      error: { message: "constraint violation" },
    };
    const result = await unrejectSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  test("unauthenticated caller is denied before any DB write", async () => {
    mockUser = null;
    const result = await unrejectSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

// ══ cancelSignup ══════════════════════════════════════════════════════════════

describe("cancelSignup — participant cancels own signup", () => {
  beforeEach(() => {
    // Participant cancels their own signup
    mockUser = { id: PARTICIPANT_ID };
    mockSignupRow = baseSignup({ user_id: PARTICIPANT_ID });
  });

  test("participant cancels their signup successfully", async () => {
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
    expect(calendarSignupRemovals).toContain(SIGNUP_ID);
  });

  test("calendar removal happens only after the DB write is proven", async () => {
    // Verify order: if DB write is attempted and succeeds, calendar fires
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
    expect(calendarSignupRemovals).toHaveLength(1);
  });

  test("RLS 0-row no-error: calendar NOT removed, error returned", async () => {
    mockSignupUpdateResult = { data: null, error: null };
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("explicit DB error: calendar NOT removed", async () => {
    mockSignupUpdateResult = {
      data: null,
      error: { message: "foreign key violation" },
    };
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("repeat cancellation: second call returns error with no additional side effects", async () => {
    // First cancellation succeeds
    await cancelSignup(SIGNUP_ID);
    expect(calendarSignupRemovals).toHaveLength(1);

    // Second attempt: DB returns 0 rows (already cancelled / RLS blocks re-cancel)
    calendarSignupRemovals.length = 0;
    mockSignupUpdateResult = { data: null, error: null };
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarSignupRemovals).toHaveLength(0);
  });
});

describe("cancelSignup — organizer cancels on behalf of participant", () => {
  beforeEach(() => {
    // Creator acts as organizer
    mockUser = { id: USER_ID };
    mockSignupRow = baseSignup({ user_id: PARTICIPANT_ID });
    // Project lookup returns creator_id matching mockUser
    mockProject = baseProject({ creator_id: USER_ID, organization_id: null });
  });

  test("project creator can cancel a participant signup", async () => {
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
    expect(calendarSignupRemovals).toContain(SIGNUP_ID);
  });

  test("org admin can cancel a participant signup (can_be_managed_by_staff irrelevant)", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "admin" };
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ success: true });
    expect(calendarSignupRemovals).toContain(SIGNUP_ID);
  });

  test("staff denied for organizer cancel when can_be_managed_by_staff is false", async () => {
    mockProject = baseProject({
      creator_id: "other",
      can_be_managed_by_staff: false,
    });
    mockOrgMember = { role: "staff" };
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarSignupRemovals).toHaveLength(0);
  });

  test("organizer cancel: calendar not removed when DB write fails", async () => {
    mockSignupUpdateResult = { data: null, error: null };
    const result = await cancelSignup(SIGNUP_ID);
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(calendarSignupRemovals).toHaveLength(0);
  });
});
