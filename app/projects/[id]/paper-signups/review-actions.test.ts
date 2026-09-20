import { beforeEach, expect, mock, test } from "bun:test";

let allowed = true;
let rpcError: { code: string; message: string } | null = null;
let rpcData: unknown = "updated";
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
mock.module("./access", () => ({
  requirePaperScanAccess: async () =>
    allowed
      ? {
          ok: true,
          userId: "fictional-organizer",
          project: { title: "Fictional project", project_timezone: "UTC" },
          admin: {
            rpc: async (name: string, args: Record<string, unknown>) => {
              calls.push({ name, args });
              return { data: rpcData, error: rpcError };
            },
            from: (table: string) => {
              if (table !== "project_paper_scan_batches")
                throw new Error(`Unexpected read from ${table}`);
              const query = {
                select: () => query,
                eq: () => query,
                single: async () => ({ data: { schedule_id: "oneTime" } }),
              };
              return query;
            },
          },
        }
      : { ok: false, error: "Not authorized" },
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => null,
}));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => null }));
mock.module("@/lib/projects/hours-publication-email-service", () => ({
  drainPublicationEmails: async () => {},
  loadDurablePublicationForRetry: async () => {},
}));
mock.module("../hours/certificate-issuance", () => ({
  getPublishStateKey: () => "oneTime",
  issueCertificatesForSignups: async () => {},
}));
const { updatePaperScanRow, commitPaperScanBatch } = await import("./actions");

const input = {
  projectId: "f1111111-1111-4111-8111-111111111111",
  batchId: "f2222222-2222-4222-8222-222222222222",
  rowId: "f3333333-3333-4333-8333-333333333333",
  patch: { decision: "exclude" as const, expectedRevision: 4 },
};
beforeEach(() => {
  allowed = true;
  rpcError = null;
  rpcData = "updated";
  calls.length = 0;
});

test("a concurrent saved-roster exclusion returns an actionable message", async () => {
  rpcError = {
    code: "22023",
    message: "saved attendance must remain included",
  };
  expect(await updatePaperScanRow(input)).toEqual({
    error: "This row already has saved attendance. Review it to make changes.",
  });
  expect(calls).toEqual([
    {
      name: "update_paper_scan_review_row",
      args: {
        p_project_id: input.projectId,
        p_batch_id: input.batchId,
        p_row_id: input.rowId,
        p_actor_id: "fictional-organizer",
        p_patch: input.patch,
      },
    },
  ]);
});

test("stale review revisions still tell the coordinator to reload", async () => {
  rpcError = {
    code: "40001",
    message: "review row changed; refresh before saving",
  };
  expect(await updatePaperScanRow(input)).toEqual({
    error: "This row changed in another window. Reload before editing.",
  });
});

test("unrelated database details are not returned to the browser", async () => {
  rpcError = { code: "22023", message: "unrelated internal detail" };
  expect(await updatePaperScanRow(input)).toEqual({
    error: "Could not save the row.",
  });
});

test("revoked organizer access does not call the privileged update", async () => {
  allowed = false;
  expect(await updatePaperScanRow(input)).toEqual({ error: "Not authorized" });
  expect(calls).toEqual([]);
});

test("an allowed unsaved row still saves its decision", async () => {
  expect(await updatePaperScanRow(input)).toEqual({ success: true });
  expect(calls).toHaveLength(1);
});

test("reconciling a saved roster reports existing attendance without issuing credit or delivery", async () => {
  rpcData = [
    {
      row_id: input.rowId,
      outcome: "skipped",
      signup_id: "f4444444-4444-4444-8444-444444444444",
      anonymous_id: "f5555555-5555-4555-8555-555555555555",
      user_id: null,
      over_capacity: false,
      detail: "reconciled_existing_attendance",
    },
  ];
  expect(
    await commitPaperScanBatch({
      projectId: input.projectId,
      batchId: input.batchId,
      rowIds: [input.rowId],
      allowOverCapacity: false,
      idempotencyKey: "f6666666-6666-4666-8666-666666666666",
    }),
  ).toEqual({
    success: true,
    created: 0,
    updated: 0,
    rosterOnly: 0,
    reconciled: 1,
    overCapacity: 0,
    failed: [],
    certificatesIssued: 0,
    certificateErrors: [],
    notificationsQueued: 0,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].name).toBe("commit_paper_signup_batch");
});
