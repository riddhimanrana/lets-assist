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
 * leaves a harmless retry behind. Scan photos are never referenced by other
 * records, so no re-check filter is needed before deletion.
 */
export async function drainPaperScanStorageDeletionQueue(
  supabase: SupabaseClient,
  limit = 500,
): Promise<{ deleted: number; error?: string }> {
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
      const ids = batch.map((row) => row.id);
      const paths = batch.map((row) => row.object_path);

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

      deleted += batch.length;
    }
  }

  return firstError ? { deleted, error: firstError } : { deleted };
}
