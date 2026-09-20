"use server";

import { z } from "zod";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { resolveScheduleId } from "@/utils/project";
import { getScheduleIdAliases } from "@/lib/projects/hours-publish-key";
import { requirePaperScanAccess } from "./access";
import { REVIEW_ROW_COLUMNS, paperRowView } from "./row-view";

const scope = z.object({
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export async function startManualAttendance(input: {
  projectId: string;
  scheduleId: string;
  requestId: string;
}) {
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      scheduleId: z.string().min(1).max(200),
      requestId: z.string().uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid attendance request." };
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const scheduleId = resolveScheduleId(access.project, input.scheduleId);
  if (!getAttendanceScheduleWindow(access.project, scheduleId))
    return { error: "Session not found." };
  const { data, error } = await access.admin.rpc(
    "create_manual_attendance_batch",
    {
      p_project_id: input.projectId,
      p_schedule_id: scheduleId,
      p_actor_id: access.userId,
      p_request_id: input.requestId,
    },
  );
  if (error || !data) return { error: "Could not open manual attendance." };
  return { batchId: String(data) };
}

export async function loadAttendanceReview(input: {
  projectId: string;
  batchId: string;
}) {
  if (!scope.strict().safeParse(input).success)
    return { error: "Invalid attendance request." };
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const { data, error } = await access.admin
    .from("project_paper_scan_rows")
    .select(REVIEW_ROW_COLUMNS)
    .eq("project_id", input.projectId)
    .eq("batch_id", input.batchId)
    .order("sheet_row_number")
    .limit(300);
  if (error) return { error: "Could not load attendance rows." };
  return { rows: (data ?? []).map(paperRowView) };
}

export async function addAttendanceReviewRow(input: {
  projectId: string;
  batchId: string;
  requestId: string;
}) {
  if (
    !scope.extend({ requestId: z.string().uuid() }).strict().safeParse(input)
      .success
  )
    return { error: "Invalid attendance request." };
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const { data, error } = await access.admin.rpc("add_paper_attendance_row", {
    p_project_id: input.projectId,
    p_batch_id: input.batchId,
    p_actor_id: access.userId,
    p_request_id: input.requestId,
  });
  if (error || !data)
    return { error: "Could not add a row. Reload to check the batch status." };
  return { rowId: String(data) };
}

export async function combineAttendanceReviewRows(input: {
  projectId: string;
  batchId: string;
  targetRowId: string;
  sourceRowIds: string[];
  requestId: string;
}) {
  if (
    !scope
      .extend({
        targetRowId: z.string().uuid(),
        sourceRowIds: z.array(z.string().uuid()).min(1).max(20),
        requestId: z.string().uuid(),
      })
      .strict()
      .safeParse(input).success
  )
    return { error: "Invalid combine request." };
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const { error } = await access.admin.rpc("combine_paper_attendance_rows", {
    p_project_id: input.projectId,
    p_batch_id: input.batchId,
    p_actor_id: access.userId,
    p_target_row_id: input.targetRowId,
    p_source_row_ids: input.sourceRowIds,
    p_request_id: input.requestId,
  });
  if (error)
    return {
      error:
        "Could not combine these rows. Confirm they belong to the same volunteer and reload if either changed.",
    };
  return { success: true as const };
}

export async function loadAttendanceCandidates(input: {
  projectId: string;
  batchId: string;
}) {
  if (!scope.strict().safeParse(input).success)
    return { error: "Invalid attendance request." };
  const access = await requirePaperScanAccess(input.projectId);
  if (!access.ok) return { error: access.error };
  const { data: batch } = await access.admin
    .from("project_paper_scan_batches")
    .select("schedule_id")
    .eq("id", input.batchId)
    .eq("project_id", input.projectId)
    .single();
  if (!batch) return { error: "Batch not found." };
  const aliases = getScheduleIdAliases(access.project, batch.schedule_id);
  if (!aliases.length) return { error: "Session not found." };
  const candidates: Array<{ id: string; name: string; email: string | null }> =
    [];
  let cursor: string | null = null;
  for (;;) {
    let query = access.admin
      .from("project_signups")
      .select(
        "id, profile:profiles!project_signups_user_id_fkey_profiles(full_name,email), guest:anonymous_signups!anonymous_id(name,email)",
      )
      .eq("project_id", input.projectId)
      .in("schedule_id", aliases)
      .in("status", ["approved", "attended", "pending"])
      .order("id")
      .limit(200);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) return { error: "Could not load the session roster." };
    for (const row of data ?? []) {
      const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
      const guest = Array.isArray(row.guest) ? row.guest[0] : row.guest;
      candidates.push({
        id: row.id,
        name: profile?.full_name || guest?.name || "Unnamed volunteer",
        email: profile?.email || guest?.email || null,
      });
    }
    if (!data || data.length < 200) break;
    cursor = data[data.length - 1].id;
  }
  return { candidates };
}
