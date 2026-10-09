import { logError } from "@/lib/logger";
import {
  writeThenClearStaleSpreadsheetValues,
  type SpreadsheetReplaceStage,
} from "@/lib/organization/spreadsheet-replace-core";
import {
  GOOGLE_SHEETS_API,
  type SpreadsheetValueInputOption,
} from "./google-drive";

import {
  buildWriteRange,
  buildStaleClearRanges,
} from "@/lib/google-sheets/ranges";
export {
  describeReportRangeOverflow,
  GOOGLE_SHEETS_MAX_COLUMN_INDEX,
  CSF_SHEET_MAX_BOUNDED_CELLS,
  columnToIndex,
  indexToColumn,
  parseA1Range,
  formatSheetNameForA1,
  buildWriteRange,
  buildClearRange,
  buildStaleClearRanges,
} from "@/lib/google-sheets/ranges";

/** Every Sheets request is bounded so one stalled call cannot hold a worker. */
export const GOOGLE_SHEETS_REQUEST_TIMEOUT_MS = 10_000;

export type SheetsFailureReason =
  | "timeout"
  | "access_denied"
  | "not_found"
  | "rate_limited"
  | "invalid_request"
  | "unavailable";

/** A report cell. Numbers are sent as JSON numbers so Sheets can sum them. */
export type SheetCellValue = string | number;

/** Bulk reads feed imports of large sheets, so they get a longer bound. */
const GOOGLE_SHEETS_BULK_READ_TIMEOUT_MS = 60_000;

/**
 * `signal` lets a caller end a request early, for example at a per-tenant
 * deadline. `budget` caps how many Sheets requests one piece of work may
 * make: each request spends one, and a request past the cap is refused.
 */
export type SheetsRequestOptions = {
  signal?: AbortSignal;
  budget?: { remaining: number };
};

function sheetsFetch(
  url: string,
  init: RequestInit = {},
  options: SheetsRequestOptions = {},
  timeoutMs = GOOGLE_SHEETS_REQUEST_TIMEOUT_MS,
) {
  options.signal?.throwIfAborted();
  if (options.budget) {
    if (options.budget.remaining <= 0) {
      throw new Error("Sheets request budget spent");
    }
    options.budget.remaining -= 1;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...init,
    signal: options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout,
  });
}

function failureReasonForError(error: unknown): SheetsFailureReason {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError"
    ? "timeout"
    : "unavailable";
}

function failureReasonForResponse(
  status: number,
  body: string,
): SheetsFailureReason {
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (status === 401) return "access_denied";
  if (status === 403) {
    return /rate.?limit|quota|RESOURCE_EXHAUSTED/iu.test(body)
      ? "rate_limited"
      : "access_denied";
  }
  if (status === 400) return "invalid_request";
  return "unavailable";
}

type SheetsWriteResult =
  { ok: true } | { ok: false; reason: SheetsFailureReason };

async function clearSpreadsheetValuesResult(
  accessToken: string,
  sheetId: string,
  range: string,
  options: SheetsRequestOptions = {},
): Promise<SheetsWriteResult> {
  try {
    const response = await sheetsFetch(
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
      options,
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to clear Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        range,
        status: response.status,
      });
      return {
        ok: false,
        reason: failureReasonForResponse(response.status, error),
      };
    }

    return { ok: true };
  } catch (error) {
    logError("Exception while clearing Google spreadsheet values", error, {
      sheet_id: sheetId,
      range,
    });
    return { ok: false, reason: failureReasonForError(error) };
  }
}

export async function clearSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
): Promise<boolean> {
  return (await clearSpreadsheetValuesResult(accessToken, sheetId, range)).ok;
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
    const response = await sheetsFetch(GOOGLE_SHEETS_API, {
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

export type SpreadsheetMetadata = {
  sheetId: string;
  sheetTitle: string;
  tabs: string[];
  tabIds: Record<string, number>;
  timeZone: string | null;
  /** Grid extent per tab title, so callers can build bounded A1 ranges. */
  tabGrids: Record<string, { rowCount: number; columnCount: number }>;
};

export type SpreadsheetInspection =
  | { ok: true; metadata: SpreadsheetMetadata }
  | { ok: false; reason: SheetsFailureReason };

/**
 * Reads a spreadsheet's title and tabs, and says why when it cannot. This is
 * the access probe: under the `drive.file` scope a file the connected person
 * did not pick or create answers as not found or forbidden.
 */
export async function inspectSpreadsheet(
  accessToken: string,
  sheetId: string,
  options: SheetsRequestOptions = {},
): Promise<SpreadsheetInspection> {
  try {
    const response = await sheetsFetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId,
      )}?fields=spreadsheetId,properties(title,timeZone),sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      options,
    );

    if (!response.ok) {
      logError(
        "Failed to fetch Google spreadsheet metadata",
        new Error(`Sheets returned ${response.status}`),
        {
          status: response.status,
        },
      );
      // The body is never read here: the status alone classifies the failure.
      return {
        ok: false,
        reason: failureReasonForResponse(response.status, ""),
      };
    }

    const data = await response.json();
    type SheetProperties = {
      properties?: {
        title?: string;
        sheetId?: number;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    };
    const sheets: SheetProperties[] = data.sheets || [];
    const tabs = sheets
      .map((sheet) => sheet.properties?.title)
      .filter((title: string | undefined): title is string => Boolean(title));
    const tabGrids: Record<string, { rowCount: number; columnCount: number }> =
      Object.create(null);
    const tabIds: Record<string, number> = Object.create(null);
    for (const sheet of sheets) {
      const title = sheet.properties?.title;
      const tabId = sheet.properties?.sheetId;
      if (
        title &&
        typeof tabId === "number" &&
        Number.isSafeInteger(tabId) &&
        tabId >= 0
      ) {
        tabIds[title] = tabId;
      }
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
      ok: true,
      metadata: {
        sheetId: data.spreadsheetId,
        sheetTitle: data.properties?.title || "Untitled Spreadsheet",
        timeZone:
          typeof data.properties?.timeZone === "string"
            ? data.properties.timeZone
            : null,
        tabs,
        tabIds: { ...tabIds },
        tabGrids: { ...tabGrids },
      },
    };
  } catch (error) {
    logError(
      "Exception while fetching Google spreadsheet metadata",
      new Error("Sheets metadata request failed"),
    );
    return { ok: false, reason: failureReasonForError(error) };
  }
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  sheetId: string,
): Promise<SpreadsheetMetadata | null> {
  const inspection = await inspectSpreadsheet(accessToken, sheetId);
  return inspection.ok ? inspection.metadata : null;
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

    const response = await sheetsFetch(
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

async function updateSpreadsheetValuesResult(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: ReadonlyArray<ReadonlyArray<SheetCellValue>>,
  valueInputOption: SpreadsheetValueInputOption,
  options: SheetsRequestOptions = {},
): Promise<SheetsWriteResult> {
  const resolvedRange = range || "A1";
  try {
    const response = await sheetsFetch(
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
      options,
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to update Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        range: resolvedRange,
        rows_count: rows.length,
        status: response.status,
      });
      return {
        ok: false,
        reason: failureReasonForResponse(response.status, error),
      };
    }

    return { ok: true };
  } catch (error) {
    logError("Exception while updating Google spreadsheet values", error, {
      sheet_id: sheetId,
      range: resolvedRange,
      rows_count: rows.length,
    });
    return { ok: false, reason: failureReasonForError(error) };
  }
}

export async function updateSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: ReadonlyArray<ReadonlyArray<SheetCellValue>>,
  valueInputOption: SpreadsheetValueInputOption = "USER_ENTERED",
): Promise<boolean> {
  const result = await updateSpreadsheetValuesResult(
    accessToken,
    sheetId,
    range,
    rows,
    valueInputOption,
  );
  return result.ok;
}

/** Cells right of the report, and rows below it. */
export const MAX_REPORT_STALE_CLEAR_REQUESTS = 2;

export type SpreadsheetReportReplaceResult =
  | { success: true }
  | {
      success: false;
      stage: SpreadsheetReplaceStage;
      reason: SheetsFailureReason;
    };

/**
 * Writes the report, then clears what an earlier, larger report left behind.
 * Throws a RangeError when the report does not fit a bounded range, so check
 * `describeReportRangeOverflow` first to report that to a person.
 */
export async function replaceSpreadsheetReportValues(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rangeA1: string | null | undefined,
  rows: ReadonlyArray<ReadonlyArray<SheetCellValue>>,
  options: SheetsRequestOptions = {},
): Promise<SpreadsheetReportReplaceResult> {
  const writeRange = buildWriteRange(tabName, rangeA1, rows);
  const staleRanges = buildStaleClearRanges(tabName, rangeA1, rows);
  // One write and a fixed number of clears: a report can never fan out into
  // an unbounded number of Sheets requests.
  if (staleRanges.length > MAX_REPORT_STALE_CLEAR_REQUESTS) {
    throw new RangeError("Report replacement exceeds its Sheets request cap.");
  }
  let failure: SheetsFailureReason = "unavailable";
  const remember = (result: SheetsWriteResult) => {
    if (!result.ok) failure = result.reason;
    return result.ok;
  };

  const replacement = await writeThenClearStaleSpreadsheetValues(staleRanges, {
    // Report cells are untrusted data, never formulas. RAW prevents names,
    // emails, project titles, or custom labels from being evaluated by Sheets.
    // RAW also stores a JSON number as a number, so totals stay summable.
    write: async () =>
      remember(
        await updateSpreadsheetValuesResult(
          accessToken,
          sheetId,
          writeRange,
          rows,
          "RAW",
          options,
        ),
      ),
    clear: async (range) =>
      remember(
        await clearSpreadsheetValuesResult(
          accessToken,
          sheetId,
          range,
          options,
        ),
      ),
  });

  return replacement.success
    ? replacement
    : { ...replacement, reason: failure };
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
    const response = await sheetsFetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}/values:batchGet?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {},
      GOOGLE_SHEETS_BULK_READ_TIMEOUT_MS,
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
