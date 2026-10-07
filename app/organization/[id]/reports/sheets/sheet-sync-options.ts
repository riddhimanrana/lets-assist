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

/** Splits a saved A1 range into the range builder's fields. */
export function parseSavedRange(rangeA1: string | null | undefined): {
  mode: "full" | "custom";
  startColumn: string;
  startRow: string;
  endColumn: string;
  endRow: string;
} | null {
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
    endColumn: (match[3] ?? match[1]).toUpperCase(),
    endRow: match[4] ?? match[2],
  };
}
