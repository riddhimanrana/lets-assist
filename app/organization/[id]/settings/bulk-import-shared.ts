import type { InvitationDuration } from "@/lib/organization/invitation-utils";

export type ImportMode = "file" | "manual";
export type DialogStep =
  "input" | "preview" | "manualResult" | "importProcessing" | "importResult";

export type FailedRowPreview = {
  row_number: number;
  email: string;
  error: string | null;
  status: "failed" | "skipped";
};

export const IMPORT_BATCH_SIZE = 100;

export const ROLE_OPTIONS = [
  { label: "Members", value: "member" },
  { label: "Staff", value: "staff" },
] as const;

export const INVITATION_DURATION_OPTIONS: Array<{
  label: string;
  value: InvitationDuration;
}> = [
  { label: "1 week", value: "1_week" },
  { label: "1 month", value: "1_month" },
];

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function mergeFailedRows(
  previous: FailedRowPreview[],
  nextRows: FailedRowPreview[],
): FailedRowPreview[] {
  const mergedMap = new Map<string, FailedRowPreview>();

  for (const row of previous) {
    mergedMap.set(`${row.row_number}-${row.status}`, row);
  }

  for (const row of nextRows) {
    mergedMap.set(`${row.row_number}-${row.status}`, row);
  }

  return Array.from(mergedMap.values())
    .sort((a, b) => a.row_number - b.row_number)
    .slice(0, 50);
}
