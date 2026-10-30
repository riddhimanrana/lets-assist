/**
 * Who can read a project's feedback summary, with auth, the admin client and
 * the user-scoped client mocked. Pins the readers the volunteer-facing copy
 * names (project managers and Let's Assist administrators). It does not test
 * the SQL policy itself; pgTAP owns that. No permission is changed here.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

const PROJECT = "00000000-0000-4000-8000-0000000000f1";
let viewer: { id: string; superAdmin?: boolean } | null;
let project: {
  creator_id: string;
  organization_id: string | null;
  can_be_managed_by_staff: boolean;
};
let membershipRole: string | null;
let feedbackReads = 0;

function query(result: () => unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order"]) chain[name] = () => chain;
  chain.single = async () => ({ data: result() });
  chain.maybeSingle = async () => ({ data: result() });
  chain.then = (resolve: (value: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 });
  return chain;
}

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () =>
    viewer ? { user: viewer, error: null } : { user: null, error: "none" },
}));
mock.module("@/lib/auth/super-admin", () => ({
  isSuperAdminUser: (user: { superAdmin?: boolean }) =>
    Boolean(user.superAdmin),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) =>
      query(() =>
        table === "projects"
          ? project
          : membershipRole
            ? { role: membershipRole }
            : null,
      ),
  }),
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      feedbackReads += 1;
      return query(() => null);
    },
  }),
}));
mock.module("next/cache", () => ({ revalidatePath() {} }));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("@/lib/ai/rate-limit", () => ({
  consumeAiQuota: async () => true,
}));
mock.module("@/services/moderation", () => ({
  moderateText: async () => ({}),
  notifyAdminFlaggedContent: async () => {},
}));

const { getProjectFeedbackSummary } = await import("./feedback");

beforeEach(() => {
  viewer = { id: "viewer" };
  project = {
    creator_id: "creator",
    organization_id: "org-1",
    can_be_managed_by_staff: false,
  };
  membershipRole = null;
  feedbackReads = 0;
});

const read = async () => (await getProjectFeedbackSummary(PROJECT)).success;

describe("feedback summary readers", () => {
  test("the project creator can read it", async () => {
    viewer = { id: "creator" };
    expect(await read()).toBe(true);
  });

  test("an organization admin can read it", async () => {
    membershipRole = "admin";
    expect(await read()).toBe(true);
  });

  test("staff can read it only when the project allows staff management", async () => {
    membershipRole = "staff";
    expect(await read()).toBe(false);
    project.can_be_managed_by_staff = true;
    expect(await read()).toBe(true);
  });

  test("a Let's Assist administrator can read it", async () => {
    viewer = { id: "platform-admin", superAdmin: true };
    expect(await read()).toBe(true);
  });

  test("an ordinary member or a stranger cannot, and no rows are read", async () => {
    membershipRole = "member";
    expect(await read()).toBe(false);
    membershipRole = null;
    expect(await read()).toBe(false);
    expect(feedbackReads).toBe(0);
  });

  test("signed out cannot", async () => {
    viewer = null;
    expect(await read()).toBe(false);
  });
});
