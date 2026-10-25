import { beforeEach, expect, mock, test } from "bun:test";

import type { DeleteUserCleanupReport } from "@/lib/supabase/delete-user-with-cleanup";

const subjectId = "c64a0900-0000-4000-8000-000000000001";
const operationId = "c64a0910-0000-4000-8000-000000000001";
let authenticated = true;
let unexpectedFailure = false;
let report: DeleteUserCleanupReport;
const calls: unknown[] = [];
const admin = { fixture: true };

mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options: unknown) => {
    calls.push(["authenticate", options]);
    return authenticated
      ? { user: { id: subjectId }, error: null }
      : { user: null, error: "private authentication details" };
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    calls.push(["admin"]);
    return admin;
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signOut: async () => {
        calls.push(["signOut"]);
        return { error: null };
      },
    },
  }),
}));
const { accountDeletionFailureMessage } =
  await import("@/lib/supabase/delete-user-with-cleanup");
mock.module("@/lib/supabase/delete-user-with-cleanup", () => ({
  accountDeletionFailureMessage,
  deleteUserWithCleanup: async (...args: unknown[]) => {
    calls.push(["delete", ...args]);
    if (unexpectedFailure) throw new Error("private storage failure details");
    return report;
  },
}));
const { deleteAccount } = await import("./actions");

beforeEach(() => {
  authenticated = true;
  unexpectedFailure = false;
  calls.length = 0;
  report = {
    userId: subjectId,
    operationId,
    phase: "blocked",
    blockedBySoleAdminOrgs: [],
    blockers: { plugin_retention_review_required: true },
    deletedCounts: {},
    skipped: [],
    notes: [],
    completedNow: false,
  };
});

test("retention refusal returns safe action data instead of a production-redacted exception", async () => {
  const result = await deleteAccount();
  expect(result).toEqual({
    success: false,
    error:
      "Account removal is blocked. Disconnect linked providers and resolve retained organization, plugin, or storage records before retrying. No account data was removed.",
  });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(calls).toEqual([
    [
      "authenticate",
      { sensitive: true, checkMfa: true, allowAccountDeletion: true },
    ],
    ["admin"],
    [
      "delete",
      admin,
      subjectId,
      { deleteProjects: true, deleteOrganizations: false },
    ],
  ]);
});

test("sole-admin refusal preserves the reviewed ownership instructions", async () => {
  report.blockedBySoleAdminOrgs = [
    {
      organization_id: "c64a0920-0000-4000-8000-000000000001",
      organization_name: "Fictional service club",
    },
  ];
  expect(await deleteAccount()).toEqual({
    success: false,
    error:
      "Add another active admin before deleting this account: Fictional service club.",
  });
  expect(calls.some((call) => JSON.stringify(call) === '["signOut"]')).toBe(
    false,
  );
});

test("pending external cleanup returns its recovery receipt without signing out", async () => {
  report.phase = "external_pending";
  report.blockers = {};
  expect(await deleteAccount()).toEqual({
    success: false,
    error: `Account cleanup is pending. Retry deletion or contact support with operation ${operationId}.`,
  });
  expect(calls.some((call) => JSON.stringify(call) === '["signOut"]')).toBe(
    false,
  );
});

test("authentication failure returns sign-in guidance before privileged work", async () => {
  authenticated = false;
  expect(await deleteAccount()).toEqual({
    success: false,
    error: "Sign in again to delete your account.",
  });
  expect(calls).toHaveLength(1);
});

test("only completed deletion signs out and returns success", async () => {
  report.phase = "completed";
  report.blockers = {};
  report.completedNow = true;
  expect(await deleteAccount()).toEqual({ success: true });
  expect(calls.at(-1)).toEqual(["signOut"]);
});

test("unexpected failures remain exceptions rather than serialized private error data", async () => {
  unexpectedFailure = true;
  await expect(deleteAccount()).rejects.toThrow(
    "private storage failure details",
  );
  expect(calls.some((call) => JSON.stringify(call) === '["signOut"]')).toBe(
    false,
  );
});
