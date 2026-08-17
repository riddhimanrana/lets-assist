import { logError } from "@/lib/logger";
import {
  writeThenClearStaleSpreadsheetValues,
  type SpreadsheetReplaceResult,
} from "@/lib/organization/spreadsheet-replace-core";
import {
  GOOGLE_SHEETS_API,
  type SpreadsheetValueInputOption,
} from "./google-drive";

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

export async function clearSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId,
      )}/values/${encodeURIComponent(range)}:clear`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to clear Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        range,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError("Exception while clearing Google spreadsheet values", error, {
      sheet_id: sheetId,
      range,
    });
    return false;
  }
}

export async function createSpreadsheet(
  accessToken: string,
  title: string,
  tabName: string,
): Promise<{
  sheetId: string;
  sheetUrl: string;
  tabName: string;
  sheetTitle: string;
} | null> {
  try {
    const response = await fetch(GOOGLE_SHEETS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          {
            properties: {
              title: tabName,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to create Google spreadsheet", new Error(error), {
        title,
        tab_name: tabName,
      });
      return null;
    }

    const data = await response.json();
    return {
      sheetId: data.spreadsheetId,
      sheetUrl: data.spreadsheetUrl,
      tabName,
      sheetTitle: data.properties?.title || title,
    };
  } catch (error) {
    logError("Exception while creating Google spreadsheet", error, {
      title,
      tab_name: tabName,
    });
    return null;
  }
}

export function extractSpreadsheetId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export function buildSpreadsheetUrl(sheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  sheetId: string,
): Promise<{
  sheetId: string;
  sheetTitle: string;
  tabs: string[];
  /** Grid extent per tab title, so callers can build bounded A1 ranges. */
  tabGrids: Record<string, { rowCount: number; columnCount: number }>;
} | null> {
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId,
      )}?fields=spreadsheetId,properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      logError(
        "Failed to fetch Google spreadsheet metadata",
        new Error(`Sheets returned ${response.status}`),
        {
          status: response.status,
        },
      );
      return null;
    }

    const data = await response.json();
    type SheetProperties = {
      properties?: {
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    };
    const sheets: SheetProperties[] = data.sheets || [];
    const tabs = sheets
      .map((sheet) => sheet.properties?.title)
      .filter((title: string | undefined): title is string => Boolean(title));
    const tabGrids: Record<string, { rowCount: number; columnCount: number }> =
      {};
    for (const sheet of sheets) {
      const title = sheet.properties?.title;
      const grid = sheet.properties?.gridProperties;
      if (!title || !grid) continue;
      const rowCount = Number(grid.rowCount);
      const columnCount = Number(grid.columnCount);
      if (
        Number.isInteger(rowCount) &&
        rowCount > 0 &&
        Number.isInteger(columnCount) &&
        columnCount > 0
      ) {
        tabGrids[title] = { rowCount, columnCount };
      }
    }

    return {
      sheetId: data.spreadsheetId,
      sheetTitle: data.properties?.title || "Untitled Spreadsheet",
      tabs,
      tabGrids,
    };
  } catch {
    logError(
      "Exception while fetching Google spreadsheet metadata",
      new Error("Sheets metadata request failed"),
    );
    return null;
  }
}

export async function ensureSpreadsheetTab(
  accessToken: string,
  sheetId: string,
  tabName: string,
): Promise<boolean> {
  try {
    const metadata = await getSpreadsheetMetadata(accessToken, sheetId);
    if (!metadata) return false;
    if (metadata.tabs.some((tab) => tab === tabName)) return true;

    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: tabName,
                },
              },
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to create Google sheet tab", new Error(error), {
        sheet_id: sheetId,
        tab_name: tabName,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError("Exception while ensuring Google sheet tab", error, {
      sheet_id: sheetId,
      tab_name: tabName,
    });
    return false;
  }
}

export async function updateSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: string[][],
  valueInputOption: SpreadsheetValueInputOption = "USER_ENTERED",
): Promise<boolean> {
  const resolvedRange = range || "A1";
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId,
      )}/values/${encodeURIComponent(resolvedRange)}?valueInputOption=${valueInputOption}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range: resolvedRange,
          majorDimension: "ROWS",
          values: rows,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to update Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        range: resolvedRange,
        rows_count: rows.length,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError("Exception while updating Google spreadsheet values", error, {
      sheet_id: sheetId,
      range: resolvedRange,
      rows_count: rows.length,
    });
    return false;
  }
}

export async function replaceSpreadsheetReportValues(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][],
): Promise<SpreadsheetReplaceResult> {
  const writeRange = buildWriteRange(tabName, rangeA1, rows);
  const staleRanges = buildStaleClearRanges(tabName, rangeA1, rows);

  return writeThenClearStaleSpreadsheetValues(staleRanges, {
    // Report cells are untrusted data, never formulas. RAW prevents names,
    // emails, project titles, or custom labels from being evaluated by Sheets.
    write: () =>
      updateSpreadsheetValues(accessToken, sheetId, writeRange, rows, "RAW"),
    clear: (range) => clearSpreadsheetValues(accessToken, sheetId, range),
  });
}

export async function batchGetSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  ranges: string[],
): Promise<Array<{ range: string; values: string[][] }> | null> {
  if (ranges.length === 0) return [];

  const params = new URLSearchParams();
  for (const range of ranges) {
    params.append("ranges", range);
  }
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "FORMATTED_VALUE");

  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}/values:batchGet?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logError(
        "Failed to batch read Google spreadsheet values",
        new Error(error),
        {
          sheet_id: sheetId,
          ranges: ranges.join(", "),
        },
      );
      return null;
    }

    const data = await response.json();
    return (data.valueRanges || []).map(
      (valueRange: { range?: string; values?: string[][] }) => ({
        range: valueRange.range || "",
        values: valueRange.values || [],
      }),
    );
  } catch (error) {
    logError("Exception while batch reading Google spreadsheet values", error, {
      sheet_id: sheetId,
      ranges: ranges.join(", "),
    });
    return null;
  }
}
