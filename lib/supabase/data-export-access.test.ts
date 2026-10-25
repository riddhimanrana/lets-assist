import { expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountExportJobDto,
  createAccountExportDownload,
} from "./data-export-access";
const user = "fa900000-0000-4000-8000-000000000001";
const id = "fa900000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-07T00:00:00Z");
function fixture(changes: Record<string, unknown> = {}) {
  const row = {
    id,
    user_id: user,
    status: "completed",
    protocol_version: 2,
    storage_path: `${user}/${id}/fa900000-0000-4000-8000-000000000003.zip`,
    artifact_ready_at: "2026-10-07T00:00:00Z",
    artifact_expires_at: "2026-10-08T00:00:00Z",
    ...changes,
  };
  const filters: unknown[] = [];
  const signed: unknown[] = [];
  const client = {
    from: () => {
      const q = {
        select: () => q,
        eq: (...args: unknown[]) => {
          filters.push(args);
          return q;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (...args: unknown[]) => {
          signed.push(args);
          return {
            data: { signedUrl: "https://synthetic.example.test/download" },
            error: null,
          };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, filters, signed };
}
test("download binds both account and job and lasts at most five minutes", async () => {
  const h = fixture();
  await createAccountExportDownload(h.client, user, id, now);
  expect(h.filters).toEqual([
    ["id", id],
    ["user_id", user],
  ]);
  expect(h.signed[0]).toEqual([
    `${user}/${id}/fa900000-0000-4000-8000-000000000003.zip`,
    300,
    { download: "lets-assist-account-data.zip" },
  ]);
});
for (const changes of [
  { user_id: "fa900000-0000-4000-8000-000000000099" },
  { status: "processing" },
  { protocol_version: 1 },
  { artifact_ready_at: null },
  { artifact_expires_at: "invalid" },
  { artifact_expires_at: "2026-10-06T00:00:00Z" },
  { storage_path: "someone-else/private.zip" },
  { id: "fa900000-0000-4000-8000-000000000099" },
])
  test("unavailable, stale, legacy, or unowned archives never receive a download capability", async () => {
    const h = fixture(changes);
    await expect(
      createAccountExportDownload(h.client, user, id, now),
    ).rejects.toThrow();
    expect(h.signed).toHaveLength(0);
  });
test("download capability cannot outlive archive retention", async () => {
  const h = fixture({ artifact_expires_at: "2026-10-07T00:00:09Z" });
  await createAccountExportDownload(h.client, user, id, now);
  expect((h.signed[0] as unknown[])[1]).toBe(9);
});
test("history never returns legacy raw provider error bodies", () => {
  const dto = accountExportJobDto({
    id,
    status: "failed",
    delivery_email: "synthetic@example.test",
    requested_at: "2026-10-07",
    completed_at: null,
    artifact_expires_at: null,
    zip_size_bytes: null,
    record_count: 0,
    delivery_status: "not_attempted",
    protocol_version: 1,
    error_message: "synthetic-provider-secret",
  });
  expect(JSON.stringify(dto)).not.toContain("synthetic-provider-secret");
});
