const PAGE_SIZE = 1000;
const MAX_CANDIDATES = 10_000;

/** Keep the candidate set complete, or fail instead of silently omitting identities. */
export async function loadScanCandidatePages<T>(
  page: (
    start: number,
    end: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { code: string } | null;
  }>,
): Promise<T[]> {
  const candidates: T[] = [];
  for (let offset = 0; offset <= MAX_CANDIDATES; offset += PAGE_SIZE) {
    const { data, error } = await page(
      offset,
      Math.min(offset + PAGE_SIZE - 1, MAX_CANDIDATES),
    );
    if (error)
      throw new Error(`Failed to load scan match candidates: ${error.code}`);
    const rows = data ?? [];
    candidates.push(...rows);
    if (candidates.length > MAX_CANDIDATES)
      throw new Error("This project exceeds the scan candidate limit");
    if (rows.length < PAGE_SIZE) return candidates;
  }
  return candidates;
}
