"use client";
import { safeConsole } from "@/lib/safe-console";

import { Project, ProjectSchedule } from "@/types";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { stripHtml } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { AlertTriangle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { updateProject, deleteProject, updateProjectStatus } from "../actions";
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
import { CancelProjectDialog } from "@/app/projects/_components/CancelProjectDialog";
import {
  canDeleteProject,
  isWithinDeletionRestrictionWindow,
} from "@/utils/project";
import { updateCalendarEventForProject } from "@/utils/calendar-helpers";
import Schedule from "@/app/projects/create/Schedule";
import FilePreview from "@/app/projects/_components/FilePreview";
import { WaiverBuilderDialog } from "@/components/waiver/WaiverBuilderDialog";
import { buildRecurrenceRuleFromState } from "@/lib/projects/recurrence";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";
import {
  formSchema,
  initializeRecurrenceState,
  initializeScheduleState,
  type FormValues,
} from "./edit-project-form";
import { EditProjectDanger } from "./EditProjectDanger";
import { EditProjectDetails } from "./EditProjectDetails";
import { EditProjectMediaSection } from "./EditProjectMediaSection";
import { EditProjectWaiver } from "./EditProjectWaiver";
import { useEditProjectMedia } from "./useEditProjectMedia";
import { useEditProjectSchedule } from "./useEditProjectSchedule";

interface Props {
  project: Project;
}

export default function EditProjectClient({ project }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [titleChars, setTitleChars] = useState(project.title.length);
  const [locationChars, setLocationChars] = useState(project.location.length);
  const [hasChanges, setHasChanges] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const schedule = useEditProjectSchedule(project);
  const { scheduleState, recurrenceState, scheduleErrors, setScheduleErrors } =
    schedule;
  const media = useEditProjectMedia(project);

  // Helper function to check if HTML content is empty
  const isHTMLEmpty = (html: string) => {
    // Remove HTML tags and trim whitespace using safe stripHtml function
    const text = stripHtml(html);
    return !text;
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: project.title,
      description: project.description,
      location: project.location,
      location_data: project.location_data || {
        text: project.location,
        display_name: project.location,
      },
      require_login: project.require_login,
      enable_volunteer_comments: project.enable_volunteer_comments ?? false,
      show_attendees_publicly: project.show_attendees_publicly ?? false,
      waiver_required: project.waiver_required ?? false,
      waiver_allow_upload: true,
      waiver_disable_esignature: project.waiver_disable_esignature ?? false,
      verification_method: project.verification_method,
      visibility: project.visibility,
    },
  });

  useEffect(() => {
    if (form.getValues("waiver_allow_upload") !== true) {
      form.setValue("waiver_allow_upload", true, { shouldDirty: false });
    }
  }, [form]);

  // Track form changes (including schedule)
  useEffect(() => {
    const subscription = form.watch(() => {
      const formValues = form.getValues();
      const basicInfoChanged =
        formValues.title !== project.title ||
        formValues.description !== project.description ||
        formValues.location !== project.location ||
        JSON.stringify(formValues.location_data) !==
          JSON.stringify(project.location_data) ||
        formValues.require_login !== project.require_login ||
        formValues.enable_volunteer_comments !==
          (project.enable_volunteer_comments ?? false) ||
        formValues.show_attendees_publicly !==
          (project.show_attendees_publicly ?? false) ||
        formValues.waiver_required !== (project.waiver_required ?? false) ||
        formValues.waiver_allow_upload !==
          (project.waiver_allow_upload ?? true) ||
        formValues.waiver_disable_esignature !==
          (project.waiver_disable_esignature ?? false) ||
        formValues.verification_method !== project.verification_method ||
        formValues.visibility !== project.visibility;

      const initialSchedule = initializeScheduleState(project);
      const initialRecurrence = initializeRecurrenceState(project);
      const scheduleChanged =
        JSON.stringify(scheduleState) !== JSON.stringify(initialSchedule);
      const recurrenceChanged =
        JSON.stringify(recurrenceState) !== JSON.stringify(initialRecurrence);

      setHasChanges(basicInfoChanged || scheduleChanged || recurrenceChanged);
    });
    return () => subscription.unsubscribe();
  }, [form, project, scheduleState, recurrenceState]);

  // Separate effect to track schedule changes independently
  useEffect(() => {
    const initialSchedule = initializeScheduleState(project);
    const initialRecurrence = initializeRecurrenceState(project);
    const scheduleChanged =
      JSON.stringify(scheduleState) !== JSON.stringify(initialSchedule);
    const recurrenceChanged =
      JSON.stringify(recurrenceState) !== JSON.stringify(initialRecurrence);

    const formValues = form.getValues();
    const basicInfoChanged =
      formValues.title !== project.title ||
      formValues.description !== project.description ||
      formValues.location !== project.location ||
      JSON.stringify(formValues.location_data) !==
        JSON.stringify(project.location_data) ||
      formValues.require_login !== project.require_login ||
      formValues.enable_volunteer_comments !==
        (project.enable_volunteer_comments ?? false) ||
      formValues.show_attendees_publicly !==
        (project.show_attendees_publicly ?? false) ||
      formValues.waiver_required !== (project.waiver_required ?? false) ||
      formValues.waiver_allow_upload !==
        (project.waiver_allow_upload ?? true) ||
      formValues.waiver_disable_esignature !==
        (project.waiver_disable_esignature ?? false) ||
      formValues.verification_method !== project.verification_method ||
      formValues.visibility !== project.visibility;

    setHasChanges(basicInfoChanged || scheduleChanged || recurrenceChanged);
  }, [scheduleState, recurrenceState, form, project]);

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    setScheduleErrors([]);

    try {
      // Build schedule object based on event type
      let schedule: ProjectSchedule = {};
      const eventType = project.event_type;

      if (eventType === "oneTime") {
        schedule = { oneTime: scheduleState.oneTime };
      } else if (eventType === "multiDay") {
        schedule = { multiDay: scheduleState.multiDay };
      } else if (eventType === "sameDayMultiArea") {
        schedule = { sameDayMultiArea: scheduleState.sameDayMultiArea };
      }

      // Build recurrence rule payload (null means explicitly disable recurrence)
      const recurrenceRule = buildRecurrenceRuleFromState(recurrenceState);

      // Combine form values with schedule
      const updates: Partial<Project> = {
        ...values,
        schedule,
        recurrence_rule: recurrenceRule,
        ...(recurrenceRule === null && project.recurrence_rule !== null
          ? {
              recurrence_generation_id: project.recurrence_generation_id,
            }
          : {}),
      };

      const result = await updateProject(project.id, updates);
      if (result.error) {
        toast.error(result.error);
      } else {
        if (result.endedRecurringSeries) {
          const cancelled =
            typeof result.cancelledOccurrences === "number"
              ? result.cancelledOccurrences
              : 0;
          toast.success(
            `Recurring series ended. ${cancelled} upcoming occurrence${cancelled === 1 ? "" : "s"} cancelled.`,
          );
        } else {
          toast.success("Project updated successfully");
        }

        // Update calendar event if details changed (non-blocking)
        try {
          await updateCalendarEventForProject(project.id);
        } catch (calendarError) {
          safeConsole.error("Error updating calendar event:", calendarError);
          // Don't show error to user - this is non-critical
        }

        router.push(`/projects/${project.id}`);
        router.refresh();
      }
    } catch {
      toast.error("Failed to update project");
    } finally {
      setSaving(false);
    }
  };

  // Check if form is valid and has all required fields
  const isFormValid =
    form.formState.isValid &&
    form.getValues().title?.trim() &&
    form.getValues().location?.trim() &&
    !isHTMLEmpty(form.getValues().description || "");

  // Add handlers for cancel and delete project
  const handleCancelProject = async (reason: string) => {
    try {
      const result = await updateProjectStatus(project.id, "cancelled", reason);
      if (result.error) {
        toast.error(result.error);
      } else {
        const notificationStatus = result.cancellationNotifications;
        if (notificationStatus?.enqueued) {
          toast.success(
            "Project cancelled successfully. Approved volunteers will be emailed shortly.",
          );
          if (notificationStatus.error) {
            toast.warning(notificationStatus.error);
          }
        } else {
          toast.success("Project cancelled successfully.");
          toast.warning(
            notificationStatus?.error ||
              "We couldn't queue cancellation emails. Please try again shortly.",
          );
        }
        setShowCancelDialog(false);
        router.push(`/projects/${project.id}`);
        router.refresh();
      }
    } catch {
      toast.error("Failed to cancel project");
    }
  };

  const handleDeleteProject = async () => {
    if (!canDeleteProject(project)) {
      toast.error(
        "Projects cannot be deleted within 24 hours before start until 48 hours after end",
      );
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
        router.replace("/home");
      }
    } catch {
      toast.error("Failed to delete project");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const isInDeletionRestrictionPeriod =
    isWithinDeletionRestrictionWindow(project);
  const canDelete = canDeleteProject(project);
  const isCancelled = project.status === "cancelled";
  const waiverPdfUrl = media.waiverPdfUrl || project.waiver_pdf_url;

  return (
    <div className="container mx-auto grid max-w-4xl gap-8 px-4 py-6 sm:px-6">
      <PageHeader
        breadcrumb={
          <ProjectToolBreadcrumb
            projectId={project.id}
            projectTitle={project.title}
            current="Edit"
          />
        }
        title="Edit project"
        description="Update the details of your project"
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-8">
        <EditProjectDetails
          form={form}
          hasOrganization={Boolean(project.organization_id)}
          titleChars={titleChars}
          locationChars={locationChars}
          onTitleChars={setTitleChars}
          onLocationChars={setLocationChars}
        />

        <EditProjectWaiver
          form={form}
          media={media}
          projectWaiverPdfUrl={project.waiver_pdf_url}
        />

        <div className="grid gap-4">
          <Schedule
            state={{
              eventType: project.event_type,
              schedule: scheduleState,
              recurrence: recurrenceState,
            }}
            updateOneTimeScheduleAction={schedule.updateOneTimeSchedule}
            updateMultiDayScheduleAction={schedule.updateMultiDaySchedule}
            updateMultiRoleScheduleAction={schedule.updateMultiRoleSchedule}
            addMultiDaySlotAction={schedule.addMultiDaySlot}
            addMultiDayEventAction={schedule.addMultiDayEvent}
            addRoleAction={schedule.addRole}
            removeDayAction={schedule.removeDay}
            removeSlotAction={schedule.removeSlot}
            removeRoleAction={schedule.removeRole}
            updateRecurrenceAction={schedule.updateRecurrence}
            errors={scheduleErrors}
          />
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Important</AlertTitle>
            <AlertDescription>
              Changing dates or times may affect volunteers who have already
              signed up. Consider notifying them of any changes. Reducing
              volunteer capacity below current signups is not recommended.
            </AlertDescription>
          </Alert>
        </div>

        <EditProjectMediaSection project={project} media={media} />

        {/* The form's one Save action. It stays in reach while the form
            scrolls and lets go before the danger section. */}
        <div className="bg-card sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex flex-col gap-3 rounded-xl border p-3 shadow-md sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {hasChanges ? "You have unsaved changes." : "No changes to save."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 sm:flex-none"
              disabled={saving || !hasChanges || !isFormValid}
            >
              {saving && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </div>
        </div>
      </form>

      <EditProjectDanger
        isCancelled={isCancelled}
        cancellationReason={project.cancellation_reason}
        canDelete={canDelete}
        isDeleting={isDeleting}
        isInDeletionRestrictionPeriod={isInDeletionRestrictionPeriod}
        onCancelProject={() => setShowCancelDialog(true)}
        onDeleteProject={() => setShowDeleteDialog(true)}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              project and remove all data associated with it, including
              volunteer signups and documents. If you need to cancel or
              reschedule, we recommend you cancel the project instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              variant="destructive"
            >
              {isDeleting ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Deleting...
                </>
              ) : (
                "Delete project"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CancelProjectDialog
        project={project}
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={handleCancelProject}
      />

      <FilePreview
        url={media.previewDoc || ""}
        open={media.previewOpen}
        onOpenChange={media.setPreviewOpen}
        fileName={media.previewDocName}
        fileType={media.previewDocType}
      />

      {waiverPdfUrl && (
        <WaiverBuilderDialog
          open={media.waiverBuilderOpen}
          onOpenChange={media.setWaiverBuilderOpen}
          pdfFile={null}
          pdfUrl={waiverPdfUrl}
          existingDefinition={media.waiverDefinition ?? undefined}
          detectedFields={media.lastDetectedFields}
          onSave={media.handleWaiverSave}
        />
      )}
    </div>
  );
}
