"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { differenceInMinutes, format } from "date-fns";

export type ReportDateRange = {
  from?: string;
  to?: string;
};

type VolunteerSummary = {
  key: string;
  userId?: string | null;
  name: string;
  email: string | null;
  source: "registered" | "anonymous";
  totalHours: number;
  verifiedHours: number;
  pendingHours: number;
  attendanceHours: number;
  eventsAttended: number;
  lastActivity?: string;
};

type MonthlyHours = {
  month: string;
  sortKey: string;
  verified: number;
  pending: number;
  attendance: number;
  total: number;
};

type ProjectSummary = {
  id: string;
  title: string;
  status: string | null;
  verifiedHours: number;
  pendingHours: number;
  attendanceHours: number;
  totalHours: number;
  volunteerCount: number;
};

type ReportMetrics = {
  totalVolunteers: number;
  registeredVolunteers: number;
  anonymousVolunteers: number;
  verifiedHours: number;
  pendingHours: number;
  attendanceHours: number;
  totalHours: number;
  totalProjects: number;
};

type ProjectRow = {
  id: string;
  title: string;
  status: string | null;
  created_at?: string | null;
};

type CertificateRow = {
  id: string;
  user_id?: string | null;
  volunteer_name?: string | null;
  volunteer_email?: string | null;
  is_certified: boolean;
  issued_at: string;
  project_id?: string | null;
  project_title?: string | null;
  event_start?: string | null;
  event_end?: string | null;
  signup_id?: string | null;
};

type SignupRow = {
  id: string;
  user_id?: string | null;
  anonymous_id?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  project_id?: string | null;
  schedule_id?: string | null;
  profiles?: { id: string; full_name?: string | null; email?: string | null } | { id: string; full_name?: string | null; email?: string | null }[] | null;
  anonymous_signup?: { id: string; name?: string | null; email?: string | null } | { id: string; name?: string | null; email?: string | null }[] | null;
};

export type OrganizationReportData = {
  metrics: ReportMetrics;
  volunteers: VolunteerSummary[];
  monthlyHours: MonthlyHours[];
  projects: ProjectSummary[];
  updatedAt: string;
};

export type ReportType = "member-hours" | "project-summary" | "monthly-summary";

const roundHours = (hours: number) => Math.round(hours * 10) / 10;

const calculateHours = (start?: string | null, end?: string | null): number => {
  if (!start || !end) return 0;
  try {
    const minutes = differenceInMinutes(new Date(end), new Date(start));
    if (minutes <= 0) return 0;
    return roundHours(minutes / 60);
  } catch {
    return 0;
  }
};

type RangeQuery<T> = {
  gte: (field: string, value: string) => T;
  lt: (field: string, value: string) => T;
};

const applyDateRange = <T extends RangeQuery<T>>(
  query: T,
  field: string,
  range?: ReportDateRange
) => {
  if (!range?.from && !range?.to) return query;
  if (range?.from) {
    query = query.gte(field, new Date(range.from).toISOString());
  }
  if (range?.to) {
    query = query.lt(field, new Date(range.to).toISOString());
  }
  return query;
};

const csvEscape = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes("\"")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const buildFilename = (reportType: ReportType, range?: ReportDateRange) => {
  const today = format(new Date(), "yyyy-MM-dd");
  if (!range?.from || !range?.to) {
    return `${reportType}-lifetime-${today}.csv`;
  }
  const from = format(new Date(range.from), "yyyy-MM-dd");
  const to = format(new Date(range.to), "yyyy-MM-dd");
  return `${reportType}-${from}-to-${to}.csv`;
};

async function buildReportDataForOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  dateRange?: ReportDateRange
): Promise<{ data?: OrganizationReportData; error?: string }> {
  try {
    const { data: projects, error: projectsError } = (await supabase
      .from("projects")
      .select("id, title, status, created_at")
      .eq("organization_id", organizationId)) as {
      data: ProjectRow[] | null;
      error: { message: string } | null;
    };

    if (projectsError) {
      return { error: "Failed to load projects" };
    }

    const projectList = projects || [];
    const projectIds = projectList.map((project) => project.id);
    if (projectIds.length === 0) {
      return {
        data: {
          metrics: {
            totalVolunteers: 0,
            registeredVolunteers: 0,
            anonymousVolunteers: 0,
            verifiedHours: 0,
            pendingHours: 0,
            attendanceHours: 0,
            totalHours: 0,
            totalProjects: 0,
          },
          volunteers: [],
          monthlyHours: [],
          projects: [],
          updatedAt: new Date().toISOString(),
        },
      };
    }

    let certificatesQuery = supabase
      .from("certificates")
      .select(
        "id, user_id, volunteer_name, volunteer_email, is_certified, issued_at, project_id, project_title, event_start, event_end, signup_id"
      )
      .in("project_id", projectIds);

    certificatesQuery = applyDateRange(certificatesQuery, "issued_at", dateRange);

    const { data: certificates, error: certificatesError } = (await certificatesQuery) as {
      data: CertificateRow[] | null;
      error: { message: string } | null;
    };
    if (certificatesError) {
      console.error("Failed to fetch certificates:", certificatesError);
      return { error: "Failed to load certificate hours" };
    }

    let attendanceQuery = supabase
      .from("project_signups")
      .select(
        `id, user_id, anonymous_id, check_in_time, check_out_time, project_id, schedule_id,
        profiles:user_id (id, full_name, email),
        anonymous_signup:anonymous_id (id, name, email)`
      )
      .in("project_id", projectIds)
      .not("check_in_time", "is", null)
      .not("check_out_time", "is", null);

    attendanceQuery = applyDateRange(attendanceQuery, "check_in_time", dateRange);

    const { data: signups, error: attendanceError } = (await attendanceQuery) as {
      data: SignupRow[] | null;
      error: { message: string } | null;
    };
    if (attendanceError) {
      console.error("Failed to fetch attendance:", attendanceError);
      return { error: "Failed to load attendance hours" };
    }

    const certificateSignupIds = new Set(
      (certificates || [])
        .map((cert) => cert.signup_id)
        .filter((id): id is string => !!id)
    );

    const attendanceWithoutCertificates = (signups || []).filter(
      (signup) => !certificateSignupIds.has(signup.id)
    );

    const volunteerMap = new Map<string, VolunteerSummary>();
    const monthlyMap = new Map<string, MonthlyHours>();
    const projectMap = new Map<string, ProjectSummary>();
    const projectVolunteerMap = new Map<string, Set<string>>();

    projectList.forEach((project) => {
      projectMap.set(project.id, {
        id: project.id,
        title: project.title,
        status: project.status,
        verifiedHours: 0,
        pendingHours: 0,
        attendanceHours: 0,
        totalHours: 0,
        volunteerCount: 0,
      });
    });

    const ensureMonthlyRow = (dateValue?: string | null) => {
      if (!dateValue) return null;
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) return null;
      const sortKey = format(date, "yyyy-MM");
      const month = format(date, "MMM yyyy");
      if (!monthlyMap.has(sortKey)) {
        monthlyMap.set(sortKey, {
          month,
          sortKey,
          verified: 0,
          pending: 0,
          attendance: 0,
          total: 0,
        });
      }
      return monthlyMap.get(sortKey) || null;
    };

    const ensureVolunteer = (
      key: string,
      data: Partial<VolunteerSummary>
    ): VolunteerSummary => {
      if (!volunteerMap.has(key)) {
        volunteerMap.set(key, {
          key,
          userId: data.userId || null,
          name: data.name || "Unknown",
          email: data.email || null,
          source: data.source || "registered",
          totalHours: 0,
          verifiedHours: 0,
          pendingHours: 0,
          attendanceHours: 0,
          eventsAttended: 0,
          lastActivity: undefined,
        });
      }
      return volunteerMap.get(key)!;
    };

    const trackProjectVolunteer = (projectId: string, volunteerKey: string) => {
      if (!projectVolunteerMap.has(projectId)) {
        projectVolunteerMap.set(projectId, new Set());
      }
      projectVolunteerMap.get(projectId)!.add(volunteerKey);
    };

    for (const cert of certificates || []) {
      const hours = roundHours(
        calculateHours(cert.event_start, cert.event_end)
      );

      const volunteerKey = cert.user_id
        ? `user:${cert.user_id}`
        : `anon:${cert.volunteer_email || cert.id}`;

      const volunteer = ensureVolunteer(volunteerKey, {
        userId: cert.user_id,
        name: cert.volunteer_name || "Unknown",
        email: cert.volunteer_email || null,
        source: cert.user_id ? "registered" : "anonymous",
      });

      volunteer.totalHours += hours;
      if (cert.is_certified) {
        volunteer.verifiedHours += hours;
      } else {
        volunteer.pendingHours += hours;
      }
      volunteer.eventsAttended += 1;
      if (!volunteer.lastActivity || cert.issued_at > volunteer.lastActivity) {
        volunteer.lastActivity = cert.issued_at;
      }

      const monthRow = ensureMonthlyRow(cert.issued_at);
      if (monthRow) {
        if (cert.is_certified) {
          monthRow.verified += hours;
        } else {
          monthRow.pending += hours;
        }
      }

      if (cert.project_id && projectMap.has(cert.project_id)) {
        const project = projectMap.get(cert.project_id)!;
        if (cert.is_certified) {
          project.verifiedHours += hours;
        } else {
          project.pendingHours += hours;
        }
        project.totalHours += hours;
        trackProjectVolunteer(cert.project_id, volunteerKey);
      }
    }

    for (const signup of attendanceWithoutCertificates) {
      const hours = roundHours(
        calculateHours(signup.check_in_time, signup.check_out_time)
      );
      if (hours <= 0) continue;

      const profile = Array.isArray(signup.profiles)
        ? signup.profiles[0]
        : signup.profiles;
      const anonymous = Array.isArray(signup.anonymous_signup)
        ? signup.anonymous_signup[0]
        : signup.anonymous_signup;

      const volunteerKey = signup.user_id
        ? `user:${signup.user_id}`
        : `anon:${signup.anonymous_id || signup.id}`;

      const volunteer = ensureVolunteer(volunteerKey, {
        userId: signup.user_id,
        name: profile?.full_name || anonymous?.name || "Anonymous",
        email: profile?.email || anonymous?.email || null,
        source: signup.user_id ? "registered" : "anonymous",
      });

      volunteer.totalHours += hours;
      volunteer.attendanceHours += hours;
      volunteer.eventsAttended += 1;
      if (
        signup.check_out_time &&
        (!volunteer.lastActivity || signup.check_out_time > volunteer.lastActivity)
      ) {
        volunteer.lastActivity = signup.check_out_time;
      }

      const monthRow = ensureMonthlyRow(signup.check_in_time);
      if (monthRow) {
        monthRow.attendance += hours;
      }

      if (signup.project_id && projectMap.has(signup.project_id)) {
        const project = projectMap.get(signup.project_id)!;
        project.attendanceHours += hours;
        project.totalHours += hours;
        trackProjectVolunteer(signup.project_id, volunteerKey);
      }
    }

    const volunteers = Array.from(volunteerMap.values())
      .map((volunteer) => ({
        ...volunteer,
        totalHours: roundHours(volunteer.totalHours),
        verifiedHours: roundHours(volunteer.verifiedHours),
        pendingHours: roundHours(volunteer.pendingHours),
        attendanceHours: roundHours(volunteer.attendanceHours),
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    const monthlyHours = Array.from(monthlyMap.values())
      .map((row) => ({
        ...row,
        verified: roundHours(row.verified),
        pending: roundHours(row.pending),
        attendance: roundHours(row.attendance),
        total: roundHours(row.verified + row.pending + row.attendance),
      }))
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));

    const projectsSummary = Array.from(projectMap.values()).map((project) => ({
      ...project,
      verifiedHours: roundHours(project.verifiedHours),
      pendingHours: roundHours(project.pendingHours),
      attendanceHours: roundHours(project.attendanceHours),
      totalHours: roundHours(project.totalHours),
      volunteerCount: projectVolunteerMap.get(project.id)?.size || 0,
    }));

    const verifiedHours = volunteers.reduce((sum, v) => sum + v.verifiedHours, 0);
    const pendingHours = volunteers.reduce((sum, v) => sum + v.pendingHours, 0);
    const attendanceHours = volunteers.reduce((sum, v) => sum + v.attendanceHours, 0);

    const metrics: ReportMetrics = {
      totalVolunteers: volunteers.length,
      registeredVolunteers: volunteers.filter((v) => v.source === "registered").length,
      anonymousVolunteers: volunteers.filter((v) => v.source === "anonymous").length,
      verifiedHours: roundHours(verifiedHours),
      pendingHours: roundHours(pendingHours),
      attendanceHours: roundHours(attendanceHours),
      totalHours: roundHours(verifiedHours + pendingHours + attendanceHours),
      totalProjects: projectList.length,
    };

    return {
      data: {
        metrics,
        volunteers,
        monthlyHours,
        projects: projectsSummary,
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("Error generating report data:", error);
    return { error: "Failed to generate report data" };
  }
}

export async function getOrganizationReportData(
  organizationId: string,
  dateRange?: ReportDateRange
): Promise<{ data?: OrganizationReportData; error?: string }> {
  const supabase = await createClient();

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      return { error: "Authentication required" };
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", authData.user.id)
      .single();

    const canView = membership?.role === "admin" || membership?.role === "staff";
    if (!canView) {
      return { error: "Permission denied" };
    }

    return buildReportDataForOrg(supabase, organizationId, dateRange);
  } catch (error) {
    console.error("Error generating report data:", error);
    return { error: "Failed to generate report data" };
  }
}

export async function getOrganizationReportDataForSync(
  organizationId: string,
  dateRange?: ReportDateRange
): Promise<{ data?: OrganizationReportData; error?: string }> {
  const supabase = getAdminClient();
  return buildReportDataForOrg(supabase, organizationId, dateRange);
}

export async function buildOrganizationReportRows(
  organizationId: string,
  reportType: ReportType,
  dateRange?: ReportDateRange
): Promise<{ rows?: string[][]; error?: string }> {
  const report = await getOrganizationReportData(organizationId, dateRange);
  if (!report.data || report.error) {
    return { error: report.error || "Report unavailable" };
  }

  if (reportType === "member-hours") {
    const rows = [
      [
        "Volunteer Name",
        "Email",
        "Total Hours",
        "Verified Hours",
        "Pending Hours",
        "Unpublished Attendance Hours",
        "Events Attended",
        "Last Activity",
        "Source",
      ],
      ...report.data.volunteers.map((volunteer) => [
        volunteer.name,
        volunteer.email || "",
        volunteer.totalHours.toFixed(1),
        volunteer.verifiedHours.toFixed(1),
        volunteer.pendingHours.toFixed(1),
        volunteer.attendanceHours.toFixed(1),
        volunteer.eventsAttended.toString(),
        volunteer.lastActivity ? format(new Date(volunteer.lastActivity), "yyyy-MM-dd") : "",
        volunteer.source === "registered" ? "Registered" : "Anonymous",
      ]),
    ];

    return { rows };
  }

  if (reportType === "project-summary") {
    const rows = [
      [
        "Project",
        "Status",
        "Verified Hours",
        "Pending Hours",
        "Unpublished Attendance Hours",
        "Total Hours",
        "Volunteer Count",
      ],
      ...report.data.projects.map((project) => [
        project.title,
        project.status || "",
        project.verifiedHours.toFixed(1),
        project.pendingHours.toFixed(1),
        project.attendanceHours.toFixed(1),
        project.totalHours.toFixed(1),
        project.volunteerCount.toString(),
      ]),
    ];

    return { rows };
  }

  const rows = [
    [
      "Month",
      "Verified Hours",
      "Pending Hours",
      "Unpublished Attendance Hours",
      "Total Hours",
    ],
    ...report.data.monthlyHours.map((month) => [
      month.month,
      month.verified.toFixed(1),
      month.pending.toFixed(1),
      month.attendance.toFixed(1),
      month.total.toFixed(1),
    ]),
  ];

  return { rows };
}

export async function buildOrganizationReportRowsForSync(
  organizationId: string,
  reportType: ReportType,
  dateRange?: ReportDateRange
): Promise<{ rows?: string[][]; error?: string }> {
  const report = await getOrganizationReportDataForSync(organizationId, dateRange);
  if (!report.data || report.error) {
    return { error: report.error || "Report unavailable" };
  }

  if (reportType === "member-hours") {
    const rows = [
      [
        "Volunteer Name",
        "Email",
        "Total Hours",
        "Verified Hours",
        "Pending Hours",
        "Unpublished Attendance Hours",
        "Events Attended",
        "Last Activity",
        "Source",
      ],
      ...report.data.volunteers.map((volunteer) => [
        volunteer.name,
        volunteer.email || "",
        volunteer.totalHours.toFixed(1),
        volunteer.verifiedHours.toFixed(1),
        volunteer.pendingHours.toFixed(1),
        volunteer.attendanceHours.toFixed(1),
        volunteer.eventsAttended.toString(),
        volunteer.lastActivity ? format(new Date(volunteer.lastActivity), "yyyy-MM-dd") : "",
        volunteer.source === "registered" ? "Registered" : "Anonymous",
      ]),
    ];

    return { rows };
  }

  if (reportType === "project-summary") {
    const rows = [
      [
        "Project",
        "Status",
        "Verified Hours",
        "Pending Hours",
        "Unpublished Attendance Hours",
        "Total Hours",
        "Volunteer Count",
      ],
      ...report.data.projects.map((project) => [
        project.title,
        project.status || "",
        project.verifiedHours.toFixed(1),
        project.pendingHours.toFixed(1),
        project.attendanceHours.toFixed(1),
        project.totalHours.toFixed(1),
        project.volunteerCount.toString(),
      ]),
    ];

    return { rows };
  }

  const rows = [
    [
      "Month",
      "Verified Hours",
      "Pending Hours",
      "Unpublished Attendance Hours",
      "Total Hours",
    ],
    ...report.data.monthlyHours.map((month) => [
      month.month,
      month.verified.toFixed(1),
      month.pending.toFixed(1),
      month.attendance.toFixed(1),
      month.total.toFixed(1),
    ]),
  ];

  return { rows };
}

export async function exportOrganizationReport(
  organizationId: string,
  reportType: ReportType,
  dateRange?: ReportDateRange
): Promise<{ csvData?: string; error?: string; filename?: string }> {
  const { rows, error } = await buildOrganizationReportRows(
    organizationId,
    reportType,
    dateRange
  );

  if (error || !rows) {
    return { error: error || "Unable to build report" };
  }

  const csvRows = rows.map((row) => row.map(csvEscape).join(","));
  return {
    csvData: csvRows.join("\n"),
    filename: buildFilename(reportType, dateRange),
  };
}
