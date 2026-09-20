import { beforeEach, expect, mock, test } from "bun:test";

let allowed = true;
let rpcError: { code: string; message: string } | null = null;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
mock.module("./access", () => ({
  requirePaperScanAccess: async () =>
    allowed
      ? {
          ok: true,
          userId: "fictional-organizer",
          admin: {
            rpc: async (name: string, args: Record<string, unknown>) => {
              calls.push({ name, args });
              return { data: "updated", error: rpcError };
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
const { updatePaperScanRow } = await import("./actions");

const input = {
  projectId: "f1111111-1111-4111-8111-111111111111",
  batchId: "f2222222-2222-4222-8222-222222222222",
  rowId: "f3333333-3333-4333-8333-333333333333",
  patch: { decision: "exclude" as const, expectedRevision: 4 },
};
beforeEach(() => {
  allowed = true;
  rpcError = null;
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
