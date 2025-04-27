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
  Trash2,
  AlertCircle,
  Loader2,
  Users,
  FileEdit,
  XCircle,
  AlertTriangle,
  CalendarClock,
  QrCode,
  UserCheck, // Add UserCheck icon for attendance
  Zap // Add Zap icon for automatic check-in
} from "lucide-react";
import { useState, useMemo } from "react";
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
import { canCancelProject, canDeleteProject } from "@/utils/project";
import { CancelProjectDialog } from "@/components/CancelProjectDialog";
import { differenceInHours, addHours, isBefore } from "date-fns";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";
import ProjectTimeline from "./ProjectTimeline";
import { ProjectQRCodeModal } from "./ProjectQRCodeModal"; 

interface Props {
  project: Project;
}

export default function CreatorDashboard({ project }: Props) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [qrCodeOpen, setQrCodeOpen] = useState(false);

  const handleCancelProject = async (reason: string) => {
    try {
      const result = await updateProjectStatus(project.id, "cancelled", reason);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project cancelled successfully");
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
    } catch (error) {
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
      }
    } catch (error) {
      toast.error("Failed to delete project");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const now = new Date();
  const startDateTime = getProjectStartDateTime(project);
  const endDateTime = getProjectEndDateTime(project);
  const hoursUntilStart = differenceInHours(startDateTime, now);
  const hoursAfterEnd = differenceInHours(now, endDateTime);
  
  const isInDeletionRestrictionPeriod = hoursUntilStart <= 24 && hoursAfterEnd <= 48;
  const canDelete = canDeleteProject(project);
  const canCancel = canCancelProject(project);
  const isCancelled = project.status === "cancelled";
  
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
  const timeUntilAttendanceOpens = useMemo(() => {
    if (isAttendanceAvailable) return null;
    
    let earliestSessionTime: Date | null = null;
    
    if (project.event_type === "oneTime" && project.schedule.oneTime) {
      const { date, startTime } = project.schedule.oneTime;
      const [year, month, day] = date.split('-').map(Number);
      const [hours, minutes] = startTime.split(':').map(Number);
      
      earliestSessionTime = new Date(year, month - 1, day, hours, minutes);
    } 
    else if (project.event_type === "multiDay" && project.schedule.multiDay) {
      project.schedule.multiDay.forEach(day => {
        const [year, month, dayNum] = day.date.split('-').map(Number);
        
        day.slots.forEach(slot => {
          const [hours, minutes] = slot.startTime.split(':').map(Number);
          const sessionStart = new Date(year, month - 1, dayNum, hours, minutes);
          
          if (!earliestSessionTime || isBefore(sessionStart, earliestSessionTime)) {
            earliestSessionTime = sessionStart;
          }
        });
      });
    }
    else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
      const { date, roles } = project.schedule.sameDayMultiArea;
      const [year, month, day] = date.split('-').map(Number);
      
      roles.forEach(role => {
        const [hours, minutes] = role.startTime.split(':').map(Number);
        const sessionStart = new Date(year, month - 1, day, hours, minutes);
        
        if (!earliestSessionTime || isBefore(sessionStart, earliestSessionTime)) {
          earliestSessionTime = sessionStart;
        }
      });
    }
    
    if (earliestSessionTime) {
      const openTime = addHours(earliestSessionTime, -2);
      const diffMs = openTime.getTime() - now.getTime();
      
      if (diffMs > 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        return `${diffHours}h ${diffMinutes}m before event starts`;
      }
    }
    
    return "Not yet available";
  }, [project, isAttendanceAvailable]);

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
            <Button
              variant="outline"
              className="w-full sm:w-auto flex items-center justify-center gap-2"
              onClick={() => router.push(`/projects/${project.id}/documents`)}
            >
              <FileEdit className="h-4 w-4" />
              Manage Files
            </Button>
            
            {/* Add QR Code Button - only for QR code verification */}
            {project.verification_method === 'qr-code' && (
              <Button
                variant="outline"
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-chart-4/30 hover:bg-chart-4/20 border-chart-4/60"
                onClick={() => setQrCodeOpen(true)}
              >
                <QrCode className="h-4 w-4" />
                QR Check-In
              </Button>
            )}
            
            {/* Attendance Button - for QR code and manual methods */}
            {(project.verification_method === 'qr-code' || project.verification_method === 'manual') && (
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
            )}
            
            {/* Visual indicator for automatic check-in */}
            {project.verification_method === 'auto' && (
              <div className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto flex items-center justify-center gap-2 opacity-70 cursor-default"
                  disabled
                >
                  <Zap className="h-4 w-4" />
                  Automatic Check-in Enabled
                </Button>
              </div>
            )}

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
              </Tooltip>
            </TooltipProvider> */}
          </div>

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
    </div>
  );
}
