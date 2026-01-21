"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useEventForm } from "@/hooks/use-event-form";
import type { EventFormState } from "@/hooks/use-event-form";
import BasicInfo from "./BasicInfo";
import EventTypeStep from "./EventType";
import Schedule from "./Schedule";
import Finalize from "./Finalize";
import VerificationSettings from "./VerificationSettings";
import AIAssistant, { AIParseResult } from "./AIAssistant";
// shadcn components
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
// icon components
import { Loader2, ChevronLeft, ChevronRight, AlertCircle, Sparkles, Save } from "lucide-react";
// utility
import { cn } from "@/lib/utils";
// Replace shadcn toast with Sonner
import { toast } from "sonner";
import { createProject, uploadCoverImage, uploadProjectDocument, uploadWaiverPdf, finalizeProject, saveProjectAsNewDraft, autoSaveDraft } from "./actions";
import { useRouter } from "next/navigation";
// Import Zod schemas
import {
  basicInfoSchema,
  oneTimeSchema,
  multiDaySchema,
  multiRoleSchema,
  verificationSettingsSchema
} from "@/schemas/event-form-schema";
import { z } from "zod";
import DraftsSidebar from "./DraftsSidebar";
import type { ProjectSchedule, EventType } from "@/types";

interface Draft {
  id: string;
  title: string;
  description: string;
  location: string;
  event_type: EventType;
  schedule: ProjectSchedule | null;
  cover_image_url: string | null;
  created_at: string;
  workflow_status: string;
  organization: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
}

interface ProjectCreatorProps {
  initialOrgId?: string;
  initialOrgOptions?: {
    id: string;
    name: string;
    logo_url?: string | null;
    role: string;
    allowed_email_domains?: string[] | null;
  }[];
  drafts?: Draft[];
  initialDraftData?: Partial<EventFormState>;
  initialDraftId?: string | null;
}

export default function ProjectCreator({ initialOrgId, initialOrgOptions, drafts = [], initialDraftData, initialDraftId }: ProjectCreatorProps) {
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
    removeSlot,
    removeRole,

    updateRestrictToOrgDomains,

    updateEnableVolunteerComments,
    updateShowAttendeesPublicly,
    updateWaiverRequired,
    updateWaiverAllowUpload,
    updateWaiverPdfFile,
    updateWaiverPdfValidation,
    clearWaiverPdf,
    updateRecurrence,
    loadDraftState,
  } = useEventForm();

  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // File handling states
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [documents, setDocuments] = useState<File[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _AUTOSAVE_KEY = "project-autosave";

  // Form validation states
  const [basicInfoErrors, setBasicInfoErrors] = useState<z.ZodIssue[]>([]);
  const [scheduleErrors, setScheduleErrors] = useState<z.ZodIssue[]>([]);
  const [verificationErrors, setVerificationErrors] = useState<z.ZodIssue[]>([]);

  // Validation tracking - only validate after continue is clicked
  const [validationAttempted, setValidationAttempted] = useState(false);

  const [hasProfanity, setHasProfanity] = useState<boolean>(false);

  // AI Assistant state
  const [showAIAssistant, setShowAIAssistant] = useState(false);

  // Autosave state - initialize with loaded draft ID if available
  const [autosaveDraftId, setAutosaveDraftId] = useState<string | undefined>(initialDraftId || undefined);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_lastAutosaveTime, setLastAutosaveTime] = useState<Date | null>(null);

  type AIScheduleSlot = { startTime: string; endTime: string; volunteers: number };
  type AIScheduleDay = { date: string; slots?: AIScheduleSlot[] };
  type AIScheduleRole = { name: string; startTime: string; endTime: string; volunteers: number };
  type AIScheduleSameDay = { date: string; overallStart?: string; overallEnd?: string; roles?: AIScheduleRole[] };
  type AIScheduleOneTime = { date: string; startTime?: string; endTime?: string; volunteers?: number };

  // Load draft data on mount if provided
  const draftLoadedRef = useRef(false);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Guard to prevent infinite update loops when hydrating draft state
    if (initialDraftData && loadDraftState && !draftLoadedRef.current) {
      draftLoadedRef.current = true;
      loadDraftState(initialDraftData);
      // Show success toast after a brief delay to ensure UI is ready
      setTimeout(() => {
        toast.success('Draft restored!', {
          description: 'Your previous progress has been loaded. Continue where you left off!',
        });
      }, 500);
    }
  }, [initialDraftData, loadDraftState]);

  // Serialize state for change detection
  const stateSnapshot = useMemo(() => JSON.stringify(state), [state]);
  const previousStateRef = useRef<string>("");

  // Autosave to database on state changes (debounced and change-based)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!state) return;

    // Skip autosave if there's no title
    if (!state.basicInfo.title || state.basicInfo.title.trim() === '') {
      return;
    }

    // Only autosave if state has actually changed
    if (previousStateRef.current === stateSnapshot) {
      return;
    }

    // Update previous state reference
    previousStateRef.current = stateSnapshot;

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // Debounce autosave by 3 seconds
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setAutosaveStatus('saving');
        
        const result = await autoSaveDraft(state, autosaveDraftId);
        
        if (result.autosaved && result.id) {
          // Set the draft ID if this is the first autosave
          if (!autosaveDraftId) {
            setAutosaveDraftId(result.id);
          }
          
          setAutosaveStatus('saved');
          setLastAutosaveTime(new Date());
          
          // Clear saved status after 3 seconds
          setTimeout(() => {
            setAutosaveStatus(prev => prev === 'saved' ? 'idle' : prev);
          }, 3000);
        } else if (result.error) {
          setAutosaveStatus('error');
          console.warn('Autosave error:', result.error);
          
          // Clear error status after 5 seconds
          setTimeout(() => {
            setAutosaveStatus(prev => prev === 'error' ? 'idle' : prev);
          }, 5000);
        }
      } catch (err) {
        console.error("Failed to autosave draft", err);
        setAutosaveStatus('error');
        setTimeout(() => {
          setAutosaveStatus(prev => prev === 'error' ? 'idle' : prev);
        }, 5000);
      }
    }, 3000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [stateSnapshot, state, autosaveDraftId]);

  // Add handler to update profanity state
  const handleProfanityResult = (hasIssues: boolean) => {
    setHasProfanity(hasIssues);
  };

  // Handle AI-generated data
  const handleApplyAIData = (data: AIParseResult) => {
    // Apply basic info
    if (data.title) {
      handleBasicInfoUpdate('title', data.title);
    }
    if (data.location) {
      handleBasicInfoUpdate('location', data.location);
    }
    if (data.description) {
      handleBasicInfoUpdate('description', data.description);
    }

    // Apply event type
    if (data.eventType) {
      setEventType(data.eventType);
    }

    // Apply schedule based on event type
    if (data.schedule && data.eventType) {
      if (data.eventType === 'oneTime' && (data.schedule as AIScheduleOneTime).date) {
        const schedule = data.schedule as AIScheduleOneTime;
        handleOneTimeScheduleUpdate('date', schedule.date);
        if (schedule.startTime) handleOneTimeScheduleUpdate('startTime', schedule.startTime);
        if (schedule.endTime) handleOneTimeScheduleUpdate('endTime', schedule.endTime);
        if (schedule.volunteers) handleOneTimeScheduleUpdate('volunteers', schedule.volunteers);
      } else if (data.eventType === 'multiDay' && Array.isArray(data.schedule)) {
        // Clear existing days first
        const currentDays = state.schedule.multiDay.length;
        for (let i = currentDays - 1; i >= 0; i--) {
          removeDay(i);
        }

        // Add new days from AI
        (data.schedule as AIScheduleDay[]).forEach((day, dayIndex) => {
          if (dayIndex === 0) {
            // Update first day
            handleMultiDayScheduleUpdate(0, 'date', day.date);
            if (Array.isArray(day.slots)) {
              day.slots.forEach((slot, slotIndex) => {
                if (slotIndex === 0) {
                  handleMultiDayScheduleUpdate(0, 'startTime', slot.startTime, 0);
                  handleMultiDayScheduleUpdate(0, 'endTime', slot.endTime, 0);
                  handleMultiDayScheduleUpdate(0, 'volunteers', slot.volunteers, 0);
                } else {
                  addMultiDaySlot(0);
                  handleMultiDayScheduleUpdate(0, 'startTime', slot.startTime, slotIndex);
                  handleMultiDayScheduleUpdate(0, 'endTime', slot.endTime, slotIndex);
                  handleMultiDayScheduleUpdate(0, 'volunteers', slot.volunteers, slotIndex);
                }
              });
            }
          } else {
            addMultiDayEvent();
            handleMultiDayScheduleUpdate(dayIndex, 'date', day.date);
            if (Array.isArray(day.slots)) {
              day.slots.forEach((slot, slotIndex) => {
                if (slotIndex === 0) {
                  handleMultiDayScheduleUpdate(dayIndex, 'startTime', slot.startTime, 0);
                  handleMultiDayScheduleUpdate(dayIndex, 'endTime', slot.endTime, 0);
                  handleMultiDayScheduleUpdate(dayIndex, 'volunteers', slot.volunteers, 0);
                } else {
                  addMultiDaySlot(dayIndex);
                  handleMultiDayScheduleUpdate(dayIndex, 'startTime', slot.startTime, slotIndex);
                  handleMultiDayScheduleUpdate(dayIndex, 'endTime', slot.endTime, slotIndex);
                  handleMultiDayScheduleUpdate(dayIndex, 'volunteers', slot.volunteers, slotIndex);
                }
              });
            }
          }
        });
      } else if (data.eventType === 'sameDayMultiArea' && (data.schedule as AIScheduleSameDay).date) {
        const schedule = data.schedule as AIScheduleSameDay;
        handleMultiRoleScheduleUpdate('date', schedule.date);
        if (schedule.overallStart) handleMultiRoleScheduleUpdate('overallStart', schedule.overallStart);
        if (schedule.overallEnd) handleMultiRoleScheduleUpdate('overallEnd', schedule.overallEnd);

        // Clear existing roles
        const currentRoles = state.schedule.sameDayMultiArea.roles.length;
        for (let i = currentRoles - 1; i > 0; i--) {
          removeRole(i);
        }

        // Add new roles from AI
        if (Array.isArray(schedule.roles)) {
          schedule.roles.forEach((role, roleIndex) => {
            if (roleIndex === 0) {
              handleMultiRoleScheduleUpdate('name', role.name, 0);
              handleMultiRoleScheduleUpdate('startTime', role.startTime, 0);
              handleMultiRoleScheduleUpdate('endTime', role.endTime, 0);
              handleMultiRoleScheduleUpdate('volunteers', role.volunteers, 0);
            } else {
              addRole();
              handleMultiRoleScheduleUpdate('name', role.name, roleIndex);
              handleMultiRoleScheduleUpdate('startTime', role.startTime, roleIndex);
              handleMultiRoleScheduleUpdate('endTime', role.endTime, roleIndex);
              handleMultiRoleScheduleUpdate('volunteers', role.volunteers, roleIndex);
            }
          });
        }
      }
    }

    // Apply verification settings
    if (data.verificationMethod) {
      updateVerificationMethod(data.verificationMethod);
    }
    if (data.requireLogin !== undefined) {
      updateRequireLogin(data.requireLogin);
    }

    // Close AI Assistant
    setShowAIAssistant(false);
  };

  // Clear errors when a field is updated
  const handleBasicInfoUpdate = (
    field: Parameters<typeof updateBasicInfo>[0],
    value: Parameters<typeof updateBasicInfo>[1]
  ) => {
    // Clear errors related to this field
    if (validationAttempted) {
      setBasicInfoErrors(prev => prev.filter(error => !error.path.includes(field)));
    }
    updateBasicInfo(field, value);
  };

  const handleOneTimeScheduleUpdate = (
    field: Parameters<typeof updateOneTimeSchedule>[0],
    value: Parameters<typeof updateOneTimeSchedule>[1]
  ) => {
    // Clear errors related to this field
    if (validationAttempted) {
      setScheduleErrors(prev => prev.filter(error => !error.path.includes(field)));
    }
    updateOneTimeSchedule(field, value);
  };

  const handleMultiDayScheduleUpdate = (
    dayIndex: number,
    field: Parameters<typeof updateMultiDaySchedule>[1],
    value: Parameters<typeof updateMultiDaySchedule>[2],
    slotIndex?: number
  ) => {
    // Clear errors related to this field/slot
    if (validationAttempted) {
      setScheduleErrors(prev => prev.filter(error => {
        if (slotIndex !== undefined) {
          return !(error.path[0] === dayIndex && error.path[2] === slotIndex && error.path.includes(field));
        }
        return !(error.path[0] === dayIndex && error.path.includes(field));
      }));
    }
    updateMultiDaySchedule(dayIndex, field, value, slotIndex);
  };

  const handleMultiRoleScheduleUpdate = (
    field: Parameters<typeof updateMultiRoleSchedule>[0],
    value: Parameters<typeof updateMultiRoleSchedule>[1],
    roleIndex?: number
  ) => {
    // Clear errors related to this field/role
    if (validationAttempted) {
      setScheduleErrors(prev => prev.filter(error => {
        if (roleIndex !== undefined) {
          return !(error.path[0] === 'roles' && error.path[1] === roleIndex && error.path.includes(field));
        }
        return !error.path.includes(field);
      }));
    }
    updateMultiRoleSchedule(field, value, roleIndex);
  };

  // Function to convert File to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Validate current step with Zod
  const validateCurrentStep = (): boolean => {
    try {
      switch (state.step) {
        case 1: // Basic Info
          basicInfoSchema.parse(state.basicInfo);
          setBasicInfoErrors([]);
          return true;

        case 2: // Event Type
          // No validation needed for event type selection
          return true;

        case 3: // Schedule
          if (state.eventType === "oneTime") {
            oneTimeSchema.parse(state.schedule.oneTime);
          } else if (state.eventType === "multiDay") {
            multiDaySchema.parse(state.schedule.multiDay);
          } else if (state.eventType === "sameDayMultiArea") {
            multiRoleSchema.parse(state.schedule.sameDayMultiArea);
          }
          setScheduleErrors([]);
          return true;

        case 4: // Verification Settings
          verificationSettingsSchema.parse({
            verificationMethod: state.verificationMethod,
            requireLogin: state.requireLogin,
            visibility: state.visibility,
            waiverRequired: state.waiverRequired,
            waiverAllowUpload: state.waiverAllowUpload,
          });
          setVerificationErrors([]);
          return true;

        case 5: // Finalize
          // No validation needed for files
          return true;

        default:
          return false;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Store errors according to the current step
        switch (state.step) {
          case 1:
            setBasicInfoErrors(error.issues);
            break;
          case 3:
            setScheduleErrors(error.issues);
            break;
          case 4:
            setVerificationErrors(error.issues);
            break;
        }
        // Mark validation as attempted so errors will show
        setValidationAttempted(true);
      }
      return false;
    }
  };

  // Get field error from Zod issues
  const getFieldError = (fieldPath: string, issues: z.ZodIssue[]): string | undefined => {
    if (!validationAttempted) return undefined;

    const error = issues.find(issue => {
      // Match exact field or field in array (e.g., "roles.0.name")
      return issue.path.join('.') === fieldPath ||
        issue.path.join('.').startsWith(fieldPath + '[') ||
        issue.path.join('.').startsWith(fieldPath + '.');
    });
    return error?.message;
  };

  // Handler for continuing to next step
  const handleNextStep = () => {
    // Validate current step before proceeding
    const isValid = validateCurrentStep();

    if (isValid || state.step === 5) {
      nextStep();
      // Reset validation attempted since we're moving to a new step
      setValidationAttempted(false);
    }
  };

  const handleSubmit = async () => {
    if (state.step !== 5) {
      handleNextStep();
      return;
    }

    // Check for profanity before allowing submission
    if (hasProfanity) {
      toast.error("Please fix the flagged content before creating your project");
      return;
    }

    // Final validation of all steps before submission
    try {
      basicInfoSchema.parse(state.basicInfo);

      if (state.eventType === "oneTime") {
        oneTimeSchema.parse(state.schedule.oneTime);
      } else if (state.eventType === "multiDay") {
        multiDaySchema.parse(state.schedule.multiDay);
      } else if (state.eventType === "sameDayMultiArea") {
        multiRoleSchema.parse(state.schedule.sameDayMultiArea);
      }

      verificationSettingsSchema.parse({
        verificationMethod: state.verificationMethod,
        requireLogin: state.requireLogin,
        visibility: state.visibility,
        enableVolunteerComments: state.enableVolunteerComments,
        showAttendeesPublicly: state.showAttendeesPublicly,
        waiverRequired: state.waiverRequired,
        waiverAllowUpload: state.waiverAllowUpload,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        setValidationAttempted(true);
        // Show a toast with general error message
        toast.error("Please fix all validation errors before submitting");
        return;
      }
    }

    try {
      setIsSubmitting(true);

      // Show loading toast
      const loadingToast = toast.loading("Creating your project...");

      // Step 1: Create basic project without files
      const formData = new FormData();
      formData.append("projectData", JSON.stringify(state));

      const result = await createProject(formData);

      if ("error" in result) {
        toast.dismiss(loadingToast);
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      const projectId = result.id;
      let hasErrors = false;

      // Step 2: Upload cover image if available
      if (coverImage) {
        if (validateFileSize(coverImage, 5 * 1024 * 1024)) {
          try {
            const coverBase64 = await fileToBase64(coverImage);
            const coverResult = await uploadCoverImage(projectId, coverBase64);
            if (coverResult.error) {
              console.error(`Cover image: ${coverResult.error}`);
              hasErrors = true;
            }
          } catch (error) {
            console.error("Error processing cover image:", error);
            hasErrors = true;
          }
        } else {
          hasErrors = true;
        }
      }

      // Step 3: Upload documents one by one with sequential processing
      if (documents.length > 0) {
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];

          // Check size before attempting upload
          if (!validateFileSize(doc, 10 * 1024 * 1024)) {
            hasErrors = true;
            continue;
          }

          try {
            const docBase64 = await fileToBase64(doc);
            const uploadResult = await uploadProjectDocument(projectId, docBase64, doc.name, doc.type);

            // Wait a short delay between uploads to prevent race conditions
            await new Promise(resolve => setTimeout(resolve, 200));

            if (uploadResult.error) {
              console.error(`Document ${doc.name}: ${uploadResult.error}`);
              hasErrors = true;
            }
          } catch (error) {
            console.error(`Error processing document ${doc.name}:`, error);
            hasErrors = true;
          }
        }
      }

      // Step 4: Upload waiver PDF if available and waiver is required
      if (state.waiverRequired && state.waiverPdfFile) {
        try {
          const waiverBase64 = await fileToBase64(state.waiverPdfFile);
          const waiverResult = await uploadWaiverPdf(projectId, waiverBase64, state.waiverPdfFile.name);
          if (waiverResult.error) {
            console.error(`Waiver PDF: ${waiverResult.error}`);
            hasErrors = true;
          }
        } catch (error) {
          console.error("Error processing waiver PDF:", error);
          hasErrors = true;
        }
      }

      // Step 5: Finalize project (non-blocking)
      finalizeProject(projectId).catch(error => {
        console.error("Error finalizing project:", error);
      });

      // Dismiss loading toast and show success
      toast.dismiss(loadingToast);
      const message = hasErrors
        ? "Project created but some files couldn't be uploaded"
        : "Project Created Successfully! 🎉";

      if (hasErrors) {
        toast.warning(message);
      } else {
        toast.success(message);
      }

      // Reset form state
      setIsSubmitting(false);

      // Force a full page redirect using window.location.href instead of Next.js router
      // This ensures the page fully loads on production
      window.location.href = `/projects/${projectId}`;

    } catch (error) {
      console.error("Error submitting project:", error);
      toast.dismiss();
      toast.error("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  // Handle saving as draft - with minimal validation
  const handleSaveDraft = async () => {
    // Only require a title for drafts
    if (!state.basicInfo.title || state.basicInfo.title.trim() === '') {
      toast.error("Please enter a title to save as draft");
      return;
    }

    try {
      setIsSavingDraft(true);
      const loadingToast = toast.loading("Saving new draft...");

      const formData = new FormData();
      formData.append("projectData", JSON.stringify(state));

      const result = await saveProjectAsNewDraft(formData);

      if ("error" in result) {
        toast.dismiss(loadingToast);
        toast.error(result.error);
        setIsSavingDraft(false);
        return;
      }

      toast.dismiss(loadingToast);
      toast.success("New draft saved! Refreshing...");
      
      // Refresh the page to update the drafts list
      router.refresh();

      setIsSavingDraft(false);

    } catch (error) {
      console.error("Error saving draft:", error);
      toast.dismiss();
      toast.error("Failed to save draft. Please try again.");
      setIsSavingDraft(false);
    }
  };

  // Function to check if the project is being created for an organization
  const isOrganizationProject = () => {
    return !!state.basicInfo.organizationId;
  };

  // Improved function to check file sizes before upload
  const validateFileSize = (file: File, maxSize: number): boolean => {
    if (file.size > maxSize) {
      toast.error(`File ${file.name} exceeds the maximum size limit`);
      return false;
    }
    return true;
  };

  // Render step based on current state.step
  const renderStep = () => {
    switch (state.step) {
      case 1:
        return (
          <BasicInfo
            state={state}
            updateBasicInfoAction={handleBasicInfoUpdate}
            initialOrgId={initialOrgId}
            initialOrganizations={initialOrgOptions}
            errors={{
              title: getFieldError("title", basicInfoErrors),
              location: getFieldError("location", basicInfoErrors),
              description: getFieldError("description", basicInfoErrors)
            }}
          />
        );
      case 2:
        return (
          <EventTypeStep
            eventType={state.eventType}
            setEventTypeAction={setEventType}
          />
        );
      case 3:
        return (
          <Schedule
            state={state}
            updateOneTimeScheduleAction={handleOneTimeScheduleUpdate}
            updateMultiDayScheduleAction={handleMultiDayScheduleUpdate}
            updateMultiRoleScheduleAction={handleMultiRoleScheduleUpdate}
            addMultiDaySlotAction={addMultiDaySlot}
            addMultiDayEventAction={addMultiDayEvent}
            addRoleAction={addRole}
            removeDayAction={removeDay}
            removeSlotAction={removeSlot}
            removeRoleAction={removeRole}
            updateRecurrenceAction={updateRecurrence}
            errors={validationAttempted ? scheduleErrors : []}
          />
        );
      case 4:
        return (
          <VerificationSettings
            verificationMethod={state.verificationMethod}
            requireLogin={state.requireLogin}
            isOrganization={isOrganizationProject()}
            visibility={state.visibility}
            enableVolunteerComments={state.enableVolunteerComments}
            showAttendeesPublicly={state.showAttendeesPublicly}
            waiverRequired={state.waiverRequired}
            waiverAllowUpload={state.waiverAllowUpload}
            waiverPdfFile={state.waiverPdfFile}
            waiverPdfUrl={state.waiverPdfUrl}
            waiverPdfValidation={state.waiverPdfValidation}
            restrictToOrgDomains={state.restrictToOrgDomains}
            allowedEmailDomains={
              state.basicInfo.organizationId
                ? initialOrgOptions?.find(o => o.id === state.basicInfo.organizationId)?.allowed_email_domains
                : undefined
            }
            updateVerificationMethodAction={(method) => {
              if (validationAttempted) {
                setVerificationErrors(prev => prev.filter(error => !error.path.includes('verificationMethod')));
              }
              updateVerificationMethod(method);
            }}
            updateRequireLoginAction={(value) => {
              if (validationAttempted) {
                setVerificationErrors(prev => prev.filter(error => !error.path.includes('requireLogin')));
              }
              updateRequireLogin(value);
            }}
            updateVisibilityAction={(value) => {
              if (validationAttempted) {
                setVerificationErrors(prev => prev.filter(error => !error.path.includes('visibility')));
              }
              updateVisibility(value);
            }}
            updateEnableVolunteerCommentsAction={updateEnableVolunteerComments}
            updateShowAttendeesPubliclyAction={updateShowAttendeesPublicly}
            updateWaiverRequiredAction={updateWaiverRequired}
            updateWaiverAllowUploadAction={updateWaiverAllowUpload}
            updateWaiverPdfFileAction={updateWaiverPdfFile}
            updateWaiverPdfValidationAction={updateWaiverPdfValidation}
            clearWaiverPdfAction={clearWaiverPdf}
            updateRestrictToOrgDomainsAction={updateRestrictToOrgDomains}
            errors={{
              verificationMethod: getFieldError("verificationMethod", verificationErrors)
            }}
          />
        );
      case 5:
        return (
          <Finalize
            state={state}
            setCoverImageAction={setCoverImage} // Updated prop name
            setDocumentsAction={setDocuments}   // Updated prop name
            onProfanityChange={handleProfanityResult}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="mb-6 sm:mb-8">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold">
            Create a Volunteering Project
          </h1>
          {state.step === 1 && (
            <Button
              variant="outline"
              onClick={() => setShowAIAssistant(!showAIAssistant)}
              className="flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">AI Auto-fill</span>
            </Button>
          )}
        </div>

        <Progress value={(state.step / 5) * 100} className="h-2" />
        <div className="grid grid-cols-5 mt-2 text-xs sm:text-sm text-muted-foreground">
          <span className={cn("text-center sm:text-left truncate", state.step === 1 && "text-primary font-medium")}>
            Basic Info
          </span>
          <span className={cn("text-center sm:text-left truncate", state.step === 2 && "text-primary font-medium")}>
            Event Type
          </span>
          <span className={cn("text-center sm:text-left truncate", state.step === 3 && "text-primary font-medium")}>
            Schedule
          </span>
          <span className={cn("text-center sm:text-left truncate", state.step === 4 && "text-primary font-medium")}>
            Settings
          </span>
          <span className={cn("text-center sm:text-left", state.step === 5 && "text-primary font-medium")}>
            Finalize
          </span>
        </div>
      </div>

      {/* AI Assistant Component */}
      {state.step === 1 && (
        <AIAssistant
          isOpen={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          onApplyData={handleApplyAIData}
        />
      )}

      <div className="space-y-6 sm:space-y-8">
        {renderStep()}
        <div className="flex justify-between gap-4">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={state.step === 1 || isSubmitting || isSavingDraft}
            className="w-[120px]"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex gap-2 items-center">
            {/* Drafts button */}
            <DraftsSidebar initialDrafts={drafts} />

            {/* Save as New Draft button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={handleSaveDraft}
                    disabled={isSubmitting || isSavingDraft || !state.basicInfo.title?.trim()}
                    className="h-9 w-9"
                  >
                    {isSavingDraft ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Save as New Draft</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Autosave Status Indicator */}
            {autosaveDraftId && (
              <div className="hidden sm:flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs text-muted-foreground">
                {autosaveStatus === 'saving' && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Saving...</span>
                  </>
                )}
                {autosaveStatus === 'saved' && (
                  <>
                    <svg className="h-3 w-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Saved</span>
                  </>
                )}
                {autosaveStatus === 'error' && (
                  <>
                    <AlertCircle className="h-3 w-3 text-amber-600" />
                    <span>Save failed</span>
                  </>
                )}
                {autosaveStatus === 'idle' && (
                  <>
                    <div className="h-2 w-2 rounded-full bg-green-600" />
                    <span>Autosave on</span>
                  </>
                )}
              </div>
            )}

            {/* Continue / Create button (full) */}
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || isSavingDraft}
              className="w-[120px]"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : state.step === 5 ? (
                'Create'
              ) : (
                <>
                  Continue
                  <ChevronRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Calendar Options Modal - removed automatic display after project creation */}
    </>
  );
}
