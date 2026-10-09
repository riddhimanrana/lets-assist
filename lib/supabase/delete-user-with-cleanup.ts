import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const storageObject = z.object({
  id: z.uuid(),
  bucket_id: z.enum(["avatars", "data-exports"]),
  object_name: z.string().min(1).max(1024),
});
const blockersSchema = z.record(z.string(), z.unknown());
const operationSchema = z.object({
  id: z.uuid(),
  target_user_id: z.uuid(),
  requested_by: z.uuid(),
  mode: z.enum(["self_delete", "admin_blacklist"]),
  phase: z.enum([
    "database_pending",
    "blocked",
    "external_pending",
    "completed",
  ]),
  deleted_counts: z.record(z.string(), z.number().int().nonnegative()),
  blockers: blockersSchema,
  safe_error_code: z.string().nullable(),
  reason: z.string().max(1000).nullable().default(null),
  claim_token: z.uuid().nullable(),
  objects: z.array(storageObject).max(500).optional(),
});
type Operation = z.infer<typeof operationSchema>;
type SoleAdminOrg = {
  organization_id: string;
  organization_name: string | null;
};
export type DeleteUserWithCleanupOptions = {
  deleteProjects?: boolean;
  deleteOrganizations?: boolean;
  dryRun?: boolean;
  actorId?: string;
  reason?: string;
  mode?: "self_delete" | "admin_blacklist";
};
export type DeleteUserCleanupReport = {
  userId: string;
  operationId?: string;
  phase: "blocked" | "external_pending" | "completed" | "preflight";
  blockedBySoleAdminOrgs: SoleAdminOrg[];
  blockers: Record<string, unknown>;
  deletedCounts: Record<string, number>;
  skipped: string[];
  notes: string[];
  completedNow: boolean;
};
function report(
  operation: Operation,
  completedNow = false,
): DeleteUserCleanupReport {
  return {
    userId: operation.target_user_id,
    operationId: operation.id,
    phase:
      operation.phase === "database_pending"
        ? "external_pending"
        : operation.phase,
    blockedBySoleAdminOrgs: readSoleAdminOrgs(operation.blockers),
    blockers: operation.blockers,
    deletedCounts: operation.deleted_counts,
    skipped: [],
    notes: operation.safe_error_code ? [operation.safe_error_code] : [],
    completedNow,
  };
}
function readSoleAdminOrgs(blockers: Record<string, unknown>): SoleAdminOrg[] {
  return z
    .array(
      z.object({
        organization_id: z.uuid(),
        organization_name: z.string().nullable(),
      }),
    )
    .parse(blockers.sole_admin_organizations ?? []);
}
async function receiptRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      "Account cleanup could not be confirmed. Retry the saved operation.",
    );
  return operationSchema.parse(data);
}

/** Resume a service-owned operation. The claim supplies the frozen target and storage paths. */
export async function resumeAccountDeletionOperation(
  client: SupabaseClient,
  operationId: string,
): Promise<DeleteUserCleanupReport> {
  let operation = await receiptRpc(client, "claim_account_deletion_cleanup", {
    p_operation: z.uuid().parse(operationId),
  });
  if (operation.phase === "completed") return report(operation);
  if (
    operation.phase !== "external_pending" ||
    !operation.claim_token ||
    !operation.objects
  )
    throw new Error("Account cleanup returned an invalid claim.");
  const claim = operation.claim_token;
  const pendingObjects = operation.objects;
  const advance = (step: string, ids: string[] = []) =>
    receiptRpc(client, "advance_account_deletion_cleanup", {
      p_operation: operationId,
      p_claim: claim,
      p_step: step,
      p_object_ids: ids,
    });
  const failed = async (
    step: "storage_cleanup_failed" | "auth_cleanup_failed",
  ) => {
    try {
      operation = await advance(step);
    } catch {
      /* The lease expires after an uncertain response. */
    }
    return report({
      ...operation,
      phase: "external_pending",
      safe_error_code: step,
    });
  };
  for (const bucket of ["avatars", "data-exports"] as const) {
    const objects = pendingObjects.filter(
      (object) => object.bucket_id === bucket,
    );
    for (let index = 0; index < objects.length; index += 100) {
      const batch = objects.slice(index, index + 100);
      try {
        await advance("renew");
        const { error } = await client.storage
          .from(bucket)
          .remove(batch.map((object) => object.object_name));
        if (error) return await failed("storage_cleanup_failed");
        await advance(
          "storage_removed",
          batch.map((object) => object.id),
        );
      } catch {
        return await failed("storage_cleanup_failed");
      }
    }
  }
  try {
    await advance("renew");
    if (operation.mode === "self_delete") {
      const { error } = await client.auth.admin.deleteUser(
        operation.target_user_id,
      );
      // A lost successful response can leave an already-removed user on retry.
      // The final RPC independently verifies absence before completing.
      if (error && error.code !== "user_not_found")
        return await failed("auth_cleanup_failed");
    } else {
      const { error } = await client.auth.admin.updateUserById(
        operation.target_user_id,
        {
          ban_duration: "876000h",
          app_metadata: {
            account_access: {
              status: "banned",
              reason:
                operation.reason ??
                "Account removal approved by an administrator.",
              updated_at: new Date().toISOString(),
              updated_by: operation.requested_by,
            },
          },
        },
      );
      if (error) return await failed("auth_cleanup_failed");
    }
    operation = await advance("complete");
    if (operation.phase !== "completed")
      throw new Error("Account cleanup is incomplete.");
    return report(operation, true);
  } catch {
    return await failed("auth_cleanup_failed");
  }
}

export async function deleteUserWithCleanup(
  client: SupabaseClient,
  userId: string,
  options: DeleteUserWithCleanupOptions = {},
): Promise<DeleteUserCleanupReport> {
  if (options.deleteOrganizations)
    throw new Error(
      "Transfer organization ownership before deleting an account.",
    );
  const args = {
    p_actor: z.uuid().parse(options.actorId ?? userId),
    p_target: z.uuid().parse(userId),
    p_mode: options.mode ?? "self_delete",
    p_delete_projects: options.deleteProjects ?? true,
  };
  if (options.dryRun) {
    const { data, error } = await client.rpc(
      "preflight_account_deletion",
      args,
    );
    if (error)
      throw new Error("Account deletion preflight could not be completed.");
    const blockers = blockersSchema.parse(data);
    return {
      userId,
      phase: "preflight",
      blockers,
      blockedBySoleAdminOrgs: readSoleAdminOrgs(blockers),
      deletedCounts: {},
      skipped: ["Read-only preflight"],
      notes: [],
      completedNow: false,
    };
  }
  const operation = await receiptRpc(client, "begin_account_deletion", {
    ...args,
    p_reason: options.reason?.trim() || null,
  });
  if (
    operation.target_user_id !== userId ||
    operation.requested_by !== args.p_actor ||
    operation.mode !== args.p_mode
  )
    throw new Error(
      "Account deletion intent did not match the requested account.",
    );
  if (operation.phase !== "external_pending") return report(operation);
  try {
    return await resumeAccountDeletionOperation(client, operation.id);
  } catch {
    return report(operation);
  }
}
export async function findSoleAdminOrgs(
  client: SupabaseClient,
  userId: string,
): Promise<SoleAdminOrg[]> {
  return (await deleteUserWithCleanup(client, userId, { dryRun: true }))
    .blockedBySoleAdminOrgs;
}
export function accountDeletionFailureMessage(
  result: DeleteUserCleanupReport,
): string {
  if (result.blockedBySoleAdminOrgs.length)
    return `Add another active admin before deleting this account: ${result.blockedBySoleAdminOrgs
      .map(
        (organization) =>
          organization.organization_name ?? organization.organization_id,
      )
      .join(", ")}.`;
  if (result.phase === "external_pending")
    return `Account cleanup is pending. Retry deletion or contact support with operation ${result.operationId}.`;
  return "Account removal is blocked. Disconnect linked providers and resolve retained organization, plugin, or storage records before retrying. No account data was removed.";
}
