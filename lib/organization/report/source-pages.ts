/** The most rows one request asks for. The API returns at most 1,000. */
export const REPORT_SOURCE_PAGE_SIZE = 500;
/** The most ids one `in` filter carries, so a request URL stays small. */
export const REPORT_SOURCE_ID_CHUNK_SIZE = 200;
export const REPORT_SOURCE_MAX_PROJECTS = 10_000;
/** Certificates and attended signups together. */
export const REPORT_SOURCE_MAX_RECORDS = 100_000;
export const REPORT_SOURCE_MAX_INTERVALS = 100_000;

/**
 * Why a report source could not be loaded whole. The report is then not
 * built at all: a caller never receives part of an organization's records.
 */
export class ReportSourceError extends Error {
  constructor(readonly reason: "unavailable" | "changed" | "too_large") {
    super(`Report source ${reason}`);
    this.name = "ReportSourceError";
  }
}

/** A shared allowance of rows, so several reads stay under one bound. */
export function createReportSourceBudget(maxRows: number) {
  let reserved = 0;
  return {
    reserve(count: number) {
      if (count > maxRows - reserved) throw new ReportSourceError("too_large");
      reserved += count;
    },
  };
}
export type ReportSourceBudget = ReturnType<typeof createReportSourceBudget>;

export type ReportSourcePage<Row> = {
  data: Row[] | null;
  error: unknown;
  count?: number | null;
};

export function chunkReportSourceIds<Id>(ids: readonly Id[]): Id[][] {
  const chunks: Id[][] = [];
  for (let start = 0; start < ids.length; start += REPORT_SOURCE_ID_CHUNK_SIZE)
    chunks.push(ids.slice(start, start + REPORT_SOURCE_ID_CHUNK_SIZE));
  return chunks;
}

/**
 * Reads every row of one filtered query in primary-key order, a page at a
 * time. `fetchPage` must filter, order by `id` ascending, continue after
 * `after`, apply `limit`, and ask for an exact count when `after` is null.
 *
 * The read fails instead of returning less than everything: on a request
 * error, a page larger than asked for, an id that is missing, repeated or out
 * of order, a first page with no exact count, a total that differs from that
 * count, or more rows than the budget allows.
 *
 * The pages are separate requests, not one database snapshot. A row added or
 * removed between them is caught only when it changes the total, so this
 * shows the source was complete as counted with the first page. It does not
 * show the source as of a single instant.
 */
export async function readReportSourcePages<Row extends { id: string }>(
  fetchPage: (
    after: string | null,
    limit: number,
  ) => PromiseLike<ReportSourcePage<Row>>,
  budget: ReportSourceBudget,
): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | null = null;
  let expected = 0;
  for (let first = true; ; first = false) {
    const page = await fetchPage(after, REPORT_SOURCE_PAGE_SIZE);
    if (
      page.error ||
      !Array.isArray(page.data) ||
      page.data.length > REPORT_SOURCE_PAGE_SIZE
    )
      throw new ReportSourceError("unavailable");
    if (first) {
      // Without an exact count nothing shows the pages were the whole source:
      // a first page that happens to be full, or short, proves neither.
      const count: unknown = page.count;
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < page.data.length
      )
        throw new ReportSourceError("unavailable");
      expected = count;
      // Reserved before the rest is fetched, so an oversized source stops here.
      budget.reserve(expected);
    }
    for (const row of page.data) {
      const id: unknown = (row as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || id === "")
        throw new ReportSourceError("unavailable");
      // A page that repeats or goes backwards would never end.
      if (after !== null && id <= after) throw new ReportSourceError("changed");
      after = id;
      rows.push(row);
    }
    if (rows.length > expected) throw new ReportSourceError("changed");
    if (page.data.length < REPORT_SOURCE_PAGE_SIZE) break;
  }
  if (rows.length !== expected) throw new ReportSourceError("changed");
  return rows;
}
