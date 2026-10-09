export const GOOGLE_SHEETS_MAX_COLUMN_INDEX = 18_278; // ZZZ
export const CSF_SHEET_MAX_BOUNDED_CELLS = 250_000;

export const columnToIndex = (column: string) => {
  const normalized = column.toUpperCase();
  if (!/^[A-Z]{1,3}$/u.test(normalized)) return Number.NaN;

  const index = normalized
    .split("")
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
  return Number.isSafeInteger(index) && index <= GOOGLE_SHEETS_MAX_COLUMN_INDEX
    ? index
    : Number.NaN;
};

export const indexToColumn = (index: number) => {
  if (
    !Number.isSafeInteger(index) ||
    index < 1 ||
    index > GOOGLE_SHEETS_MAX_COLUMN_INDEX
  ) {
    throw new RangeError(
      "Google Sheets column index is outside the supported A1 range.",
    );
  }

  let value = index;
  let column = "";
  while (value > 0) {
    const modulo = (value - 1) % 26;
    column = String.fromCharCode(65 + modulo) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
};

const parseA1Cell = (cell: string) => {
  const match = cell.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  const columnIndex = columnToIndex(match[1]);
  const row = Number.parseInt(match[2], 10);
  if (
    !Number.isSafeInteger(columnIndex) ||
    !Number.isSafeInteger(row) ||
    row < 1
  ) {
    return null;
  }
  return {
    column: match[1].toUpperCase(),
    row,
  };
};

export const parseA1Range = (range: string) => {
  const trimmed = range.trim();
  if (!trimmed) return null;
  // Numbered groups rather than named ones: this project's TypeScript target
  // predates ES2018, so a named capture group is a compile error here.
  // Group 1 is the optional tab, 2 the start cell, 3 the optional end cell.
  const match =
    /^(?:('(?:[^']|'')*'|[^'!]+)!)?([A-Za-z]+\d+)(?::([A-Za-z]+\d+))?$/u.exec(
      trimmed,
    );
  if (!match) return null;
  const start = parseA1Cell(match[2]);
  const end = match[3] ? parseA1Cell(match[3]) : null;
  if (!start) return null;
  const rawTabPart = match[1];
  const tabPart = rawTabPart?.startsWith("'")
    ? rawTabPart.slice(1, -1).replace(/''/g, "'")
    : rawTabPart;
  return {
    tabName: tabPart || null,
    start,
    end,
  };
};

export const formatSheetNameForA1 = (tabName: string) => {
  const escaped = tabName.replace(/'/g, "''");
  return `'${escaped}'`;
};

/**
 * A saved report destination. Unlike `parseA1Range`, an end may be open: a
 * whole-column range such as `A:H` bounds the columns and leaves the rows free.
 */
export type ReportRange = {
  tabName: string | null;
  startColumn: string;
  startRow: number;
  /** Null when the range does not bound its columns. */
  endColumn: string | null;
  /** Null when the range does not bound its rows. */
  endRow: number | null;
  /** The range as the admin wrote it, without its tab. */
  label: string;
};

type ReportRows = ReadonlyArray<ReadonlyArray<unknown>>;

const DEFAULT_REPORT_RANGE: Omit<ReportRange, "tabName"> = {
  startColumn: "A",
  startRow: 1,
  endColumn: null,
  endRow: null,
  label: "A1",
};

const parseReportCorner = (corner: string) => {
  const match = /^([A-Za-z]{1,3})(\d+)?$/u.exec(corner);
  if (!match) return null;
  const columnIndex = columnToIndex(match[1]);
  const row = match[2] === undefined ? null : Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(columnIndex)) return null;
  if (row !== null && (!Number.isSafeInteger(row) || row < 1)) return null;
  return { columnIndex, row };
};

/**
 * Reads `A1`, `A1:H20`, `A:H` and `A2:H`. Returns null for anything else, and
 * callers then fall back to the top-left cell of the tab.
 */
export function parseReportRange(
  range: string | null | undefined,
): ReportRange | null {
  const trimmed = (range ?? "").trim();
  if (!trimmed) return null;
  const match = /^(?:('(?:[^']|'')*'|[^'!]+)!)?([^!:]+)(?::([^!:]+))?$/u.exec(
    trimmed,
  );
  if (!match) return null;
  const start = parseReportCorner(match[2].trim());
  const end =
    match[3] === undefined ? null : parseReportCorner(match[3].trim());
  if (!start || (match[3] !== undefined && !end)) return null;
  // A lone column is not a destination. A lone cell is an open-ended anchor.
  if (!end && start.row === null) return null;

  const rawTab = match[1];
  const tabName = rawTab?.startsWith("'")
    ? rawTab.slice(1, -1).replace(/''/g, "'")
    : rawTab;
  const label = `${match[2].trim()}${end ? `:${match[3].trim()}` : ""}`;

  if (!end) {
    return {
      tabName: tabName || null,
      startColumn: indexToColumn(start.columnIndex),
      startRow: start.row ?? 1,
      endColumn: null,
      endRow: null,
      label: label.toUpperCase(),
    };
  }

  const startColumnIndex = Math.min(start.columnIndex, end.columnIndex);
  const endColumnIndex = Math.max(start.columnIndex, end.columnIndex);
  const rows = [start.row, end.row].filter(
    (row): row is number => row !== null,
  );
  // `A:H` has no rows at all, and `A2:H` has only a first row. Both leave the
  // bottom open.
  const startRow = rows.length > 0 ? Math.min(...rows) : 1;
  const endRow = rows.length === 2 ? Math.max(...rows) : null;

  return {
    tabName: tabName || null,
    startColumn: indexToColumn(startColumnIndex),
    startRow,
    endColumn: indexToColumn(endColumnIndex),
    endRow,
    label: label.toUpperCase(),
  };
}

/**
 * The custom range the setup form used to pre-fill. Nobody typed it.
 */
export const LEGACY_DEFAULT_REPORT_RANGE = "A1:H20";

/** True only for the exact pre-filled value, never for any other range. */
export function isLegacyDefaultReportRange(
  rangeA1: string | null | undefined,
): boolean {
  return rangeA1?.trim() === LEGACY_DEFAULT_REPORT_RANGE;
}

/**
 * Reads the old pre-filled range `A1:H20` as the start cell `A1` with an open
 * end, and returns every other range unchanged.
 *
 * Why this exists: the sync used to write from the start cell and ignore the
 * end, so a saved `A1:H20` let the report grow past row 20. A bounded range is
 * now a strict box. Without this, every sync that kept the form's default
 * would start failing once its report passed 20 rows, though no admin chose a
 * 20-row box.
 *
 * It applies only to that exact string. `A1:H21`, `B2:H20` and every other
 * range with an end stay strict. Use the result for the fit check and the
 * write range, and `legacyDefaultStaleClearRange` for clearing stale cells.
 */
export function openLegacyDefaultReportRange<
  Range extends string | null | undefined,
>(rangeA1: Range): Range | "A1" {
  return isLegacyDefaultReportRange(rangeA1) ? "A1" : rangeA1;
}

/**
 * The cells a legacy-default sync clears after writing.
 *
 * The clear has to reach as far as the write can. A report that grew past row
 * 20 and later shrank would otherwise leave its old rows, with member names
 * and hours, in the sheet for good. It stays inside the columns the report
 * uses (at least the old box's A to H), so it never widens sideways into
 * columns the report was never written to.
 */
export function legacyDefaultStaleClearRange(rows: ReportRows): string {
  const widest = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const endColumn = indexToColumn(Math.max(widest, columnToIndex("H")));
  const endRow = Math.max(rows.length + 50, 1000);
  return `A1:${endColumn}${endRow}`;
}

const measureReport = (rows: ReportRows) => ({
  rowCount: Math.max(rows.length, 1),
  columnCount: Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1,
  ),
});

/**
 * Says why a report does not fit the saved range, or returns null when it
 * fits. A range with an end is a box the admin chose, so a report that would
 * spill past it must fail instead of overwriting the cells around the box.
 */
export function describeReportRangeOverflow(
  rangeA1: string | null | undefined,
  rows: ReportRows,
): string | null {
  const range = parseReportRange(rangeA1);
  if (!range) return null;
  const { rowCount, columnCount } = measureReport(rows);

  if (range.endRow !== null) {
    const capacity = range.endRow - range.startRow + 1;
    if (rowCount > capacity) {
      return `The report has ${rowCount} rows but the selected range ${range.label} holds ${capacity}. Widen the range or remove its end.`;
    }
  }

  if (range.endColumn !== null) {
    const capacity =
      columnToIndex(range.endColumn) - columnToIndex(range.startColumn) + 1;
    if (columnCount > capacity) {
      return `The report has ${columnCount} columns but the selected range ${range.label} holds ${capacity}. Widen the range or remove its end.`;
    }
  }

  return null;
}

export function buildWriteRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: ReportRows,
) {
  const overflow = describeReportRangeOverflow(rangeA1, rows);
  if (overflow) throw new RangeError(overflow);

  const range = parseReportRange(rangeA1);
  const { startColumn, startRow } = range ?? DEFAULT_REPORT_RANGE;
  const { rowCount, columnCount } = measureReport(rows);
  const endColumn = indexToColumn(columnToIndex(startColumn) + columnCount - 1);
  const endRow = startRow + rowCount - 1;
  const resolvedTab = range?.tabName || tabName;

  return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${endColumn}${endRow}`;
}

/**
 * The outer edge of what a sync may clear: the saved box where the admin drew
 * one, and a generous margin past the report where the range is open.
 */
const resolveClearExtent = (range: ReportRange | null, rows: ReportRows) => {
  const { startColumn, startRow, endColumn, endRow } =
    range ?? DEFAULT_REPORT_RANGE;
  const startColumnIndex = columnToIndex(startColumn);
  const { columnCount } = measureReport(rows);
  return {
    startColumn,
    startRow,
    startColumnIndex,
    endColumnIndex:
      endColumn !== null
        ? columnToIndex(endColumn)
        : Math.max(startColumnIndex + columnCount - 1, 26),
    endRow: endRow ?? Math.max(startRow + rows.length + 50, 1000),
  };
};

export function buildClearRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: ReportRows,
) {
  const range = parseReportRange(rangeA1);
  const extent = resolveClearExtent(range, rows);
  const resolvedTab = range?.tabName || tabName;

  return `${formatSheetNameForA1(resolvedTab)}!${extent.startColumn}${extent.startRow}:${indexToColumn(extent.endColumnIndex)}${extent.endRow}`;
}

export function buildStaleClearRanges(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: ReportRows,
): string[] {
  const range = parseReportRange(rangeA1);
  const {
    startColumn,
    startRow,
    startColumnIndex,
    endColumnIndex: clearEndColumnIndex,
    endRow: clearEndRow,
  } = resolveClearExtent(range, rows);
  const { rowCount, columnCount } = measureReport(rows);
  const writeEndColumnIndex = startColumnIndex + columnCount - 1;
  const writeEndRow = startRow + rowCount - 1;
  const formattedTab = formatSheetNameForA1(range?.tabName || tabName);
  const clearEndColumn = indexToColumn(clearEndColumnIndex);
  const staleRanges: string[] = [];

  // Clear cells to the right of a newly narrower report without touching any
  // values that were just written.
  if (clearEndColumnIndex > writeEndColumnIndex && clearEndRow >= startRow) {
    const rightStartColumn = indexToColumn(writeEndColumnIndex + 1);
    const rightEndRow = Math.min(writeEndRow, clearEndRow);
    staleRanges.push(
      `${formattedTab}!${rightStartColumn}${startRow}:${clearEndColumn}${rightEndRow}`,
    );
  }

  // Clear rows left behind by a newly shorter report.
  if (clearEndRow > writeEndRow) {
    staleRanges.push(
      `${formattedTab}!${startColumn}${writeEndRow + 1}:${clearEndColumn}${clearEndRow}`,
    );
  }

  return staleRanges;
}

export type CsfSheetBounds = {
  tabName: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export function parseCsfSheetBoundedRange(
  range: string,
  fallbackTabName: string,
): CsfSheetBounds | null {
  const parsed = parseA1Range(range);
  if (!parsed?.end) return null;
  const tabName = parsed.tabName || fallbackTabName;
  if (!tabName) return null;

  const startRow = parsed.start.row;
  const endRow = parsed.end.row;
  const startColumn = columnToIndex(parsed.start.column);
  const endColumn = columnToIndex(parsed.end.column);
  const height = endRow - startRow + 1;
  const width = endColumn - startColumn + 1;
  const cellCount = height * width;
  if (
    !Number.isSafeInteger(startRow) ||
    !Number.isSafeInteger(endRow) ||
    !Number.isSafeInteger(startColumn) ||
    !Number.isSafeInteger(endColumn) ||
    startRow < 1 ||
    endRow < startRow ||
    startColumn < 1 ||
    endColumn < startColumn ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(cellCount) ||
    cellCount > CSF_SHEET_MAX_BOUNDED_CELLS
  ) {
    return null;
  }

  return { tabName, startRow, endRow, startColumn, endColumn };
}

export function formatCsfSheetBounds(bounds: CsfSheetBounds) {
  const height = bounds.endRow - bounds.startRow + 1;
  const width = bounds.endColumn - bounds.startColumn + 1;
  const cellCount = height * width;
  if (
    !bounds.tabName.trim() ||
    !Number.isSafeInteger(bounds.startRow) ||
    !Number.isSafeInteger(bounds.endRow) ||
    !Number.isSafeInteger(bounds.startColumn) ||
    !Number.isSafeInteger(bounds.endColumn) ||
    bounds.startRow < 1 ||
    bounds.endRow < bounds.startRow ||
    bounds.startColumn < 1 ||
    bounds.endColumn < bounds.startColumn ||
    bounds.endColumn > GOOGLE_SHEETS_MAX_COLUMN_INDEX ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(cellCount) ||
    cellCount > CSF_SHEET_MAX_BOUNDED_CELLS
  ) {
    throw new RangeError(
      "CSF Google Sheets bounds must describe one safe bounded rectangle.",
    );
  }

  const startColumn = indexToColumn(bounds.startColumn);
  const endColumn = indexToColumn(bounds.endColumn);
  return `${formatSheetNameForA1(bounds.tabName)}!${startColumn}${bounds.startRow}:${endColumn}${bounds.endRow}`;
}
