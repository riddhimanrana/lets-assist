import { columnToIndex } from "@/lib/google-sheets/ranges";

import type { ReportType } from "../actions";

export const reportTypeLabels: Record<ReportType, string> = {
  "member-hours": "Member Hours Summary",
  "project-summary": "Project Summary",
  "monthly-summary": "Monthly Hours",
};

export const rangeModeLabels: Record<"full" | "custom", string> = {
  full: "Full tab (A1)",
  custom: "Custom range",
};

export const syncIntervalOptions = [
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
  { value: "4320", label: "Every 3 days" },
] as const;

export const getSyncIntervalLabel = (
  value: string | number | null | undefined,
) => {
  const normalized = String(value ?? "");
  return (
    syncIntervalOptions.find((option) => option.value === normalized)?.label ||
    (normalized ? `Every ${normalized} minutes` : "Interval")
  );
};

export type SheetOwnerOption = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  connectedEmail: string | null;
  hasSheetsAccess: boolean;
};

export type SheetSetupMetadata = {
  sheetId: string;
  sheetTitle: string;
  sheetUrl: string;
  tabs: string[];
};

export type RangeFields = {
  mode: "full" | "custom";
  startColumn: string;
  startRow: string;
  /** Empty when the range has no end. */
  endColumn: string;
  /** Empty when the range has no end. */
  endRow: string;
};

/** One sentence, shown wherever a range is chosen. */
export const RANGE_END_EXPLANATION =
  "Leave the end open and the report can grow. Set an end and the report stays inside that box, and the sync stops if it no longer fits.";

export const LEGACY_DEFAULT_RANGE_NOTE =
  "This sync was set up with the old default range, so the report is allowed to grow past row 20. Set a range end to keep it inside a box.";

/**
 * The A1 range the builder's fields describe. The end counts only when both
 * its column and its row are set, and it never sits before the start cell.
 */
export function buildRangeA1(fields: RangeFields): string {
  if (fields.mode === "full") return "A1";
  const startColumn = fields.startColumn || "A";
  const startRow = Math.max(Number.parseInt(fields.startRow, 10) || 1, 1);
  const start = `${startColumn}${startRow}`;
  if (!fields.endColumn || !fields.endRow) return start;

  const endColumn =
    columnToIndex(fields.endColumn) < columnToIndex(startColumn)
      ? startColumn
      : fields.endColumn;
  const endRow = Math.max(
    Number.parseInt(fields.endRow, 10) || startRow,
    startRow,
  );
  return `${start}:${endColumn}${endRow}`;
}

/**
 * Splits a saved A1 range into the range builder's fields. Returns null for a
 * range that starts at A1 with no end, which the builder shows as "Full tab".
 * The old pre-filled `A1:H20` keeps its own fields, so saving the form without
 * touching the range stores the same value. Turning it into `A1` on a save the
 * admin did not ask for would widen what the sync clears.
 */
export function parseSavedRange(
  rangeA1: string | null | undefined,
): RangeFields | null {
  const range = (rangeA1 ?? "").split("!").pop()?.trim() ?? "";
  if (!range || range.toUpperCase() === "A1") {
    return null;
  }
  const match = range.match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
  if (!match) {
    return null;
  }
  return {
    mode: "custom",
    startColumn: match[1].toUpperCase(),
    startRow: match[2],
    endColumn: (match[3] ?? "").toUpperCase(),
    endRow: match[4] ?? "",
  };
}
