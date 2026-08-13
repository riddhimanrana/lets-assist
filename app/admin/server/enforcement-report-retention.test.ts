import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Enforcement removes an account's data but must not remove the reports that
 * account filed about other people's content.
 *
 * This path bans the auth row rather than deleting it, so the `ON DELETE SET
 * NULL` foreign key never fires and nothing downstream repeats the
 * detachment. A failed detach therefore has to stop the action outright.
 */

mock.module("server-only", () => ({}));

let detachFails = false;
let detachCalls: string[] = [];
let operations: Array<{ relation: string; verb: string }> = [];
let banCalls: string[] = [];
let emails: string[] = [];

mock.module("@/lib/moderation/content-report-retention", () => ({
  detachContentReportReporter: async (
    _client: unknown,
    userId: string,
  ): Promise<void> => {
    detachCalls.push(userId);
    if (detachFails) throw new Error("Failed to detach content reports: down");
  },
}));

function chain(relation: string, verb: string) {
  operations.push({ relation, verb });
  const link = {
    eq: () => link,
    in: () => link,
    select: () => link,
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: () => link,
    then: (
      resolve: (result: {
        data: unknown[];
        error: { message: string } | null;
      }) => unknown,
    ) => Promise.resolve(resolve({ data: [], error: null })),
  };
  return link;
}

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (relation: string) => ({
      select: () => chain(relation, "select"),
      update: () => chain(relation, "update"),
      delete: () => chain(relation, "delete"),
      upsert: () => chain(relation, "upsert"),
    }),
    auth: {
      admin: {
        getUserById: async (userId: string) => ({
          data: { user: { id: userId, email: "banned@example.test" } },
          error: null,
        }),
        updateUserById: async (userId: string) => {
          banCalls.push(userId);
          return { error: null };
        },
      },
    },
  }),
}));

mock.module("./auth", () => ({
  checkSuperAdmin: async () => ({
    isAdmin: true,
    userId: "40000000-0000-4000-8000-000000000001",
  }),
}));

mock.module("@/services/email", () => ({
  sendEmail: async (payload: { to: string }) => {
    emails.push(payload.to);
    return { data: null, error: null };
  },
}));

mock.module("@/emails/account-access-update", () => ({
  default: () => null,
}));

mock.module("./shared", () => ({
  createServerNotification: async () => {},
  readBannedUntil: () => null,
}));

const { deleteAndBlacklistUser } = await import("./enforcement");

const USER_ID = "20000000-0000-4000-8000-000000000002";

beforeEach(() => {
  detachFails = false;
  detachCalls = [];
  operations = [];
  banCalls = [];
  emails = [];
});

describe("enforcement retains moderation evidence", () => {
  test("a banned account's reports are detached, never deleted", async () => {
    const result = await deleteAndBlacklistUser({
      userId: USER_ID,
      reason: "abuse",
      sendEmail: false,
    });

    expect(result).toEqual({ success: true });
    expect(detachCalls).toEqual([USER_ID]);
    expect(
      operations.some(
        (operation) =>
          operation.relation === "content_reports" &&
          operation.verb === "delete",
      ),
    ).toBe(false);
    expect(banCalls).toEqual([USER_ID]);
  });

  test("a failed detach stops the action before anything is destroyed", async () => {
    detachFails = true;

    const result = await deleteAndBlacklistUser({
      userId: USER_ID,
      reason: "abuse",
      sendEmail: false,
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/No data was removed/u);
    expect(operations.some((operation) => operation.verb === "delete")).toBe(
      false,
    );
    expect(banCalls).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });
});
