import { createClient } from "@/utils/supabase/client";
import { NotificationService } from "@/services/notifications";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Project } from "@/types";
import {
  Edit,
  AlertCircle,
  Loader2,
  Users,
  AlertTriangle,
  QrCode,
  UserCheck,
  Zap,
  Pause,
  Printer,
  Info,
  Hourglass,
  CheckCircle2,
  Clock,
  Mail,
  Calendar,
  CalendarCheck,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { deleteProject, updateProjectStatus } from "./actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { canDeleteProject } from "@/utils/project";
import { CancelProjectDialog } from "@/components/CancelProjectDialog";
import { differenceInHours, addHours, isBefore, isAfter, parseISO, format } from "date-fns";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";
import ProjectTimeline from "./ProjectTimeline";
import { ProjectQRCodeModal } from "./ProjectQRCodeModal";
import CalendarOptionsModal from "@/components/CalendarOptionsModal";
import {
  removeCalendarEventForProject,
  removeAllVolunteerCalendarEvents,
} from "@/utils/calendar-helpers";

interface Props {
  project: Project;
}

import ProjectInstructionsModal from "./ProjectInstructions";

export default function CreatorDashboard({ project }: Props) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [qrCodeOpen, setQrCodeOpen] = useState(false);
  
  // Calendar integration states
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [isCalendarSynced, setIsCalendarSynced] = useState(!!project.creator_calendar_event_id);

  // Auto-sync calendar on page load if user is connected and project isn't synced
  useEffect(() => {
    const autoSyncCalendar = async () => {
      // Only sync if not already synced
      if (isCalendarSynced) return;

      try {
        // Check if user is connected to Google Calendar
        const response = await fetch("/api/calendar/connection-status");
        const data = await response.json();

        if (data.connected) {
          // Sync project to calendar
          const syncResponse = await fetch("/api/calendar/sync-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: project.id }),
          });

          if (syncResponse.ok) {
            toast.success("Project synced to Google Calendar");
            setIsCalendarSynced(true);
          }
        }
      } catch (error) {
        console.error("Auto calendar sync failed:", error);
      }
    };

    autoSyncCalendar();
  }, [project.id, isCalendarSynced]);

  const handleCancelProject = async (reason: string) => {
    try {
      const result = await updateProjectStatus(project.id, "cancelled", reason);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project cancelled successfully");
        
        // Remove calendar events (non-blocking)
        try {
          // Remove creator's calendar event
          await removeCalendarEventForProject(project.id);
          // Remove all volunteer calendar events
          await removeAllVolunteerCalendarEvents(project.id);
        } catch (calendarError) {
          console.error("Error removing calendar events:", calendarError);
          // Don't show error to user - this is non-critical
        }
        
        // Send cancellation notifications to all participants
        try {
          const supabase = createClient();
          const { data: signups, error } = await supabase
            .from('project_signups')
            .select('user_id')
            .eq('project_id', project.id);
            if (!error && signups) {
            for (const signup of signups) {
              if (signup.user_id) {
              await NotificationService.createNotification({
                title: `Project Cancelled`,
                body: `The project "${project.title}" which you signed up for has been cancelled.`,
                type: 'project_updates',
                actionUrl: `/projects/${project.id}`,
                data: { projectId: project.id, signupId: signup.user_id },
                severity: 'warning',
              }, signup.user_id);
              }
            }
            }
        } catch (notifyError) {
          console.error('Error sending cancellation notifications:', notifyError);
        }
        setShowCancelDialog(false);
        router.refresh();
      }
    } catch {
      toast.error("Failed to cancel project");
    }
  };

  const handleDeleteProject = async () => {
    if (!canDeleteProject(project)) {
      toast.error("Projects cannot be deleted 24 hours before start until 48 hours after end");
      setShowDeleteDialog(false);
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteProject(project.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project deleted successfully");
        router.push("/home");
        router.refresh(); // Trigger server-side re-fetch of home page data
      }
    } catch {
      toast.error("Failed to delete project");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleContactAllSignups = async () => {
    try {
      const supabase = createClient();
      const { data: signups, error } = await supabase
        .from('project_signups')
        .select(`
          user_id,
          profiles!inner(email, full_name)
        `)
        .eq('project_id', project.id)
        .not('profiles.email', 'is', null);

      if (error) {
        console.log('Error fetching signups:', error);
        console.error('Error fetching signups:', error);
        toast.error("Failed to fetch signup emails" + error.message);
        return;
      }

      if (!signups || signups.length === 0) {
        toast.error("No signups found for this project");
        return;
      }

      // Extract emails from the signups
      const emails = signups
        .map((signup: any) => {
          if (Array.isArray(signup.profiles)) {
            return signup.profiles[0]?.email;
          }
          return signup.profiles?.email;
        })
        .filter((email): email is string => !!email) // Remove any null/undefined emails
        .join(',');

      if (!emails) {
        toast.error("No valid email addresses found");
        return;
      }

      // Create mailto link
      const subject = encodeURIComponent(`Update regarding: ${project.title}`);
      const body = encodeURIComponent(`Dear volunteers,\n\nI hope this message finds you well. I wanted to reach out regarding the upcoming volunteer project "${project.title}".\n\n[Please add your message here]\n\nThank you for your commitment to this project!\n\nBest regards,\n[Your name]`);
      const mailtoLink = `mailto:?bcc=${emails}&subject=${subject}&body=${body}`;

      // Open email client
      window.location.href = mailtoLink;
      
      toast.success(`Opening email client with ${signups.length} volunteer emails`);
    } catch (error) {
      console.error('Error fetching signups:', error);
      toast.error("Failed to fetch signup emails");
    }
  };

  const now = new Date();
  const startDateTime = getProjectStartDateTime(project);
  const endDateTime = getProjectEndDateTime(project);
  const hoursUntilStart = differenceInHours(startDateTime, now);
  const hoursAfterEnd = differenceInHours(now, endDateTime);

  const isInDeletionRestrictionPeriod = hoursUntilStart <= 24 && hoursAfterEnd <= 48;
  const isCancelled = project.status === "cancelled";

  // --- Phases ---
  const isStartingSoon = hoursUntilStart <= 24 && isBefore(now, startDateTime); // Within 24 hours but not started
  const isInProgress = isAfter(now, startDateTime) && isBefore(now, endDateTime);
  const isCompleted = isAfter(now, endDateTime);
  const isCheckInOpen = hoursUntilStart <= 2 && isBefore(now, endDateTime); // Within 2 hours before start until end


  // Check if attendance management is available (2 hours before event)
  const isAttendanceAvailable = useMemo(() => {
    // Handle different event types
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const { date, startTime } = project.schedule.oneTime;
      const [year, month, day] = date.split('-').map(Number);
      const [hours, minutes] = startTime.split(':').map(Number);
      
      const sessionStart = new Date(year, month - 1, day, hours, minutes);
      const attendanceOpenTime = addHours(sessionStart, -2);
      
      return !isBefore(now, attendanceOpenTime);
    } 
    else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      // Check if any session is within 2 hours of starting
      return project.schedule.multiDay.some(day => {
        const [year, month, dayNum] = day.date.split('-').map(Number);
        
        return day.slots.some(slot => {
          const [hours, minutes] = slot.startTime.split(':').map(Number);
          const sessionStart = new Date(year, month - 1, dayNum, hours, minutes);
          const attendanceOpenTime = addHours(sessionStart, -2);
          
          return !isBefore(now, attendanceOpenTime);
        });
      });
    }
    else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
      const { date, roles } = project.schedule.sameDayMultiArea;
      const [year, month, day] = date.split('-').map(Number);
      
      return roles.some(role => {
        const [hours, minutes] = role.startTime.split(':').map(Number);
        const sessionStart = new Date(year, month - 1, day, hours, minutes);
        const attendanceOpenTime = addHours(sessionStart, -2);
        
        return !isBefore(now, attendanceOpenTime);
      });
    }
    
    return false;
  }, [project]);
  
  // Calculate time until attendance opens for tooltip

  // --- Helper function to get the key used in the 'published' object ---
  const getPublishStateKey = (sessionId: string): string => {
    if (project.event_type === "oneTime" && sessionId === "oneTime") {
      return "oneTime";
    } else if (project.event_type === "multiDay") {
      const match = sessionId.match(/day-(\d+)-slot-(\d+)/);
      if (match && project.schedule.multiDay) {
        const dayIndex = parseInt(match[1], 10);
        const slotIndex = parseInt(match[2], 10);
        const dateKey = project.schedule.multiDay[dayIndex]?.date;
        // Ensure dateKey is valid before constructing the key
        return dateKey ? `${dateKey}-${slotIndex}` : sessionId; // Fallback
      }
    } else if (project.event_type === "sameDayMultiArea") {
       // For sameDayMultiArea, the session ID passed to this function might be role-${index}
       // but the actual key in 'published' is the role name. We need the role name from the session list.
       // This helper might need adjustment depending on where it's called, or we filter based on the session object directly.
       // Let's assume the session object with the name is available where filtering happens.
       // If called with just the ID like 'role-0', we need to look up the name.
       const match = sessionId.match(/role-(\d+)/);
       if (match && project.schedule.sameDayMultiArea?.roles) {
         const roleIndex = parseInt(match[1], 10);
         const roleName = project.schedule.sameDayMultiArea.roles[roleIndex]?.name;
         return roleName || sessionId; // Use role name if found
       }
       // If the sessionId is already the role name (as used in HoursClient), return it directly
       if (project.schedule.sameDayMultiArea?.roles.some(r => r.name === sessionId)) {
         return sessionId;
       }
    }
    return sessionId; // Fallback
  };
  // --- End Helper ---

  // --- NEW: Session-specific Editing Window Check (FILTERED) ---
  const activeUnpublishedSessionsInEditingWindow = useMemo(() => {
    const result: { id: string; name: string; hoursRemaining: number }[] = [];
    const publishedKeys = project.published || {};

    // Check one-time events
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const date = parseISO(project.schedule.oneTime.date);
      const [hours, minutes] = project.schedule.oneTime.endTime.split(':').map(Number);
      const sessionEndTime = new Date(new Date(date).setHours(hours, minutes)); // Use new Date() to avoid modifying original 'date'
      const hoursSinceEnd = differenceInHours(now, sessionEndTime);
      const sessionId = "oneTime";
      const publishKey = getPublishStateKey(sessionId);

      if (isAfter(now, sessionEndTime) && hoursSinceEnd >= 0 && hoursSinceEnd < 48 && !publishedKeys[publishKey]) {
        result.push({
          id: sessionId,
          name: `Event on ${format(date, "MMM d")}`,
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
          const slotEndTime = new Date(new Date(dayDate).setHours(hours, minutes)); // Use new Date()
          const hoursSinceEnd = differenceInHours(now, slotEndTime);
          const sessionId = `day-${dayIndex}-slot-${slotIndex}`;
          const publishKey = getPublishStateKey(sessionId); // Uses date and slotIndex

          if (isAfter(now, slotEndTime) && hoursSinceEnd >= 0 && hoursSinceEnd < 48 && !publishedKeys[publishKey]) {
            result.push({
              id: sessionId,
              name: `${format(dayDate, "MMM d")} (${slot.startTime} - ${slot.endTime})`,
              hoursRemaining: 48 - hoursSinceEnd
            });
          }
        });
      });
    }

    // Check same-day multi-area events
    else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
      const date = parseISO(project.schedule.sameDayMultiArea.date);

      project.schedule.sameDayMultiArea.roles.forEach((role, _roleIndex) => {
        const [hours, minutes] = role.endTime.split(':').map(Number);
        const roleEndTime = new Date(new Date(date).setHours(hours, minutes)); // Use new Date()
        const hoursSinceEnd = differenceInHours(now, roleEndTime);
        // Use the role name as the primary identifier and the key for publishing
        const sessionId = role.name; // Use role name directly
        const publishKey = sessionId; // The key is the role name

        if (isAfter(now, roleEndTime) && hoursSinceEnd >= 0 && hoursSinceEnd < 48 && !publishedKeys[publishKey]) {
          result.push({
            id: sessionId, // Store role name as ID here
            name: `${role.name} (${role.startTime} - ${role.endTime})`,
            hoursRemaining: 48 - hoursSinceEnd
          });
        }
      });
    }

    return result;
    // Add project.published to dependency array
  }, [project, now, project.published]);

  // Rename variable used later
  const hasActiveUnpublishedSessions = activeUnpublishedSessionsInEditingWindow.length > 0;
  // --- END NEW ---

  return (
    <div className="space-y-4 sm:space-y-6 mb-4 px-2 sm:px-0">
      <Card className="overflow-hidden">
        <CardHeader className="px-4 py-4 sm:py-6 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl sm:text-2xl">Creator Dashboard</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                Manage your project and track volunteer signups
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 sm:gap-3">
            {/* Project Actions */}
            <Button
              variant="outline"
              className="w-full sm:w-auto flex items-center justify-center gap-2"
              onClick={() => router.push(`/projects/${project.id}/edit`)}
            >
              <Edit className="h-4 w-4" />
              Edit Project
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto flex items-center justify-center gap-2"
              onClick={() => router.push(`/projects/${project.id}/signups`)}
            >
              <Users className="h-4 w-4" />
              Manage Signups
            </Button>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-full sm:w-auto">
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto flex items-center justify-center gap-2"
                      onClick={handleContactAllSignups}
                      disabled={isCancelled}
                    >
                      <Mail className="h-4 w-4" />
                      Contact All Signups
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px] p-2">
                  <p>Open your email client with all volunteer emails pre-populated in BCC field</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Creator Instructions Modal */}
            <ProjectInstructionsModal project={project} isCreator={true} />

            {/* Calendar Sync Button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-full sm:w-auto">
                    <Button
                      variant="outline"
                      className={`w-full sm:w-auto flex items-center justify-center gap-2 ${
                        isCalendarSynced 
                          ? "bg-chart-5/10 hover:bg-chart-5/20 border-chart-5/80" 
                          : ""
                      }`}
                      onClick={() => setShowCalendarModal(true)}
                    >
                      {isCalendarSynced ? (
                        <>
                          <CalendarCheck className="h-4 w-4 text-chart-5" />
                          Synced to Calendar
                        </>
                      ) : (
                        <>
                          <Calendar className="h-4 w-4" />
                          Add to Calendar
                        </>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px] p-2">
                  <p>
                    {isCalendarSynced
                      ? "This project is synced to your calendar. Click to manage or remove."
                      : "Add this project to your Google Calendar or download an iCal file"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Creator Instructions Modal */}

            {/* --- MODIFIED: Manage Hours Button (Conditional) --- */}
            {/* Use the new filtered list */}
            {hasActiveUnpublishedSessions && project.verification_method !== 'auto' && (
              <div className="w-full sm:w-auto">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="w-full sm:w-auto">
                        <Button
                          variant="outline"
                          className="w-full bg-chart-8/10 hover:bg-chart-8/20 border-chart-8/80 sm:w-auto flex items-center justify-center gap-2"
                          onClick={() => router.push(`/projects/${project.id}/hours`)}
                        >
                          <Clock className="h-4 w-4" />
                          Manage Hours
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {/* --- Update tooltip content to use activeUnpublishedSessionsInEditingWindow --- */}
                    <TooltipContent className="max-w-[280px] p-2">
                      <p>
                        {activeUnpublishedSessionsInEditingWindow.length === 1
                          ? `Editing window open for: ${activeUnpublishedSessionsInEditingWindow[0].name}`
                          : `Editing windows open for ${activeUnpublishedSessionsInEditingWindow.length} sessions`}
                      </p>
                      {activeUnpublishedSessionsInEditingWindow.length > 1 && (
                        <ul className="text-xs mt-1 space-y-1">
                          {activeUnpublishedSessionsInEditingWindow.map(session => (
                            <li key={session.id}>
                              • {session.name} ({session.hoursRemaining}h remaining)
                            </li>
                          ))}
                        </ul>
                      )}
                       <p className="text-xs mt-1 text-muted-foreground">Click to review/edit hours before publishing.</p>
                    </TooltipContent>
                    {/* --- End Update --- */}
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
            {/* --- END MODIFIED --- */}

            {/* Attendance Button - for QR code and manual methods */}
            {/* {(project.verification_method === 'qr-code' || project.verification_method === 'manual') && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="w-full sm:w-auto">
                      <Button
                        variant="outline"
                        className={`w-full sm:w-auto flex items-center justify-center gap-2 ${
                          isAttendanceAvailable 
                            ? "bg-chart-5/30 hover:bg-chart-5/20 border-chart-5/60" 
                            : "opacity-70"
                        }`}
                        onClick={() => router.push(`/projects/${project.id}/attendance`)}
                        disabled={!isAttendanceAvailable}
                      >
                        <UserCheck className="h-4 w-4" />
                        {project.verification_method === 'manual' ? 'Check-in Volunteers' : 'Manage Attendance'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!isAttendanceAvailable && (
                    <TooltipContent className="max-w-[250px] p-2">
                      <p>Attendance management will be available 2 hours before the event starts</p>
                      {timeUntilAttendanceOpens && (
                        <p className="text-xs mt-1">{timeUntilAttendanceOpens}</p>
                      )}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}  */}
            {/* Visual indicator for automatic check-in */}
            

            {/* <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-full sm:w-auto">
                    <Button
                      variant="destructive"
                      className="w-full sm:w-auto flex items-center justify-center gap-2"
                      onClick={() => setShowDeleteDialog(true)}
                      disabled={isDeleting || !canDelete || isInDeletionRestrictionPeriod}
                    >
                      {isDeleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete Project
                    </Button>
                  </span>
                </TooltipTrigger>
                {isInDeletionRestrictionPeriod && (
                  <TooltipContent className="max-w-[250px] text-center p-2">
                    <p>Projects cannot be deleted during the 72-hour window around the event</p>
                  </TooltipContent>
                )}
                 {!canDelete && !isInDeletionRestrictionPeriod && ( // Add tooltip if deletion is disallowed for other reasons
                  <TooltipContent className="max-w-[250px] text-center p-2">
                    <p>Project cannot be deleted at this time (e.g., too close to start).</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider> */}
          </div>

          {/* --- Conditional Alerts --- */}
          {/* Signup-Only */}
          {project.verification_method === 'signup-only' && !isCancelled && (
            <>
              {isStartingSoon && (
                <Alert variant="default" className="border-chart-3/50 bg-chart-3/10 mt-4">
                  <Info className="h-4 w-4 text-chart-3" />
                  <AlertTitle className="text-chart-3">Event Starting Soon!</AlertTitle>
                  <AlertDescription>
                    Your signup-only event starts within 24 hours. Consider pausing signups if you&apos;re no longer accepting volunteers. You can also view or print the current signup list from the Manage Signups page.
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/projects/${project.id}/signups`}>
                          <Pause className="h-4 w-4 mr-1.5" /> Pause/View Signups
                        </Link>
                      </Button>
                       <Button variant="outline" size="sm" asChild>
                         <Link href={`/projects/${project.id}/signups`}>
                           <Printer className="h-4 w-4 mr-1.5" /> Print List
                         </Link>
                       </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {isInProgress && (
                <Alert variant="default" className="border-chart-4/50 bg-chart-4/10 mt-4">
                  <Info className="h-4 w-4 text-chart-4" />
                  <AlertTitle className="text-chart-4">Event In Progress</AlertTitle>
                  <AlertDescription>
                    Your signup-only event is currently ongoing based on the scheduled time.
                  </AlertDescription>
                </Alert>
              )}
              {/* --- MODIFIED: Signup-Only Completed Alert --- */}
              {isCompleted && ( // Condition already checks for completion
                <Alert variant="default" className="border-chart-6/50 bg-chart-6/10 mt-4">
                  <CheckCircle2 className="h-4 w-4 text-chart-6" />
                  <AlertTitle className="text-chart-6">Event Completed</AlertTitle>
                  <AlertDescription>
                    {/* Use hasActiveUnpublishedSessions for conditional text */}
                    {hasActiveUnpublishedSessions
                      ? "Your signup-only event has finished. Please review and finalize volunteer hours within 48 hours of the event end time to generate certificates."
                      : "Your signup-only event has finished, and the window for managing volunteer hours has closed or all sessions are published."}
                    <div className="mt-3">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* Span needed for tooltip on disabled button */}
                            <span className="inline-block" tabIndex={hasActiveUnpublishedSessions ? -1 : 0}>
                              <Button
                                variant="outline"
                                size="sm"
                                asChild={hasActiveUnpublishedSessions} // Link only if active
                                disabled={!hasActiveUnpublishedSessions} // Disable if no active sessions
                                className={!hasActiveUnpublishedSessions ? "pointer-events-none opacity-60" : ""} // Style disabled button
                              >
                                {hasActiveUnpublishedSessions ? (
                                  <Link href={`/projects/${project.id}/hours`}>
                                    <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                  </Link>
                                ) : (
                                  // Content for disabled button
                                  <>
                                    <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                  </>
                                )}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {/* Tooltip for disabled button */}
                          {!hasActiveUnpublishedSessions && (
                            <TooltipContent>
                              <p>Editing window closed or all sessions published.</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {/* --- END MODIFIED --- */}
            </>
          )}
          {/* QR Code / Manual */}
          {(project.verification_method === 'qr-code' || project.verification_method === 'manual') && !isCancelled && (
            <>
              {isStartingSoon && !isCheckInOpen && ( // Show only if > 2 hours away
                <Alert variant="default" className="border-chart-3/50 bg-chart-3/10 mt-4">
                  <Info className="h-4 w-4 text-chart-3" />
                  <AlertTitle className="text-chart-3">Event Starting Soon!</AlertTitle>
                  <AlertDescription>
                    Your event starts within 24 hours. 
                    {project.verification_method === 'qr-code' && " QR codes for check-in will be available 2 hours before the start time."}
                    {project.verification_method === 'manual' && " Prepare for manual volunteer check-in."}
                    <div className="mt-3 flex gap-2">
                      {project.verification_method === 'qr-code' && (
                        <Button variant="outline" size="sm" onClick={() => setQrCodeOpen(true)}>
                          <QrCode className="h-4 w-4 mr-1.5" /> Preview QR Codes
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/projects/${project.id}/signups`}>
                          <Users className="h-4 w-4 mr-1.5" /> View Signups
                        </Link>
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {isCheckInOpen && !isInProgress && !isCompleted && ( // Show only if < 2 hours away but not started
                <Alert variant="default" className="border-primary/50 bg-primary/10 mt-4">
                  <Hourglass className="h-4 w-4 text-primary" />
                  <AlertTitle className="text-primary">Check-in Window Open!</AlertTitle>
                  <AlertDescription>
                    Volunteer check-in is available starting 2 hours before the event.
                    {project.verification_method === 'qr-code' && " Ensure QR codes are accessible."}
                    {project.verification_method === 'manual' && " Be ready to check volunteers in manually."}
                    <div className="mt-3 flex gap-2">
                      {project.verification_method === 'qr-code' && (
                        <Button variant="outline" size="sm" onClick={() => setQrCodeOpen(true)}>
                          <QrCode className="h-4 w-4 mr-1.5" /> View QR Codes
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/projects/${project.id}/attendance`}>
                          <UserCheck className="h-4 w-4 mr-1.5" /> Manage Attendance
                        </Link>
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {isInProgress && (
                <Alert variant="default" className="border-chart-4/50 bg-chart-4/10 mt-4">
                  <Info className="h-4 w-4 text-chart-4" />
                  <AlertTitle className="text-chart-4">Event In Progress</AlertTitle>
                  <AlertDescription>
                    Your event is currently ongoing. Manage check-ins and view attendance records.
                    <div className="mt-3 flex gap-2">
                      {project.verification_method === 'qr-code' && (
                        <Button variant="outline" size="sm" onClick={() => setQrCodeOpen(true)}>
                          <QrCode className="h-4 w-4 mr-1.5" /> View QR Codes
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/projects/${project.id}/attendance`}>
                          <UserCheck className="h-4 w-4 mr-1.5" /> Manage Attendance
                        </Link>
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
                      {isCompleted && (project.verification_method === 'qr-code' || project.verification_method === 'manual') && !isCancelled && (
                      <Alert
                        variant="default"
                        // Use hasActiveUnpublishedSessions for conditional styling
                        className={`border-${hasActiveUnpublishedSessions ? "chart-3" : "chart-5"}/50 bg-${hasActiveUnpublishedSessions ? "chart-3" : "chart-5"}/10 mt-4`}
                      >
                        <CheckCircle2 className={`h-4 w-4 text-${hasActiveUnpublishedSessions ? "chart-3" : "chart-5"}`} />
                        <AlertTitle className={`text-${hasActiveUnpublishedSessions ? "chart-3" : "chart-5"}`}>Event Completed</AlertTitle>
                        <AlertDescription>
                    {/* Use hasActiveUnpublishedSessions here */}
                    {hasActiveUnpublishedSessions
                      ? "Your event has finished. Please review, edit, and publish volunteer hours within 48 hours of the event end time to generate certificates. If you don't edit, hours will be published automatically."
                      : "Your event has finished, and the window for managing volunteer hours has closed or all sessions are published. You can still view the final attendance records."}
                    <div className="mt-3 flex gap-2 flex-wrap">
                         <Button variant="outline" size="sm" asChild>
                           <Link href={`/projects/${project.id}/attendance`}>
                             <Users className="h-4 w-4 mr-1.5" /> View Attendance
                           </Link>
                         </Button>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-block" tabIndex={hasActiveUnpublishedSessions ? -1 : 0}>
                              <Button
                                variant="outline"
                                size="sm"
                                asChild={hasActiveUnpublishedSessions} // Link only if active
                                disabled={!hasActiveUnpublishedSessions} // Disable if no active sessions
                                className={!hasActiveUnpublishedSessions ? "pointer-events-none opacity-60" : ""} // Style disabled button
                              >
                                {hasActiveUnpublishedSessions ? (
                                  <Link href={`/projects/${project.id}/hours`}>
                                    <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                  </Link>
                                ) : (
                                  <>
                                    <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                  </>
                                )}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {/* Tooltip for disabled button */}
                          {!hasActiveUnpublishedSessions && (
                            <TooltipContent>
                              <p>Editing window closed or all sessions published.</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {/* --- END MODIFIED --- */}
            </>
          )}
          {/* Auto Check-in (Keep this separate as it has no hours management) */}
          {project.verification_method === 'auto' && !isCancelled && (
             <Alert variant="default" className="border-chart-2/50 bg-chart-2/10 mt-4">
               <Zap className="h-4 w-4 text-chart-2" />
               <AlertTitle className="text-chart-2">Automatic Check-in Enabled</AlertTitle>
               <AlertDescription>
                 Volunteer check-in is automatic. Hours are recorded based on the schedule. Manual editing is not available for this project type.
                 <div className="mt-3 flex gap-2">
                   <Button variant="outline" size="sm" asChild disabled={!isAttendanceAvailable}>
                     <Link href={`/projects/${project.id}/attendance`}>
                       <Users className="h-4 w-4 mr-1.5" /> {isCompleted ? "View Final Attendance" : "Monitor Attendance"}
                     </Link>
                   </Button>
                 </div>
               </AlertDescription>
             </Alert>
          )}
          {/* --- End Conditional Alerts --- */}


          {/* Cancelled Project Info */}
          {isCancelled ? (
            <div className="flex flex-col sm:flex-row items-start gap-2 rounded-md border border-destructive p-3 sm:p-4 bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  This project has been cancelled. You can still edit details and manage existing signups,
                  but new signups are disabled and this project has been shut off. If this was a mistake, please contact <Link className="text-chart-3" href="mailto:support@lets-assist.com">support@lets-assist.com</Link>
                </p>
                {project.cancellation_reason && (
                  <p className="mt-1">
                    <span className="font-medium">Reason:</span> {project.cancellation_reason}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start gap-2 rounded-md border p-3 sm:p-4 bg-muted/50">
              
              <div className="text-sm text-muted-foreground space-y-2">
              <AlertCircle className="h-5 w-5 mr-2 text-muted-foreground inline flex-shrink-0" />
                <p className="inline">
                  As the project creator, you have full control over this project.
                  You can edit project details, manage volunteer signups, update
                  documents, and more.
                </p>
                {isInDeletionRestrictionPeriod && (
                  <div className="mt-2 flex items-center text-chart-6">
                    <AlertTriangle className="h-4 w-4 inline mr-2 flex-shrink-0" />
                    <span className="inline">
                      Project deletion is restricted during the 72-hour window around the event (24 hours before until 48 hours after).
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-[425px]">
          <AlertDialogHeader className="space-y-3">
            <AlertDialogTitle className="text-lg sm:text-xl">Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This action cannot be undone. This will permanently delete your
              project and remove all data associated with it, including volunteer
              signups and documents. If you need to cancel or reschedule, we recommend you cancel the project instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-3">
            <AlertDialogCancel className="w-full sm:w-auto mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Project"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Project Dialog */}
      <CancelProjectDialog
        project={project}
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={handleCancelProject}
      />

      {/* Project Timeline */}
      <ProjectTimeline 
        project={project} 
        open={timelineOpen} 
        onOpenAction={setTimelineOpen} 
      />
      
      {/* Add QR Code Modal - only for qr code method */}
      {project.verification_method === 'qr-code' && (
        <ProjectQRCodeModal
          project={project}
          open={qrCodeOpen}
          onOpenChange={setQrCodeOpen}
        />
      )}

      {/* Calendar Sync Modal */}
      <CalendarOptionsModal
        open={showCalendarModal}
        onOpenChange={setShowCalendarModal}
        project={project}
        mode="creator"
        onSyncSuccess={() => setIsCalendarSynced(true)}
      />
    </div>
  );
}
