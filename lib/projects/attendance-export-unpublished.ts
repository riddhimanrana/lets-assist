import {
  serviceDate,
  type AttendanceExportFilters,
  type AttendanceExportRecord,
  type ExportProject,
} from "./attendance-export";

export type ExportRosterEntry = {
  id: string;
  scan_row_id: string | null;
  schedule_id: string;
  name: string;
  check_in_time: string | null;
  check_out_time: string | null;
  attendance_intervals: unknown;
};
export type ExportReviewRow = {
  id: string;
  name: string | null;
  email: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  attendance_intervals: unknown;
  review_revision: number;
  review_acknowledged: boolean;
  identity_confirmed: boolean;
  decision: string;
  outcome: string;
  committed_signup_id: string | null;
  batch: { schedule_id: string; status: string } | null;
};
function readIntervals(
  value: unknown,
  checkIn: string | null,
  checkOut: string | null,
) {
  if (!Array.isArray(value) || !value.length) return [{ checkIn, checkOut }];
  return value.map((item: unknown) => {
    const row =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      checkIn: typeof row.checkIn === "string" ? row.checkIn : null,
      checkOut: typeof row.checkOut === "string" ? row.checkOut : null,
    };
  });
}
function completeIntervals(intervals: ReturnType<typeof readIntervals>) {
  const ranges = intervals
    .map((interval) => ({
      start: Date.parse(interval.checkIn ?? ""),
      end: Date.parse(interval.checkOut ?? ""),
    }))
    .sort((a, b) => a.start - b.start);
  return (
    ranges.length > 0 &&
    ranges.every(
      (range, index) =>
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.end > range.start &&
        (!index || range.start >= ranges[index - 1].end),
    ) &&
    ranges.at(-1)!.end - ranges[0].start <= 86400000
  );
}
export function buildUnpublishedAttendanceRecords(
  project: ExportProject,
  roster: ExportRosterEntry[],
  review: ExportReviewRow[],
  filters: AttendanceExportFilters,
): AttendanceExportRecord[] {
  if (!filters.includeUnpublished) return [];
  const committedRows = new Set(
    roster.map((row) => row.scan_row_id).filter(Boolean),
  );
  const records: AttendanceExportRecord[] = [];
  const add = (
    row: {
      id: string;
      name: string | null;
      email?: string | null;
      check_in_time: string | null;
      check_out_time: string | null;
    },
    sessionId: string,
    intervals: ReturnType<typeof readIntervals>,
    source: "roster" | "review",
    state: "pending" | "unresolved",
    revision: number | null,
  ) => {
    const date = serviceDate(project, sessionId, row.check_in_time);
    if (
      (filters.sessionId && filters.sessionId !== sessionId) ||
      (filters.from && (!date || date < filters.from)) ||
      (filters.to && (!date || date > filters.to))
    )
      return;
    records.push({
      projectId: project.id,
      projectTitle: project.title,
      organizationId: project.organization_id,
      sessionId,
      serviceDate: date,
      timezone: project.project_timezone || "America/Los_Angeles",
      sourceType: source,
      sourceId: row.id,
      signupId: null,
      participantId: source === "roster" ? row.id : null,
      participantType: source === "roster" ? "guest" : "unresolved",
      name: row.name ?? "",
      email: row.email ?? "",
      intervals,
      creditedMinutes: null,
      publicationState: state,
      certificateId: null,
      attendanceRevision: revision,
    });
  };
  for (const row of roster)
    add(
      row,
      row.schedule_id,
      readIntervals(
        row.attendance_intervals,
        row.check_in_time,
        row.check_out_time,
      ),
      "roster",
      "unresolved",
      null,
    );
  for (const row of review) {
    if (
      row.decision === "exclude" ||
      !["pending", "failed"].includes(row.outcome) ||
      row.committed_signup_id ||
      committedRows.has(row.id) ||
      !row.batch ||
      !["draft", "review", "failed"].includes(row.batch.status)
    )
      continue;
    const intervals = readIntervals(
      row.attendance_intervals,
      row.check_in_time,
      row.check_out_time,
    );
    const state =
      row.decision === "include" &&
      row.review_acknowledged &&
      row.identity_confirmed &&
      completeIntervals(intervals)
        ? "pending"
        : "unresolved";
    add(
      row,
      row.batch.schedule_id,
      intervals,
      "review",
      state,
      row.review_revision,
    );
  }
  return records;
}
