type Row = { id: string };
/** Keyset pages avoid treating Supabase's response cap as the whole collection. */
export async function loadCalendarSourcePages<T extends Row>(
  fetchPage: (
    afterId: string | null,
    pageSize: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  /** Stops before the next page once the caller's deadline has passed. */
  signal?: AbortSignal,
): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    if (signal?.aborted)
      throw new Error("Calendar source loading stopped at its deadline.");
    const { data, error } = await fetchPage(afterId, pageSize);
    if (error || !data || data.length > pageSize)
      throw new Error("Failed to load the complete calendar source snapshot.");
    for (const row of data) {
      if (typeof row.id !== "string" || (afterId !== null && row.id <= afterId))
        throw new Error("Calendar source pagination did not advance.");
      afterId = row.id;
      rows.push(row);
    }
    if (rows.length > 10_000)
      throw new Error(
        "Calendar source limit exceeded. No event changes were sent.",
      );
    if (data.length < pageSize) return rows;
  }
}

/** Ends a source query with the caller's deadline, when it has one. */
export function withCalendarDeadline<
  Query extends { abortSignal: (signal: AbortSignal) => Query },
>(query: Query, signal?: AbortSignal): Query {
  return signal ? query.abortSignal(signal) : query;
}
