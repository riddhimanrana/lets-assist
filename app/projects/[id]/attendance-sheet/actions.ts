"use server";

import { z } from "zod";
import {
  attendancePrintSessions,
  requireAttendancePrintAccess,
} from "@/lib/attendance/print-manifest";
import type {
  AttendancePrintRow,
  AttendancePrintSheet,
} from "@/lib/attendance/print-types";

const optionsSchema = z
  .object({
    projectId: z.string().uuid(),
    scheduleIds: z.array(z.string().min(1).max(200)).min(1).max(50),
    blankRows: z.number().int().min(0).max(100),
    continuationRows: z.number().int().min(0).max(30),
  })
  .strict();

export async function createAttendancePrintSheets(
  input: z.infer<typeof optionsSchema>,
): Promise<{ sheets: AttendancePrintSheet[] } | { error: string }> {
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success)
    return { error: "Choose sessions and valid blank row counts." };
  const access = await requireAttendancePrintAccess(parsed.data.projectId);
  if (!access)
    return { error: "You do not have permission to print this roster." };
  const sessions = attendancePrintSessions(access.project);
  const selected = [...new Set(parsed.data.scheduleIds)].map((id) =>
    sessions.find((session) => session.id === id),
  );
  if (selected.some((session) => !session))
    return {
      error: "A selected session is no longer available. Reload and try again.",
    };
  const sheets: AttendancePrintSheet[] = [];
  for (const session of selected) {
    if (!session) continue;
    const { data: sheetId, error } = await access.admin.rpc(
      "create_attendance_print_sheet",
      {
        p_project_id: parsed.data.projectId,
        p_schedule_id: session.id,
        p_actor_id: access.userId,
        p_blank_rows: parsed.data.blankRows,
        p_continuation_rows: parsed.data.continuationRows,
      },
    );
    if (error || typeof sheetId !== "string")
      return {
        error: "Could not prepare the attendance sheet. Please try again.",
      };
    const { data: sheet, error: sheetError } = await access.admin
      .from("project_attendance_print_sheets")
      .select("id, project_title, project_timezone, starts_at, ends_at")
      .eq("id", sheetId)
      .eq("project_id", parsed.data.projectId)
      .single();
    const rows: Array<{
      row_reference: string;
      row_number: number;
      row_kind: AttendancePrintRow["rowKind"];
      printed_name: string;
    }> = [];
    for (let offset = 0; offset < 5130; offset += 500) {
      const { data: page, error: rowsError } = await access.admin
        .from("project_attendance_print_rows")
        .select("row_reference, row_number, row_kind, printed_name")
        .eq("sheet_id", sheetId)
        .eq("project_id", parsed.data.projectId)
        .order("row_number")
        .range(offset, offset + 499);
      if (rowsError || !page)
        return {
          error: "Could not load the prepared sheet. Please try again.",
        };
      rows.push(...page);
      if (page.length < 500) break;
    }
    if (sheetError || !sheet)
      return { error: "Could not load the prepared sheet. Please try again." };
    sheets.push({
      sheetReference: sheet.id,
      projectTitle: sheet.project_title,
      sessionLabel: session.label,
      timezone: sheet.project_timezone,
      startsAt: sheet.starts_at,
      endsAt: sheet.ends_at,
      rows: rows.map((row) => ({
        rowReference: row.row_reference,
        rowNumber: row.row_number,
        rowKind: row.row_kind as AttendancePrintRow["rowKind"],
        name: row.printed_name,
      })),
    });
  }
  return { sheets };
}
