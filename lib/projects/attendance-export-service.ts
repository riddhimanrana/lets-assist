import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import type { OrganizationMembershipRow } from "./management-access";
import {
  AttendanceExportError,
  canExportAttendance,
  serviceDate,
  attendanceExportCsv,
  buildAttendanceExportRecords,
  parseAttendanceExportFilters,
  type ExportScope,
  type ExportProject,
  type ExportSignup,
  type ExportCertificate,
  type ExportInterval,
} from "./attendance-export";
import {
  buildUnpublishedAttendanceRecords,
  type ExportRosterEntry,
  type ExportReviewRow,
} from "./attendance-export-unpublished";
import { readAllExportPages } from "./attendance-export-pagination";

const projectColumns =
  "id,title,organization_id,creator_id,can_be_managed_by_staff,project_timezone,event_type,schedule,published";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
type Admin = ReturnType<typeof getAdminClient>;

async function assertAccess(
  admin: Admin,
  scope: ExportScope,
  scopeId: string,
  userId: string,
) {
  let project: ExportProject | null = null;
  if (scope === "project") {
    const result = await admin
      .from("projects")
      .select(projectColumns)
      .eq("id", scopeId)
      .maybeSingle();
    if (result.error)
      throw new AttendanceExportError("Unable to check export access", 503);
    project = result.data as ExportProject | null;
    if (!project) throw new AttendanceExportError("Export access denied", 403);
  }
  const organizationId =
    project?.organization_id ?? (scope === "organization" ? scopeId : null);
  let membership: OrganizationMembershipRow = null;
  if (organizationId) {
    const result = await admin
      .from("organization_members")
      .select("role,status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error)
      throw new AttendanceExportError("Unable to check export access", 503);
    membership = result.data;
  }
  const allowed = canExportAttendance(scope, project, userId, membership);
  if (!allowed) throw new AttendanceExportError("Export access denied", 403);
  return project;
}

async function projectRows<T extends { id: string }>(
  admin: Admin,
  table: string,
  columns: string,
  projectId: string,
): Promise<T[]> {
  return readAllExportPages<T>(async (after, limit) => {
    let query = admin
      .from(table)
      .select(columns)
      .eq("project_id", projectId)
      .order("id")
      .limit(limit);
    if (after) query = query.gt("id", after);
    const result = await query;
    return { data: result.data as unknown as T[] | null, error: result.error };
  });
}

export async function attendanceExportResponse(
  request: Request,
  scope: ExportScope,
  scopeId: string,
): Promise<Response> {
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        scopeId,
      )
    )
      throw new AttendanceExportError("Invalid export scope");
    const filters = parseAttendanceExportFilters(
      new URL(request.url).searchParams,
      scope,
    );
    const session = await createClient();
    const auth = await session.auth.getUser();
    if (auth.error || !auth.data.user || auth.data.user.is_anonymous)
      throw new AttendanceExportError("Authentication required", 401);
    const userId = auth.data.user.id;
    const admin = getAdminClient();
    const project = await assertAccess(admin, scope, scopeId, userId);
    const projects = project
      ? [project]
      : await readAllExportPages<ExportProject>(async (after, limit) => {
          let query = admin
            .from("projects")
            .select(projectColumns)
            .eq("organization_id", scopeId)
            .order("id")
            .limit(limit);
          if (after) query = query.gt("id", after);
          if (filters.projectId) query = query.eq("id", filters.projectId);
          const result = await query;
          return {
            data: result.data as ExportProject[] | null,
            error: result.error,
          };
        });
    if (filters.projectId && projects.length === 0)
      throw new AttendanceExportError(
        "Project is not in this organization",
        403,
      );
    if (
      filters.sessionId &&
      project &&
      !serviceDate(project, filters.sessionId)
    )
      throw new AttendanceExportError("Invalid session filter");
    const records = [];
    for (const item of projects) {
      const [signups, certificates, intervals] = await Promise.all([
        projectRows<ExportSignup>(
          admin,
          "project_signups",
          "id,schedule_id,user_id,anonymous_id,check_in_time,check_out_time,status,attendance_revision,profile:profiles!project_signups_user_id_fkey_profiles(full_name,email),guest:anonymous_signups!project_signups_anonymous_id_fkey(name,email)",
          item.id,
        ),
        projectRows<ExportCertificate>(
          admin,
          "certificates",
          "id,signup_id,schedule_id,user_id,volunteer_name,volunteer_email,event_start,event_end,credited_minutes,attendance_revision,type",
          item.id,
        ),
        projectRows<ExportInterval>(
          admin,
          "project_attendance_intervals",
          "id,signup_id,check_in_time,check_out_time",
          item.id,
        ),
      ]);
      records.push(
        ...buildAttendanceExportRecords(
          item,
          signups,
          certificates,
          intervals,
          filters,
        ),
      );
      if (filters.includeUnpublished) {
        const [roster, review] = await Promise.all([
          projectRows<ExportRosterEntry>(
            admin,
            "project_paper_roster_entries",
            "id,scan_row_id,schedule_id,name,check_in_time,check_out_time,attendance_intervals",
            item.id,
          ),
          projectRows<ExportReviewRow>(
            admin,
            "project_paper_scan_rows",
            "id,name,email,check_in_time,check_out_time,attendance_intervals,review_revision,review_acknowledged,identity_confirmed,decision,outcome,committed_signup_id,batch:project_paper_scan_batches!batch_id(schedule_id,status)",
            item.id,
          ),
        ]);
        records.push(
          ...buildUnpublishedAttendanceRecords(item, roster, review, filters),
        );
      }
      if (records.length > 100_000)
        throw new AttendanceExportError(
          "Export exceeds the row limit. Select a narrower scope.",
          413,
        );
    }
    // Recheck the live session and role before releasing participant contact data.
    const currentAuth = await session.auth.getUser();
    if (
      currentAuth.error ||
      currentAuth.data.user?.id !== userId ||
      currentAuth.data.user.is_anonymous
    )
      throw new AttendanceExportError("Authentication required", 401);
    await assertAccess(admin, scope, scopeId, userId);
    if (scope === "organization") {
      const currentProjects = await readAllExportPages<{ id: string }>(
        async (after, limit) => {
          let query = admin
            .from("projects")
            .select("id")
            .eq("organization_id", scopeId)
            .order("id")
            .limit(limit);
          if (after) query = query.gt("id", after);
          return await query;
        },
      );
      const currentIds = new Set(currentProjects.map((item) => item.id));
      if (projects.some((item) => !currentIds.has(item.id)))
        throw new AttendanceExportError(
          "Project scope changed while loading. Retry the export.",
          409,
        );
    }
    const generatedAt = new Date().toISOString();
    const body =
      filters.format === "json"
        ? JSON.stringify({
            schemaVersion: 1,
            generatedAt,
            scope: { type: scope, id: scopeId },
            filters,
            records,
          })
        : attendanceExportCsv(records);
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type":
          filters.format === "json"
            ? "application/json; charset=utf-8"
            : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${scope}-${scopeId}-hours.${filters.format}"`,
      },
    });
  } catch (error) {
    const known = error instanceof AttendanceExportError;
    return Response.json(
      { error: known ? error.message : "Unable to create attendance export" },
      { status: known ? error.status : 500, headers },
    );
  }
}
