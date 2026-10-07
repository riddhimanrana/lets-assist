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

export function buildWriteRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][],
) {
  const totalRows = Math.max(rows.length, 1);
  const totalColumns = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1,
  );
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startIndex = columnToIndex(startColumn);
  const endColumn = indexToColumn(startIndex + totalColumns - 1);
  const endRow = startRow + totalRows - 1;
  const resolvedTab = parsed?.tabName || tabName;

  return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${endColumn}${endRow}`;
}

export function buildClearRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][],
) {
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startIndex = columnToIndex(startColumn);
  const totalColumns = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1,
  );
  const resolvedTab = parsed?.tabName || tabName;

  if (parsed?.end) {
    return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${parsed.end.column}${parsed.end.row}`;
  }

  const endColumn = indexToColumn(Math.max(startIndex + totalColumns - 1, 26));
  const endRow = Math.max(startRow + rows.length + 50, 1000);
  return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${endColumn}${endRow}`;
}

export function buildStaleClearRanges(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][],
): string[] {
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startColumnIndex = columnToIndex(startColumn);
  const rowCount = Math.max(rows.length, 1);
  const columnCount = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1,
  );
  const writeEndColumnIndex = startColumnIndex + columnCount - 1;
  const writeEndRow = startRow + rowCount - 1;
  const clearEndColumnIndex = parsed?.end
    ? Math.max(startColumnIndex, columnToIndex(parsed.end.column))
    : Math.max(writeEndColumnIndex, 26);
  const clearEndRow = parsed?.end
    ? Math.max(startRow, parsed.end.row)
    : Math.max(startRow + rows.length + 50, 1000);
  const resolvedTab = parsed?.tabName || tabName;
  const formattedTab = formatSheetNameForA1(resolvedTab);
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
