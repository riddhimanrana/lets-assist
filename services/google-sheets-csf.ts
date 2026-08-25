import { createHash } from "node:crypto";
import { logError } from "@/lib/logger";
import {
  GOOGLE_SHEETS_API,
  type CsfDriveCommentThread,
} from "./google-drive";
import {
  CSF_SHEET_MAX_BOUNDED_CELLS,
  GOOGLE_SHEETS_MAX_COLUMN_INDEX,
  columnToIndex,
  formatSheetNameForA1,
  indexToColumn,
  parseA1Range,
} from "./google-sheets-report";

export type CsfSheetTabVisibility = "visible" | "hidden" | "very_hidden";

export type CsfSheetSourceUnavailableReason =
  | "reconnect_required"
  | "not_found"
  | "rate_limited"
  | "invalid_range"
  | "unavailable";

export type CsfSheetBounds = {
  tabName: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export type CsfSheetTabEvidence = {
  tabName: string;
  sheetId: number | null;
  visibility: CsfSheetTabVisibility;
  gridRowCount: number | null;
  gridColumnCount: number | null;
};

export type CsfSheetRowEvidence = {
  /** One-based row number in the spreadsheet, not in the selected block. */
  sourceRowNumber: number;
  hiddenByUser: boolean;
  hiddenByFilter: boolean;
  /** One-based column numbers whose cell holds a formula rather than typed input. */
  formulaColumns: number[];
  /** True when at least one cell in the row resolved to a non-empty value. */
  hasEffectiveValue: boolean;
  values: string[];
  /**
   * Sparse per-cell presentation evidence keyed by one-based column number.
   * Officers encode decisions as fill colors and cell notes (green = met,
   * red = not met, yellow = exception), so acquisition preserves them for
   * reconciliation instead of flattening the sheet to bare values.
   */
  annotations: Record<number, CsfSheetCellAnnotation>;
};

export type CsfSheetCellAnnotation = {
  /** Lowercase #rrggbb fill, absent for the default white/transparent fill. */
  background?: string;
  /** The cell note verbatim, trimmed. */
  note?: string;
};

export type CsfSheetSourceSnapshot = {
  status: "ok";
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedTab: CsfSheetTabEvidence;
  tabs: CsfSheetTabEvidence[];
  requestedRange: CsfSheetBounds;
  /** Null when the requested range holds no populated cell at all. */
  populatedRange: CsfSheetBounds | null;
  rows: CsfSheetRowEvidence[];
  contentHash: string;
  hasBasicFilter: boolean;
  threadedCommentsByRow: Record<
    number,
    Array<{
      columnNumber: number;
      content: string;
      replies: string[];
      resolved: boolean;
    }>
  >;
  threadedCommentCount: number;
  unmatchedThreadedCommentCount: number;
};

export type CsfSheetSourceSnapshotResult =
  | CsfSheetSourceSnapshot
  | {
      status: "unavailable";
      reason: CsfSheetSourceUnavailableReason;
      message: string;
    };

/**
 * Sheets reports fills as fractional RGB and omits channels at zero. White is
 * the default grid fill, so it normalizes to "no annotation" rather than a
 * meaningful color.
 */
function normalizeSheetBackground(
  color: { red?: number; green?: number; blue?: number } | undefined,
): string | undefined {
  if (!color) return undefined;
  const channel = (value: number | undefined) =>
    Math.max(0, Math.min(255, Math.round((value ?? 0) * 255)));
  const red = channel(color.red);
  const green = channel(color.green);
  const blue = channel(color.blue);
  if (red >= 250 && green >= 250 && blue >= 250) return undefined;
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function unavailableReasonForStatus(
  status: number,
): CsfSheetSourceUnavailableReason {
  if (status === 401 || status === 403) return "reconnect_required";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

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

/**
 * Trim a requested block down to the rows and columns that actually hold text.
 * Returns null when nothing in the block is populated, which is a real answer
 * rather than a failure -- callers distinguish it from `unavailable`.
 */
export function narrowCsfSheetBoundsToPopulated(
  requested: CsfSheetBounds,
  values: string[][],
): CsfSheetBounds | null {
  let lastRowOffset = -1;
  let lastColumnOffset = -1;
  let firstRowOffset = -1;
  let firstColumnOffset = -1;

  values.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      if (!String(value ?? "").trim()) return;
      if (firstRowOffset < 0) firstRowOffset = rowOffset;
      lastRowOffset = rowOffset;
      if (firstColumnOffset < 0 || columnOffset < firstColumnOffset) {
        firstColumnOffset = columnOffset;
      }
      if (columnOffset > lastColumnOffset) lastColumnOffset = columnOffset;
    });
  });

  if (firstRowOffset < 0 || firstColumnOffset < 0) return null;

  return {
    tabName: requested.tabName,
    startRow: requested.startRow + firstRowOffset,
    endRow: Math.min(requested.endRow, requested.startRow + lastRowOffset),
    startColumn: requested.startColumn + firstColumnOffset,
    endColumn: Math.min(
      requested.endColumn,
      requested.startColumn + lastColumnOffset,
    ),
  };
}

export function hashCsfSheetSelection(
  bounds: CsfSheetBounds,
  values: string[][],
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        tabName: bounds.tabName,
        startRow: bounds.startRow,
        endRow: bounds.endRow,
        startColumn: bounds.startColumn,
        endColumn: bounds.endColumn,
        values,
      }),
    )
    .digest("hex");
}

type SheetsGridResponse = {
  spreadsheetId?: string;
  properties?: { title?: string };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      hidden?: boolean;
      sheetType?: string;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
    basicFilter?: unknown;
    data?: Array<{
      startRow?: number;
      startColumn?: number;
      rowMetadata?: Array<{ hiddenByUser?: boolean; hiddenByFilter?: boolean }>;
      rowData?: Array<{
        values?: Array<{
          formattedValue?: string;
          note?: string;
          effectiveFormat?: {
            backgroundColor?: { red?: number; green?: number; blue?: number };
          };
          effectiveValue?: Record<string, unknown>;
          userEnteredValue?: { formulaValue?: string };
        }>;
      }>;
    }>;
  }>;
};

function tabEvidenceFrom(
  sheet: NonNullable<SheetsGridResponse["sheets"]>[number],
): CsfSheetTabEvidence | null {
  const tabName = sheet.properties?.title;
  if (!tabName) return null;
  return {
    tabName,
    sheetId:
      typeof sheet.properties?.sheetId === "number"
        ? sheet.properties.sheetId
        : null,
    // The Sheets API models visibility as a single `hidden` flag. "Very hidden"
    // is an Excel-package concept surfaced by the uploaded-workbook path, so it
    // is representable here but never invented for a live spreadsheet.
    visibility: sheet.properties?.hidden === true ? "hidden" : "visible",
    gridRowCount:
      typeof sheet.properties?.gridProperties?.rowCount === "number"
        ? sheet.properties.gridProperties.rowCount
        : null,
    gridColumnCount:
      typeof sheet.properties?.gridProperties?.columnCount === "number"
        ? sheet.properties.gridProperties.columnCount
        : null,
  };
}

/**
 * Read one officer-selected, bounded Sheet range together with the acquisition
 * evidence preflight needs. Uses only `spreadsheets.values.batchGet` and
 * `spreadsheets.get`, both covered by the Sheets scope already granted.
 */
export async function getCsfSheetSourceSnapshot(
  accessToken: string,
  spreadsheetId: string,
  requestedRangeA1: string,
  fallbackTabName: string,
  threadedComments: readonly CsfDriveCommentThread[] = [],
): Promise<CsfSheetSourceSnapshotResult> {
  const requestedRange = parseCsfSheetBoundedRange(
    requestedRangeA1,
    fallbackTabName,
  );
  if (!requestedRange) {
    return {
      status: "unavailable",
      reason: "invalid_range",
      message:
        "Select a bounded A1 range such as A1:Z1000 on the exact Sheet tab.",
    };
  }

  const formattedRequestedRange = formatCsfSheetBounds(requestedRange);
  const valuesParams = new URLSearchParams();
  valuesParams.append("ranges", formattedRequestedRange);
  valuesParams.set("majorDimension", "ROWS");
  valuesParams.set("valueRenderOption", "FORMATTED_VALUE");

  let requestedValues: string[][];
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${valuesParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      logError(
        "Failed to read Google spreadsheet source values",
        new Error(`Sheets returned ${response.status}`),
        {
          sheet_id: spreadsheetId,
          range: formattedRequestedRange,
          status: response.status,
        },
      );
      return {
        status: "unavailable",
        reason: unavailableReasonForStatus(response.status),
        message:
          "The selected Sheet range could not be read; no rows were treated as empty.",
      };
    }
    const data = (await response.json()) as {
      valueRanges?: Array<{ values?: string[][] }>;
    };
    requestedValues = (data.valueRanges?.[0]?.values ?? []).map((row) =>
      // Preserve exact formatted values for the source digest. The importer
      // normalizes fields later, but whitespace-only source drift must still
      // produce a different acquisition snapshot.
      (row ?? []).map((cell) => String(cell ?? "")),
    );
  } catch (error) {
    logError(
      "Exception while reading Google spreadsheet source values",
      error,
      {
        sheet_id: spreadsheetId,
        range: formattedRequestedRange,
      },
    );
    return {
      status: "unavailable",
      reason: "unavailable",
      message:
        "The selected Sheet range could not be read; no rows were treated as empty.",
    };
  }

  const narrowed = narrowCsfSheetBoundsToPopulated(
    requestedRange,
    requestedValues,
  );
  // Rows are narrowed to the populated block; the leading column is deliberately
  // left anchored to the officer's range. Saved column mappings are one-based
  // offsets into that range, so trimming leading empty columns here would
  // silently re-point every mapping a column to the left.
  const populatedRange = narrowed
    ? { ...narrowed, startColumn: requestedRange.startColumn }
    : null;

  // The metadata request is intentionally separate from the ranged grid read.
  // Sheets only returns tabs intersecting a `ranges` filter, while preflight
  // must disclose hidden sibling tabs as well as the selected tab.
  const metadataParams = new URLSearchParams({
    includeGridData: "false",
    fields: [
      "spreadsheetId",
      "properties.title",
      "sheets.properties(sheetId,title,hidden,sheetType,gridProperties(rowCount,columnCount))",
    ].join(","),
  });

  let metadata: SheetsGridResponse;
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}?${metadataParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      logError(
        "Failed to read Google spreadsheet tab inventory",
        new Error(`Sheets returned ${response.status}`),
        { sheet_id: spreadsheetId, status: response.status },
      );
      return {
        status: "unavailable",
        reason: unavailableReasonForStatus(response.status),
        message:
          "The selected Sheet could not be inspected; no rows were treated as empty.",
      };
    }
    metadata = (await response.json()) as SheetsGridResponse;
  } catch (error) {
    logError(
      "Exception while reading Google spreadsheet tab inventory",
      error,
      {
        sheet_id: spreadsheetId,
      },
    );
    return {
      status: "unavailable",
      reason: "unavailable",
      message:
        "The selected Sheet could not be inspected; no rows were treated as empty.",
    };
  }

  const tabs = (metadata.sheets ?? [])
    .map(tabEvidenceFrom)
    .filter((tab): tab is CsfSheetTabEvidence => tab !== null);
  const selectedTab =
    tabs.find((tab) => tab.tabName === requestedRange.tabName) ?? null;
  if (!selectedTab) {
    return {
      status: "unavailable",
      reason: "not_found",
      message: `The selected Sheet no longer contains a ${requestedRange.tabName} tab.`,
    };
  }

  // Inspect the complete officer-bounded range, not just the displayed-value
  // extent. This is how hidden rows and formula-filled template capacity remain
  // visible in preflight without treating grid capacity as import records.
  const params = new URLSearchParams();
  params.append("ranges", formattedRequestedRange);
  params.set("includeGridData", "true");
  params.set(
    "fields",
    [
      "sheets.properties(sheetId,title)",
      "sheets.basicFilter.range",
      "sheets.data(startRow,startColumn,rowMetadata(hiddenByUser,hiddenByFilter),rowData.values(formattedValue,effectiveValue,userEnteredValue.formulaValue,note,effectiveFormat.backgroundColor))",
    ].join(","),
  );

  let grid: SheetsGridResponse;
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      const error = await response.text();
      logError(
        "Failed to read Google spreadsheet acquisition evidence",
        new Error(error),
        {
          sheet_id: spreadsheetId,
          range: formattedRequestedRange,
          status: response.status,
        },
      );
      return {
        status: "unavailable",
        reason: unavailableReasonForStatus(response.status),
        message:
          "The selected Sheet could not be inspected; no rows were treated as empty.",
      };
    }
    grid = (await response.json()) as SheetsGridResponse;
  } catch (error) {
    logError(
      "Exception while reading Google spreadsheet acquisition evidence",
      error,
      {
        sheet_id: spreadsheetId,
        range: formattedRequestedRange,
      },
    );
    return {
      status: "unavailable",
      reason: "unavailable",
      message:
        "The selected Sheet could not be inspected; no rows were treated as empty.",
    };
  }

  const selectedSheet = (grid.sheets ?? []).find(
    (sheet) => sheet.properties?.title === requestedRange.tabName,
  );
  if (!selectedSheet) {
    return {
      status: "unavailable",
      reason: "not_found",
      message: `The selected Sheet no longer contains a ${requestedRange.tabName} tab.`,
    };
  }
  const block = selectedSheet.data?.[0];
  const blockStartRow = (block?.startRow ?? requestedRange.startRow - 1) + 1;
  const blockStartColumn =
    (block?.startColumn ?? requestedRange.startColumn - 1) + 1;
  const rowMetadata = block?.rowMetadata ?? [];
  const rowData = block?.rowData ?? [];

  const structuralRows = Array.from(
    { length: Math.max(rowMetadata.length, rowData.length) },
    (_unused, offset) => {
      const metadata = rowMetadata[offset];
      const cells = rowData[offset]?.values ?? [];
      const formulaColumns = cells.flatMap((cell, cellOffset) =>
        typeof cell?.userEnteredValue?.formulaValue === "string"
          ? [blockStartColumn + cellOffset]
          : [],
      );
      const formulaDigests = cells.flatMap((cell, cellOffset) =>
        typeof cell?.userEnteredValue?.formulaValue === "string"
          ? [
              createHash("sha256")
                .update(
                  `${blockStartColumn + cellOffset}\u001f${cell.userEnteredValue.formulaValue}`,
                )
                .digest("hex"),
            ]
          : [],
      );
      const annotations: Record<number, CsfSheetCellAnnotation> = {};
      cells.forEach((cell, cellOffset) => {
        const background = normalizeSheetBackground(
          cell?.effectiveFormat?.backgroundColor,
        );
        const note =
          typeof cell?.note === "string" && cell.note.trim() !== ""
            ? cell.note.trim()
            : undefined;
        if (background || note) {
          annotations[blockStartColumn + cellOffset] = {
            ...(background ? { background } : {}),
            ...(note ? { note } : {}),
          };
        }
      });
      return {
        sourceRowNumber: blockStartRow + offset,
        hiddenByUser: metadata?.hiddenByUser === true,
        hiddenByFilter: metadata?.hiddenByFilter === true,
        formulaColumns,
        formulaDigests,
        annotations,
        hasEffectiveValue: cells.some(
          (cell) =>
            cell?.effectiveValue !== undefined &&
            String(cell.formattedValue ?? "").trim() !== "",
        ),
      };
    },
  ).filter(
    (row) =>
      row.hiddenByUser ||
      row.hiddenByFilter ||
      row.formulaColumns.length > 0 ||
      Object.keys(row.annotations).length > 0 ||
      row.hasEffectiveValue,
  );
  const structuralByRow = new Map(
    structuralRows.map((row) => [row.sourceRowNumber, row]),
  );
  const evidenceRowNumbers = new Set<number>(
    structuralRows.map((row) => row.sourceRowNumber),
  );
  requestedValues.forEach((values, offset) => {
    if (values.some((value) => String(value ?? "").trim() !== "")) {
      evidenceRowNumbers.add(requestedRange.startRow + offset);
    }
  });
  const rows: CsfSheetRowEvidence[] = [...evidenceRowNumbers]
    .sort((left, right) => left - right)
    .map((sourceRowNumber) => {
      const structural = structuralByRow.get(sourceRowNumber);
      return {
        sourceRowNumber,
        hiddenByUser: structural?.hiddenByUser === true,
        hiddenByFilter: structural?.hiddenByFilter === true,
        formulaColumns: structural?.formulaColumns ?? [],
        annotations: structural?.annotations ?? {},
        hasEffectiveValue: structural?.hasEffectiveValue === true,
        values:
          requestedValues[sourceRowNumber - requestedRange.startRow]?.slice(
            0,
            (populatedRange?.endColumn ?? requestedRange.startColumn) -
              requestedRange.startColumn +
              1,
          ) ?? [],
      };
    });

  const decodeQuotedText = (html: string) =>
    html
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<[^>]*>/gu, "")
      .replace(/&nbsp;/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;|&apos;/giu, "'")
      .trim();
  const threadedCommentsByRow: CsfSheetSourceSnapshot["threadedCommentsByRow"] =
    {};
  let matchedThreadedCommentCount = 0;
  for (const comment of threadedComments) {
    if (!comment.quotedHtml) continue;
    const quotedText = decodeQuotedText(comment.quotedHtml);
    if (!quotedText) continue;
    const matches: Array<{ sourceRowNumber: number; columnNumber: number }> = [];
    requestedValues.forEach((values, rowOffset) => {
      values.forEach((value, columnOffset) => {
        if (String(value ?? "").trim() === quotedText) {
          matches.push({
            sourceRowNumber: requestedRange.startRow + rowOffset,
            columnNumber: requestedRange.startColumn + columnOffset,
          });
        }
      });
    });
    // Drive's Sheet anchors are opaque workbook-range identifiers. Only bind a
    // thread when its quoted cell text identifies one cell in this bounded tab.
    // Ambiguous and off-range threads stay in the snapshot digest but never get
    // guessed onto a student record.
    if (matches.length !== 1) continue;
    const [{ sourceRowNumber, columnNumber }] = matches;
    (threadedCommentsByRow[sourceRowNumber] ??= []).push({
      columnNumber,
      content: comment.content,
      replies: comment.replies.map((reply) => reply.content),
      resolved: comment.resolved,
    });
    matchedThreadedCommentCount += 1;
  }

  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        requestedRange,
        populatedRange,
        tabs: tabs.map((tab) => ({
          tabName: tab.tabName,
          sheetId: tab.sheetId,
          visibility: tab.visibility,
        })),
        hasBasicFilter: Boolean(selectedSheet.basicFilter),
        rows,
        formulas: structuralRows.flatMap((row) =>
          row.formulaDigests.length > 0
            ? [
                {
                  sourceRowNumber: row.sourceRowNumber,
                  digests: row.formulaDigests,
                },
              ]
            : [],
        ),
        threadedComments: threadedComments.map((comment) => ({
          id: comment.id,
          anchor: comment.anchor,
          quotedHtml: comment.quotedHtml,
          content: comment.content,
          resolved: comment.resolved,
          replies: comment.replies,
        })),
      }),
    )
    .digest("hex");

  return {
    status: "ok",
    spreadsheetId: metadata.spreadsheetId || spreadsheetId,
    spreadsheetTitle: metadata.properties?.title || "Untitled Spreadsheet",
    selectedTab,
    tabs,
    requestedRange,
    populatedRange,
    rows,
    contentHash,
    hasBasicFilter: Boolean(selectedSheet.basicFilter),
    threadedCommentsByRow,
    threadedCommentCount: threadedComments.length,
    unmatchedThreadedCommentCount:
      threadedComments.length - matchedThreadedCommentCount,
  };
}
