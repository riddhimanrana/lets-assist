import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
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
  ChevronRight,
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
import { CancelProjectDialog } from "@/app/projects/_components/CancelProjectDialog";
import { differenceInHours, isBefore, isAfter, parseISO, format } from "date-fns";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";
import ProjectTimeline from "./ProjectTimeline";
import { ProjectQRCodeModal } from "./ProjectQRCodeModal";
import CalendarOptionsModal from "@/app/projects/_components/CalendarOptionsModal";

interface Props {
  project: Project;
}

import ProjectInstructionsModal from "./ProjectInstructionsModalWrapper";

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
        const notificationStatus = result.cancellationNotifications;
        if (notificationStatus?.enqueued) {
          toast.success("Project cancelled successfully. Approved volunteers will be emailed shortly.");
          if (notificationStatus.error) {
            toast.warning(notificationStatus.error);
          }
        } else {
          toast.success("Project cancelled successfully.");
          toast.warning(
            notificationStatus?.error ||
            "We couldn't queue cancellation emails. Please try again shortly."
          );
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
        .map((signup: { profiles: { email: string | null } | { email: string | null }[] }) => {
          const profile = Array.isArray(signup.profiles) ? signup.profiles[0] : signup.profiles;
          return profile?.email;
        })
        .filter(email => email) // Remove any null/undefined emails
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
    } catch (_error) {
      console.error('Error fetching signups:', _error);
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

  const statusLabel = isCancelled
    ? "Cancelled"
    : isInProgress
      ? "In progress"
      : isStartingSoon
        ? "Starting soon"
        : isCompleted
          ? "Completed"
          : "Scheduled";

  const statusTone = isCancelled
    ? "bg-destructive/15 text-destructive"
    : isInProgress
      ? "bg-warning/15 text-warning"
      : isStartingSoon
        ? "bg-info/15 text-info"
        : isCompleted
          ? "bg-success/15 text-success"
          : "bg-primary/10 text-primary";

  const verificationLabel =
    project.verification_method === "qr-code"
      ? "QR code"
      : project.verification_method === "manual"
        ? "Manual check-in"
        : project.verification_method === "auto"
          ? "Auto check-in"
          : "Signup-only";

  const checkInLabel =
    project.verification_method === "signup-only"
      ? "Not required"
      : project.verification_method === "auto"
        ? "Automatic"
        : isCheckInOpen
          ? "Open"
          : isCompleted
            ? "Closed"
            : "Scheduled";


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

      project.schedule.sameDayMultiArea.roles.forEach((role) => {
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
      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="pb-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xl sm:text-2xl">Creator Dashboard</CardTitle>
              <div className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold shrink-0", statusTone)}>
                {statusLabel}
              </div>
            </div>
            <CardDescription className="text-sm">
              Manage your project, volunteers, and event logistics in one place.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="hidden sm:block rounded-lg border bg-muted/30">
            <div className="grid divide-y sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
              <div className="p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Starts</div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {format(startDateTime, "EEE, MMM d")}
                </div>
                <div className="text-xs text-muted-foreground">{format(startDateTime, "p")}</div>
              </div>
              <div className="p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Ends</div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {format(endDateTime, "EEE, MMM d")}
                </div>
                <div className="text-xs text-muted-foreground">{format(endDateTime, "p")}</div>
              </div>
              <div className="p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Check-in</div>
                <div className="mt-2 text-sm font-semibold text-foreground">{checkInLabel}</div>
                <div className="text-xs text-muted-foreground">{verificationLabel}</div>
              </div>
            </div>
          </div>

          {hasActiveUnpublishedSessions && (
            <div className="flex items-center gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">
              <Clock className="h-3.5 w-3.5" />
              {activeUnpublishedSessionsInEditingWindow.length} session{activeUnpublishedSessionsInEditingWindow.length === 1 ? "" : "s"} need hours published.
            </div>
          )}

          <div className="rounded-lg border bg-background/40">
            <div className="flex items-center justify-between px-3 py-3 sm:px-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Quick actions</h3>
                <p className="text-xs text-muted-foreground hidden sm:block">Jump into the most common creator tasks.</p>
              </div>
            </div>

            <div className="sm:hidden px-2 pb-2">
              <div className="divide-y rounded-md border bg-background/60">
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-full justify-between px-2"
                    onClick={() => router.push(`/projects/${project.id}/edit`)}
                  >
                    <span className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      Edit Project
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-full justify-between px-2"
                    onClick={() => router.push(`/projects/${project.id}/signups`)}
                  >
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Manage Signups
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
                <div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={
                        <span className="w-full">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 w-full justify-between px-2"
                            onClick={handleContactAllSignups}
                            disabled={isCancelled}
                          >
                            <span className="flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              Contact All Signups
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </span>
                      } />
                      <TooltipContent className="max-w-75 p-2">
                        <p>Open your email client with all volunteer emails pre-populated in BCC field</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div>
                  <ProjectInstructionsModal
                    project={project}
                    isCreator={true}
                    buttonVariant="ghost"
                    buttonSize="sm"
                    showChevron
                    buttonClassName="h-10 w-full justify-between px-2"
                  />
                </div>
                <div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={
                        <span className="w-full">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 w-full justify-between px-2"
                            onClick={() => setShowCalendarModal(true)}
                          >
                            <span className="flex items-center gap-2">
                              {isCalendarSynced ? (
                                <CalendarCheck className="h-4 w-4 text-success" />
                              ) : (
                                <Calendar className="h-4 w-4" />
                              )}
                              {isCalendarSynced ? "Synced to Calendar" : "Add to Calendar"}
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </span>
                      } />
                      <TooltipContent className="max-w-70 p-2">
                        <p>
                          {isCalendarSynced
                            ? "This project is synced to your calendar. Click to manage or remove."
                            : "Add this project to your Google Calendar or download an iCal file"}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {hasActiveUnpublishedSessions && project.verification_method !== 'auto' && (
                  <div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={
                          <span className="w-full">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-10 w-full justify-between px-2"
                              onClick={() => router.push(`/projects/${project.id}/hours`)}
                            >
                              <span className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Manage Hours
                              </span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </span>
                        } />
                        <TooltipContent className="max-w-70 p-2">
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
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>
            </div>

            <div className="hidden sm:grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-3 sm:px-4 sm:pb-4">
              <Button
                variant="outline"
                className="h-10 w-full justify-between gap-2 bg-background/60 shadow-none"
                onClick={() => router.push(`/projects/${project.id}/edit`)}
              >
                <span className="flex items-center gap-2">
                  <Edit className="h-4 w-4" />
                  Edit Project
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="h-10 w-full justify-between gap-2 bg-background/60 shadow-none"
                onClick={() => router.push(`/projects/${project.id}/signups`)}
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Manage Signups
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Button>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={
                    <span className="w-full">
                      <Button
                        variant="outline"
                        className="h-10 w-full justify-between gap-2 bg-background/60 shadow-none"
                        onClick={handleContactAllSignups}
                        disabled={isCancelled}
                      >
                        <span className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          Contact All Signups
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </span>
                  } />
                  <TooltipContent className="max-w-75 p-2">
                    <p>Open your email client with all volunteer emails pre-populated in BCC field</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <ProjectInstructionsModal
                project={project}
                isCreator={true}
                buttonClassName="h-10 w-full justify-between px-2 bg-background/60 shadow-none"
                buttonVariant="outline"
                showChevron
              />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={
                    <span className="w-full">
                      <Button
                        variant="outline"
                        className={`h-10 w-full justify-between gap-2 bg-background/60 shadow-none ${isCalendarSynced
                          ? "bg-success/10 hover:bg-success/20 border-success/80"
                          : ""
                          }`}
                        onClick={() => setShowCalendarModal(true)}
                      >
                        <span className="flex items-center gap-2">
                          {isCalendarSynced ? (
                            <CalendarCheck className="h-4 w-4 text-success" />
                          ) : (
                            <Calendar className="h-4 w-4" />
                          )}
                          {isCalendarSynced ? "Synced to Calendar" : "Add to Calendar"}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </span>
                  } />
                  <TooltipContent className="max-w-70 p-2">
                    <p>
                      {isCalendarSynced
                        ? "This project is synced to your calendar. Click to manage or remove."
                        : "Add this project to your Google Calendar or download an iCal file"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {hasActiveUnpublishedSessions && project.verification_method !== 'auto' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={
                      <span className="w-full">
                        <Button
                          variant="outline"
                          className="h-10 w-full justify-between gap-2 bg-primary/10 hover:bg-primary/20 border-primary/80 shadow-none"
                          onClick={() => router.push(`/projects/${project.id}/hours`)}
                        >
                          <span className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Manage Hours
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </span>
                    } />
                    <TooltipContent className="max-w-70 p-2">
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
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

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
                            ? "bg-success/30 hover:bg-success/20 border-success/60" 
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
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-destructive/10 hover:bg-destructive/20 text-destructive"
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

          {/* --- Conditional Alerts --- */}
          {/* Signup-Only */}
          {project.verification_method === 'signup-only' && !isCancelled && (
            <>
              {isStartingSoon && (
                <Alert variant="default" className="border-info/50 bg-info/10 mt-4">
                  <Info className="h-4 w-4 text-info" />
                  <AlertTitle className="text-info">Event Starting Soon!</AlertTitle>
                  <AlertDescription>
                    Your signup-only event starts within 24 hours. Consider pausing signups if you&apos;re no longer accepting volunteers. You can also view or print the current signup list from the Manage Signups page.
                    <div className="mt-3 flex gap-2">
                      <Link href={`/projects/${project.id}/signups`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}>
                        <Pause className="h-4 w-4 mr-1.5" /> Pause/View Signups
                      </Link>
                      <Link href={`/projects/${project.id}/signups`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}>
                        <Printer className="h-4 w-4 mr-1.5" /> Print List
                      </Link>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {isInProgress && (
                <Alert variant="default" className="border-warning/50 bg-warning/10 mt-4">
                  <Info className="h-4 w-4 text-warning" />
                  <AlertTitle className="text-warning">Event In Progress</AlertTitle>
                  <AlertDescription>
                    Your signup-only event is currently ongoing based on the scheduled time.
                  </AlertDescription>
                </Alert>
              )}
              {/* --- MODIFIED: Signup-Only Completed Alert --- */}
              {isCompleted && ( // Condition already checks for completion
                <Alert variant="default" className="border-success/50 bg-success/10 mt-4">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertTitle className="text-success">Event Completed</AlertTitle>
                  <AlertDescription>
                    {/* Use hasActiveUnpublishedSessions for conditional text */}
                    {hasActiveUnpublishedSessions
                      ? "Your signup-only event has finished. Please review and finalize volunteer hours within 48 hours of the event end time to generate certificates."
                      : "Your signup-only event has finished, and the window for managing volunteer hours has closed or all sessions are published."}
                    <div className="mt-3">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger render={
                            /* Span needed for tooltip on disabled button */
                            <span className="inline-block" tabIndex={hasActiveUnpublishedSessions ? -1 : 0}>
                              {hasActiveUnpublishedSessions ? (
                                <Link
                                  href={`/projects/${project.id}/hours`}
                                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}
                                >
                                  <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                </Link>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled
                                  className="pointer-events-none opacity-60"
                                >
                                  <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                </Button>
                              )}
                            </span>
                          } />
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
                <Alert variant="default" className="border-info/50 bg-info/10 mt-4">
                  <Info className="h-4 w-4 text-info" />
                  <AlertTitle className="text-info">Event Starting Soon!</AlertTitle>
                  <AlertDescription>
                    Your event starts within 24 hours.
                    {project.verification_method === 'qr-code' && " QR codes for check-in will be available 2 hours before the start time."}
                    {project.verification_method === 'manual' && " Prepare for manual volunteer check-in."}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {project.verification_method === 'qr-code' && (
                        <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setQrCodeOpen(true)}>
                          <QrCode className="h-4 w-4 mr-1.5" /> Preview QR Codes
                        </Button>
                      )}
                      <Link
                        href={`/projects/${project.id}/signups`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline! w-full sm:w-auto")}
                      >
                        <Users className="h-4 w-4 mr-1.5" /> View Signups
                      </Link>
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
                      <Link href={`/projects/${project.id}/attendance`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}>
                        <UserCheck className="h-4 w-4 mr-1.5" /> Manage Attendance
                      </Link>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {isInProgress && (
                <Alert variant="default" className="border-warning/50 bg-warning/10 mt-4">
                  <Info className="h-4 w-4 text-warning" />
                  <AlertTitle className="text-warning">Event In Progress</AlertTitle>
                  <AlertDescription>
                    Your event is currently ongoing. Manage check-ins and view attendance records.
                    <div className="mt-3 flex gap-2">
                      {project.verification_method === 'qr-code' && (
                        <Button variant="outline" size="sm" onClick={() => setQrCodeOpen(true)}>
                          <QrCode className="h-4 w-4 mr-1.5" /> View QR Codes
                        </Button>
                      )}
                      <Link href={`/projects/${project.id}/attendance`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}>
                        <UserCheck className="h-4 w-4 mr-1.5" /> Manage Attendance
                      </Link>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {isCompleted && (project.verification_method === 'qr-code' || project.verification_method === 'manual') && !isCancelled && (
                <Alert
                  variant="default"
                  // Use hasActiveUnpublishedSessions for conditional styling
                  className={`border-${hasActiveUnpublishedSessions ? "info" : "success"}/50 bg-${hasActiveUnpublishedSessions ? "info" : "success"}/10 mt-4`}
                >
                  <CheckCircle2 className={`h-4 w-4 text-${hasActiveUnpublishedSessions ? "info" : "success"}`} />
                  <AlertTitle className={`text-${hasActiveUnpublishedSessions ? "info" : "success"}`}>Event Completed</AlertTitle>
                  <AlertDescription>
                    {/* Use hasActiveUnpublishedSessions here */}
                    {hasActiveUnpublishedSessions
                      ? "Your event has finished. Please review, edit, and publish volunteer hours within 48 hours of the event end time to generate certificates. If you don't edit, hours will be published automatically."
                      : "Your event has finished, and the window for managing volunteer hours has closed or all sessions are published. You can still view the final attendance records."}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <Link href={`/projects/${project.id}/attendance`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}>
                        <UserCheck className="h-4 w-4 mr-1.5" /> Manage Attendance
                      </Link>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger render={
                            <span className="inline-block" tabIndex={hasActiveUnpublishedSessions ? -1 : 0}>
                              {hasActiveUnpublishedSessions ? (
                                <Link
                                  href={`/projects/${project.id}/hours`}
                                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}
                                >
                                  <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                </Link>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled
                                  className="pointer-events-none opacity-60"
                                >
                                  <Clock className="h-4 w-4 mr-1.5" /> Manage Hours
                                </Button>
                              )}
                            </span>
                          } />
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
            <Alert variant="default" className="border-secondary/50 bg-secondary/10 mt-4">
              <Zap className="h-4 w-4 text-secondary" />
              <AlertTitle className="text-secondary">Automatic Check-in Enabled</AlertTitle>
              <AlertDescription>
                Volunteer check-in is automatic. Hours are recorded based on the schedule. Manual editing is not available for this project type.
                <div className="mt-3 flex gap-2">
                  <Link href={`/projects/${project.id}/attendance`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline! hover:no-underline!")}>
                    <Users className="h-4 w-4 mr-1.5" /> View Attendance
                  </Link>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {/* --- End Conditional Alerts --- */}


          {/* Cancelled Project Info */}
          {isCancelled ? (
            <div className="flex flex-col sm:flex-row items-start gap-2 rounded-md border border-destructive p-3 sm:p-4 bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  This project has been cancelled. You can still edit details and manage existing signups,
                  but new signups are disabled and this project has been shut off. If this was a mistake, please contact <Link className="text-primary hover:underline" href="mailto:support@lets-assist.com">support@lets-assist.com</Link>
                </p>
                {project.cancellation_reason && (
                  <p className="mt-1">
                    <span className="font-medium">Reason:</span> {project.cancellation_reason}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <></>
          )}
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-106.25">
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
              className="w-full sm:w-auto bg-destructive/10 text-destructive hover:bg-destructive/20"
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
