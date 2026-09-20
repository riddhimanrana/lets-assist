import {
  inspectAttendanceIntervals,
  type AttendanceInterval,
} from "./intervals";

type ReviewState = {
  outcome: string;
  decision: string;
  reviewAcknowledged: boolean;
  identityConfirmed: boolean;
  attendanceIntervals: AttendanceInterval[];
  timeExceptionReason: string | null;
};

export function isFinalAttendanceRow(row: Pick<ReviewState, "outcome">) {
  return ["signup_created", "signup_updated", "skipped"].includes(row.outcome);
}

export function isSavedAttendanceRow(row: Pick<ReviewState, "outcome">) {
  return isFinalAttendanceRow(row) || row.outcome === "roster_only";
}

export function hasPersistedAttendance(
  row: Pick<ReviewState, "outcome"> & { savedAttendance?: boolean },
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
    !isSavedAttendanceRow(row) &&
    row.decision === "include" &&
    row.reviewAcknowledged &&
    row.identityConfirmed &&
    inspection.problems.length === 0 &&
    (!inspection.outsideSession || Boolean(row.timeExceptionReason?.trim()))
  );
}
