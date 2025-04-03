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
  AlertTriangle
} from "lucide-react";
import { useState } from "react";
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
import { differenceInHours } from "date-fns";
import { getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project";

interface Props {
  project: Project;
}

export default function CreatorDashboard({ project }: Props) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

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

            {!isCancelled && (
              <Button
                variant="destructive"
                className="w-full sm:w-auto flex items-center justify-center gap-2"
                onClick={() => setShowCancelDialog(true)}
                disabled={!canCancel}
              >
                <XCircle className="h-4 w-4" />
                Cancel Project
              </Button>
            )}

            <TooltipProvider>
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
            </TooltipProvider>
          </div>

          {isCancelled ? (
            <div className="flex flex-col sm:flex-row items-start gap-2 rounded-md border border-destructive p-3 sm:p-4 bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  This project has been cancelled. You can still edit details and manage existing signups,
                  but new signups are disabled. If this was a mistake, please contact <Link className="text-chart-3" href="mailto:support@lets-assist.com">support@lets-assist.com</Link>
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
            <AlertDialogDescription className="text-sm sm:text-base">
              This action cannot be undone. This will permanently delete your
              project and remove all data associated with it, including volunteer
              signups and documents.
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
    </div>
  );
}
