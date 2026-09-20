import { readAttendanceIntervals } from "@/lib/projects/paper-signup/intervals";
import type { PaperScanRowView } from "./PaperSignupsClient";

export const REVIEW_ROW_COLUMNS =
  "id, sheet_row_number, image_id, raw_extraction, overall_confidence, name, email, phone, check_in_time, check_out_time, signature_present, match_kind, match_signup_id, match_score, match_reasons, decision, outcome, outcome_detail, attendance_intervals, review_acknowledged, identity_confirmed, time_exception_reason, review_revision";

export function paperRowView(row: Record<string, unknown>): PaperScanRowView {
  const raw = (row.raw_extraction ?? {}) as Record<
    string,
    { confidence?: number }
  >;
  const confidence = (key: string) => raw[key]?.confidence ?? 0;
  return {
    id: String(row.id),
    sheetRowNumber: Number(row.sheet_row_number),
    imageId: row.image_id as string | null,
    name: row.name as string | null,
    email: row.email as string | null,
    phone: row.phone as string | null,
    checkInTime: row.check_in_time as string | null,
    checkOutTime: row.check_out_time as string | null,
    signaturePresent: Boolean(row.signature_present),
    overallConfidence: Number(row.overall_confidence ?? 0),
    fieldConfidence: {
      name: confidence("name"),
      email: confidence("email"),
      phone: confidence("phone"),
      timeIn: confidence("timeIn"),
      timeOut: confidence("timeOut"),
    },
    matchKind: String(row.match_kind ?? "none"),
    matchSignupId: row.match_signup_id as string | null,
    matchScore: row.match_score == null ? null : Number(row.match_score),
    matchReasons: (row.match_reasons ?? []) as string[],
    decision: row.decision as PaperScanRowView["decision"],
    outcome: String(row.outcome ?? "pending"),
    outcomeDetail: row.outcome_detail as string | null,
    attendanceIntervals: readAttendanceIntervals(
      row.attendance_intervals,
      row.check_in_time as string | null,
      row.check_out_time as string | null,
    ),
    reviewAcknowledged: Boolean(row.review_acknowledged),
    identityConfirmed: Boolean(row.identity_confirmed),
    timeExceptionReason: row.time_exception_reason as string | null,
    reviewRevision: Number(row.review_revision ?? 0),
  };
}
