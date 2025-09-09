import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { VolunteerGoals } from "./VolunteerGoals";
import { Badge } from "@/components/ui/badge";
import { ProgressCircle } from "./ProgressCircle";
import { format, subMonths, parseISO, differenceInMinutes, isBefore, isAfter } from "date-fns";
import { Award, Calendar, Clock, Users, Target, FileCheck, ChevronRight, Download, GalleryVerticalEnd, TicketCheck, Plus, CalendarDays, BarChart3, CircleCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityChart } from "./ActivityChart";
import { ExportSection } from "./ExportSection";
import { AllHoursSection } from "./AllHoursSection";
import { AddVolunteerHoursModal } from "./AddVolunteerHoursModal";
import { Project, ProjectSchedule } from "@/types";
import { getSlotDetails } from "@/utils/project";
import { Metadata } from "next";

// Define types for certificate data returned by the backend
// Renamed to avoid colliding with the UI Certificate type imported above
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
  status: 'approved' | 'pending';
}

export const metadata: Metadata = {
  title: "Volunteer Dashboard",
  description: "Track your volunteering progress and achievements",
};

// Calculate hours between two timestamps
function calculateHours(startTime: string, endTime: string): number {
  try {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    if (isBefore(end, start)) return 0;
    return Math.round(differenceInMinutes(end, start) / 60 * 10) / 10; // Round to 1 decimal place
  } catch (e) {
    console.error("Error calculating hours:", e);
    return 0;
  }
}

// Helper function to get combined DateTime from date and time strings
function getCombinedDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  try {
    // Use date-fns parse which is more robust
    const dateTime = parseISO(`${dateStr}T${timeStr}`);
    return isNaN(dateTime.getTime()) ? null : dateTime;
  } catch (e) {
    console.error("Error parsing date/time:", e);
    return null;
  }
}

// Helper function to get session display name
function getSessionDisplayName(project: Project, startTime: Date | null, details: any): string {
  if ('name' in details && details.name) {
    return details.name;
  } else if (project.schedule?.oneTime) {
    return "Main Event";
  } else if (project.schedule?.multiDay && startTime) {
    const formattedDate = format(startTime, "MMM d, yyyy");
    const formattedStartTime = format(parseISO(`1970-01-01T${details.startTime}`), "h:mm a");
    const formattedEndTime = format(parseISO(`1970-01-01T${details.endTime}`), "h:mm a");
    return `${formattedDate} (${formattedStartTime} - ${formattedEndTime})`;
  } else {
    return details.schedule_id || "Session";
  }
}

// Helper to calculate duration in decimal hours
function calculateDecimalHours(startTimeISO: string, endTimeISO: string): number {
  try {
    const start = parseISO(startTimeISO);
    const end = parseISO(endTimeISO);
    const minutes = differenceInMinutes(end, start);
    return minutes > 0 ? minutes / 60 : 0;
  } catch (e) {
    console.error("Error calculating duration:", e);
    return 0; // Return 0 if parsing fails
  }
}

// Helper function to format total duration from hours (decimal) to Xh Ym
function formatTotalDuration(totalHours: number): string {
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

export default async function VolunteerDashboard() {
  const cookieStore = cookies();
  const supabase = await createClient();

  // Check authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect("/login?redirect=/dashboard");
  }

  // Fetch user's profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("Error fetching profile:", profileError);
  }

  // Fetch certificates for this user
  const { data: certificates, error: certificatesError } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", user.id)
    .order("issued_at", { ascending: false });

  if (certificatesError) {
    console.error("Error fetching certificates:", certificatesError);
  }

  // Fetch upcoming signups
  const { data: signupData, error: signupsError } = await supabase
    .from("project_signups")
    .select(`
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
    `)
    .eq("user_id", user.id)
    .in("status", ["approved", "pending"]); // Fetch approved and pending

  if (signupsError) {
    console.error("Error fetching upcoming signups:", signupsError);
    // Handle error appropriately, maybe show a message
  }

  // Fetch certificates for the dashboard (modified)
  const { data: certificatesData, error: certificatesErrorFetch } = await supabase
    .from("certificates")
    .select("*")
    .eq("volunteer_email", user.email) // Assuming you fetch by email
    .order("issued_at", { ascending: false }); // Sort by most recent

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
    hoursByMonth: {}
  };

  // Process certificate data (typed as BackendCertificate from the DB)
  const processedCertificates = (certificates || []).map((cert: BackendCertificate) => {
    // Calculate hours for this certificate
    const hours = calculateHours(cert.event_start, cert.event_end);
    
    // Default to 'verified' for existing certificates that don't have the type field
    const certType = cert.type || 'verified';
    
    // Only count verified hours for main statistics
    if (certType === 'verified') {
      statistics.totalHours += hours;
      statistics.totalCertificates++;
      
      // Only track organizations with actual names, exclude "Independent Projects"
      if (cert.organization_name) {
        // Track unique organizations with valid names
        if (!statistics.organizations.some(org => org.name === cert.organization_name)) {
          statistics.organizations.push({
            name: cert.organization_name,
            hours: hours,
            projects: 1
          });
        } else {
          const orgIndex = statistics.organizations.findIndex(org => org.name === cert.organization_name);
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
      hours
    };
  });

  // Map backend certificate types to the UI Certificate type expected by components:
  // backend 'verified' -> UI 'platform', 'self-reported' stays 'self-reported'
  const uiCertificates: UICertificate[] = processedCertificates.map((c) => ({
    ...c,
    // Ensure the "type" matches the UI type union ("platform" | "self-reported" | undefined)
    type: c.type === "verified" ? "platform" : c.type,
  }));

  // Get unique project count from verified certificates only
  statistics.totalProjects = [...new Set(processedCertificates
    .filter((c: BackendCertificate & { hours: number }) => (c.type || 'verified') === 'verified')
    .map((c: BackendCertificate & { hours: number }) => c.project_id)
  )].filter(Boolean).length;

  // Calculate self-reported hours
  const selfReportedHours = processedCertificates
    .filter((c: BackendCertificate & { hours: number }) => c.type === 'self-reported')
    .reduce((total, cert) => total + cert.hours, 0);

  // Format hours by month for chart data - last 6 months
  const now = new Date();
  const monthsData = [];
  for (let i = 5; i >= 0; i--) {
    const month = subMonths(now, i);
    const monthStr = format(month, "MMM yyyy");
    monthsData.push({
      month: format(month, "MMM"),
      hours: statistics.hoursByMonth[monthStr] || 0
    });
  }
  statistics.recentActivity = monthsData;

  // --- MODIFIED: Process signups to find genuinely upcoming sessions ---
  const upcomingSessions: UpcomingSession[] = [];

  if (signupData) {
    for (const signup of signupData) {
      // Ensure project data is available and is not an array (should be single object)
      const project = Array.isArray(signup.projects) ? signup.projects[0] as Project : signup.projects as Project | null;
      if (!project || !project.schedule || !signup.schedule_id) {
        continue; // Skip if project data or schedule_id is missing
      }

      const details = getSlotDetails(project, signup.schedule_id);
      if (!details) continue; // Skip if slot details not found

      // Find the date for the slot
      let slotDate: string | undefined;
      if (project.event_type === "oneTime" && project.schedule.oneTime) {
        slotDate = project.schedule.oneTime.date;
      } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
        for (const day of project.schedule.multiDay) {
          // Check if the slot belongs to this day
          if (day.slots.some(slot => slot === details)) {
            slotDate = day.date;
            break;
          }
        }
      } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
        slotDate = project.schedule.sameDayMultiArea.date;
      }

      if (!slotDate || !details.startTime) continue; // Skip if date or start time missing

      const sessionStartTime = getCombinedDateTime(slotDate, details.startTime);

      // Check if the session start time is valid and in the future
      if (sessionStartTime && isAfter(sessionStartTime, now)) {
        upcomingSessions.push({
          signupId: signup.id,
          projectId: project.id,
          projectTitle: project.title,
          scheduleId: signup.schedule_id,
          sessionDisplayName: getSessionDisplayName(project, sessionStartTime, details),
          sessionStartTime: sessionStartTime,
          status: signup.status as 'approved' | 'pending',
        });
      }
    }
  }

  // Sort upcoming sessions by start time (soonest first)
  upcomingSessions.sort((a, b) => a.sessionStartTime.getTime() - b.sessionStartTime.getTime());
  // --- END NEW PROCESSING ---

  return (
    <div className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Volunteer Dashboard</h1>
          <p className="text-muted-foreground">
            Track your volunteering progress and achievements
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <AddVolunteerHoursModal />
        </div>
      </div>

      {/* Mobile-First Responsive Tabs Layout */}
      <Tabs defaultValue="overview" className="space-y-6">
        {/* Mobile Tab Navigation with Icons */}
        <TabsList className="grid w-full grid-cols-3 h-auto p-1">
          <TabsTrigger value="overview" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 px-2 sm:px-4">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs sm:text-sm">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="hours" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 px-2 sm:px-4">
            <CalendarDays className="h-4 w-4" />
            <span className="text-xs sm:text-sm">All Hours</span>
          </TabsTrigger>
          <TabsTrigger value="export" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 px-2 sm:px-4">
            <Download className="h-4 w-4" />
            <span className="text-xs sm:text-sm">Export</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Stats Grid - 2 cols mobile, 4 cols desktop */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {/* Total Verified Hours */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-primary/10 w-fit">
                    <CircleCheck className="h-4 w-4 sm:h-6 sm:w-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Verified Hours</p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">{formatTotalDuration(statistics.totalHours)}</h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">Let&apos;s Assist verified</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Self-Reported Hours */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-chart-4/10 dark:bg-chart-4/10 w-fit">
                    <UserCheck className="h-4 w-4 sm:h-6 sm:w-6 text-chart-4 dark:text-chart-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Self-Reported</p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">{selfReportedHours}h</h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">Unverified hours</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Projects */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-chart-3/10 w-fit">
                    <Users className="h-4 w-4 sm:h-6 sm:w-6 text-chart-3" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Projects</p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">{statistics.totalProjects}</h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">Completed</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Upcoming Sessions */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-chart-5/10 w-fit">
                    <Calendar className="h-4 w-4 sm:h-6 sm:w-6 text-chart-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Upcoming</p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">{upcomingSessions.length}</h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">Sessions</p>
                  </div>
                  <Button
                    asChild
                    size="icon"
                    variant="ghost"
                    aria-label="See all upcoming projects"
                    className="ml-auto hidden lg:flex"
                  >
                    <Link href="/projects">
                      <ChevronRight className="h-5 w-5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Left Column - Activity and Organizations */}
            <div className="col-span-1 lg:col-span-2 space-y-6 lg:space-y-8">
              <ActivityChart data={statistics.recentActivity} />

              {/* Organizations */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Organizations</CardTitle>
                  <CardDescription>
                    Formal organizations you&apos;ve volunteered with
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statistics.organizations.length > 0 ? (
                    <div className="space-y-4 sm:space-y-6">
                      {statistics.organizations.map((org, index) => (
                        <div key={index} className="flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{org.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {org.projects} {org.projects === 1 ? 'project' : 'projects'} • {org.hours.toFixed(1)} hours
                            </p>
                          </div>
                          <div className="w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0">
                            <ProgressCircle 
                              value={(org.hours / statistics.totalHours) * 100} 
                              size={48} 
                              strokeWidth={4}
                              showLabel={false}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center">
                      <Users className="h-8 w-8 sm:h-12 sm:w-12 text-muted-foreground mb-3 sm:mb-4" />
                      <h3 className="font-medium text-base sm:text-lg">No Organizations Yet</h3>
                      <p className="text-muted-foreground max-w-md mt-1 text-sm sm:text-base">
                        When you volunteer with formal organizations, they&apos;ll appear here.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Goals and Upcoming */}
            <div className="space-y-6 lg:space-y-8">
              {/* Enhanced Goals with Date Range */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" /> Volunteering Goals
                  </CardTitle>
                  <CardDescription>Set and track your volunteering targets</CardDescription>
                </CardHeader>
                <CardContent>
                  <VolunteerGoals
                    userId={user.id}
                    totalHours={statistics.totalHours}
                    totalEvents={statistics.totalProjects}
                  />
                </CardContent>
              </Card>

              {/* Upcoming Sessions */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Upcoming Sessions</CardTitle>
                  <CardDescription>Your scheduled volunteer commitments</CardDescription>
                </CardHeader>
                <CardContent>
                  {upcomingSessions.length > 0 ? (
                    <div className="space-y-3 sm:space-y-4">
                      <div className="max-h-[300px] sm:max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                        <div className="space-y-3 sm:space-y-4">
                          {upcomingSessions.map((session) => (
                            <div key={session.signupId} className="border rounded-lg p-3 sm:p-4 space-y-2">
                              <Link href={`/projects/${session.projectId}`} className="font-medium hover:text-primary transition-colors block text-sm sm:text-base">
                                {session.projectTitle}
                              </Link>
                              <p className="text-xs sm:text-sm text-muted-foreground">
                                Session: {session.sessionDisplayName}
                              </p>
                              <p className="text-xs sm:text-sm text-muted-foreground">
                                Starts: {format(session.sessionStartTime, "MMM d, yyyy 'at' h:mm a")}
                              </p>
                              <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                                Status: <Badge variant={session.status === 'approved' ? 'default' : 'outline'}>
                                  {session.status === "approved" ? "Confirmed" : "Pending"}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 sm:py-8 text-center">
                      <Calendar className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground/30 mb-3" />
                      <h3 className="font-medium text-sm sm:text-base">No Upcoming Sessions</h3>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-xs">
                        You don&apos;t have any upcoming volunteer commitments
                      </p>
                      <Button className="mt-3 sm:mt-4" variant="outline" size="sm" asChild>
                        <Link href="/home">Browse Opportunities</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Unified Hours Tab - Shows both verified and unverified */}
        <TabsContent value="hours" className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">All Volunteer Hours</h2>
              <p className="text-muted-foreground text-sm sm:text-base">
                Both verified and self-reported volunteer hours
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-2">
                <Award className="h-4 w-4" />
                {uiCertificates.length} Total Certificates
              </Badge>
            </div>
          </div>

          {/* Unified Hours Display */}
          <AllHoursSection certificates={uiCertificates} />
        </TabsContent>

        {/* Export & Reports Tab */}
        <TabsContent value="export" className="space-y-6">
          {user.email && (
            <ExportSection
              userEmail={user.email}
              // For the export UI, use uiCertificates where 'platform' == previously 'verified'
              verifiedCount={uiCertificates.filter(cert => cert.type === 'platform').length}
              unverifiedCount={uiCertificates.filter(cert => cert.type === 'self-reported').length}
              totalCertificates={uiCertificates.length}
              certificatesData={uiCertificates}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}