"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Clock, Link as LinkIcon, User, Mail, Phone, Calendar, Info, Loader2, XCircle, AlertTriangle, Clock3, Award, Medal } from "lucide-react"; // Use Medal instead of Certificate
import Link from "next/link";
import { format, addDays, parseISO, differenceInSeconds, differenceInHours, isAfter } from "date-fns";
import { formatTimeTo12Hour } from "@/lib/utils";
import { Project } from "@/types";
import { useState, useMemo, useEffect } from "react"; // add useEffect
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { cancelSignup } from "@/app/projects/[id]/actions";

// Helper function to format schedule slot (same as before)
const formatScheduleSlot = (project: Project, slotId: string) => {
  if (!project) return slotId;

  if (project.event_type === "oneTime") {
    if (slotId === "oneTime" && project.schedule.oneTime) {
      const dateStr = project.schedule.oneTime.date;
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return `${format(date, "MMMM d, yyyy")} from ${formatTimeTo12Hour(project.schedule.oneTime.startTime)} to ${formatTimeTo12Hour(project.schedule.oneTime.endTime)}`;
    }
  }

  if (project.event_type === "multiDay") {
    const parts = slotId.split("-");
    if (parts.length >= 2) {
      const slotIndex = parts.pop();
      const date = parts.join("-");
      const day = project.schedule.multiDay?.find(d => d.date === date);
      if (day && slotIndex !== undefined) {
        const slotIdx = parseInt(slotIndex, 10);
        const slot = day.slots[slotIdx];
        if (slot) {
          const [year, month, dayNum] = date.split('-').map(Number);
          const utcDate = new Date(year, month - 1, dayNum);
          return `${format(utcDate, "EEEE, MMMM d, yyyy")} from ${formatTimeTo12Hour(slot.startTime)} to ${formatTimeTo12Hour(slot.endTime)}`;
        }
      }
    }
  }

  if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === slotId);
    if (role) {
      const eventDate = project.schedule.sameDayMultiArea?.date;
      if (eventDate) {
        const [year, month, day] = eventDate.split('-').map(Number);
        const utcDate = new Date(year, month - 1, day);
        return `${format(utcDate, "EEEE, MMMM d, yyyy")} - Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
      } else {
        return `Role: ${role.name} (${formatTimeTo12Hour(role.startTime)} to ${formatTimeTo12Hour(role.endTime)})`;
      }
    }
  }

  return slotId; // Fallback
};

// Calculate project end date from project data
const getProjectEndDate = (project: Project): Date | null => {
  try {
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const dateStr = project.schedule.oneTime.date;
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      // Find the last day in the multiDay schedule
      const dates = project.schedule.multiDay.map(day => {
        const [year, month, dayNum] = day.date.split('-').map(Number);
        return new Date(year, month - 1, dayNum);
      });
      return dates.length > 0 ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
    } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
      const dateStr = project.schedule.sameDayMultiArea.date;
      if (dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
    }
    return null;
  } catch (error) {
    console.error("Error calculating project end date:", error);
    return null;
  }
};

// Get the auto-deletion date (30 days after project end)
const getAutoDeletionDate = (project: Project): Date | null => {
  const projectEndDate = getProjectEndDate(project);
  return projectEndDate ? addDays(projectEndDate, 30) : null;
};

// Types for the props
interface AnonymousSignupClientProps {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
  confirmed_at: string | null;
  status: string;
  schedule_id: string;
  project: Project;
  project_signup_id: string;
  isProjectCancelled: boolean;
  created_at: string; // Add creation date
  check_in_time: string | null;
}

export default function AnonymousSignupClient({
  id,
  name,
  email,
  phone_number,
  confirmed_at,
  status,
  schedule_id,
  project,
  project_signup_id,
  isProjectCancelled,
  created_at,
  check_in_time
}: AnonymousSignupClientProps) {
  const router = useRouter();
  const isConfirmed = !!confirmed_at;
  const signupStatus = status;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  
  // Parse dates
  const createdDate = new Date(created_at);
  const confirmedDate = confirmed_at ? new Date(confirmed_at) : null;
  const autoDeletionDate = getAutoDeletionDate(project);

  // --- Start: Progress Calculation Logic ---
  let percent = 0;
  let sessionDate = "";
  let endTime = "";
  let checkInTimeFormatted = "";

  // Determine session timing from project data (similar to VolunteerStatusCard)
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    sessionDate = project.schedule.oneTime.date;
    endTime = project.schedule.oneTime.endTime;
  } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    // schedule_id format: "YYYY-MM-DD-<slotIndex>", e.g., "2025-04-26-1"
    const lastDashIdx = schedule_id.lastIndexOf("-");
    const date = schedule_id.substring(0, lastDashIdx);
    const idx = schedule_id.substring(lastDashIdx + 1);
    const day = project.schedule.multiDay.find(d => d.date === date);
    const slotIndex = parseInt(idx, 10);
    const slot = day && !isNaN(slotIndex) ? day.slots[slotIndex] : undefined;
    if (day && slot) {
      sessionDate = day.date;
      endTime = slot.endTime;
    }
  } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
    const role = project.schedule.sameDayMultiArea.roles.find(r => r.name === schedule_id);
    if (role) {
      sessionDate = project.schedule.sameDayMultiArea.date;
      endTime = role.endTime;
    }
  }

  // Calculate progress if status is 'attended' and check_in_time exists
  if (status === 'attended' && check_in_time) {
    try {
      const checkIn = new Date(check_in_time);
      checkInTimeFormatted = format(checkIn, "h:mm a") || "N/A"; // Format check-in time for display
      const endDt = parseISO(`${sessionDate}T${endTime}`);

      if (!isNaN(endDt.getTime()) && !isNaN(checkIn.getTime())) {
        const totalSec = Math.max(1, differenceInSeconds(endDt, checkIn));
        const elapsedSec = Math.min(totalSec, differenceInSeconds(new Date(), checkIn));
        percent = Math.round((elapsedSec / totalSec) * 100);
      } else {
        console.error("Invalid session end time or check-in time:", `${sessionDate}T${endTime}`, check_in_time);
      }
    } catch (error) {
      console.error("Error parsing dates for progress:", error);
    }
  }
  // --- End: Progress Calculation Logic ---

  // Handle signup cancellation by deleting records
  const handleCancelSignup = async () => {
    if (!project_signup_id || !id) {
      toast.error("Unable to find signup details");
      setCancelDialogOpen(false);
      return;
    }
    
    try {
      setIsCancelling(true);

      // Use the server action which includes calendar cleanup
      const result = await cancelSignup(project_signup_id);
      
      if (result.error) {
        toast.error(result.error);
        setCancelDialogOpen(false);
        return;
      }

      // Also clean up the anonymous_signups record
      const supabase = createClient();
      const { error: anonymousSignupError } = await supabase
        .from("anonymous_signups")
        .delete()
        .eq("id", id);
        
      if (anonymousSignupError) {
        console.error("Error deleting anonymous signup:", anonymousSignupError);
        // Continue anyway - the main signup was cancelled
      }
      
      // Close dialog and show success message
      setCancelDialogOpen(false);
      setIsDeleted(true);
      toast.success("Your signup has been cancelled successfully");

      // Redirect to projects page after a short delay
      setTimeout(() => {
        router.push("/projects");
      }, 3000);
    } catch (error) {
      console.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup. Please try again.");
      setCancelDialogOpen(false);
    } finally {
      setIsCancelling(false);
    }
  };

  // Calculate if we're in the post-event window (first 48 hours after event ends)
  const isInPostEventWindow = useMemo(() => {
    if (!endTime || !sessionDate) return false;
    
    try {
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      if (isNaN(endDt.getTime())) return false;
      
      const hoursSinceEnd = differenceInHours(new Date(), endDt);
      return isAfter(new Date(), endDt) && hoursSinceEnd >= 0 && hoursSinceEnd < 48;
    } catch (error) {
      console.error("Error calculating post-event window:", error);
      return false;
    }
  }, [sessionDate, endTime]);
  
  // Check if project is over
  const isProjectOver = useMemo(() => {
    if (!sessionDate || !endTime) return false;
    
    try {
      const endDt = parseISO(`${sessionDate}T${endTime}`);
      if (isNaN(endDt.getTime())) return false;
      
      return isAfter(new Date(), endDt);
    } catch (error) {
      console.error("Error determining if project is over:", error);
      return false;
    }
  }, [sessionDate, endTime]);

  // --- ADDED: Check if hours are published for this specific schedule_id ---
  const areHoursPublished = useMemo(() => {
    return project.published && project.published[schedule_id] === true;
  }, [project.published, schedule_id]);
  
  // --- Check for corresponding certificate based on project_signup_id ---
  const [certMap, setCertMap] = useState<Record<string,string>>({});
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("certificates")
      .select("id, signup_id")
      .eq("signup_id", project_signup_id)
      .then(({ data, error }) => {
        if (error) console.error("Error fetching certificates:", error);
        else {
          const map: Record<string,string> = {};
          data?.forEach((cert) => {
            map[cert.signup_id] = cert.id;
          });
          setCertMap(map);
        }
      });
  }, [project_signup_id]);
  const certificateId = certMap[project_signup_id] ?? null;
  // --- END ADDED ---

  // Determine if this is a "missed event" situation (approved but didn't attend)
  // --- MODIFIED: Only count as missed if hours are NOT published ---
  const isMissedEvent = status === 'approved' && !check_in_time && isProjectOver && !areHoursPublished;

  if (isDeleted) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 rounded-full bg-destructive/10 p-3">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Signup Cancelled</h2>
              <p className="text-muted-foreground mb-6">
                Your signup for &quot;{project.title}&quot; has been cancelled successfully.
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Redirecting you to the projects page...
              </p>
              <Button asChild>
                <Link href="/projects">Browse Projects</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <Card className="overflow-hidden">
        {isProjectCancelled && (
          <div className="bg-destructive/10 border-b border-destructive/30 p-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Project Has Been Cancelled</p>
                <p className="text-sm">This project is no longer active. Your signup information is retained for your records.</p>
              </div>
            </div>
          </div>
        )}
        
        <CardHeader className={isProjectCancelled ? "pt-4" : ""}>
            <CardTitle className="leading-tight">Volunteer Signup Details</CardTitle>
          <CardDescription>
            Details for your anonymous signup for the project:{" "}
            <Link href={`/projects/${project.id}`} className="text-primary hover:underline font-medium">
              {project.title}
            </Link>
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="flex items-center gap-2 mb-2">
            {/* Convert alerts to cards */}

            {/* --- ADDED: Hours Published Card (Highest Priority Post-Event) --- */}
            {areHoursPublished && (
              <Card className="w-full border-chart-5/30 bg-chart-5/5 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-chart-5/10 p-2 rounded-full">
                      <Award className="h-5 w-5 text-chart-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Volunteer Hours Published!</CardTitle>
                      <CardDescription>Your hours for {project.title} have been finalized.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  {/* Session info */}
                  <div className="flex flex-col space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Event:</span>
                      <span>{formatScheduleSlot(project, schedule_id)}</span>
                    </div>
                    {check_in_time && (
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-muted-foreground">Checked in at:</span>
                        <span>{format(new Date(check_in_time), "h:mm a")}</span>
                      </div>
                    )}
                  </div>

                  {/* Info Section */}
                  <div className="relative pl-6 border-chart-5/30 mt-3 space-y-3">
                    <div className="relative">
                      <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-5/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-chart-5"></div>
                      </div>
                      <p className="text-sm font-medium">Hours Finalized</p>
                      <p className="text-xs text-muted-foreground">
                        Your participation details and hours have been recorded.
                      </p>
                    </div>
                  </div>

                  {/* Certificate Link */}
                  {certificateId && (
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/certificates/${certificateId}`}>
                          <Medal className="h-4 w-4 mr-1.5" />
                          View Certificate
                        </Link>
                      </Button>
                    </div>
                  )}

                  {/* Data Retention Warning */}
                  {autoDeletionDate && (
                    <Alert className="bg-muted/50 border-muted mt-4">
                      <Clock className="h-4 w-4" />
                      <AlertTitle className="font-medium">Important: Data Retention</AlertTitle>
                      <AlertDescription className="text-xs text-muted-foreground">
                        This anonymous signup account will be automatically deleted on <span className="font-semibold">{format(autoDeletionDate, "MMMM d, yyyy")}</span>. However, your hours and certificate links will remain available for your records. We recommend saving the links to your certificate and any important details before this date.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}
            {/* --- END ADDED --- */}

            {/* --- MODIFIED: Only show processing card if hours are NOT published --- */}
            {status === 'attended' && isInPostEventWindow && !areHoursPublished && (
              <Card className="w-full border-chart-4/30 bg-chart-4/5 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-chart-4/10 p-2 rounded-full">
                      <Clock className="h-5 w-5 text-chart-4" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Volunteer Hours Being Processed</CardTitle>
                      <CardDescription>Thank you for attending {project.title}!</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  {/* Session info */}
                  <div className="flex flex-col space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Event:</span>
                      <span>{formatScheduleSlot(project, schedule_id)}</span>
                    </div>
                    {check_in_time && (
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-muted-foreground">Checked in at:</span>
                        <span>{format(new Date(check_in_time), "h:mm a")}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Processing information with visual timeline */}
                  <div className="relative pl-6 border-chart-4/30 mt-3 space-y-3">
                    <div className="relative">
                      <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-4/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-chart-4"></div>
                      </div>
                      <p className="text-sm font-medium">Processing Period</p>
                      <p className="text-xs text-muted-foreground">
                        Hours are typically finalized within 48 hours after the event.
                      </p>
                    </div>
                    
                    <div className="relative">
                      <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-4/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-chart-4"></div>
                      </div>
                      <p className="text-sm font-medium">Need Adjustments?</p>
                      <p className="text-xs text-muted-foreground">
                        If your recorded hours need correction, please contact the project organizer directly.
                      </p>
                    </div>
                  </div>
                  
                  {/* Approx time remaining */}
                  <div className="bg-chart-4/10 rounded-md p-3 flex items-center justify-between mt-2">
                    <span className="text-xs font-medium text-chart-4">Processing time remaining:</span>
                    <span className="text-xs font-medium text-chart-4">
                      {48 - differenceInHours(new Date(), parseISO(`${sessionDate}T${endTime}`))} hours
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {isMissedEvent && (
              <Card className="w-full border-chart-7/30 bg-chart-7/5 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-chart-7/10 p-2 rounded-full">
                      <AlertTriangle className="h-5 w-5 text-chart-7" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Event Not Attended</CardTitle>
                      <CardDescription>You were signed up for {project.title} but no attendance was recorded.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  {/* Session info */}
                  <div className="flex flex-col space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Event:</span>
                      <span>{formatScheduleSlot(project, schedule_id)}</span>
                    </div>
                  </div>
                  
                  {/* Timeline style info */}
                  <div className="relative pl-6 border-chart-7/30 mt-3 space-y-3">
                    <div className="relative">
                      <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-chart-7/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-chart-7"></div>
                      </div>
                      <p className="text-sm font-medium">Think This Is a Mistake?</p>
                      <p className="text-xs text-muted-foreground">
                        If you believe this is an error, please contact the project organizer directly. Your signup status might be updated if there was a check-in issue.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isConfirmed && signupStatus === 'pending' && (
              <Card className="w-full border-amber-500/30 bg-amber-500/5 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-amber-500/10 p-2 rounded-full">
                      <Clock className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Action Required</CardTitle>
                      <CardDescription>Please confirm your email to finalize your signup.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  <div className="flex flex-col space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Email:</span>
                      <span className="font-medium">{email}</span>
                    </div>
                  </div>
                  
                  <div className="relative pl-6 border-amber-500/30 mt-3 space-y-3">
                    <div className="relative">
                      <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                      </div>
                      <p className="text-sm font-medium">Next Steps</p>
                      <p className="text-xs text-muted-foreground">
                        Check your email for a confirmation link to verify your identity and secure your spot.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {isConfirmed && signupStatus === 'approved' && !isProjectOver && !areHoursPublished && (
              <Card className="w-full border-primary/30 bg-primary/5 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Signup Confirmed!</CardTitle>
                      <CardDescription>Your spot for this project is confirmed. Thank you for volunteering!</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  <div className="flex flex-col space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">Event:</span>
                      <span>{formatScheduleSlot(project, schedule_id)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {signupStatus === 'rejected' && (
              <Card className="w-full border-destructive/30 bg-destructive/5 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-destructive/10 p-2 rounded-full">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Signup Rejected</CardTitle>
                      <CardDescription>This signup has been rejected by the project coordinator.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  <div className="relative pl-6 border-destructive/30 mt-3 space-y-3">
                    <div className="relative">
                      <div className="absolute -left-[27px] top-0 w-5 h-5 rounded-full bg-destructive/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-destructive"></div>
                      </div>
                      <p className="text-sm font-medium">Need More Information?</p>
                      <p className="text-xs text-muted-foreground">
                        Contact the project coordinator for more details about why your signup was not approved.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <h3 className="text-base font-semibold mb-3">Timeline</h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-chart-3 text-muted-foreground flex items-center justify-center">
                    <Clock3 className="h-3.5 w-3.5 my-1 text-popover" />
                  </div>
                  <div className="w-0.5 h-full bg-border mt-1"></div>
                </div>
                <div>
                  <p className="font-medium">Signup Created</p>
                  <p className="text-muted-foreground text-xs">{format(createdDate, "MMMM d, yyyy 'at' h:mm a")}</p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full ${confirmedDate ? 'bg-primary text-muted-foreground' : 'bg-muted text-muted-foreground'} flex items-center justify-center`}>
                    {confirmedDate ? <CheckCircle2 className="h-3.5 w-3.5 my-1 text-popover" /> : <Clock className="h-3.5 w-3.5" />}
                  </div>
                  <div className="w-0.5 h-full bg-border mt-1"></div>
                </div>
                <div>
                  <p className="font-medium">Email {confirmedDate ? 'Confirmed' : 'Confirmation Pending'}</p>
                  {confirmedDate ? (
                    <p className="text-muted-foreground text-xs">{format(confirmedDate, "MMMM d, yyyy 'at' h:mm a")}</p>
                  ) : (
                    <p className="text-muted-foreground text-xs">Waiting for you to confirm your email</p>
                  )}
                </div>
              </div>
              
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                    <Calendar className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div>
                  <p className="font-medium">Project Date</p>
                  <p className="text-muted-foreground text-xs">{formatScheduleSlot(project, schedule_id)}</p>
                </div>
              </div>
            </div>
          </div>
          
          
            {status === 'attended' && check_in_time && !areHoursPublished && (
            <>
              <Separator />
              <div className="space-y-3 text-sm">
              <h3 className="font-medium text-base mb-2">Session Progress</h3>
              <p className="text-muted-foreground">
                Checked in at: <span className="text-foreground font-medium">{checkInTimeFormatted}</span>
              </p>
              <Progress value={percent} className="h-3" aria-label="Session progress" />
              <div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">{percent}% of session completed</p>
                {/* Time remaining */}
                {(() => {
                  // Calculate time remaining
                  let timeRemaining = "";
                  if (sessionDate && endTime) {
                    const now = new Date();
                    const endDt = parseISO(`${sessionDate}T${endTime}`);
                    let diff = Math.max(0, endDt.getTime() - now.getTime());
                    const hours = Math.floor(diff / (1000 * 60 * 60));
                    diff -= hours * 1000 * 60 * 60;
                    const minutes = Math.floor(diff / (1000 * 60));
                    if (endDt > now) {
                      timeRemaining = `${hours > 0 ? `${hours}h ` : ""}${minutes}m remaining`;
                    } else {
                      timeRemaining = "Session ended";
                    }
                  }
                  return (
                    <p className="text-xs text-muted-foreground text-right min-w-[110px]">
                      {timeRemaining}
                    </p>
                  );
                })()}
              </div>
              </div>
              </div>
            </>
            )}
        <Separator />

          <div className="space-y-3 text-sm">
            <h3 className="font-medium text-base mb-2">Your Information</h3>
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" /> Name: <span className="text-foreground font-medium">{name}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" /> Email: <span className="text-foreground font-medium">{email}</span>
            </div>
            {phone_number && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" /> Phone: <span className="text-foreground font-medium">{phone_number}</span>
              </div>
            )}
          </div>
          <Separator />
          <div className="space-y-3 text-sm">
            <h3 className="font-medium text-base mb-2">Project & Slot Details</h3>
             <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4 flex-shrink-0" /> Slot: <span className="text-foreground font-medium">{formatScheduleSlot(project, schedule_id)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Info className="h-4 w-4" /> Status:
              <Badge variant={
                signupStatus === 'approved' ? 'default' :
                signupStatus === 'attended' ? 'default' :
                signupStatus === 'pending' ? 'secondary' :
                'destructive'
              } className="capitalize ml-1">
                {signupStatus}
              </Badge>
            </div>
          </div>
          
          {/* --- MODIFIED: Move Data Retention Notice into the Published Hours card --- */}
          {/* {autoDeletionDate && (
            <Alert className="bg-muted/50 border-muted"> ... </Alert>
          )} */}
        </CardContent>

        <CardFooter className="flex flex-col border-t p-6 gap-4">
          <h3 className="font-medium text-base self-start">Manage Your Signup</h3>
          
          <div className="grid gap-4 w-full sm:grid-cols-2">
            {(isConfirmed || signupStatus === 'pending') && signupStatus !== 'rejected' && !isProjectCancelled && (
              <Button 
                variant="destructive" 
                onClick={() => setCancelDialogOpen(true)}
                className="flex items-center gap-2"
              >
                <XCircle className="h-4 w-4" />
                Cancel My Signup
              </Button>
            )}
            
            <Button variant="outline" asChild>
              <Link href={`/projects/${project.id}`} className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                View Project Details
              </Link>
            </Button>
          </div>
          
          <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Want to manage this signup with your Let&apos;s Assist account or create one? Linking your account allows you to easily track all your volunteer activities.
                </p>
                <Button disabled> {/* Disabled for now */}
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Link to Let&apos;s Assist Account
                </Button>
                <p className="text-xs text-muted-foreground">
                  (Account linking functionality coming soon!)
                </p>
              </div>
        </CardFooter>
      </Card>

      {/* Cancellation Confirmation Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Cancel Your Signup</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your signup for this volunteer project? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2 pb-4">
            <Alert variant="destructive" className="border-destructive/70 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-destructive">Important Note</AlertTitle>
              <AlertDescription className="text-destructive">
                This will permanently delete your signup information. You will need to sign up again if you change your mind later.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setCancelDialogOpen(false)}
              disabled={isCancelling}
            >
              Keep My Signup
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleCancelSignup}
              disabled={isCancelling}
              className="flex items-center gap-2"
            >
              {isCancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCancelling ? 'Cancelling...' : 'Yes, Cancel Signup'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Start: Session Progress Section (Conditional) --- */}
      
      {/* --- End: Session Progress Section --- */}
    </div>
  );
}
