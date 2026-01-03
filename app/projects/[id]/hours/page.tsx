import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { differenceInHours, isAfter, format, parseISO } from "date-fns";
import { getProjectEndDateTime } from "@/utils/project";
import { Project, ProjectSignup } from "@/types";
import { HoursClient } from "./HoursClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CalendarClock } from "lucide-react";

// Define session type for easier handling
type ProjectSession = {
  id: string;
  name: string;
  endDateTime: Date;
  hoursRemaining: number;
};

// Helper function to check if user has permission (Creator or Org Admin/Staff)
async function checkPermissions(projectId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("creator_id, organization_id")
    .eq("id", projectId)
    .single();

  if (!project) return false;
  if (project.creator_id === userId) return true;

  if (project.organization_id) {
    const { data: member } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", project.organization_id)
      .single();
    return member?.role === "admin" || member?.role === "staff";
  }

  return false;
}

// NEW: Helper function to get sessions that are in editing window
function getSessionsInEditingWindow(project: Project): ProjectSession[] {
  const now = new Date();
  const result: ProjectSession[] = [];
  
  // Helper function to format time to 12-hour format
  const formatTime12h = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12; // Convert 0 to 12 for 12 AM
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
  };
  
  // Check one-time events
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    const date = parseISO(project.schedule.oneTime.date);
    const [hours, minutes] = project.schedule.oneTime.endTime.split(':').map(Number);
    const sessionEndTime = new Date(date.setHours(hours, minutes));
    const hoursSinceEnd = differenceInHours(now, sessionEndTime);
    
    if (isAfter(now, sessionEndTime) && hoursSinceEnd >= 0 && hoursSinceEnd < 48) {
      result.push({
        id: "oneTime",
        name: `${format(date, "MMMM d")} (${formatTime12h(project.schedule.oneTime.startTime)} - ${formatTime12h(project.schedule.oneTime.endTime)})`,
        endDateTime: sessionEndTime,
        hoursRemaining: 48 - hoursSinceEnd
      });
    }
  }
  
  // Check multi-day events
  else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day, dayIndex) => {
      const dayDate = parseISO(day.date);
      
      day.slots.forEach((slot, slotIndex) => {
        const [hours, minutes] = slot.endTime.split(':').map(Number);
        const slotEndTime = new Date(new Date(dayDate).setHours(hours, minutes));
        const hoursSinceEnd = differenceInHours(now, slotEndTime);
        
        if (isAfter(now, slotEndTime) && hoursSinceEnd >= 0 && hoursSinceEnd < 48) {
          const sessionId = `day-${dayIndex}-slot-${slotIndex}`;
          result.push({
            id: sessionId,
            name: `${format(dayDate, "MMMM d")} (${formatTime12h(slot.startTime)} - ${formatTime12h(slot.endTime)})`,
            endDateTime: slotEndTime,
            hoursRemaining: 48 - hoursSinceEnd
          });
        }
      });
    });
  }
  
  // Check same-day multi-area events
  else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const date = parseISO(project.schedule.sameDayMultiArea.date);
    
    project.schedule.sameDayMultiArea.roles.forEach((role, roleIndex) => {
      const [hours, minutes] = role.endTime.split(':').map(Number);
      const roleEndTime = new Date(new Date(date).setHours(hours, minutes));
      const hoursSinceEnd = differenceInHours(now, roleEndTime);
      
      if (isAfter(now, roleEndTime) && hoursSinceEnd >= 0 && hoursSinceEnd < 48) {
        const sessionId = `role-${roleIndex}`;
        result.push({
          id: sessionId,
          name: `${role.name} (${formatTime12h(role.startTime)} - ${formatTime12h(role.endTime)})`,
          endDateTime: roleEndTime,
          hoursRemaining: 48 - hoursSinceEnd
        });
      }
    });
  }
  
  return result;
}

export default async function HoursPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = cookies();
  const supabase = await createClient();
  const { id: projectId } = await params;

  // 1. Check User Authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect(`/login?redirect=/projects/${projectId}/hours`);
  }

  // 2. Check User Permissions
  const hasPermission = await checkPermissions(projectId, user.id);
  if (!hasPermission) {
    // Or redirect to project page with an error message?
    notFound();
  }

  // 3. Fetch Project Data
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*") // Select all project fields needed by HoursClient
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // 4. Check if Project Type is Eligible (Exclude 'auto')
  if (project.verification_method === 'auto') {
    return (
      <div className="container mx-auto px-4 py-6 max-w-5xl">
         <div className="mb-6">
          <Button variant="ghost" className="gap-2" asChild>
            <Link href={`/projects/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
              Back to Project
            </Link>
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Manage Volunteer Hours</CardTitle>
            <CardDescription>Review volunteer participation.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="default" className="border-chart-2/50 bg-chart-2/10">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Automatic Check-in</AlertTitle>
              <AlertDescription>
                This project uses automatic check-in. Volunteer hours are recorded based on the schedule and cannot be manually edited here. View attendance records for details.
              </AlertDescription>
            </Alert>
          </CardContent>
           <CardFooter className="justify-center border-t p-4">
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}/attendance`}>
                View Attendance Records
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // 5. Calculate Post-Event Editing Window Status using our new session-specific logic
  const now = new Date();
  const projectEndDateTime = getProjectEndDateTime(project);
  const activeSessions = getSessionsInEditingWindow(project);
  const hasActiveSessions = activeSessions.length > 0;
  
  // Find the session with the least time remaining (most urgent)
  let mostUrgentSession: ProjectSession | null = null;
  let hoursUntilWindowCloses: number | null = null;
  
  if (activeSessions.length > 0) {
    mostUrgentSession = activeSessions.reduce(
      (prev, current) => (prev.hoursRemaining < current.hoursRemaining ? prev : current)
    );
    hoursUntilWindowCloses = mostUrgentSession.hoursRemaining;
  }

  // 6. Fetch Attendance Data (Signups)
  const { data: signupsData, error: signupsError } = await supabase
    .from("project_signups")
    .select(`
      id,
      project_id,
      created_at,
      check_in_time,
      check_out_time,
      schedule_id,
      user_id,
      anonymous_id,
      status,
      profile:profiles!left (
        id,
        full_name,
        username,
        email,
        phone
      ),
      anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey (
        id,
        name,
        email,
        phone_number
      )
    `)
    .eq("project_id", projectId)
    .in("status", ["attended", "approved"]); // Fetch both attended and approved

  if (signupsError) {
    console.error("Error fetching signups:", signupsError);
    return <div>Error loading volunteer data.</div>;
  }
  
  // Log for debugging purposes
  console.log("Fetched signups:", signupsData?.length || 0);
  if (signupsData && signupsData.length > 0) {
    console.log("Sample schedule_id formats:", signupsData.slice(0, 3).map(s => s.schedule_id));
  }

  // Transform Supabase response arrays to single objects for profile and anonymous_signup
  const signups = (signupsData || []).map((s: {
    profile?: unknown;
    anonymous_signup?: unknown;
    [key: string]: unknown;
  }) => ({
    ...s,
    profile: Array.isArray(s.profile) ? s.profile[0] : s.profile,
    anonymous_signup: Array.isArray(s.anonymous_signup) ? s.anonymous_signup[0] : s.anonymous_signup,
  }));

  // 7. Render Client Component or "Not Yet Available" Message
  if (!hasActiveSessions) {
    const eventHasEnded = projectEndDateTime && isAfter(now, projectEndDateTime);
    const hoursUntilWindowOpens = projectEndDateTime ? differenceInHours(projectEndDateTime, now) : null;

    return (
       <div className="container mx-auto px-4 py-6 max-w-5xl">
         <div className="mb-6">
          <Button variant="ghost" className="gap-2" asChild>
            <Link href={`/projects/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
              Back to Project
            </Link>
          </Button>
        </div>
        <Card className="min-h-[400px] relative">
          <CardHeader>
            <CardTitle>Manage Volunteer Hours</CardTitle>
            <CardDescription>
              {eventHasEnded
                ? "The editing window for volunteer hours has closed (48 hours post-event)."
                : "Volunteer hours can be edited after the event concludes."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center space-y-4">
            <div className="rounded-full bg-muted p-6 w-fit">
              <CalendarClock className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mt-6">
              {eventHasEnded ? "Editing Window Closed" : "Editing Not Yet Available"}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {eventHasEnded
                ? "The 48-hour window to edit volunteer hours after the event has ended."
                : `You can manage volunteer hours here for 48 hours after the event ends.`}
              {!eventHasEnded && hoursUntilWindowOpens !== null && hoursUntilWindowOpens > 0 && (
                 <span className="block mt-2 text-sm">
                    (Window opens in approximately {hoursUntilWindowOpens} hour{hoursUntilWindowOpens !== 1 ? 's' : ''})
                  </span>
              )}
               {!eventHasEnded && projectEndDateTime && (
                 <span className="block mt-2 text-sm">
                    Event ends: {format(projectEndDateTime, "MMMM d, yyyy 'at' h:mm a")}
                  </span>
              )}
            </p>
          </CardContent>
           <CardFooter className="justify-center border-t p-4">
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}`}>
                Return to Project
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Pass data to the client component
  return (
    <HoursClient
      project={project as Project}
      initialSignups={signups as any}
      hoursUntilWindowCloses={hoursUntilWindowCloses}
      activeSessions={activeSessions}
    />
  );
}
