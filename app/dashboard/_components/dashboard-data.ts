import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { redirect } from "next/navigation";
import {
  format,
  subMonths,
  parseISO,
  differenceInMinutes,
  isBefore,
  isAfter,
} from "date-fns";
import { TZDate, tz } from "@date-fns/tz";
import { Project } from "@/types";
import { getSlotDetails } from "@/utils/project";
import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";

interface BackendCertificate {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "verified" | "self-reported"; // backend uses 'verified' | 'self-reported'
  event_start: string;
  event_end: string;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  projects?: {
    project_timezone?: string;
  };
}

// Add a local UI certificate type that matches what the components expect.
// backend 'verified' -> UI 'platform', self-reported stays 'self-reported'
interface UICertificate {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "platform" | "self-reported";
  event_start: string;
  projects?: {
    project_timezone?: string;
  };
  event_end: string;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  hours?: number; // computed field added in processing
}

// Define types for statistics
interface VolunteerStats {
  totalHours: number;
  totalProjects: number;
  totalCertificates: number;
  recentActivity: {
    month: string;
    hours: number;
  }[];
  organizations: {
    name: string;
    hours: number;
    projects: number;
  }[];
  hoursByMonth: Record<string, number>;
}

// Define type for upcoming session data
interface UpcomingSession {
  signupId: string;
  projectId: string;
  projectTitle: string;
  scheduleId: string;
  sessionDisplayName: string;
  sessionStartTime: Date;
  status: "approved" | "pending";
  project_timezone: string;
}

// Calculate hours between two timestamps
function calculateHours(startTime: string, endTime: string): number {
  try {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    if (isBefore(end, start)) return 0;
    return Math.round((differenceInMinutes(end, start) / 60) * 10) / 10; // Round to 1 decimal place
  } catch (e) {
    console.error("Error calculating hours:", e);
    return 0;
  }
}

// Helper function to get combined DateTime from date and time strings
function getCombinedDateTime(
  dateStr: string,
  timeStr: string,
  timezone?: string,
): Date | null {
  if (!dateStr || !timeStr) return null;
  try {
    const isoString = `${dateStr}T${timeStr}`;
    if (timezone) {
      // Parse to use TZDate constructor safely (Year, MonthIndex, Day, Hour, Minute)
      const [year, month, day] = dateStr.split("-").map(Number);
      const [hours, minutes] = timeStr.split(":").map(Number);
      return new TZDate(year, month - 1, day, hours, minutes, 0, timezone);
    }
    const dateTime = parseISO(isoString);
    return isNaN(dateTime.getTime()) ? null : dateTime;
  } catch (e) {
    console.error("Error parsing date/time:", e);
    return null;
  }
}

// Helper function to get session display name
type SlotDetails = NonNullable<ReturnType<typeof getSlotDetails>> & {
  name?: string;
  schedule_id?: string;
};

function getSessionDisplayName(
  project: Project,
  startTime: Date | null,
  details: SlotDetails,
  projectTimezone?: string,
  slotDate?: string,
): string {
  const timezone = projectTimezone || project.project_timezone || "UTC";

  if ("name" in details && details.name) {
    return details.name;
  }

  if (project.schedule?.oneTime) {
    return "Main Event";
  }

  if (startTime) {
    const formattedDate = format(startTime, "MMM d, yyyy", {
      in: tz(timezone),
    });
    const formattedStartTime = format(startTime, "h:mm a", {
      in: tz(timezone),
    });
    const endDateTime =
      slotDate && details.endTime
        ? getCombinedDateTime(slotDate, details.endTime, timezone)
        : null;
    const formattedEndTime = endDateTime
      ? format(endDateTime, "h:mm a", { in: tz(timezone) })
      : null;

    if (formattedEndTime) {
      return `${formattedDate} (${formattedStartTime} - ${formattedEndTime})`;
    }

    return `${formattedDate} (${formattedStartTime})`;
  }

  return details.schedule_id || "Session";
}

// Helper function to format total duration from hours (decimal) to Xh Ym
export function formatTotalDuration(totalHours: number): string {
  if (totalHours <= 0) return "0m"; // Handle zero or negative hours

  // Convert decimal hours to total minutes, rounding to nearest minute
  const totalMinutes = Math.round(totalHours * 60);

  if (totalMinutes === 0) return "0m"; // Handle cases that round down to 0

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  let result = "";
  if (hours > 0) {
    result += `${hours}h`;
  }
  if (remainingMinutes > 0) {
    // Add space if hours were also added
    if (hours > 0) {
      result += " ";
    }
    result += `${remainingMinutes}m`;
  }

  // Fallback in case result is somehow empty (e.g., very small positive number rounds to 0 minutes)
  return result || (totalMinutes > 0 ? "1m" : "0m");
}

export async function loadVolunteerDashboardData() {
  const supabase = await createClient();

  // Check authentication using getClaims() for better performance
  const { user, error: userError } = await getAuthUser();
  if (userError || !user) {
    redirect("/login?redirect=/dashboard");
  }

  // Fetch user's profile
  const profileResult = await withRetryableSupabaseQuery(() =>
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  );

  const { error: profileError } = profileResult as {
    error: { message?: string } | null;
  };

  if (profileError) {
    console.error("Error fetching profile:", profileError);
  }

  // Fetch certificates for this user
  type CertificateRow = {
    id: string;
    project_title: string;
    creator_name: string | null;
    is_certified: boolean;
    event_start: string;
    event_end: string;
    volunteer_email: string | null;
    organization_name: string | null;
    project_id: string | null;
    schedule_id: string | null;
    issued_at: string;
    signup_id: string | null;
    volunteer_name: string | null;
    project_location: string | null;
  };

  const certificatesResult = await withRetryableSupabaseQuery(() =>
    supabase
      .from("certificates")
      .select(
        `
      *
    `,
      )
      .eq("user_id", user.id)
      .order("issued_at", { ascending: false }),
  );

  const { data: certificates, error: certificatesError } =
    certificatesResult as {
      data: CertificateRow[] | null;
      error: { message?: string } | null;
    };

  if (certificatesError) {
    console.error("Error fetching certificates:", certificatesError);
  }

  // Fetch upcoming signups
  type SignupRow = {
    id: string;
    project_id: string;
    schedule_id: string;
    status: string;
    projects:
      | Pick<Project, "id" | "title" | "schedule" | "event_type">
      | Pick<Project, "id" | "title" | "schedule" | "event_type">[]
      | null;
  };

  const signupsResult = await withRetryableSupabaseQuery(() =>
    supabase
      .from("project_signups")
      .select(
        `
      id,
      project_id,
      schedule_id,
      status,
      projects (
        id,
        title,
        schedule,
        event_type
      )
    `,
      )
      .eq("user_id", user.id)
      .in("status", ["approved", "pending"]),
  );

  const { data: signupData, error: signupsError } = signupsResult as {
    data: SignupRow[] | null;
    error: { message?: string } | null;
  }; // Fetch approved and pending

  if (signupsError) {
    console.error("Error fetching upcoming signups:", signupsError);
    // Handle error appropriately, maybe show a message
  }

  // Fetch certificates for the dashboard (modified)
  const certificatesFetchResult = await withRetryableSupabaseQuery(() =>
    supabase
      .from("certificates")
      .select(
        `
      *,
      projects!inner(
        project_timezone
      )
    `,
      )
      .eq("volunteer_email", user.email) // Assuming you fetch by email
      .order("issued_at", { ascending: false }),
  );

  const { error: certificatesErrorFetch } = certificatesFetchResult as {
    error: { message?: string } | null;
  };

  if (certificatesErrorFetch) {
    console.error("Error fetching certificates:", certificatesErrorFetch);
    // Handle error appropriately
  }

  // Calculate volunteer statistics
  const statistics: VolunteerStats = {
    totalHours: 0,
    totalProjects: 0,
    totalCertificates: 0,
    recentActivity: [],
    organizations: [],
    hoursByMonth: {},
  };

  // Process certificate data (typed as BackendCertificate from the DB)
  const processedCertificates = (certificates || []).map(
    (cert: BackendCertificate) => {
      // Calculate hours for this certificate
      const hours = calculateHours(cert.event_start, cert.event_end);

      // Default to 'verified' for existing certificates that don't have the type field
      const certType = cert.type || "verified";

      // Only count verified hours for main statistics
      if (certType === "verified") {
        statistics.totalHours += hours;
        statistics.totalCertificates++;

        // Only track organizations with actual names, exclude "Independent Projects"
        if (cert.organization_name) {
          // Track unique organizations with valid names
          if (
            !statistics.organizations.some(
              (org) => org.name === cert.organization_name,
            )
          ) {
            statistics.organizations.push({
              name: cert.organization_name,
              hours: hours,
              projects: 1,
            });
          } else {
            const orgIndex = statistics.organizations.findIndex(
              (org) => org.name === cert.organization_name,
            );
            statistics.organizations[orgIndex].hours += hours;
            statistics.organizations[orgIndex].projects += 1;
          }
        }

        // Track hours by month for verified certificates
        const monthYear = format(parseISO(cert.issued_at), "MMM yyyy");
        if (!statistics.hoursByMonth[monthYear]) {
          statistics.hoursByMonth[monthYear] = 0;
        }
        statistics.hoursByMonth[monthYear] += hours;
      }

      return {
        ...cert,
        type: certType as "verified" | "self-reported",
        hours,
      };
    },
  );

  // Map backend certificate types to the UI Certificate type expected by components:
  // backend 'verified' -> UI 'platform', 'self-reported' stays 'self-reported'
  const uiCertificates: UICertificate[] = processedCertificates.map((c) => ({
    ...c,
    // Ensure the "type" matches the UI type union ("platform" | "self-reported" | undefined)
    type: c.type === "verified" ? "platform" : c.type,
  }));

  // Get unique project count from verified certificates only
  statistics.totalProjects = [
    ...new Set(
      processedCertificates
        .filter(
          (c: BackendCertificate & { hours: number }) =>
            (c.type || "verified") === "verified",
        )
        .map((c: BackendCertificate & { hours: number }) => c.project_id),
    ),
  ].filter(Boolean).length;

  // Calculate self-reported hours
  const selfReportedHours = processedCertificates
    .filter(
      (c: BackendCertificate & { hours: number }) => c.type === "self-reported",
    )
    .reduce((total, cert) => total + cert.hours, 0);

  // Format hours by month for chart data - last 6 months
  const now = new Date();
  const monthsData = [];
  for (let i = 5; i >= 0; i--) {
    const month = subMonths(now, i);
    const monthStr = format(month, "MMM yyyy");
    monthsData.push({
      month: format(month, "MMM"),
      hours: statistics.hoursByMonth[monthStr] || 0,
    });
  }
  statistics.recentActivity = monthsData;

  // --- MODIFIED: Process signups to find genuinely upcoming sessions ---
  const upcomingSessions: UpcomingSession[] = [];

  if (signupData) {
    for (const signup of signupData) {
      // Ensure project data is available and is not an array (should be single object)
      const project = Array.isArray(signup.projects)
        ? (signup.projects[0] as Project)
        : (signup.projects as Project | null);
      if (!project || !project.schedule || !signup.schedule_id) {
        continue; // Skip if project data or schedule_id is missing
      }

      const details = getSlotDetails(project, signup.schedule_id);
      if (!details) continue; // Skip if slot details not found

      // Find the date for the slot
      let slotDate: string | undefined;
      if (project.event_type === "oneTime" && project.schedule.oneTime) {
        slotDate = project.schedule.oneTime.date;
      } else if (
        project.event_type === "multiDay" &&
        project.schedule.multiDay
      ) {
        for (const day of project.schedule.multiDay) {
          // Check if the slot belongs to this day
          if (day.slots.some((slot) => slot === details)) {
            slotDate = day.date;
            break;
          }
        }
      } else if (
        project.event_type === "sameDayMultiArea" &&
        project.schedule.sameDayMultiArea
      ) {
        slotDate = project.schedule.sameDayMultiArea.date;
      }

      if (!slotDate || !details.startTime) continue; // Skip if date or start time missing

      const projectTimezone = project.project_timezone || "America/Los_Angeles"; // Default timezone if not set
      const sessionStartTime = getCombinedDateTime(
        slotDate,
        details.startTime,
        projectTimezone,
      );

      // Check if the session start time is valid and in the future
      if (sessionStartTime && isAfter(sessionStartTime, now)) {
        upcomingSessions.push({
          signupId: signup.id,
          projectId: project.id,
          projectTitle: project.title,
          scheduleId: signup.schedule_id,
          sessionDisplayName: getSessionDisplayName(
            project,
            sessionStartTime,
            details,
            projectTimezone,
            slotDate,
          ),
          sessionStartTime: sessionStartTime,
          status: signup.status as "approved" | "pending",
          project_timezone: projectTimezone,
        });
      }
    }
  }

  // Sort upcoming sessions by start time (soonest first)
  upcomingSessions.sort(
    (a, b) => a.sessionStartTime.getTime() - b.sessionStartTime.getTime(),
  );
  // --- END NEW PROCESSING ---

  return {
    statistics,
    selfReportedHours,
    upcomingSessions,
    user,
    uiCertificates,
  };
}

export type VolunteerDashboardData = Awaited<
  ReturnType<typeof loadVolunteerDashboardData>
>;
