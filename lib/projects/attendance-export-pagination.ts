import { isDeepStrictEqual } from "node:util";
import { AttendanceExportError } from "./attendance-export";

export const MAX_EXPORT_SOURCE_ROWS = 100_000;

export function createExportReadBudget(maxRows = MAX_EXPORT_SOURCE_ROWS) {
  let reserved = 0;
  return {
    reserve(count: number) {
      if (count > maxRows - reserved)
        throw new AttendanceExportError(
          "Export exceeds the row limit. Select a narrower scope.",
          413,
        );
      reserved += count;
    },
  };
}

export type ExportReadBudget = ReturnType<typeof createExportReadBudget>;

function exportChanged() {
  return new AttendanceExportError(
    "Export changed while loading. Retry the export.",
    409,
  );
}

export async function readAllExportPages<T extends { id: string }>(
  fetchPage: (
    after: string | null,
    limit: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  countOrLimit:
    | (() => PromiseLike<{ count: number | null; error: unknown }>)
    | number = MAX_EXPORT_SOURCE_ROWS,
  budget = createExportReadBudget(
    typeof countOrLimit === "number" ? countOrLimit : MAX_EXPORT_SOURCE_ROWS,
  ),
): Promise<T[]> {
  const fetchCount = typeof countOrLimit === "function" ? countOrLimit : null;
  const readCount = async () => {
    if (!fetchCount) return null;
    const { count, error } = await fetchCount();
    if (error || count === null || !Number.isSafeInteger(count) || count < 0)
      throw new AttendanceExportError("Unable to load complete export", 503);
    return count;
  };
  const expected = await readCount();
  // Reserve before fetching so concurrent table reads share one memory bound.
  if (expected !== null) budget.reserve(expected);
  const rows: T[] = [];
  let after: string | null = null;
  while (true) {
    const { data, error } = await fetchPage(after, 500);
    if (error || !data)
      throw new AttendanceExportError("Unable to load complete export", 503);
    if (!data.length) {
      if (
        expected !== null &&
        (rows.length !== expected || (await readCount()) !== expected)
      )
        throw exportChanged();
      return rows;
    }
    if (expected === null) budget.reserve(data.length);
    else if (data.length > expected - rows.length) throw exportChanged();
    for (const row of data) {
      if (after !== null && row.id <= after) throw exportChanged();
      rows.push(row);
      after = row.id;
    }
  }
}

// Both complete raw reads must agree before filtering or calculating totals.
// This detects observed drift, but cannot exclude changes that revert between
// reads. Each pass shares one budget; at most two bounded passes are retained.
export async function readValidatedExportSnapshot<T>(
  readSnapshot: (budget: ExportReadBudget) => Promise<T>,
  maxRows = MAX_EXPORT_SOURCE_ROWS,
): Promise<T> {
  const snapshot = await readSnapshot(createExportReadBudget(maxRows));
  const current = await readSnapshot(createExportReadBudget(maxRows));
  if (!isDeepStrictEqual(snapshot, current)) throw exportChanged();
  return snapshot;
}
