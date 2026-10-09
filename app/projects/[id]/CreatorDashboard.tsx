"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  CalendarCheck,
  Clock,
  Copy,
  Mail,
  MessageSquareText,
  ScanText,
} from "lucide-react";
import { differenceInHours, format, isAfter, isBefore } from "date-fns";
import { toast } from "sonner";

import { SquarePenIcon, useAnimatedIcon } from "@/components/icons/animated";
import { SectionHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CancelProjectDialog } from "@/app/projects/_components/CancelProjectDialog";
import CalendarOptionsModal from "@/app/projects/_components/CalendarOptionsModal";
import type { Project } from "@/types";
import {
  canDeleteProject,
  getProjectEndDateTime,
  getProjectStartDateTime,
} from "@/utils/project";
import { deleteProject } from "./actions";
import {
  getActiveUnpublishedSessions,
  type CreatorDashboardSignupSummary,
} from "./creator-dashboard-sessions";
import { CreatorDashboardNotices } from "./CreatorDashboardNotices";
import ProjectInstructionsModal from "./ProjectInstructionsModalWrapper";
import { ProjectQRCodeModal } from "./ProjectQRCodeModal";
import ProjectTimeline from "./ProjectTimeline";
import { useCreatorDashboardActions } from "./useCreatorDashboardActions";

interface Props {
  project: Project;
  allSignups?: CreatorDashboardSignupSummary[];
  canSyncProjectCalendar?: boolean;
}

const TOOL_BUTTON_CLASS = "w-full justify-start sm:w-auto";

/** Wraps a tool in a tooltip without making a disabled button unhoverable. */
function ToolTooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="w-full sm:w-auto" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{content}</TooltipContent>
    </Tooltip>
  );
}

export default function CreatorDashboard({
  project,
  allSignups = [],
  canSyncProjectCalendar = true,
}: Props) {
  const router = useRouter();
  const editIcon = useAnimatedIcon();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [qrCodeOpen, setQrCodeOpen] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const {
    isCloning,
    isCalendarSynced,
    setIsCalendarSynced,
    handleCancelProject,
    handleClone,
    handleContactAllSignups,
  } = useCreatorDashboardActions({
    project,
    canSyncProjectCalendar,
    onCancelled: () => setShowCancelDialog(false),
  });

  const handleDeleteProject = async () => {
    if (!canDeleteProject(project)) {
      toast.error(
        "Projects cannot be deleted 24 hours before start until 48 hours after end",
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

  const now = new Date();
  const startDateTime = getProjectStartDateTime(project);
  const endDateTime = getProjectEndDateTime(project);
  const hoursUntilStart = differenceInHours(startDateTime, now);

  const isCancelled = project.status === "cancelled";

  // --- Phases ---
  const isStartingSoon = hoursUntilStart <= 24 && isBefore(now, startDateTime); // Within 24 hours but not started
  const isInProgress =
    isAfter(now, startDateTime) && isBefore(now, endDateTime);
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

  const statusVariant = isCancelled
    ? "destructive"
    : isInProgress
      ? "warning"
      : isStartingSoon
        ? "info"
        : isCompleted
          ? "success"
          : "info";

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

  const activeUnpublishedSessionsInEditingWindow = useMemo(
    () => getActiveUnpublishedSessions(project, allSignups, now),
    [project, now, project.published, allSignups],
  );
  const hasActiveUnpublishedSessions =
    activeUnpublishedSessionsInEditingWindow.length > 0;
  const unpublishedCount = activeUnpublishedSessionsInEditingWindow.length;
  const unpublishedSummary = hasActiveUnpublishedSessions
    ? `${unpublishedCount} session${unpublishedCount === 1 ? "" : "s"} (${activeUnpublishedSessionsInEditingWindow.reduce(
        (acc, s) => acc + s.attendedCount,
        0,
      )} attended) need hours published.`
    : null;
  const completedNoticeShowsSummary =
    isCompleted && !isCancelled && project.verification_method !== "auto";
  const base = `/projects/${project.id}`;

  return (
    <section className="mb-6 grid gap-4" aria-label="Project dashboard">
      <SectionHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Project dashboard
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </span>
        }
        description="Manage your project, volunteers, and event logistics in one place."
        actions={
          <>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => router.push(`${base}/edit`)}
              {...editIcon.triggerProps}
            >
              <SquarePenIcon
                ref={editIcon.ref}
                size={16}
                data-icon="inline-start"
                aria-hidden="true"
              />
              Edit project
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              onClick={() => router.push(`${base}/signups`)}
            >
              Manage signups
            </Button>
          </>
        }
      />

      <StatStrip
        items={[
          {
            label: "Starts",
            value: format(startDateTime, "EEE, MMM d"),
            helper: format(startDateTime, "p"),
          },
          {
            label: "Ends",
            value: format(endDateTime, "EEE, MMM d"),
            helper: format(endDateTime, "p"),
          },
          {
            label: "Check-in",
            value: checkInLabel,
            helper: verificationLabel,
          },
        ]}
      />

      {isCancelled ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            <p>
              This project has been cancelled. You can still edit details and
              manage existing signups, but new signups are disabled and this
              project has been shut off. If this was a mistake, please contact{" "}
              <Link href="mailto:support@lets-assist.com">
                support@lets-assist.com
              </Link>
            </p>
            {project.cancellation_reason && (
              <p>
                <span className="font-medium">Reason:</span>{" "}
                {project.cancellation_reason}
              </p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {unpublishedSummary && !completedNoticeShowsSummary ? (
        <Alert variant="info">
          <Clock aria-hidden="true" />
          <AlertDescription>{unpublishedSummary}</AlertDescription>
        </Alert>
      ) : null}

      <CreatorDashboardNotices
        project={project}
        phase={{
          isCancelled,
          isStartingSoon,
          isInProgress,
          isCompleted,
          isCheckInOpen,
        }}
        hasActiveUnpublishedSessions={hasActiveUnpublishedSessions}
        unpublishedSummary={unpublishedSummary}
        onOpenQrCodes={() => setQrCodeOpen(true)}
      />

      <div
        className="grid gap-2 sm:flex sm:flex-wrap"
        role="group"
        aria-label="Project tools"
      >
        {hasActiveUnpublishedSessions &&
          project.verification_method !== "auto" && (
            <ToolTooltip
              content={
                <>
                  <p>
                    {unpublishedCount === 1
                      ? `Editing window open for: ${activeUnpublishedSessionsInEditingWindow[0].name}`
                      : `Editing windows open for ${unpublishedCount} sessions`}
                  </p>
                  <ul className="mt-1 grid gap-1">
                    {activeUnpublishedSessionsInEditingWindow.map((session) => (
                      <li key={session.id}>
                        {session.name}: {session.attendedCount} attended (
                        {session.hoursRemaining}h left)
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">
                    Click to review/edit hours before publishing.
                  </p>
                </>
              }
            >
              <Button
                variant="outline"
                className={TOOL_BUTTON_CLASS}
                onClick={() => router.push(`${base}/hours`)}
              >
                <Clock data-icon="inline-start" aria-hidden="true" />
                Manage hours
              </Button>
            </ToolTooltip>
          )}

        {isCompleted && !isCancelled && (
          <>
            <Button
              variant="outline"
              className={TOOL_BUTTON_CLASS}
              onClick={() => router.push(`${base}/paper-signups`)}
            >
              <ScanText data-icon="inline-start" aria-hidden="true" />
              Scan paper signups
            </Button>
            <Button
              variant="outline"
              className={TOOL_BUTTON_CLASS}
              onClick={() => router.push(`${base}/feedback`)}
            >
              <MessageSquareText data-icon="inline-start" aria-hidden="true" />
              Volunteer feedback
            </Button>
          </>
        )}

        <ToolTooltip
          content={
            <p>
              Open your email client with all volunteer emails pre-populated in
              BCC field
            </p>
          }
        >
          <Button
            variant="outline"
            className={TOOL_BUTTON_CLASS}
            onClick={handleContactAllSignups}
            disabled={isCancelled}
          >
            <Mail data-icon="inline-start" aria-hidden="true" />
            Contact all signups
          </Button>
        </ToolTooltip>

        {canSyncProjectCalendar && (
          <ToolTooltip
            content={
              <p>
                {isCalendarSynced
                  ? "This project is synced to your calendar. Click to manage or remove."
                  : "Add this project to your Google Calendar or download an iCal file"}
              </p>
            }
          >
            <Button
              variant="outline"
              className={TOOL_BUTTON_CLASS}
              onClick={() => setShowCalendarModal(true)}
            >
              {isCalendarSynced ? (
                <CalendarCheck
                  data-icon="inline-start"
                  className="text-success"
                  aria-hidden="true"
                />
              ) : (
                <Calendar data-icon="inline-start" aria-hidden="true" />
              )}
              {isCalendarSynced ? "Synced to calendar" : "Add to calendar"}
            </Button>
          </ToolTooltip>
        )}

        <Button
          variant="outline"
          className={TOOL_BUTTON_CLASS}
          onClick={handleClone}
          disabled={isCloning}
        >
          {isCloning ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" aria-hidden="true" />
          )}
          Clone project
        </Button>

        <ProjectInstructionsModal
          project={project}
          isCreator={true}
          buttonVariant="outline"
          buttonClassName={TOOL_BUTTON_CLASS}
        />
      </div>

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
              variant="destructive"
              onClick={handleDeleteProject}
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

      <ProjectTimeline
        project={project}
        open={timelineOpen}
        onOpenAction={setTimelineOpen}
      />

      {project.verification_method === "qr-code" && (
        <ProjectQRCodeModal
          project={project}
          open={qrCodeOpen}
          onOpenChange={setQrCodeOpen}
        />
      )}

      {canSyncProjectCalendar && (
        <CalendarOptionsModal
          open={showCalendarModal}
          onOpenChange={setShowCalendarModal}
          project={project}
          mode="creator"
          onSyncSuccess={() => setIsCalendarSynced(true)}
        />
      )}
    </section>
  );
}
