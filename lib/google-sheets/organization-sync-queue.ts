import {
  ORGANIZATION_SYNC_MAX_BATCH,
  organizationSyncBatchLimit,
  readOrganizationSyncBatch,
} from "@/lib/organization/sync-batch";

/** No sheet syncs more often than this, whatever interval is saved. */
export const ORGANIZATION_SHEET_SYNC_INTERVAL_FLOOR_MINUTES = 15;
/** The interval used when the saved one is missing or not positive. */
export const ORGANIZATION_SHEET_SYNC_DEFAULT_INTERVAL_MINUTES = 1440;

/**
 * The interval the database applies to one saved sync when it decides what
 * is due. This mirrors that rule for callers that explain or model it.
 */
export function sheetSyncIntervalMinutes(saved: unknown) {
  return typeof saved === "number" && Number.isFinite(saved) && saved > 0
    ? Math.max(saved, ORGANIZATION_SHEET_SYNC_INTERVAL_FLOOR_MINUTES)
    : ORGANIZATION_SHEET_SYNC_DEFAULT_INTERVAL_MINUTES;
}

export function isSheetSyncDue(
  lastSyncedAt: string | null,
  intervalMinutes: number,
  now: number,
) {
  if (!lastSyncedAt) return true;
  return now - new Date(lastSyncedAt).getTime() >= intervalMinutes * 60 * 1000;
}

type Answer = PromiseLike<{ data: unknown; error: unknown }>;
/** The two database calls discovery makes. Each takes the run's signal. */
export type SheetSyncQueueClient = {
  rpc: (
    name: "claim_organization_sheet_sync_batch",
    args: { p_limit: number; p_run_started_at: string },
  ) => Answer & { abortSignal: (signal: AbortSignal) => Answer };
  from: (table: "organization_sheet_syncs") => {
    select: (columns: string) => {
      in: (
        column: "organization_id",
        values: string[],
      ) => Answer & { abortSignal: (signal: AbortSignal) => Answer };
    };
  };
};

/** What every loaded configuration must carry before a sync may use it. */
export type SheetSyncSelectedRow = {
  organization_id: string;
  sheet_id: string;
  created_by: string;
  updated_at: string;
  auto_sync: boolean;
};

export type SheetSyncDiscovery<Row> =
  /** The due organizations could not be counted. Nothing is known. */
  | { status: "unread" }
  /** Counted and selected, but the selected configurations did not load exactly. */
  | { status: "unloaded"; dueCount: number }
  | { status: "selected"; dueCount: number; rows: Row[] };

const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/**
 * Finds the sheet syncs one run attempts.
 *
 * One database call counts every due organization and selects this run's
 * batch from the same snapshot, by each sync's own interval. The batch
 * continues in organization id order from where the last one ended and wraps
 * around. That position is saved when the batch is selected, whatever the
 * syncs then do, so organizations that keep failing, or many that are not
 * due, cannot hide the ones behind them.
 *
 * The selected configurations are then loaded by id, at most 200 per request.
 * The load must return exactly the selected organizations, each once and each
 * well formed. Anything else attempts nothing. The claim each sync takes
 * later pins the owner, the destination and the revision that was loaded.
 */
export async function discoverDueSheetSyncs<Row extends SheetSyncSelectedRow>({
  supabase,
  columns,
  maxOrganizations,
  startedAt,
  signal,
}: {
  supabase: SheetSyncQueueClient;
  columns: string;
  maxOrganizations: number;
  startedAt: number;
  signal: AbortSignal;
}): Promise<SheetSyncDiscovery<Row>> {
  const limit = organizationSyncBatchLimit(maxOrganizations);
  let batch: ReturnType<typeof readOrganizationSyncBatch>;
  try {
    const answer = await supabase
      .rpc("claim_organization_sheet_sync_batch", {
        p_limit: limit,
        p_run_started_at: new Date(startedAt).toISOString(),
      })
      .abortSignal(signal);
    batch = answer.error ? null : readOrganizationSyncBatch(answer.data, limit);
  } catch {
    batch = null;
  }
  if (!batch) return { status: "unread" };
  const { dueCount, organizationIds } = batch;

  const loaded = new Map<string, Row>();
  try {
    for (
      let start = 0;
      start < organizationIds.length;
      start += ORGANIZATION_SYNC_MAX_BATCH
    ) {
      const chunk = organizationIds.slice(
        start,
        start + ORGANIZATION_SYNC_MAX_BATCH,
      );
      const { data, error } = await supabase
        .from("organization_sheet_syncs")
        .select(columns)
        .in("organization_id", chunk)
        .abortSignal(signal);
      if (error || !Array.isArray(data) || data.length !== chunk.length)
        return { status: "unloaded", dueCount };
      for (const entry of data as Array<Partial<Row> | null>) {
        if (
          !entry ||
          !isText(entry.organization_id) ||
          !chunk.includes(entry.organization_id) ||
          loaded.has(entry.organization_id) ||
          !isText(entry.sheet_id) ||
          !isText(entry.created_by) ||
          !isText(entry.updated_at) ||
          typeof entry.auto_sync !== "boolean"
        )
          return { status: "unloaded", dueCount };
        loaded.set(entry.organization_id, entry as Row);
      }
    }
  } catch {
    return { status: "unloaded", dueCount };
  }
  return {
    status: "selected",
    dueCount,
    // In the order the database selected them.
    rows: organizationIds.map((id) => loaded.get(id)!),
  };
}
