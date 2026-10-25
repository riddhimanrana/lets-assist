import "server-only";

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { getMultiDaySlotDisplayName } from "@/utils/project";
import { getScheduleIdAliases } from "@/lib/projects/hours-publish-key";
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

type PrintAccess = NonNullable<
  Awaited<ReturnType<typeof requireAttendancePrintAccess>>
>;
type PrintReference = Pick<
  z.infer<typeof printReferenceSchema>,
  "sheetReference" | "rowReference"
>;
type ResolvedPrintReference = {
  signupId: string | null;
  userId: string | null;
  anonymousId: string | null;
  rowKind: "signup" | "walk_in" | "continuation";
  rowNumber: number;
};
const REFERENCE_QUERY_CHUNK = 50;
const MAX_SCAN_REFERENCES = 300;

function chunks<T>(values: T[]): T[][] {
  return Array.from(
    { length: Math.ceil(values.length / REFERENCE_QUERY_CHUNK) },
    (_, index) =>
      values.slice(
        index * REFERENCE_QUERY_CHUNK,
        (index + 1) * REFERENCE_QUERY_CHUNK,
      ),
  );
}
function referenceKey(reference: PrintReference) {
  return `${reference.sheetReference}:${reference.rowReference}`;
}

/** Server-only scan callers must supply their already-authorized manager context. */
export async function resolveAuthorizedAttendancePrintReferences(
  access: PrintAccess,
  input: {
    projectId: string;
    scheduleId: string;
    references: PrintReference[];
  },
): Promise<Array<ResolvedPrintReference | null>> {
  if (input.references.length > MAX_SCAN_REFERENCES)
    throw new Error("Too many printed references");
  const empty = input.references.map(() => null);
  if (input.projectId !== access.project.id) return empty;
  const valid = input.references.filter(
    (reference) =>
      printReferenceSchema.safeParse({
        projectId: input.projectId,
        scheduleId: input.scheduleId,
        ...reference,
      }).success,
  );
  if (!valid.length) return empty;
  const scheduleIds = getScheduleIdAliases(access.project, input.scheduleId);
  if (
    !scheduleIds.length ||
    !getAttendanceScheduleWindow(access.project, scheduleIds[0])
  )
    return empty;

  const sheetIds = new Set<string>();
  for (const ids of chunks([
    ...new Set(valid.map((reference) => reference.sheetReference)),
  ])) {
    const { data, error } = await access.admin
      .from("project_attendance_print_sheets")
      .select("id")
      .eq("project_id", input.projectId)
      .in("schedule_id", scheduleIds)
      .in("id", ids);
    if (error) throw new Error(`Failed to load printed sheets: ${error.code}`);
    for (const sheet of data ?? []) sheetIds.add(sheet.id);
  }
  const unique = [
    ...new Map(
      valid
        .filter((reference) => sheetIds.has(reference.sheetReference))
        .map((reference) => [referenceKey(reference), reference]),
    ).values(),
  ];
  const rows = new Map<
    string,
    { signup_id: string | null; row_kind: string; row_number: number }
  >();
  for (const references of chunks(unique)) {
    // Each strict UUID/hex pair selects at most one composite-key row.
    const { data, error } = await access.admin
      .from("project_attendance_print_rows")
      .select("sheet_id, row_reference, signup_id, row_kind, row_number")
      .eq("project_id", input.projectId)
      .or(
        references
          .map(
            (reference) =>
              `and(sheet_id.eq.${reference.sheetReference},row_reference.eq.${reference.rowReference})`,
          )
          .join(","),
      );
    if (error) throw new Error(`Failed to load printed rows: ${error.code}`);
    for (const row of data ?? [])
      rows.set(`${row.sheet_id}:${row.row_reference}`, row);
  }
  const signups = new Map<
    string,
    { id: string; user_id: string | null; anonymous_id: string | null }
  >();
  const signupIds = [
    ...new Set(
      [...rows.values()].flatMap((row) =>
        row.signup_id ? [row.signup_id] : [],
      ),
    ),
  ];
  for (const ids of chunks(signupIds)) {
    const { data, error } = await access.admin
      .from("project_signups")
      .select("id, user_id, anonymous_id")
      .eq("project_id", input.projectId)
      .in("schedule_id", scheduleIds)
      .in("status", ["approved", "attended"])
      .in("id", ids);
    if (error)
      throw new Error(`Failed to validate printed signups: ${error.code}`);
    for (const signup of data ?? []) signups.set(signup.id, signup);
  }
  return input.references.map((reference) => {
    const row = rows.get(referenceKey(reference));
    if (!row) return null;
    const signup = row.signup_id ? signups.get(row.signup_id) : null;
    if (row.signup_id && !signup) return null;
    return {
      signupId: row.signup_id,
      userId: signup?.user_id ?? null,
      anonymousId: signup?.anonymous_id ?? null,
      rowKind: row.row_kind as ResolvedPrintReference["rowKind"],
      rowNumber: row.row_number,
    };
  });
}

/** References only suggest a match. The reviewed attendance commit still authorizes the change. */
export async function resolveAttendancePrintReference(
  input: z.infer<typeof printReferenceSchema>,
) {
  const parsed = printReferenceSchema.safeParse(input);
  if (!parsed.success) return null;
  const access = await requireAttendancePrintAccess(parsed.data.projectId);
  if (!access) return null;
  const [resolved] = await resolveAuthorizedAttendancePrintReferences(access, {
    projectId: parsed.data.projectId,
    scheduleId: parsed.data.scheduleId,
    references: [parsed.data],
  });
  return resolved
    ? {
        signupId: resolved.signupId,
        rowKind: resolved.rowKind,
        rowNumber: resolved.rowNumber,
      }
    : null;
}
