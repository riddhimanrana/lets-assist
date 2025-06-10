import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { VolunteerGoals } from "./VolunteerGoals";
import { Badge } from "@/components/ui/badge";
import { ProgressCircle } from "./ProgressCircle";
import { format, subMonths, parseISO, differenceInMinutes, isBefore, isAfter } from "date-fns";
import { Award, Calendar, Clock, Users, Target, FileCheck, ChevronRight, Download, GalleryVerticalEnd, TicketCheck} from "lucide-react";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityChart } from "./ActivityChart";
import { CertificateExport } from "./CertificateExport";
import { Project, ProjectSchedule } from "@/types";
import { getSlotDetails } from "@/utils/project";
import { Metadata } from "next";

// Define types for certificate data
interface Certificate {
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

  // Process certificate data
  const processedCertificates = (certificates || []).map((cert: Certificate) => {
    // Calculate hours for this certificate
    const hours = calculateHours(cert.event_start, cert.event_end);
    
    // Increment total stats
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
    
    // Track hours by month
    const monthYear = format(parseISO(cert.issued_at), "MMM yyyy");
    if (!statistics.hoursByMonth[monthYear]) {
      statistics.hoursByMonth[monthYear] = 0;
    }
    statistics.hoursByMonth[monthYear] += hours;

    return {
      ...cert,
      hours
    };
  });

  // Get unique project count
  statistics.totalProjects = [...new Set(processedCertificates.map((c: Certificate & { hours: number }) => c.project_id))].filter(Boolean).length;

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
        
        <div className="flex-shrink-0">
          <Button asChild>
            <Link href="/home">
              Find Opportunities <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Top Stats Row - Update Total Hours Display */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Hours</p>
                {/* Use the new formatting function */}
                <h2 className="text-3xl font-bold">{formatTotalDuration(statistics.totalHours)}</h2>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-chart-3/10">
                <Users className="h-6 w-6 text-chart-3" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Projects</p>
                <h2 className="text-3xl font-bold">{statistics.totalProjects}</h2>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-chart-4/10">
                  <Award className="h-6 w-6 text-chart-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Certificates</p>
                  <h2 className="text-3xl font-bold">{statistics.totalCertificates}</h2>
                </div>
              </div>
              <Button
                asChild
                size="icon"
                variant="ghost"
                aria-label="View all certificates"
                className="ml-2"
              >
                <Link href="/certificates">
                  <GalleryVerticalEnd className="h-5 w-5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-chart-5/10">
                  <Calendar className="h-6 w-6 text-chart-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Upcoming</p>
                  <h2 className="text-3xl font-bold">{upcomingSessions.length}</h2>
                </div>
              </div>
              <Button
                asChild
                size="icon"
                variant="ghost"
                aria-label="See all upcoming projects"
                className="ml-2"
              >
                <Link href="/projects">
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column */}
        <div className="col-span-1 lg:col-span-2 space-y-8">
          {/* Activity Chart */}

                <ActivityChart data={statistics.recentActivity} />

          {/* Certificates / Organizations Tabs */}
          <Tabs defaultValue="certificates">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="certificates">Recent Certificates</TabsTrigger>
              <TabsTrigger value="organizations">Organizations</TabsTrigger>
            </TabsList>
            
            <TabsContent value="certificates">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle>Recent Certificates</CardTitle>
                    <CardDescription>Your earned volunteering certificates</CardDescription>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    aria-label="View all certificates"
                  >
                    <Link href="/certificates">
                      <GalleryVerticalEnd className="h-4 w-4 mr-2" />
                      View All
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {certificatesData && certificatesData.length > 0 ? (
                    <div className="space-y-4">
                      {/* Use certificatesData directly */}
                      {certificatesData.map((cert: Certificate) => {
                        // Calculate and format duration
                        const durationHours = calculateDecimalHours(cert.event_start, cert.event_end);
                        const formattedDuration = formatTotalDuration(durationHours);

                        return (
                          <div key={cert.id} className="border rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div className="flex-1 space-y-1">
                              <Link href={`/projects/${cert.project_id}`} className="font-medium hover:text-primary transition-colors block">
                                {cert.project_title}
                              </Link>
                              <p className="text-sm text-muted-foreground">
                                {cert.organization_name || cert.creator_name || "Unknown Organizer"}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {format(parseISO(cert.event_start), "MMM d, yyyy")}
                                </span>
                                {/* Display formatted duration */}
                                {formattedDuration !== "0m" && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formattedDuration}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex-shrink-0">
                              <Button size="sm" variant="outline" asChild>
                                {/* TODO: Link to actual certificate download/view page */}
                                <Link href={`/certificates/${cert.id}`} target="_blank" rel="noopener noreferrer">
                                  <TicketCheck className="h-4 w-4 mr-2" />
                                  View Certificate
                                </Link>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // No certificates message
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <FileCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
                      <h3 className="font-medium">No Certificates Yet</h3>
                      <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                        Complete volunteer opportunities to earn certificates.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="organizations" className="mt-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Organizations</CardTitle>
                  <CardDescription>
                    Formal organizations you&apos;ve volunteered with
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statistics.organizations.length > 0 ? (
                    <div className="space-y-6">
                      {statistics.organizations.map((org, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium">{org.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {org.projects} {org.projects === 1 ? 'project' : 'projects'} • {org.hours.toFixed(1)} hours
                            </p>
                          </div>
                          <div className="w-16 h-16">
                            <ProgressCircle 
                              value={(org.hours / statistics.totalHours) * 100} 
                              size={64} 
                              strokeWidth={5}
                              showLabel={false}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
                      <h3 className="font-medium text-lg">No Organizations Yet</h3>
                      <p className="text-muted-foreground max-w-md mt-1">
                        When you volunteer with formal organizations (not including independent projects), they&apos;ll appear here with your contribution statistics.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          {/* Certificate Export */}
          {user.email && (
            <CertificateExport 
              userEmail={user.email}
              totalCertificates={statistics.totalCertificates}
            />
          )}

          {/* Goals */}
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

          {/* --- MODIFIED: Upcoming Events Card --- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Upcoming Sessions</CardTitle> {/* Changed title */}
              <CardDescription>Your scheduled volunteer commitments</CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingSessions.length > 0 ? (
                <div className="space-y-4">
                  {/* Display the first 3 upcoming sessions */}
                  {upcomingSessions.slice(0, 3).map((session) => (
                    <div key={session.signupId} className="border rounded-lg p-4 space-y-2">
                      <Link href={`/projects/${session.projectId}`} className="font-medium hover:text-primary transition-colors block">
                        {session.projectTitle}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        Session: {session.sessionDisplayName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Starts: {format(session.sessionStartTime, "MMM d, yyyy 'at' h:mm a")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Status: <Badge variant={session.status === 'approved' ? 'default' : 'outline'} className={`ml-1 ${session.status === 'approved' ? 'bg-primary/10 text-primary border-primary/30' : ''}`}>
                          {session.status === "approved" ? "Confirmed" : "Pending"}
                        </Badge>
                      </p>
                      <Button size="sm" variant="ghost" className="mt-2 w-full justify-start px-0" asChild>
                        <Link href={`/projects/${session.projectId}`}>
                          View Project Details <ChevronRight className="ml-1 h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  ))}

                  {/* Link to see all upcoming events */}
                  {upcomingSessions.length > 3 && (
                    <Button variant="outline" size="sm" className="w-full" asChild>
                      {/* TODO: Create a dedicated page for all upcoming events? */}
                      <Link href="/dashboard/events">
                        See All ({upcomingSessions.length})
                      </Link>
                    </Button>
                  )}
                </div>
              ) : (
                // No upcoming sessions message
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Calendar className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <h3 className="font-medium">No Upcoming Sessions</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                    You don&apos;t have any upcoming volunteer commitments
                  </p>
                  <Button className="mt-4" variant="outline" size="sm" asChild>
                    <Link href="/home">Browse Opportunities</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {/* --- END MODIFIED --- */}
        </div>
      </div>
    </div>
  );
}
