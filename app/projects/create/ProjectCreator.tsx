"use client";
import { useState } from "react";
import { useEventForm } from "@/hooks/use-event-form";
import BasicInfo from "./BasicInfo";
import EventType from "./EventType";
import Schedule from "./Schedule";
import Finalize from "./Finalize";
import VerificationSettings from "./VerificationSettings";
import AIAssistant, { AIParseResult } from "./AIAssistant";
// shadcn components
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
// icon components
import { Loader2, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
// utility
import { cn } from "@/lib/utils";
// Replace shadcn toast with Sonner
import { toast } from "sonner";
import { createProject, uploadCoverImage, uploadProjectDocument, finalizeProject } from "./actions";

// Import Zod schemas
import {
  basicInfoSchema,
  oneTimeSchema,
  multiDaySchema,
  multiRoleSchema,
  verificationSettingsSchema
} from "@/schemas/event-form-schema";


import { z } from "zod";

interface ProjectCreatorProps {
  initialOrgId?: string;
  initialOrgOptions?: {
    id: string;
    name: string;
    logo_url?: string | null;
    role: string;
    allowed_email_domains?: string[] | null;
  }[];
}

export default function ProjectCreator({ initialOrgId, initialOrgOptions }: ProjectCreatorProps) {
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
  } = useEventForm();


  const [isSubmitting, setIsSubmitting] = useState(false);

  // File handling states
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [documents, setDocuments] = useState<File[]>([]);

  // Form validation states
  const [basicInfoErrors, setBasicInfoErrors] = useState<z.ZodIssue[]>([]);
  const [scheduleErrors, setScheduleErrors] = useState<z.ZodIssue[]>([]);
  const [verificationErrors, setVerificationErrors] = useState<z.ZodIssue[]>([]);

  // Validation tracking - only validate after continue is clicked
  const [validationAttempted, setValidationAttempted] = useState(false);

  const [hasProfanity, setHasProfanity] = useState<boolean>(false);

  // AI Assistant state
  const [showAIAssistant, setShowAIAssistant] = useState(false);

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
      if (data.eventType === 'oneTime' && (data.schedule as any).date) {
        handleOneTimeScheduleUpdate('date', (data.schedule as any).date);
        if ((data.schedule as any).startTime) handleOneTimeScheduleUpdate('startTime', (data.schedule as any).startTime);
        if ((data.schedule as any).endTime) handleOneTimeScheduleUpdate('endTime', (data.schedule as any).endTime);
        if ((data.schedule as any).volunteers) handleOneTimeScheduleUpdate('volunteers', (data.schedule as any).volunteers);
      } else if (data.eventType === 'multiDay' && Array.isArray(data.schedule)) {
        // Clear existing days first
        const currentDays = state.schedule.multiDay.length;
        for (let i = currentDays - 1; i >= 0; i--) {
          removeDay(i);
        }

        // Add new days from AI
        data.schedule.forEach((day: { date?: string; slots?: Array<{ startTime?: string; endTime?: string; volunteers?: number }> }, dayIndex: number) => {
          if (dayIndex === 0) {
            // Update first day
            if (day.date) handleMultiDayScheduleUpdate(0, 'date', day.date);
            if (Array.isArray(day.slots)) {
              day.slots.forEach((slot, slotIndex: number) => {
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
              day.slots.forEach((slot: { startTime?: string; endTime?: string; volunteers?: number }, slotIndex: number) => {
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
      } else if (data.eventType === 'sameDayMultiArea' && (data.schedule as any).date) {
        handleMultiRoleScheduleUpdate('date', (data.schedule as any).date);
        if ((data.schedule as any).overallStart) handleMultiRoleScheduleUpdate('overallStart', (data.schedule as any).overallStart);
        if ((data.schedule as any).overallEnd) handleMultiRoleScheduleUpdate('overallEnd', (data.schedule as any).overallEnd);

        // Clear existing roles
        const currentRoles = state.schedule.sameDayMultiArea.roles.length;
        for (let i = currentRoles - 1; i > 0; i--) {
          removeRole(i);
        }

        // Add new roles from AI
        if (Array.isArray((data.schedule as any).roles)) {
          (data.schedule as any).roles.forEach((role: { name?: string; startTime?: string; endTime?: string; volunteers?: number }, roleIndex: number) => {
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
  const handleBasicInfoUpdate = (field: string, value: unknown) => {
    // Clear errors related to this field
    if (validationAttempted) {
      setBasicInfoErrors(prev => prev.filter(error => !error.path.includes(field)));
    }
    updateBasicInfo(field, value);
  };

  const handleOneTimeScheduleUpdate = (field: string, value: unknown) => {
    // Clear errors related to this field
    if (validationAttempted) {
      setScheduleErrors(prev => prev.filter(error => !error.path.includes(field)));
    }
    updateOneTimeSchedule(field, value);
  };

  const handleMultiDayScheduleUpdate = (dayIndex: number, field: string, value: unknown, slotIndex?: number) => {
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

  const handleMultiRoleScheduleUpdate = (field: string, value: unknown, roleIndex?: number) => {
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
            visibility: state.visibility
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
        visibility: state.visibility
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

      // Step 4: Finalize project (non-blocking)
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
          <EventType
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
            disabled={state.step === 1 || isSubmitting}
            className="w-[120px]"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
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

      {/* Calendar Options Modal - removed automatic display after project creation */}
    </>
  );
}
