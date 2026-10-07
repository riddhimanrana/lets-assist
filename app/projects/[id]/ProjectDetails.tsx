"use client";

import type { WaiverSignatureInput } from "@/types";
import { AuthUser } from "@/lib/supabase/types";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { LocationMapCard } from "@/app/projects/_components/LocationMapCard";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/utils";
import { isOneTimeSlotPast, formatDateDisplay } from "@/utils/project";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignupConfirmationAction } from "@/app/projects/_components/useSignupConfirmationAction";
import FilePreview from "@/app/projects/_components/FilePreview";
import CreatorDashboard from "./CreatorDashboard";
import { ProjectDetailsAside } from "./ProjectDetailsAside";
import { ProjectDetailsHeader } from "./ProjectDetailsHeader";
import { ProjectDocumentsCard } from "./ProjectDocumentsCard";
import { ProjectEmailConfirmationDialog } from "./ProjectEmailConfirmationDialog";
import {
  ProjectSignupBar,
  ProjectSignupCta,
  type ProjectSignupCtaState,
} from "./ProjectSignupCta";
import UserDashboard from "./UserDashboard";
import { ProjectSignupForm } from "./ProjectForm";
import ProjectInstructionsModal from "./ProjectInstructionsModalWrapper";
import { SlotAttendeesDropdown } from "@/components/projects/SlotAttendeesDropdown";
import { SignupConfirmationModal } from "@/app/projects/_components/SignupConfirmationModal";
import { CancelSignupModal } from "@/app/projects/_components/CancelSignupModal";
import CalendarOptionsModal from "@/app/projects/_components/CalendarOptionsModal";
import { ReportContentButton } from "@/components/feedback/ReportContentButton";
import {
  EMPTY_DEMO_ATTENDEES,
  type ProjectDetailsProps,
} from "./project-details-types";
import { getScheduleSlotSummary } from "./project-schedule-summary";
import { ProjectSlotAction } from "./ProjectSlotAction";
import { ProjectSlotsCard } from "./ProjectSlotsCard";
import {
  ProjectAnonymousSignupDialog,
  ProjectResendConfirmationDialog,
  ProjectSignInDialog,
  ProjectSlotSelectionDialog,
} from "./ProjectSignupDialogs";
import { logSignupClientDebug } from "./signup-client-debug";
import { useAnonymousSlotOptions } from "./useAnonymousSlotOptions";
import { useProjectSignupState } from "./useProjectSignupState";
import { useProjectSignupSubmit } from "./useProjectSignupSubmit";
import {
  useProjectShare,
  useProjectSlotClick,
  useReopenSignupAfterOAuth,
} from "./useProjectSlotClick";
import { useProjectStatusSync } from "./useProjectStatusSync";
import { usePublicAttendees } from "./usePublicAttendees";
import { useResendConfirmation } from "./useResendConfirmation";

export default function ProjectDetails({
  project,
  creator,
  organization,
  initialSlotData,
  initialIsCreator,
  initialCanManageProject,
  initialUser,
  userSignupsData,
  allSignups = [],
  demoMode = false,
  demoPublicAttendees = EMPTY_DEMO_ATTENDEES,
}: ProjectDetailsProps) {
  const router = useRouter();
  const [isCreator] = useState(initialIsCreator);
  const [canManageProject] = useState(initialCanManageProject);
  const [user] = useState<AuthUser | null>(initialUser);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [anonymousSlotSelectionOpen, setAnonymousSlotSelectionOpen] =
    useState(false);
  const [currentScheduleId, setCurrentScheduleId] = useState<string>("");
  const [selectedAnonymousScheduleIds, setSelectedAnonymousScheduleIds] =
    useState<string[]>([]);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");

  const [showConfirmationAlert, setShowConfirmationAlert] = useState(false);
  const [confirmationEmailAccepted, setConfirmationEmailAccepted] =
    useState(false);

  const [showSignupConfirmation, setShowSignupConfirmation] = useState(false);
  const signupConfirmation = useSignupConfirmationAction();
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [pendingScheduleId, setPendingScheduleId] = useState<string>("");
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const calculatedStatus = useProjectStatusSync(project, canManageProject);
  const { getAttendeesForSlot, refetchAttendees } = usePublicAttendees({
    project,
    canManageProject,
    demoMode,
    demoPublicAttendees,
  });
  const {
    loadingStates,
    setLoadingStates,
    remainingSlots,
    setRemainingSlots,
    hasSignedUp,
    setHasSignedUp,
    rejectedSlots,
    attendedSlots,
    pendingSlots,
    waiverDefinition,
    completedSignup,
  } = useProjectSignupState({ project, user, initialSlotData });
  const resend = useResendConfirmation();
  const anonymousSlotOptions = useAnonymousSlotOptions({
    project,
    isCreator,
    calculatedStatus,
    hasSignedUp,
    rejectedSlots,
    attendedSlots,
    remainingSlots,
  });

  useReopenSignupAfterOAuth({
    projectId: project.id,
    user,
    setPendingScheduleId,
    setShowSignupConfirmation,
  });

  const closeAnonymousFlows = () => {
    setAnonymousSlotSelectionOpen(false);
    setAnonymousDialogOpen(false);
    setSelectedAnonymousScheduleIds([]);
    setCurrentScheduleId("");
  };

  const continueToAnonymousForm = () => {
    if (selectedAnonymousScheduleIds.length === 0) {
      toast.error("Select at least one slot to continue.");
      return;
    }

    setCurrentScheduleId(selectedAnonymousScheduleIds[0]);
    setAnonymousSlotSelectionOpen(false);
    setAnonymousDialogOpen(true);
  };

  const toggleAnonymousSlotSelection = (
    scheduleId: string,
    checked: boolean,
  ) => {
    setSelectedAnonymousScheduleIds((prev) => {
      if (checked) {
        return prev.includes(scheduleId) ? prev : [...prev, scheduleId];
      }
      return prev.filter((id) => id !== scheduleId);
    });
  };

  const { handleSignUp, handleAnonymousSubmit } = useProjectSignupSubmit({
    project,
    demoMode,
    currentScheduleId,
    selectedAnonymousScheduleIds,
    setLoadingStates,
    setHasSignedUp,
    setRemainingSlots,
    setShowConfirmationAlert,
    setConfirmationEmailAccepted,
    setAnonymousDialogOpen,
    setAnonymousSlotSelectionOpen,
    setShowSignupConfirmation,
    setResendAnonymousId: resend.setResendAnonymousId,
    setShowResendDialog: resend.setShowResendDialog,
    closeAnonymousFlows,
    refetchAttendees,
  });

  const { handleSignUpClick } = useProjectSlotClick({
    project,
    user,
    isCreator,
    calculatedStatus,
    hasSignedUp,
    rejectedSlots,
    attendedSlots,
    remainingSlots,
    anonymousSlotOptions,
    setCurrentScheduleId,
    setAuthDialogOpen,
    setSelectedAnonymousScheduleIds,
    setAnonymousDialogOpen,
    setAnonymousSlotSelectionOpen,
    setPendingScheduleId,
    setShowSignupConfirmation,
    setShowCancelConfirmation,
    resetSignupConfirmation: signupConfirmation.reset,
    handleSignUp,
  });
  const handleShare = useProjectShare(project);

  // Handle confirmation modal actions
  const handleConfirmSignup = async (
    comment?: string,
    waiverSignature?: WaiverSignatureInput | null,
    formData?: Record<string, unknown>,
  ) => {
    if (!pendingScheduleId) return;
    logSignupClientDebug({
      step: "confirmation_modal_submit",
      projectId: project.id,
      scheduleId: pendingScheduleId,
      hasComment: Boolean(comment),
      hasWaiverSignature: Boolean(waiverSignature),
      hasFormData: Boolean(formData && Object.keys(formData).length > 0),
    });
    await signupConfirmation.submit(
      handleSignUp,
      [pendingScheduleId, undefined, comment, waiverSignature, formData],
      () => {
        setShowSignupConfirmation(false);
        setPendingScheduleId("");
      },
    );
  };

  const handleCloseModals = () => {
    setShowSignupConfirmation(false);
    setShowCancelConfirmation(false);
    setPendingScheduleId("");
    signupConfirmation.reset();
  };

  // Redirect to auth pages
  const redirectToAuth = (path: "login" | "signup") => {
    sessionStorage.setItem("redirect_after_auth", window.location.href);
    router.push(
      `/${path}?redirect=${encodeURIComponent(window.location.pathname)}`,
    );
  };

  // Preview document
  const openPreview = (
    url: string,
    fileName: string = "Document",
    fileType: string = "",
  ) => {
    setPreviewDoc(url);
    setPreviewDocName(fileName);
    setPreviewDocType(fileType);
    setPreviewOpen(true);
  };

  const renderSlotAction = (scheduleId: string, isPast: boolean) => (
    <ProjectSlotAction
      projectTitle={project.title}
      creatorEmail={creator?.email}
      isCreator={isCreator}
      isPast={isPast}
      isCancelled={calculatedStatus === "cancelled"}
      isLoading={Boolean(loadingStates[scheduleId])}
      isSignedUp={Boolean(hasSignedUp[scheduleId])}
      isRejected={Boolean(rejectedSlots[scheduleId])}
      isAttended={Boolean(attendedSlots[scheduleId])}
      isPending={Boolean(pendingSlots[scheduleId])}
      isFull={remainingSlots[scheduleId] === 0}
      onClick={() => handleSignUpClick(scheduleId)}
    />
  );

  const showSlotAttendees = project.show_attendees_publicly || canManageProject;

  const oneTimeOpen =
    project.event_type === "oneTime" &&
    Boolean(project.schedule.oneTime) &&
    !hasSignedUp["oneTime"] &&
    !pendingSlots["oneTime"] &&
    !rejectedSlots["oneTime"] &&
    !attendedSlots["oneTime"] &&
    remainingSlots["oneTime"] !== 0 &&
    !isOneTimeSlotPast(project);
  const signupCta: ProjectSignupCtaState | null =
    isCreator ||
    calculatedStatus === "cancelled" ||
    calculatedStatus === "completed"
      ? null
      : project.event_type === "oneTime"
        ? oneTimeOpen
          ? {
              label: "Sign up",
              onClick: () => handleSignUpClick("oneTime"),
              loading: loadingStates["oneTime"],
            }
          : null
        : {
            label: "Choose a slot",
            onClick: () =>
              document
                .getElementById("volunteer-opportunities")
                ?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                  block: "start",
                }),
          };

  const enableSavedAnonymousInfoReuse = project.event_type !== "oneTime";
  const waiverProps = {
    waiverRequired: !!project.waiver_required,
    waiverAllowUpload: project.waiver_disable_esignature
      ? true
      : (project.waiver_allow_upload ?? true),
    waiverDisableEsignature: project.waiver_disable_esignature ?? false,
    waiverPdfUrl:
      waiverDefinition?.pdf_public_url || project.waiver_pdf_url || null,
    waiverDefinition,
    signupFormSchema: project.signup_form_schema,
  };

  return (
    <>
      <div className="container mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <ProjectEmailConfirmationDialog
          open={showConfirmationAlert}
          confirmationEmailAccepted={confirmationEmailAccepted}
          onOpenChange={setShowConfirmationAlert}
          onCopyLink={() => {
            copyToClipboard(window.location.href);
            toast.success("Project link copied to clipboard!");
          }}
        />

        <ProjectDetailsHeader
          title={project.title}
          status={calculatedStatus}
          when={formatDateDisplay(project)}
          location={project.location}
          hostName={
            project.organization?.name || creator?.full_name || "Anonymous"
          }
          hostIsOrganization={Boolean(project.organization)}
          hostVerified={Boolean(project.organization?.verified)}
          primaryAction={
            signupCta ? (
              <ProjectSignupCta cta={signupCta} className="hidden lg:flex" />
            ) : null
          }
          onShare={handleShare}
          onReport={
            canManageProject ? undefined : () => setIsReportDialogOpen(true)
          }
        />
        {/* Fixed Report Content Dialog - kept outside the menu so it stays mounted when the menu closes */}
        <ReportContentButton
          contentType="project"
          contentId={project.id}
          contentTitle={project.title}
          contentCreator={creator?.full_name || creator?.username || undefined}
          contentContext={organization?.name || undefined}
          open={isReportDialogOpen}
          onOpenChange={setIsReportDialogOpen}
          showTrigger={false}
        />

        {isCreator && (
          <CreatorDashboard
            project={project}
            allSignups={allSignups || []}
            canSyncProjectCalendar={isCreator}
          />
        )}
        {/* Render User Dashboard if user is logged in, NOT creator, and has signups */}
        {user &&
          !isCreator &&
          userSignupsData &&
          userSignupsData.length > 0 && (
            <UserDashboard
              project={project}
              user={user}
              signups={userSignupsData}
            />
          )}
        {/* Project Content */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Left Column */}
          <div className="grid content-start gap-6 lg:col-span-3">
            {/* About Section */}
            <section className="grid gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                About this project
              </h2>
              <RichTextContent
                content={project.description}
                className="text-muted-foreground max-w-prose text-sm"
              />
            </section>

            <ProjectSlotsCard
              project={project}
              calculatedStatus={calculatedStatus}
              remainingSlots={remainingSlots}
              headerAction={
                canManageProject ? null : (
                  <ProjectInstructionsModal
                    project={project}
                    isCreator={false}
                    buttonClassName="whitespace-nowrap"
                  />
                )
              }
              renderAction={renderSlotAction}
              renderAttendees={(scheduleId) =>
                showSlotAttendees ? (
                  <SlotAttendeesDropdown
                    attendees={getAttendeesForSlot(scheduleId)}
                  />
                ) : null
              }
            />
          </div>

          {/* Right Column */}
          <div className="grid content-start gap-6 lg:col-span-2">
            <ProjectDetailsAside
              project={project}
              creator={creator}
              eagerImage={Boolean(demoMode)}
              onPreviewImage={openPreview}
            />

            {/* Location Map */}
            <LocationMapCard
              location={project.location}
              locationData={project.location_data}
            />

            {/* Project Documents Section */}
            {project.documents && project.documents.length > 0 && (
              <ProjectDocumentsCard
                documents={project.documents}
                onPreview={openPreview}
              />
            )}
          </div>
        </div>
      </div>

      {signupCta && !demoMode ? (
        <ProjectSignupBar
          title={project.title}
          detail={formatDateDisplay(project)}
          cta={signupCta}
        />
      ) : null}

      <ProjectSignInDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        onLogin={() => redirectToAuth("login")}
        onCreateAccount={() => redirectToAuth("signup")}
      />

      <ProjectSlotSelectionDialog
        open={anonymousSlotSelectionOpen}
        onOpenChange={(open) => {
          setAnonymousSlotSelectionOpen(open);
          if (!open) {
            setSelectedAnonymousScheduleIds([]);
          }
        }}
        options={anonymousSlotOptions}
        selectedIds={selectedAnonymousScheduleIds}
        onToggle={toggleAnonymousSlotSelection}
        onCancel={closeAnonymousFlows}
        onContinue={continueToAnonymousForm}
      />

      <ProjectAnonymousSignupDialog
        open={anonymousDialogOpen}
        onOpenChange={(open) => {
          setAnonymousDialogOpen(open);
          if (!open) {
            closeAnonymousFlows();
          }
        }}
        selectedSlotCount={selectedAnonymousScheduleIds.length}
      >
        <ProjectSignupForm
          onSubmit={handleAnonymousSubmit}
          onCancel={closeAnonymousFlows}
          isSubmitting={loadingStates[currentScheduleId]}
          showCommentField={!!project.enable_volunteer_comments}
          enableSavedInfoReuse={enableSavedAnonymousInfoReuse}
          projectId={project.id}
          {...waiverProps}
        />
      </ProjectAnonymousSignupDialog>

      <ProjectResendConfirmationDialog resend={resend} />

      <FilePreview
        url={previewDoc || ""}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        fileName={previewDocName}
        fileType={previewDocType}
      />

      {pendingScheduleId && (
        <SignupConfirmationModal
          isOpen={showSignupConfirmation}
          onClose={handleCloseModals}
          onConfirm={handleConfirmSignup}
          enableVolunteerComments={!!project.enable_volunteer_comments}
          {...waiverProps}
          project={{
            id: project.id,
            title: project.title,
            location: project.location,
            ...getScheduleSlotSummary(project, pendingScheduleId),
          }}
          scheduleId={pendingScheduleId}
          isLoading={loadingStates[pendingScheduleId]}
          error={signupConfirmation.error}
        />
      )}

      {pendingScheduleId && user && (
        <CancelSignupModal
          isOpen={showCancelConfirmation}
          onClose={handleCloseModals}
          onSuccess={(scheduleId) => {
            setHasSignedUp((prev) => ({ ...prev, [scheduleId]: false }));
            setRemainingSlots((prev) => ({
              ...prev,
              [scheduleId]: (prev[scheduleId] || 0) + 1,
            }));
            refetchAttendees();
          }}
          project={{
            title: project.title,
            location: project.location,
            ...getScheduleSlotSummary(project, pendingScheduleId),
          }}
          projectId={project.id}
          scheduleId={pendingScheduleId}
          userId={user.id}
        />
      )}

      {/* Calendar options modal after successful signup */}
      {completedSignup && (
        <CalendarOptionsModal
          open={showCalendarModal}
          onOpenChange={setShowCalendarModal}
          project={project}
          signup={{
            id: completedSignup.signupId,
            schedule_id: completedSignup.scheduleId,
            project_id: project.id,
            user_id: user?.id || null,
            status: "approved",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            check_in_time: null,
            check_out_time: null,
          }}
          mode="volunteer"
        />
      )}
    </>
  );
}
