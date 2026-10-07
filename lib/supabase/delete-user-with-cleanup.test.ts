import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteUserWithCleanup,
  resumeAccountDeletionOperation,
} from "./delete-user-with-cleanup";

const userId = "fd900000-0000-4000-8000-000000000001";
const operationId = "fd910000-0000-4000-8000-000000000001";
const objectId = "fd920000-0000-4000-8000-000000000001";
function fixture(
  options: {
    blocked?: boolean;
    storageFailure?: boolean;
    authFailure?: boolean;
    lostAuthResponse?: boolean;
    lostCommitResponse?: boolean;
    blacklist?: boolean;
  } = {},
) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let removed = false;
  let storageRemoved = false;
  let failedOnce = false;
  const operation = {
    id: operationId,
    target_user_id: userId,
    requested_by: userId,
    mode: options.blacklist ? "admin_blacklist" : "self_delete",
    phase: options.blocked ? "blocked" : "external_pending",
    blockers: options.blocked ? { plugin_retention_review_required: true } : {},
    safe_error_code: null as string | null,
    deleted_counts: { profiles: 1 },
    claim_token: "fd930000-0000-4000-8000-000000000001" as string | null,
  };
  const client = {
    from() {
      throw new Error("Client-side table deletion is forbidden");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "preflight_account_deletion")
        return { data: operation.blockers, error: null };
      if (
        name === "begin_account_deletion" &&
        options.lostCommitResponse &&
        !failedOnce
      ) {
        failedOnce = true;
        return { data: null, error: { message: "private provider details" } };
      }
      if (name === "claim_account_deletion_cleanup")
        return {
          data: {
            ...operation,
            objects: storageRemoved
              ? []
              : [
                  {
                    id: objectId,
                    bucket_id: "avatars",
                    object_name: `${userId}-123.webp`,
                  },
                ],
          },
          error: null,
        };
      if (name === "advance_account_deletion_cleanup") {
        if (args.p_step === "storage_removed") storageRemoved = true;
        if (args.p_step === "complete") {
          if (!removed || !storageRemoved)
            return { data: null, error: { message: "unconfirmed" } };
          operation.phase = "completed";
          operation.claim_token = null;
        }
        if (
          args.p_step === "auth_cleanup_failed" ||
          args.p_step === "storage_cleanup_failed"
        )
          operation.safe_error_code = args.p_step;
      }
      return { data: { ...operation }, error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            calls.push({ name: "storage.remove", args: { bucket, paths } });
            if (options.storageFailure && !failedOnce) {
              failedOnce = true;
              return { error: { message: "sensitive storage error" } };
            }
            return { error: null };
          },
        };
      },
    },
    auth: {
      admin: {
        async deleteUser(target: string) {
          calls.push({ name: "auth.delete", args: { target } });
          if (removed) return { error: { code: "user_not_found" } };
          if (options.authFailure && !failedOnce) {
            failedOnce = true;
            return {
              error: { code: "unexpected_failure", message: "private details" },
            };
          }
          removed = true;
          if (options.lostAuthResponse && !failedOnce) {
            failedOnce = true;
            throw new Error("transport interrupted after commit");
          }
          return { error: null };
        },
        async updateUserById(target: string, values: unknown) {
          calls.push({ name: "auth.ban", args: { target, values } });
          removed = true;
          return { error: null };
        },
      },
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("durable account cleanup", () => {
  test("a refused preflight performs no external cleanup", async () => {
    const { client, calls } = fixture({ blocked: true });
    expect((await deleteUserWithCleanup(client, userId)).phase).toBe("blocked");
    expect(calls.map((call) => call.name)).toEqual(["begin_account_deletion"]);
  });
  test("dry run only reads preflight and never begins an operation", async () => {
    const { client, calls } = fixture();
    expect(
      (await deleteUserWithCleanup(client, userId, { dryRun: true })).phase,
    ).toBe("preflight");
    expect(calls.map((call) => call.name)).toEqual([
      "preflight_account_deletion",
    ]);
  });
  test("cleanup removes only saved Storage paths before Auth and confirms completion", async () => {
    const { client, calls } = fixture();
    const result = await deleteUserWithCleanup(client, userId);
    expect(result.phase).toBe("completed");
    expect(result.completedNow).toBe(true);
    expect(calls.find((call) => call.name === "storage.remove")?.args).toEqual({
      bucket: "avatars",
      paths: [`${userId}-123.webp`],
    });
    expect(
      calls.findIndex((call) => call.name === "storage.remove"),
    ).toBeLessThan(calls.findIndex((call) => call.name === "auth.delete"));
    expect(calls.at(-1)?.args?.p_step).toBe("complete");
  });
  test("Storage failure preserves a retry receipt and never calls Auth", async () => {
    const { client, calls } = fixture({ storageFailure: true });
    const pending = await deleteUserWithCleanup(client, userId);
    expect(pending.phase).toBe("external_pending");
    expect(pending.notes).toEqual(["storage_cleanup_failed"]);
    expect(calls.some((call) => call.name === "auth.delete")).toBe(false);
    expect(
      (await resumeAccountDeletionOperation(client, operationId)).phase,
    ).toBe("completed");
  });
  test("Auth failure retries without repeating confirmed Storage deletion", async () => {
    const { client, calls } = fixture({ authFailure: true });
    expect((await deleteUserWithCleanup(client, userId)).phase).toBe(
      "external_pending",
    );
    expect(
      (await resumeAccountDeletionOperation(client, operationId)).phase,
    ).toBe("completed");
    expect(calls.filter((call) => call.name === "storage.remove")).toHaveLength(
      1,
    );
  });
  test("a lost successful Auth response resumes after user_not_found and DB readback", async () => {
    const { client, calls } = fixture({ lostAuthResponse: true });
    expect((await deleteUserWithCleanup(client, userId)).phase).toBe(
      "external_pending",
    );
    expect(
      (await resumeAccountDeletionOperation(client, operationId)).phase,
    ).toBe("completed");
    expect(calls.filter((call) => call.name === "auth.delete")).toHaveLength(2);
  });
  test("unknown database commit response sends no external call until receipt retry", async () => {
    const { client, calls } = fixture({ lostCommitResponse: true });
    await expect(deleteUserWithCleanup(client, userId)).rejects.toThrow(
      "Account cleanup could not be confirmed",
    );
    expect(calls.map((call) => call.name)).toEqual(["begin_account_deletion"]);
    expect((await deleteUserWithCleanup(client, userId)).phase).toBe(
      "completed",
    );
  });
  test("a completed retry performs no external cleanup or second notification transition", async () => {
    const { client, calls } = fixture();
    await deleteUserWithCleanup(client, userId);
    calls.length = 0;
    expect((await deleteUserWithCleanup(client, userId)).completedNow).toBe(
      false,
    );
    expect(calls.map((call) => call.name)).toEqual(["begin_account_deletion"]);
  });
  test("administrative removal bans Auth through the same saved operation", async () => {
    const { client, calls } = fixture({ blacklist: true });
    expect(
      (await deleteUserWithCleanup(client, userId, { mode: "admin_blacklist" }))
        .phase,
    ).toBe("completed");
    expect(calls.some((call) => call.name === "auth.ban")).toBe(true);
    expect(calls.some((call) => call.name === "auth.delete")).toBe(false);
  });
  test("organization removal cannot be smuggled through account options", async () => {
    const { client, calls } = fixture();
    await expect(
      deleteUserWithCleanup(client, userId, { deleteOrganizations: true }),
    ).rejects.toThrow("Transfer organization ownership");
    expect(calls).toHaveLength(0);
  });
});
