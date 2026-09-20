import type { ProjectSchedule } from "@/types";
import {
  activeOrganizationRole,
  canManageProjectAccess,
  type OrganizationMembershipRow,
} from "./management-access";
import { certificateHours } from "./certificate-duration";

export class AttendanceExportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type ExportScope = "project" | "organization";
export type AttendanceExportFilters = {
  format: "csv" | "json";
  from: string | null;
  to: string | null;
  sessionId: string | null;
  includeUnpublished: boolean;
};
export function parseAttendanceExportFilters(
  params: URLSearchParams,
  scope: ExportScope,
): AttendanceExportFilters {
  const allowed = new Set([
    "format",
    "from",
    "to",
    "sessionId",
    "includeUnpublished",
  ]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw new AttendanceExportError("Invalid export filter");
  }
  const format = params.get("format") ?? "csv";
  const include = params.get("includeUnpublished") ?? "false";
  if (!["csv", "json"].includes(format) || !["true", "false"].includes(include))
    throw new AttendanceExportError(
      "Invalid export format or publication filter",
    );
  const from = params.get("from"),
    to = params.get("to"),
    sessionId = params.get("sessionId");
  for (const value of [from, to]) {
    if (
      value !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new AttendanceExportError("Dates must be valid YYYY-MM-DD values");
  }
  if (from && to && from > to)
    throw new AttendanceExportError("Start date must precede end date");
  if (
    sessionId !== null &&
    (scope !== "project" || !sessionId.trim() || sessionId.length > 200)
  )
    throw new AttendanceExportError("Invalid session filter");
  return {
    format: format as "csv" | "json",
    from,
    to,
    sessionId,
    includeUnpublished: include === "true",
  };
}
export type ExportProject = {
  id: string;
  title: string;
  organization_id: string | null;
  creator_id: string;
  can_be_managed_by_staff: boolean | null;
  project_timezone: string | null;
  schedule: ProjectSchedule;
  published: Record<string, boolean> | null;
};
export function canExportAttendance(
  scope: ExportScope,
  project: ExportProject | null,
  userId: string,
  membership: OrganizationMembershipRow,
): boolean {
  const role = activeOrganizationRole(membership);
  return scope === "organization"
    ? role === "admin"
    : !!project &&
        canManageProjectAccess({
          creatorId: project.creator_id,
          userId,
          organizationRole: role,
          canBeManagedByStaff: project.can_be_managed_by_staff,
        });
}
export type ExportSignup = {
  id: string;
  schedule_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  status: string;
  attendance_revision: number | null;
  profile: { full_name: string | null; email: string | null } | null;
  guest: { name: string | null; email: string | null } | null;
};
export type ExportCertificate = {
  id: string;
  signup_id: string | null;
  schedule_id: string | null;
  user_id: string | null;
  volunteer_name: string | null;
  volunteer_email: string | null;
  event_start: string;
  event_end: string;
  credited_minutes: number | null;
  attendance_revision: number | null;
  type: string | null;
};
export type ExportInterval = {
  id: string;
  signup_id: string;
  check_in_time: string;
  check_out_time: string | null;
};
export type AttendanceExportRecord = {
  projectId: string;
  projectTitle: string;
  organizationId: string | null;
  sessionId: string | null;
  serviceDate: string | null;
  timezone: string;
  signupId: string | null;
  participantId: string | null;
  participantType: "account" | "guest";
  name: string;
  email: string;
  intervals: { checkIn: string; checkOut: string | null }[];
  creditedMinutes: number | null;
  publicationState: "published" | "pending" | "unresolved";
  certificateId: string | null;
  attendanceRevision: number | null;
};
export function serviceDate(
  project: ExportProject,
  sessionId: string | null,
  instant?: string | null,
): string | null {
  const schedule = project.schedule;
  if (sessionId === "oneTime" && schedule.oneTime) return schedule.oneTime.date;
  const datedSlot = sessionId?.match(/^(\d{4}-\d{2}-\d{2})-(?:(\d+)-)?(\d+)$/);
  if (datedSlot) {
    const day = schedule.multiDay?.find((item) => item.date === datedSlot[1]);
    if (day?.slots[Number(datedSlot[3])]) return day.date;
  }
  const day = sessionId?.match(/^day-(\d+)-slot-(\d+)$/);
  if (day && schedule.multiDay?.[Number(day[1])]?.slots[Number(day[2])])
    return schedule.multiDay[Number(day[1])].date;
  if (
    schedule.sameDayMultiArea &&
    sessionId &&
    (schedule.sameDayMultiArea.roles.some((r) => r.name === sessionId) ||
      (/^role-\d+$/.test(sessionId) &&
        schedule.sameDayMultiArea.roles[Number(sessionId.slice(5))]))
  )
    return schedule.sameDayMultiArea.date;
  if (!instant) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: project.project_timezone || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
export function buildAttendanceExportRecords(
  project: ExportProject,
  signups: ExportSignup[],
  certificates: ExportCertificate[],
  intervals: ExportInterval[],
  filters: AttendanceExportFilters,
): AttendanceExportRecord[] {
  const certBySignup = new Map<string, ExportCertificate>();
  for (const cert of certificates) {
    if (cert.signup_id) {
      const existing = certBySignup.get(cert.signup_id);
      if (
        !existing ||
        (cert.attendance_revision ?? -1) > (existing.attendance_revision ?? -1)
      )
        certBySignup.set(cert.signup_id, cert);
    }
  }
  const intervalBySignup = new Map<string, ExportInterval[]>();
  for (const interval of intervals)
    intervalBySignup.set(interval.signup_id, [
      ...(intervalBySignup.get(interval.signup_id) ?? []),
      interval,
    ]);
  const records: AttendanceExportRecord[] = [];
  function add(
    signup: ExportSignup | null,
    cert: ExportCertificate | undefined,
  ) {
    const sessionId = signup?.schedule_id ?? cert?.schedule_id ?? null;
    const date = serviceDate(
      project,
      sessionId,
      cert?.event_start ?? signup?.check_in_time,
    );
    if (
      (filters.sessionId && sessionId !== filters.sessionId) ||
      (filters.from && (!date || date < filters.from)) ||
      (filters.to && (!date || date > filters.to))
    )
      return;
    const sourceIntervals = signup
      ? (intervalBySignup.get(signup.id) ?? [])
      : [];
    const attendance = sourceIntervals.length
      ? sourceIntervals.map((i) => ({
          checkIn: i.check_in_time,
          checkOut: i.check_out_time,
        }))
      : signup?.check_in_time
        ? [{ checkIn: signup.check_in_time, checkOut: signup.check_out_time }]
        : cert
          ? [{ checkIn: cert.event_start, checkOut: cert.event_end }]
          : [];
    attendance.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const currentCertificate =
      cert &&
      (cert.credited_minutes === null ||
        cert.attendance_revision === signup?.attendance_revision ||
        !signup);
    const published =
      !!cert &&
      (cert.type === "verified" ||
        (cert.type === null && cert.credited_minutes === null)) &&
      currentCertificate;
    const complete =
      attendance.length > 0 &&
      attendance.every(
        (i) => i.checkOut && Date.parse(i.checkOut) > Date.parse(i.checkIn),
      );
    const publicationState = published
      ? "published"
      : complete && signup?.status === "attended"
        ? "pending"
        : "unresolved";
    if (!filters.includeUnpublished && publicationState !== "published") return;
    records.push({
      projectId: project.id,
      projectTitle: project.title,
      organizationId: project.organization_id,
      sessionId,
      serviceDate: date,
      timezone: project.project_timezone || "America/Los_Angeles",
      signupId: signup?.id ?? cert?.signup_id ?? null,
      participantId:
        signup?.user_id ?? signup?.anonymous_id ?? cert?.user_id ?? null,
      participantType: signup?.user_id || cert?.user_id ? "account" : "guest",
      name:
        signup?.profile?.full_name ??
        signup?.guest?.name ??
        cert?.volunteer_name ??
        "",
      email:
        signup?.profile?.email ??
        signup?.guest?.email ??
        cert?.volunteer_email ??
        "",
      intervals: attendance,
      creditedMinutes: published
        ? Math.round(
            certificateHours(cert, () =>
              Math.max(
                0,
                (Date.parse(cert.event_end) - Date.parse(cert.event_start)) /
                  3600000,
              ),
            ) * 60,
          )
        : null,
      publicationState,
      certificateId: cert?.id ?? null,
      attendanceRevision:
        signup?.attendance_revision ?? cert?.attendance_revision ?? null,
    });
  }
  const legacyByAccountSession = new Map<string, ExportCertificate>();
  for (const cert of certificates) {
    if (
      !cert.signup_id &&
      cert.user_id &&
      cert.schedule_id &&
      cert.credited_minutes === null
    ) {
      legacyByAccountSession.set(`${cert.user_id}:${cert.schedule_id}`, cert);
    }
  }
  const usedCertificates = new Set<string>();
  for (const signup of signups) {
    const cert =
      certBySignup.get(signup.id) ??
      (signup.user_id
        ? legacyByAccountSession.get(`${signup.user_id}:${signup.schedule_id}`)
        : undefined);
    if (cert) usedCertificates.add(cert.id);
    add(signup, cert);
  }
  const signupIds = new Set(signups.map((s) => s.id));
  for (const cert of certificates)
    if (
      !usedCertificates.has(cert.id) &&
      (!cert.signup_id || !signupIds.has(cert.signup_id))
    )
      add(null, cert);
  return records;
}
export function attendanceExportCsv(records: AttendanceExportRecord[]): string {
  const columns: (keyof AttendanceExportRecord)[] = [
    "projectId",
    "projectTitle",
    "organizationId",
    "sessionId",
    "serviceDate",
    "timezone",
    "signupId",
    "participantId",
    "participantType",
    "name",
    "email",
    "intervals",
    "creditedMinutes",
    "publicationState",
    "certificateId",
    "attendanceRevision",
  ];
  const cell = (value: unknown) => {
    let text =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/^\s*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    [
      columns.map(cell).join(","),
      ...records.map((record) =>
        columns.map((key) => cell(record[key])).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
