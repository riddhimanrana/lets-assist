/** The shortest interval an admin can save, so no sync is due sooner. */
export const ORGANIZATION_SHEET_SYNC_MIN_INTERVAL_MINUTES = 60;

export function isSheetSyncDue(
  lastSyncedAt: string | null,
  intervalMinutes: number,
  now: number,
) {
  if (!lastSyncedAt) return true;
  return now - new Date(lastSyncedAt).getTime() >= intervalMinutes * 60 * 1000;
}

/**
 * Picks the organizations one run syncs.
 *
 * `last_synced_at` only moves on success, so taking the oldest first would
 * put an organization that keeps failing at the head of every run and hold
 * back everyone behind the cap. The start point therefore moves with the run
 * time: every due organization gets its turn, and a failing one cannot pin
 * the queue. When everything fits under the cap, nothing is left out.
 */
export function selectSheetSyncBatch<Row>(
  dueRows: readonly Row[],
  cap: number,
  seed: number,
): Row[] {
  if (dueRows.length <= cap) return [...dueRows];
  // Mixed so a fixed schedule cannot land on the same start point each run.
  const mixed = Math.imul(Math.floor(seed / 1000) | 0, 0x9e3779b1) >>> 0;
  const start = mixed % dueRows.length;
  return Array.from(
    { length: cap },
    (_, index) => dueRows[(start + index) % dueRows.length],
  );
}
