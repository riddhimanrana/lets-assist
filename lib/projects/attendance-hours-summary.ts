export type AttendanceHoursSummaryRow = {
  creditedMinutes: number | null;
  recordedMinutes: number | null;
};

/** Recorded attendance without a certificate never contributes to awarded hours. */
export function summarizeAttendanceHours(rows: AttendanceHoursSummaryRow[]) {
  let awardedMinutes = 0;
  let recordedMinutes = 0;
  let awardedCount = 0;
  let pendingCount = 0;
  let unresolvedCount = 0;
  for (const row of rows) {
    if (
      row.creditedMinutes !== null &&
      Number.isFinite(row.creditedMinutes) &&
      row.creditedMinutes >= 0
    ) {
      awardedMinutes += row.creditedMinutes;
      awardedCount++;
    } else if (
      row.recordedMinutes !== null &&
      Number.isFinite(row.recordedMinutes) &&
      row.recordedMinutes > 0
    ) {
      recordedMinutes += row.recordedMinutes;
      pendingCount++;
    } else {
      unresolvedCount++;
    }
  }
  return {
    awardedMinutes,
    recordedMinutes,
    awardedCount,
    pendingCount,
    unresolvedCount,
  };
}
