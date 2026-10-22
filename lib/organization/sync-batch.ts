/** The most organizations the database hands one worker run. */
export const ORGANIZATION_SYNC_MAX_BATCH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type OrganizationSyncBatch = {
  /** Every organization that was due, counted with the batch. */
  dueCount: number;
  /** The distinct organizations selected for this run, in the order to try. */
  organizationIds: string[];
};

/** The limit a run sends: its own cap, held between 1 and the batch bound. */
export function organizationSyncBatchLimit(maxOrganizations: number) {
  return Math.min(
    Math.max(Math.trunc(maxOrganizations), 1),
    ORGANIZATION_SYNC_MAX_BATCH,
  );
}

/**
 * Reads the answer of a batch function: an exact count of due organizations
 * and the distinct ones selected for this run. Returns null for anything
 * else, so a malformed answer is an unread queue and never a short or empty
 * one. Being selected means an attempt is owed. It does not mean one was made.
 */
export function readOrganizationSyncBatch(
  data: unknown,
  limit: number,
): OrganizationSyncBatch | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { due_count: dueCount, organization_ids: ids } = data as Record<
    string,
    unknown
  >;
  if (
    typeof dueCount !== "number" ||
    !Number.isSafeInteger(dueCount) ||
    dueCount < 0 ||
    !Array.isArray(ids) ||
    // The batch is exactly the due organizations, up to the limit asked for.
    ids.length !== Math.min(dueCount, limit) ||
    !ids.every((id) => typeof id === "string" && UUID.test(id)) ||
    new Set(ids).size !== ids.length
  )
    return null;
  return { dueCount, organizationIds: ids as string[] };
}
