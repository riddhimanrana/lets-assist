"use client";
import { safeConsole } from "@/lib/safe-console";
import { useCreationSession } from "./use-creation-session";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useEventForm } from "@/hooks/use-event-form";
import type { EventFormState } from "@/hooks/use-event-form";
import AIAssistant, { AIParseResult } from "./AIAssistant";
// Replace shadcn toast with Sonner
import { toast } from "sonner";
import {
  createProject,
  publishWaiverStagedProject,
  uploadWaiverPdf,
  finalizeProject,
  checkProfanity,
} from "./actions";
import { saveWaiverDefinition } from "../[id]/actions";
import {
  clearStagedWaiverAttempt,
  createStagedWaiverAttempt,
  readStagedWaiverAttempt,
  writeStagedWaiverAttempt,
  type StagedWaiverAttempt,
} from "@/lib/projects/staged-waiver-attempt";
import type { Draft } from "./DraftsSidebar";
import { applyAIProjectData } from "./apply-ai-data";
import { getWaiverStepError } from "./create-blockers";
import { CreateActionBar } from "./CreateActionBar";
import { CreateHeader } from "./CreateHeader";
import {
  CreateStepContent,
  type CreateOrgOption,
  type CreatePluginStep,
} from "./CreateStepContent";
import { CreateStepper } from "./CreateStepper";
import { fileToBase64 } from "./file-base64";
import { useDraftAutosave } from "./use-draft-autosave";
import { useWaiverReuploadNotice } from "./use-draft-restore";
import { useOrganizationSteps } from "./use-organization-steps";
import { useProjectFileUploads } from "./use-project-file-uploads";
import { useStepValidation } from "./use-step-validation";

interface ProjectCreatorProps {
  creationSessionId: string;
  initialOrgId?: string;
  initialOrgOptions?: CreateOrgOption[];
  canUsePublicVisibility?: boolean;
  drafts?: Draft[];
  initialDraftData?: Partial<EventFormState>;
  initialDraftId?: string | null;
  pluginSteps?: CreatePluginStep[];
}

export default function ProjectCreator({
  creationSessionId,
  initialOrgId,
  initialOrgOptions,
  canUsePublicVisibility = true,
  drafts = [],
  initialDraftData,
  initialDraftId,
  pluginSteps = [],
}: ProjectCreatorProps) {
  const form = useEventForm({
    draft: initialDraftData,
    organizationId: initialOrgId,
  });
  const {
    state,
    nextStep,
    prevStep,
    setEventType,
    updateBasicInfo,
    addMultiDaySlot,
    addMultiDayEvent,
    addRole,
    updateOneTimeSchedule,
    updateMultiDaySchedule,
    updateMultiRoleSchedule,
    updateVerificationMethod,
    updateRequireLogin,
    updateVisibility,
    removeDay,
    removeRole,
    updateRecurrence,
  } = form;

  const { draftSession, updateDraftUrl, attemptStorage } = useCreationSession(
    creationSessionId,
    initialDraftId,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const uploads = useProjectFileUploads();
  const { uploadProjectFiles } = uploads;

  const [hasProfanity, setHasProfanity] = useState<boolean>(false);

  // AI Assistant state
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showLocationPointer, setShowLocationPointer] = useState(false);

  const showWaiverReuploadNotice = useWaiverReuploadNotice(
    initialDraftData,
    state,
  );
  // What still stops this project from being created because of its waiver.
  // The final step disables Create and says why.
  const waiverBlockedReason = getWaiverStepError(state);
  const totalSteps = 5 + pluginSteps.length;
  const finalStep = totalSteps;
  const stepLabels = useMemo(
    () => [
      "Basic info",
      "Event type",
      "Schedule",
      "Settings",
      ...pluginSteps.map((step) => step.title),
      "Finalize",
    ],
    [pluginSteps],
  );

  const validation = useStepValidation({
    state,
    finalStep,
    updateBasicInfo,
    updateOneTimeSchedule,
    updateMultiDaySchedule,
    updateMultiRoleSchedule,
  });
  const {
    setValidationAttempted,
    handleBasicInfoUpdate,
    handleOneTimeScheduleUpdate,
    handleMultiDayScheduleUpdate,
    handleMultiRoleScheduleUpdate,
    validateCurrentStep,
    validateAllSteps,
  } = validation;

  // Serialize state for change detection
  const stateSnapshot = useMemo(() => JSON.stringify(state), [state]);

  const getDraftSafeState = useCallback(
    (): Partial<EventFormState> => ({
      ...state,
      // Waiver configuration is persisted; uploaded PDF-specific data is intentionally not persisted in drafts.
      waiverPdfFile: null,
      waiverPdfUrl: null,
      waiverPdfValidation: null,
    }),
    [state],
  );

  // Keep UI state aligned with trust policy: non-trusted users cannot keep
  // public visibility selected in the editor.
  useEffect(() => {
    if (!canUsePublicVisibility && state.visibility === "public") {
      updateVisibility("unlisted");
    }
  }, [canUsePublicVisibility, state.visibility, updateVisibility]);

  const {
    autosaveDraftId,
    setAutosaveDraftId,
    autosaveStatus,
    setAutosaveStatus,
    autosaveTimerRef,
  } = useDraftAutosave({
    draftSession,
    updateDraftUrl,
    state,
    stateSnapshot,
    initialDraftId,
    isSubmitting,
    isSavingDraft,
    getDraftSafeState,
  });

  useOrganizationSteps({
    organizationId: state.basicInfo.organizationId || null,
    resolvedOrganizationId: initialOrgId || null,
    creationSessionId,
    draftSession,
    getDraftSafeState,
  });

  // Handle AI-generated data
  const handleApplyAIData = (data: AIParseResult) => {
    applyAIProjectData(data, {
      state,
      setEventType,
      addMultiDaySlot,
      addMultiDayEvent,
      addRole,
      removeDay,
      removeRole,
      updateVerificationMethod,
      updateRequireLogin,
      updateRecurrence,
      handleBasicInfoUpdate,
      handleOneTimeScheduleUpdate,
      handleMultiDayScheduleUpdate,
      handleMultiRoleScheduleUpdate,
    });

    // Close AI Assistant
    setShowAIAssistant(false);

    // Show a pointer to the location field to encourage manual verification/filling
    setShowLocationPointer(true);
  };

  // Handler for continuing to next step
  const handleNextStep = () => {
    // Validate current step before proceeding
    const isValid = validateCurrentStep();

    if (isValid || state.step === 5 + pluginSteps.length) {
      nextStep();
      // Reset validation attempted since we're moving to a new step
      setValidationAttempted(false);
    }
  };

  // The attempt lives in browser storage, not in a ref, so a reload between
  // creating the staged row and publishing it resumes the same project instead
  // of stranding an invisible draft and inserting a duplicate on retry.

  const persistAttempt = (attempt: StagedWaiverAttempt) => {
    writeStagedWaiverAttempt(attemptStorage(), attempt);
    return attempt;
  };

  /**
   * Uploads the waiver PDF, saves its configuration, and asks the server to
   * publish the staged project. Returns a user-facing reason on failure and
   * null once the project is genuinely published.
   *
   * The upload is skipped when this attempt already attached its waiver, so a
   * retry after a failed publication does not upload a second copy and orphan
   * the first. The signature placements are saved on every attempt that has
   * them: a first attempt may have had none, and a retry has to be able to
   * supply them.
   */
  const completeWaiverPublication = async (
    projectId: string,
    attempt: StagedWaiverAttempt,
  ): Promise<string | null> => {
    try {
      if (state.waiverPdfFile && !attempt.waiverAttached) {
        const waiverBase64 = await fileToBase64(state.waiverPdfFile);
        const waiverResult = await uploadWaiverPdf(
          projectId,
          waiverBase64,
          state.waiverPdfFile.name,
        );

        if (waiverResult.error) {
          return waiverResult.error;
        }

        persistAttempt({ ...attempt, waiverAttached: true });
        attempt.waiverAttached = true;
      }

      if (state.waiverDefinition) {
        const defResult = await saveWaiverDefinition(
          projectId,
          state.waiverDefinition,
        );

        if (defResult.error) {
          return defResult.error;
        }
      }

      const publishResult = await publishWaiverStagedProject(projectId);
      return publishResult.error ?? null;
    } catch (error) {
      safeConsole.error("Error completing waiver publication:", error);
      return "The waiver could not be attached. Please try again.";
    }
  };

  const handleSubmit = async () => {
    if (draftSession.publishing) return;
    if (state.step !== finalStep) {
      handleNextStep();
      return;
    }

    // Final validation of all steps before submission
    if (!validateAllSteps()) {
      toast.error("Please fix all validation errors before submitting");
      return;
    }

    try {
      if (waiverBlockedReason) {
        toast.error(waiverBlockedReason);
        return;
      }

      setIsSubmitting(true);
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      await draftSession.beginPublication();

      const profanityToast = toast.loading(
        "Checking content for inappropriate language...",
      );
      const profanityCheck = await checkProfanity({
        title: state.basicInfo.title || "",
        location: state.basicInfo.location || "",
        description: state.basicInfo.description || "",
      });
      toast.dismiss(profanityToast);

      if (!profanityCheck.success || profanityCheck.hasProfanity) {
        setHasProfanity(profanityCheck.hasProfanity);
        toast.error(
          profanityCheck.error ||
            "Please fix the flagged content before creating your project",
        );
        setIsSubmitting(false);
        return;
      }

      setHasProfanity(false);

      // Prevent any pending autosave from firing during submission
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      // Show loading toast
      const loadingToast = toast.loading("Creating your project...");

      // Step 1: Create basic project without files
      const formData = new FormData();
      formData.append("projectData", JSON.stringify(state));

      // The same attempt key is replayed until the project is published, so a
      // reload or a retry finishes the row an earlier attempt created rather
      // than inserting another one.
      const storage = attemptStorage();
      const attempt = persistAttempt(
        readStagedWaiverAttempt(storage) ??
          createStagedWaiverAttempt(crypto.randomUUID()),
      );

      formData.append("creationIdempotencyKey", attempt.idempotencyKey);

      const result = await createProject(formData);

      if ("error" in result) {
        toast.dismiss(loadingToast);
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      const projectId = result.id ?? null;
      const stagedForWaiver =
        "requiresWaiverPublication" in result &&
        Boolean(result.requiresWaiverPublication);

      if (!projectId) {
        toast.dismiss(loadingToast);
        toast.error("Failed to create project.");
        setIsSubmitting(false);
        return;
      }

      persistAttempt({ ...attempt, projectId });
      attempt.projectId = projectId;

      let hasErrors = false;

      // Step 2: Upload files directly to storage and link metadata to the
      // project. Skipped on a retry that already uploaded them, so a second
      // press does not duplicate the cover image and documents.
      if (!attempt.uploadedFiles) {
        const fileUploadResult = await uploadProjectFiles(projectId);
        hasErrors = hasErrors || fileUploadResult.hasErrors;

        if (!fileUploadResult.hasErrors) {
          persistAttempt({ ...attempt, uploadedFiles: true });
          attempt.uploadedFiles = true;
        }
      }

      // Step 3: Attach the real waiver PDF and its configuration, then ask the
      // database to publish the staged row. Until that succeeds the project
      // stays unpublished: not publicly readable and not signable.
      if (stagedForWaiver) {
        const publicationError = await completeWaiverPublication(
          projectId,
          attempt,
        );

        if (publicationError) {
          toast.dismiss(loadingToast);
          toast.error(publicationError, {
            description:
              "The project was saved but is not published yet. Fix the waiver and press Create again.",
            duration: 8000,
          });
          setIsSubmitting(false);
          return;
        }
      }

      clearStagedWaiverAttempt(storage);

      // Step 5: Finalize project (non-blocking)
      finalizeProject(projectId).catch((error) => {
        safeConsole.error("Error finalizing project:", error);
      });

      const deleteResult = await draftSession.consume();
      setAutosaveDraftId(draftSession.id);
      setAutosaveStatus("idle");
      if (deleteResult.error)
        toast.warning("Project created. Its draft could not be removed.");

      // Dismiss loading toast and show success
      toast.dismiss(loadingToast);
      const message = hasErrors
        ? "Project created but some files couldn't be uploaded"
        : "Project Created Successfully!";

      if (hasErrors) {
        toast.warning(message);
      } else {
        toast.success(message);
      }

      // Reset form state
      setIsSubmitting(false);

      // Force a full page redirect using window.location.href instead of Next.js router
      // This ensures the page fully loads on production
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/projects/${projectId}`;
    } catch (error) {
      safeConsole.error("Error submitting project:", error);
      toast.dismiss();
      toast.error("Something went wrong. Please try again.");
      setIsSubmitting(false);
    } finally {
      draftSession.endPublication();
    }
  };

  // Handle saving as draft - with minimal validation
  const handleSaveDraft = async () => {
    // Only require a title for drafts
    if (!state.basicInfo.title || state.basicInfo.title.trim() === "") {
      toast.error("Please enter a title to save as draft");
      return;
    }

    if (state.waiverRequired) {
      toast.error("Projects that require waivers can't be saved as drafts.");
      return;
    }

    try {
      setIsSavingDraft(true);
      const loadingToast = toast.loading("Saving new draft...");

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const result = await draftSession.copy(getDraftSafeState());

      if ("error" in result) {
        toast.dismiss(loadingToast);
        toast.error(result.error);
        setIsSavingDraft(false);
        return;
      }

      toast.dismiss(loadingToast);
      setAutosaveDraftId(draftSession.id);
      toast.success("New draft saved. Further edits will update this draft.");
      updateDraftUrl(draftSession.id);

      setIsSavingDraft(false);
    } catch (error) {
      safeConsole.error("Error saving draft:", error);
      toast.dismiss();
      toast.error("Failed to save draft. Please try again.");
      setIsSavingDraft(false);
    }
  };

  const saveDraftBlockedReason = state.waiverRequired
    ? "Projects that require waivers can't be saved as drafts."
    : !state.basicInfo.title?.trim()
      ? "Please enter a title to save as draft"
      : undefined;

  return (
    <div className="grid gap-6">
      <CreateHeader
        drafts={drafts}
        showAIButton={state.step === 1}
        isAIAssistantOpen={showAIAssistant}
        onToggleAIAssistant={() => setShowAIAssistant(!showAIAssistant)}
        onSaveDraft={handleSaveDraft}
        isSavingDraft={isSavingDraft}
        saveDraftDisabled={
          isSubmitting ||
          isSavingDraft ||
          !state.basicInfo.title?.trim() ||
          state.waiverRequired
        }
        saveDraftBlockedReason={saveDraftBlockedReason}
      />

      <CreateStepper steps={stepLabels} current={state.step} />

      {/* AI Assistant Component */}
      {state.step === 1 && (
        <AIAssistant
          isOpen={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          onApplyData={handleApplyAIData}
          projectTimezone={state.basicInfo.projectTimezone}
        />
      )}

      <CreateStepContent
        form={form}
        validation={validation}
        uploads={uploads}
        pluginSteps={pluginSteps}
        finalStep={finalStep}
        initialOrgOptions={initialOrgOptions}
        canUsePublicVisibility={canUsePublicVisibility}
        showLocationPointer={showLocationPointer}
        onLocationPointerDismiss={() => setShowLocationPointer(false)}
        showWaiverReuploadNotice={showWaiverReuploadNotice}
        hasProfanity={hasProfanity}
      />

      <CreateActionBar
        isFinalStep={state.step === finalStep}
        isSubmitting={isSubmitting}
        backDisabled={state.step === 1 || isSubmitting || isSavingDraft}
        primaryDisabled={
          isSubmitting ||
          isSavingDraft ||
          (state.step === finalStep && Boolean(waiverBlockedReason))
        }
        blockedReason={
          state.step === finalStep
            ? (waiverBlockedReason ?? undefined)
            : undefined
        }
        autosaveStatus={autosaveDraftId ? autosaveStatus : null}
        onBack={prevStep}
        onPrimary={handleSubmit}
      />
    </div>
  );
}
