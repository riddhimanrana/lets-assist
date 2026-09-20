export type AttendancePrintSession = {
  id: string;
  label: string;
  startsAt: number;
  endsAt: number;
};

export type AttendancePrintRow = {
  rowReference: string;
  rowNumber: number;
  rowKind: "signup" | "walk_in" | "continuation";
  name: string;
};

export type AttendancePrintSheet = {
  sheetReference: string;
  projectTitle: string;
  sessionLabel: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  rows: AttendancePrintRow[];
};

export const ATTENDANCE_PRINT_ROWS_PER_PAGE = 10;

export function paginateAttendanceRows(rows: AttendancePrintRow[]) {
  if (rows.length === 0) return [[]];
  return Array.from(
    { length: Math.ceil(rows.length / ATTENDANCE_PRINT_ROWS_PER_PAGE) },
    (_, index) =>
      rows.slice(
        index * ATTENDANCE_PRINT_ROWS_PER_PAGE,
        (index + 1) * ATTENDANCE_PRINT_ROWS_PER_PAGE,
      ),
  );
}
