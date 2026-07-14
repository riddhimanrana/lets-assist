import type { SupabaseClient } from "@supabase/supabase-js";

type StorageRemovalError = {
  message?: string;
};

export type RemoveStorageObjects = (
  bucket: string,
  paths: string[],
) => Promise<{ error: StorageRemovalError | null }>;

type WaiverStoragePaths = {
  signaturePaths: string[];
  uploadPaths: string[];
};

type WaiverStorageRecord = {
  signature_storage_path?: string | null;
  upload_storage_path?: string | null;
  signature_payload?: unknown;
};

function isStoredSignatureAsset(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("data:") &&
    !value.startsWith("http://") &&
    !value.startsWith("https://")
  );
}

/** Collects all persisted object paths, including multi-signer payload assets. */
export function collectWaiverStoragePaths(records: WaiverStorageRecord[]): WaiverStoragePaths {
  const signaturePaths = new Set<string>();
  const uploadPaths = new Set<string>();

  for (const record of records) {
    if (record.signature_storage_path) {
      signaturePaths.add(record.signature_storage_path);
    }

    if (record.upload_storage_path) {
      // Full signed waiver uploads are evidence and live in the private
      // waiver-signatures bucket. The name is retained for schema compatibility.
      signaturePaths.add(record.upload_storage_path);
    }

    if (!record.signature_payload || typeof record.signature_payload !== "object") {
      continue;
    }

    const signers = (record.signature_payload as { signers?: unknown }).signers;
    if (!Array.isArray(signers)) continue;

    for (const signer of signers) {
      if (!signer || typeof signer !== "object") continue;

      const { method, data } = signer as { method?: unknown; data?: unknown };
      if ((method === "draw" || method === "upload") && isStoredSignatureAsset(data)) {
        signaturePaths.add(data);
      }
    }
  }

  return {
    signaturePaths: [...signaturePaths],
    uploadPaths: [...uploadPaths],
  };
}

/**
 * Removes every storage object associated with a batch of waiver records.
 *
 * This is a low-level object remover only. Retention jobs must first commit
 * their database deletion and durable outbox entry; this helper does not make
 * database and Storage mutations atomic.
 */
export async function removeWaiverStorageObjects(
  remove: RemoveStorageObjects,
  paths: WaiverStoragePaths,
): Promise<{ error?: string }> {
  if (paths.signaturePaths.length > 0) {
    const { error } = await remove("waiver-signatures", paths.signaturePaths);

    if (error) {
      return { error: "Failed to delete waiver signature assets" };
    }
  }

  if (paths.uploadPaths.length > 0) {
    const { error } = await remove("waiver-signatures", paths.uploadPaths);

    if (error) {
      return { error: "Failed to delete uploaded waiver documents" };
    }
  }

  return {};
}

type WaiverStorageDeletionQueueRow = {
  id: string;
  bucket_id: string;
  object_path: string;
};

/**
 * Drains committed Storage-deletion work from the database outbox.
 *
 * Removing an already-missing object is safe, so retries are idempotent. A
 * failed Storage request leaves its queue row in place and records the error;
 * a failed queue-row delete likewise leaves a harmless retry behind.
 */
export async function drainWaiverStorageDeletionQueue(
  supabase: SupabaseClient,
  limit = 500,
): Promise<{ deleted: number; error?: string }> {
  const { data, error } = await supabase
    .from("waiver_storage_deletion_queue")
    .select("id, bucket_id, object_path")
    .order("enqueued_at", { ascending: true })
    .limit(limit);

  if (error) {
    return { deleted: 0, error: "Failed to load waiver Storage deletion queue" };
  }

  const rows = (data ?? []) as WaiverStorageDeletionQueueRow[];
  if (rows.length === 0) {
    return { deleted: 0 };
  }

  const rowsByBucket = new Map<string, WaiverStorageDeletionQueueRow[]>();
  for (const row of rows) {
    const bucketRows = rowsByBucket.get(row.bucket_id) ?? [];
    bucketRows.push(row);
    rowsByBucket.set(row.bucket_id, bucketRows);
  }

  let deleted = 0;
  let firstError: string | undefined;

  for (const [bucket, bucketRows] of rowsByBucket) {
    for (let index = 0; index < bucketRows.length; index += 100) {
      const batch = bucketRows.slice(index, index + 100);
      const ids = batch.map((row) => row.id);
      const { data: filteredData, error: filterError } = await supabase.rpc(
        "filter_unreferenced_waiver_storage_deletions",
        { p_queue_ids: ids },
      );

      if (filterError) {
        firstError ??= "Failed to re-check queued waiver evidence references";
        continue;
      }

      const filteredRows = (filteredData ?? []) as WaiverStorageDeletionQueueRow[];
      if (filteredRows.length === 0) {
        continue;
      }

      const filteredIds = filteredRows.map((row) => row.id);
      const paths = filteredRows.map((row) => row.object_path);
      const { error: storageError } = await supabase.storage.from(bucket).remove(paths);

      if (storageError) {
        const message = storageError.message?.slice(0, 1000) || "Storage deletion failed";
        const { error: trackingError } = await supabase
          .from("waiver_storage_deletion_queue")
          .update({
            last_attempt_at: new Date().toISOString(),
            last_error: message,
          })
          .in("id", filteredIds);

        firstError ??= trackingError
          ? "Storage deletion failed and its retry metadata could not be updated"
          : "Failed to delete queued waiver evidence from Storage";
        continue;
      }

      const { error: queueDeleteError } = await supabase
        .from("waiver_storage_deletion_queue")
        .delete()
        .in("id", filteredIds);

      if (queueDeleteError) {
        firstError ??= "Storage was deleted but its idempotent queue cleanup must be retried";
        continue;
      }

      deleted += filteredRows.length;
    }
  }

  return firstError ? { deleted, error: firstError } : { deleted };
}
