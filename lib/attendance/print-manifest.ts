import "server-only";

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { getMultiDaySlotDisplayName, resolveScheduleId } from "@/utils/project";
import type { Project } from "@/types";
import type { AttendancePrintSession } from "./print-types";

type PrintProject = Project & {
  organization_id: string | null;
  can_be_managed_by_staff: boolean | null;
};

export async function requireAttendancePrintAccess(projectId: string) {
  if (!z.string().uuid().safeParse(projectId).success) return null;
  const { user, error } = await getAuthUser();
  if (error || !user) return null;
  const admin = getAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select(
      "id, creator_id, organization_id, can_be_managed_by_staff, title, event_type, schedule, project_timezone",
    )
    .eq("id", projectId)
    .single();
  if (projectError || !project) return null;
  let organizationRole: string | null = null;
  if (project.organization_id && project.creator_id !== user.id) {
    const { data: membership } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    organizationRole = activeOrganizationRole(membership);
  }
  if (
    !canManageProjectAccess({
      creatorId: project.creator_id,
      userId: user.id,
      organizationRole,
      canBeManagedByStaff: project.can_be_managed_by_staff,
    })
  )
    return null;
  return {
    admin,
    userId: user.id,
    project: project as unknown as PrintProject,
  };
}

export function attendancePrintSessions(
  project: Project,
): AttendancePrintSession[] {
  const options: Array<{ id: string; label: string }> = [];
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    options.push({ id: "oneTime", label: "Main session" });
  } else if (project.event_type === "multiDay") {
    project.schedule.multiDay?.forEach((day, dayIndex) =>
      day.slots.forEach((slot, slotIndex) => {
        options.push({
          id: `${day.date}-${dayIndex}-${slotIndex}`,
          label: `${day.date} · ${getMultiDaySlotDisplayName(slot, slotIndex)}`,
        });
      }),
    );
  } else if (project.event_type === "sameDayMultiArea") {
    project.schedule.sameDayMultiArea?.roles.forEach((role) =>
      options.push({ id: role.name, label: role.name }),
    );
  }
  return options.flatMap((option) => {
    const window = getAttendanceScheduleWindow(project, option.id);
    return window
      ? [{ ...option, startsAt: window.startsAt, endsAt: window.endsAt }]
      : [];
  });
}

const printReferenceSchema = z
  .object({
    projectId: z.string().uuid(),
    scheduleId: z.string().min(1).max(200),
    sheetReference: z.string().uuid(),
    rowReference: z.string().regex(/^[0-9a-f]{12}$/),
  })
  .strict();

/** References only suggest a match. The reviewed attendance commit still authorizes the change. */
export async function resolveAttendancePrintReference(
  input: z.infer<typeof printReferenceSchema>,
) {
  const parsed = printReferenceSchema.safeParse(input);
  if (!parsed.success) return null;
  const access = await requireAttendancePrintAccess(parsed.data.projectId);
  if (!access) return null;
  const scheduleId = resolveScheduleId(access.project, parsed.data.scheduleId);
  if (!getAttendanceScheduleWindow(access.project, scheduleId)) return null;
  const { data: sheet } = await access.admin
    .from("project_attendance_print_sheets")
    .select("id")
    .eq("id", parsed.data.sheetReference)
    .eq("project_id", parsed.data.projectId)
    .eq("schedule_id", scheduleId)
    .maybeSingle();
  if (!sheet) return null;
  const { data: row } = await access.admin
    .from("project_attendance_print_rows")
    .select("signup_id, row_kind, row_number")
    .eq("sheet_id", sheet.id)
    .eq("project_id", parsed.data.projectId)
    .eq("row_reference", parsed.data.rowReference)
    .maybeSingle();
  if (!row) return null;
  if (row.signup_id) {
    const { data: signup } = await access.admin
      .from("project_signups")
      .select("id")
      .eq("id", row.signup_id)
      .eq("project_id", parsed.data.projectId)
      .eq("schedule_id", scheduleId)
      .in("status", ["approved", "attended"])
      .maybeSingle();
    if (!signup) return null;
  }
  return {
    signupId: row.signup_id as string | null,
    rowKind: row.row_kind as "signup" | "walk_in" | "continuation",
    rowNumber: row.row_number as number,
  };
}
