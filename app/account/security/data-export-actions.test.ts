import { beforeEach, expect, mock, test } from "bun:test";
const userId = "fa900000-0000-4000-8000-000000000001";
const id = "fa900000-0000-4000-8000-000000000002";
const authCalls: unknown[] = [];
const calls: unknown[] = [];
let authorized = true;
let failure = false;
const row = {
  id,
  user_id: userId,
  status: "completed",
  delivery_email: "synthetic@example.test",
  requested_at: "2026-10-07T00:00:00Z",
  completed_at: "2026-10-07T00:00:00Z",
  artifact_expires_at: "2099-01-01T00:00:00Z",
  artifact_ready_at: "2026-10-07T00:00:00Z",
  storage_path: `${userId}/${id}/fa900000-0000-4000-8000-000000000003.zip`,
  zip_size_bytes: 12,
  record_count: 1,
  delivery_status: "accepted",
  protocol_version: 2,
  error_message: null,
};
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options: unknown) => {
    authCalls.push(options);
    return authorized
      ? { user: { id: userId, email: "synthetic@example.test" }, error: null }
      : { user: null, error: "denied" };
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return failure
        ? { data: null, error: { message: "private provider details" } }
        : { data: { id, existing: true }, error: null };
    },
    from: () => {
      const q = {
        select: () => q,
        eq: (...args: unknown[]) => {
          calls.push(args);
          return q;
        },
        order: () => q,
        limit: async () => ({ data: [row], error: null }),
        single: async () => ({ data: row, error: null }),
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://synthetic.example.test/download" },
          error: null,
        }),
      }),
    },
  }),
}));
const { requestDataExport, readDataExportJobs, downloadDataExport } =
  await import("./data-export-actions");
beforeEach(() => {
  authorized = true;
  failure = false;
  authCalls.length = 0;
  calls.length = 0;
});
test("request and download require fresh authentication with MFA before privileged access", async () => {
  authorized = false;
  expect((await requestDataExport()).success).toBe(false);
  expect((await downloadDataExport(id)).success).toBe(false);
  expect(authCalls).toEqual([
    { sensitive: true, checkMfa: true },
    { sensitive: true, checkMfa: true },
  ]);
  expect(calls).toEqual([]);
});
test("request uses server-authenticated subject and reads the returned receipt under that subject", async () => {
  const result = await requestDataExport();
  expect(result.success).toBe(true);
  expect(calls).toEqual([
    ["request_account_data_export", { p_user_id: userId }],
    ["id", id],
    ["user_id", userId],
  ]);
  if (result.success) {
    expect(result.existing).toBe(true);
    expect(result.job.status).toBe("completed");
    expect(result.queued).toBe(false);
  }
});
test("an ambiguous request gives neutral retry guidance without provider details", async () => {
  failure = true;
  const result = await requestDataExport();
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private provider details");
  expect(JSON.stringify(result)).toContain("Refresh the request history");
});
test("history remains subject-scoped and omits storage paths and capabilities", async () => {
  const result = await readDataExportJobs();
  expect(calls).toEqual([["user_id", userId]]);
  expect(JSON.stringify(result)).not.toContain("storage_path");
  expect(JSON.stringify(result)).not.toContain("signed_url");
});
test("download authenticates before resolving a job for the same subject", async () => {
  const result = await downloadDataExport(id);
  expect(result.success).toBe(true);
  expect(authCalls).toEqual([{ sensitive: true, checkMfa: true }]);
  expect(calls).toEqual([
    ["id", id],
    ["user_id", userId],
  ]);
});
