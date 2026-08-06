export type ReportDateRange = {
  from?: string;
  to?: string;
};

export type VolunteerSummary = {
  key: string;
  userId?: string | null;
  name: string;
  email: string | null;
  source: "registered" | "anonymous";
  totalHours: number;
  verifiedHours: number;
  pendingHours: number;
  eventsAttended: number;
  lastActivity?: string;
};

export type MonthlyHours = {
  month: string;
  sortKey: string;
  verified: number;
  pending: number;
  total: number;
};

export type ProjectSummary = {
  id: string;
  title: string;
  status: string | null;
  verifiedHours: number;
  pendingHours: number;
  totalHours: number;
  volunteerCount: number;
};

export type ReportMetrics = {
  totalVolunteers: number;
  registeredVolunteers: number;
  anonymousVolunteers: number;
  verifiedHours: number;
  pendingHours: number;
  totalHours: number;
  totalProjects: number;
};

export type OrganizationReportData = {
  metrics: ReportMetrics;
  volunteers: VolunteerSummary[];
  monthlyHours: MonthlyHours[];
  projects: ProjectSummary[];
  updatedAt: string;
};

export type ReportType = "member-hours" | "project-summary" | "monthly-summary";

export type ProjectRow = {
  id: string;
  title: string;
  status: string | null;
  workflow_status?: string | null;
  created_at?: string | null;
};

export type CertificateRow = {
  id: string;
  user_id?: string | null;
  volunteer_name?: string | null;
  volunteer_email?: string | null;
  is_certified: boolean;
  type?: string | null;
  issued_at: string;
  project_id?: string | null;
  project_title?: string | null;
  event_start?: string | null;
  event_end?: string | null;
  signup_id?: string | null;
};

export type SignupRow = {
  id: string;
  user_id?: string | null;
  anonymous_id?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  project_id?: string | null;
  schedule_id?: string | null;
  profiles?:
    | { id: string; full_name?: string | null; email?: string | null }
    | { id: string; full_name?: string | null; email?: string | null }[]
    | null;
  anonymous_signup?:
    | { id: string; name?: string | null; email?: string | null }
    | { id: string; name?: string | null; email?: string | null }[]
    | null;
};
