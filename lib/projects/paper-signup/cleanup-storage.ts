import type { SupabaseClient } from "@supabase/supabase-js";

type PaperScanDeletionQueueRow = {
  id: string;
  bucket_id: string;
  object_path: string;
};

/**
 * Drains committed Storage-deletion work from the paper-scan outbox
 * (modelled on lib/waiver/cleanup-storage.ts). Removing an already-missing
 * object is safe, so retries are idempotent: a failed Storage request leaves
 * its queue row in place with the error recorded; a failed queue-row delete
 * leaves a harmless retry behind. A durable lease blocks new registrations
 * while each queued path is rechecked, so cleanup cannot delete a photo that
 * became registered after an ambiguous create-batch response.
 */
export async function drainPaperScanStorageDeletionQueue(
  supabase: SupabaseClient,
  limit = 500,
): Promise<{ deleted: number; error?: string }> {
  const lockToken = crypto.randomUUID();
  const { data: acquired, error: acquireError } = await supabase.rpc(
    "acquire_paper_scan_storage_cleanup_lock",
    { p_lock_token: lockToken, p_ttl_seconds: 900 },
  );
  if (acquireError || acquired !== true) {
    return {
      deleted: 0,
      error: "Paper-scan Storage cleanup is already running",
    };
  }

  try {
    const { data, error } = await supabase
      .from("paper_scan_storage_deletion_queue")
      .select("id, bucket_id, object_path")
      .order("enqueued_at", { ascending: true })
      .limit(limit);

    if (error) {
      return {
        deleted: 0,
        error: "Failed to load paper-scan Storage deletion queue",
      };
    }

    const rows = (data ?? []) as PaperScanDeletionQueueRow[];
    if (rows.length === 0) {
      return { deleted: 0 };
    }

    const rowsByBucket = new Map<string, PaperScanDeletionQueueRow[]>();
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
        const { data: renewed, error: renewError } = await supabase.rpc(
          "acquire_paper_scan_storage_cleanup_lock",
          { p_lock_token: lockToken, p_ttl_seconds: 900 },
        );
        if (renewError || renewed !== true) {
          firstError ??= "Paper-scan Storage cleanup lease expired";
          continue;
        }

        const candidatePaths = batch.map((row) => row.object_path);
        const { data: registered, error: registeredError } = await supabase
          .from("project_paper_scan_images")
          .select("object_path")
          .eq("bucket_id", bucket)
          .in("object_path", candidatePaths);
        if (registeredError) {
          firstError ??= "Failed to recheck paper-scan photo registrations";
          continue;
        }
        const registeredPaths = new Set(
          (registered ?? []).map((row) => row.object_path),
        );
        const protectedRows = batch.filter((row) =>
          registeredPaths.has(row.object_path),
        );
        if (protectedRows.length > 0) {
          const { error: protectedDeleteError } = await supabase
            .from("paper_scan_storage_deletion_queue")
            .delete()
            .in(
              "id",
              protectedRows.map((row) => row.id),
            );
          if (protectedDeleteError) {
            firstError ??= "Failed to remove registered photos from cleanup";
            continue;
          }
        }
        const removableRows = batch.filter(
          (row) => !registeredPaths.has(row.object_path),
        );
        if (removableRows.length === 0) continue;
        const ids = removableRows.map((row) => row.id);
        const paths = removableRows.map((row) => row.object_path);

        const { error: storageError } = await supabase.storage
          .from(bucket)
          .remove(paths);

        if (storageError) {
          const message =
            storageError.message?.slice(0, 1000) || "Storage deletion failed";
          const { error: trackingError } = await supabase
            .from("paper_scan_storage_deletion_queue")
            .update({
              last_attempt_at: new Date().toISOString(),
              last_error: message,
            })
            .in("id", ids);

          firstError ??= trackingError
            ? "Storage deletion failed and its retry metadata could not be updated"
            : "Failed to delete queued paper-scan photos from Storage";
          continue;
        }

        const { error: queueDeleteError } = await supabase
          .from("paper_scan_storage_deletion_queue")
          .delete()
          .in("id", ids);

        if (queueDeleteError) {
          firstError ??=
            "Storage was deleted but its idempotent queue cleanup must be retried";
          continue;
        }

        deleted += removableRows.length;
      }
    }

    return firstError ? { deleted, error: firstError } : { deleted };
  } finally {
    const { error: releaseError } = await supabase.rpc(
      "release_paper_scan_storage_cleanup_lock",
      { p_lock_token: lockToken },
    );
    if (releaseError) {
      console.error("Failed to release paper-scan cleanup lease", releaseError);
    }
  }
}
