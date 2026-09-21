import {
  inspectAttendanceIntervals,
  type AttendanceInterval,
} from "./intervals";

type ReviewState = {
  outcome: string;
  outcomeDetail?: string | null;
  decision: string;
  reviewAcknowledged: boolean;
  identityConfirmed: boolean;
  attendanceIntervals: AttendanceInterval[];
  timeExceptionReason: string | null;
};

export function isFinalAttendanceRow(row: Pick<ReviewState, "outcome">) {
  return ["signup_created", "signup_updated", "skipped"].includes(row.outcome);
}

export function isCombinedAttendanceRow(
  row: Pick<ReviewState, "outcome" | "outcomeDetail">,
) {
  return (
    row.outcome === "skipped" &&
    Boolean(row.outcomeDetail?.startsWith("combined_into:"))
  );
}

export function isSavedAttendanceRow(
  row: Pick<ReviewState, "outcome" | "outcomeDetail">,
) {
  return (
    !isCombinedAttendanceRow(row) &&
    (isFinalAttendanceRow(row) || row.outcome === "roster_only")
  );
}

export function hasPersistedAttendance(
  row: Pick<ReviewState, "outcome" | "outcomeDetail"> & {
    savedAttendance?: boolean;
  },
) {
  return Boolean(row.savedAttendance) || isSavedAttendanceRow(row);
}

export function isAttendanceRowReady(
  row: ReviewState,
  window: { startsAt: number; endsAt: number } | null,
) {
  const inspection = inspectAttendanceIntervals(
    row.attendanceIntervals,
    window,
  );
  return (
    !isFinalAttendanceRow(row) &&
    !isSavedAttendanceRow(row) &&
    row.decision === "include" &&
    row.reviewAcknowledged &&
    row.identityConfirmed &&
    inspection.problems.length === 0 &&
    (!inspection.outsideSession || Boolean(row.timeExceptionReason?.trim()))
  );
}

export function describeAttendanceFailure(detail: string) {
  if (detail === "unlinked_platform_award_requires_reconciliation") {
    return "This volunteer has a historical award that is not linked to this signup. Contact support to link the existing award before saving this row. Other valid rows can still be saved.";
  }
  if (detail === "slot_full") {
    return "The slot is full. Return to review and approve the capacity override if appropriate.";
  }
  return detail.replaceAll("_", " ");
}
