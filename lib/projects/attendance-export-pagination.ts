import { AttendanceExportError } from "./attendance-export";

export async function readAllExportPages<T extends { id: string }>(
  fetchPage: (
    after: string | null,
    limit: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 100_000,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  while (true) {
    const { data, error } = await fetchPage(after, 500);
    if (error || !data)
      throw new AttendanceExportError("Unable to load complete export", 503);
    if (!data.length) return rows;
    for (const row of data) {
      if (seen.has(row.id))
        throw new AttendanceExportError(
          "Export changed while loading. Retry the export.",
          409,
        );
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length > maxRows)
      throw new AttendanceExportError(
        "Export exceeds the row limit. Select a narrower scope.",
        413,
      );
    after = data[data.length - 1].id;
  }
}
