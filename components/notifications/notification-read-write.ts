/**
 * Runs a mark-as-read write behind an optimistic unread-count change.
 *
 * Supabase resolves a failed PostgREST mutation with `{ error }` instead of
 * rejecting, so a `try`/`catch` alone never sees it. Both a resolved error and
 * a thrown one undo the optimistic change here, then `reconcile` re-reads the
 * count from the server in case it moved while the write was in flight.
 */
export async function writeReadStateOptimistically(options: {
  apply: () => void;
  write: () => PromiseLike<{ error: unknown }>;
  rollback: () => void;
  reconcile?: () => Promise<void>;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  options.apply();

  let failure: unknown = null;
  try {
    const { error } = await options.write();
    failure = error ?? null;
  } catch (error) {
    failure = error ?? new Error("The notification write failed");
  }
  if (failure === null) return true;

  options.rollback();
  options.onError(failure);
  try {
    await options.reconcile?.();
  } catch (error) {
    // The rollback above already restored the last known count.
    options.onError(error);
  }
  return false;
}
