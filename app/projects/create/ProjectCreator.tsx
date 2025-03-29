"use client";
import { useState, useEffect } from "react";
import { useEventForm } from "@/hooks/use-event-form";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2 } from "lucide-react";
import BasicInfo from "./BasicInfo";
import EventType from "./EventType";
import Schedule from "./Schedule";
import Finalize from "./Finalize";
import VerificationSettings from "./VerificationSettings";
// shadcn components
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
// icon components
import { Loader2, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
// utility
import { cn } from "@/lib/utils";
// Replace shadcn toast with Sonner
import { toast } from "sonner";
import { createProject, uploadCoverImage, uploadProjectDocument, finalizeProject } from "./actions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface ProjectCreatorProps {
  initialOrgId?: string;
  initialOrgOptions?: {
    id: string;
    name: string;
    logo_url?: string | null;
    role: string;
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
    updateIsPrivate,
    removeDay,
    removeSlot,
    removeRole,
    canProceed,
  } = useEventForm();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // File handling states
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [documents, setDocuments] = useState<File[]>([]);

  // Function to convert File to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Helper function to check if datetime is in the past
  const isDateTimeInPast = (date: string, time: string): boolean => {
    if (!date || !time) return false;
    
    const [hours, minutes] = time.split(':').map(Number);
    const [year, month, day] = date.split('-').map(Number);
    
    const datetime = new Date(year, month - 1, day);
    datetime.setHours(hours, minutes, 0, 0);
    
    return datetime < new Date();
  };

  const getValidationMessage = () => {
    if (!canProceed()) {
      switch (state.step) {
        case 1:
          return "Please fill in all required fields";
        case 3:
          if (state.eventType === "oneTime") {
            if (!state.schedule.oneTime.date || !state.schedule.oneTime.startTime || 
                !state.schedule.oneTime.endTime || !state.schedule.oneTime.volunteers) {
              return "Please select a date, time, and number of volunteers";
            }
            if (isDateTimeInPast(state.schedule.oneTime.date, state.schedule.oneTime.startTime) ||
                isDateTimeInPast(state.schedule.oneTime.date, state.schedule.oneTime.endTime)) {
              return "Event dates and times must be in the future";
            }
          }
          if (state.eventType === "multiDay") {
            if (!state.schedule.multiDay.length) {
              return "Please add at least one day";
            }
            for (const day of state.schedule.multiDay) {
              if (!day.date || !day.slots.length) {
                return "Please ensure all days have valid dates and time slots";
              }
              for (const slot of day.slots) {
                if (!slot.startTime || !slot.endTime || !slot.volunteers) {
                  return "Please ensure all time slots have start time, end time, and volunteer count";
                }
                if (isDateTimeInPast(day.date, slot.startTime) ||
                    isDateTimeInPast(day.date, slot.endTime)) {
                  return "Event dates and times must be in the future";
                }
              }
            }
          }
          if (state.eventType === "sameDayMultiArea") {
            if (!state.schedule.sameDayMultiArea.date || 
                !state.schedule.sameDayMultiArea.overallStart ||
                !state.schedule.sameDayMultiArea.overallEnd) {
              return "Please select a date and overall event hours";
            }
            if (isDateTimeInPast(state.schedule.sameDayMultiArea.date, state.schedule.sameDayMultiArea.overallStart) ||
                isDateTimeInPast(state.schedule.sameDayMultiArea.date, state.schedule.sameDayMultiArea.overallEnd)) {
              return "Event dates and times must be in the future";
            }
            for (const role of state.schedule.sameDayMultiArea.roles) {
              if (!role.name || !role.startTime || !role.endTime || !role.volunteers) {
                return "Please ensure all roles have names, times, and volunteer counts";
              }
              if (isDateTimeInPast(state.schedule.sameDayMultiArea.date, role.startTime) ||
                  isDateTimeInPast(state.schedule.sameDayMultiArea.date, role.endTime)) {
                return "Role times must be in the future";
              }
            }
          }
        case 4:
          return "Please select a verification method";
        default:
          return "";
      }
    }
    return "";
  };

  // Improved function to check file sizes before upload
  const validateFileSize = (file: File, maxSize: number): boolean => {
    if (file.size > maxSize) {
      toast.error(`File ${file.name} exceeds the maximum size limit`);
      return false;
    }
    return true;
  };

  // Fixed submit function to handle files with better size management
  const handleSubmit = async () => {
    if (state.step !== 5) {
      nextStep();
      return;
    }
    
    try {
      setIsSubmitting(true);
      
      // Show loading toast - will be dismissed before redirect
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
        // Check size before attempting upload (5MB limit)
        if (!validateFileSize(coverImage, 5 * 1024 * 1024)) {
          hasErrors = true;
        } else {
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
        }
      }
      
      // Step 3: Upload documents one by one with sequential processing
      if (documents.length > 0) {      
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];
          
          // Update loading message but keep same toast ID
          toast.loading(`Uploading files (${i+1}/${documents.length})...`, { id: loadingToast });
          
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
      
      // Step 4: Finalize project
      await finalizeProject(projectId);
      
      // Dismiss any loading toasts - NO SUCCESS TOAST HERE
      toast.dismiss();
      
      // Store success message in sessionStorage before navigating
      const message = hasErrors 
        ? "Project created but some files couldn't be uploaded" 
        : "Project Created Successfully! 🎉";
      sessionStorage.setItem("project_creation_message", message);
      sessionStorage.setItem("project_creation_status", hasErrors ? "warning" : "success");
      
      // Redirect immediately with no success toast
      router.push(`/projects/${projectId}`);
      
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

  // Render step based on current state.step
  const renderStep = () => {
    switch (state.step) {
      case 1:
        return (
          <BasicInfo
            state={state}
            updateBasicInfoAction={updateBasicInfo}
            initialOrgId={initialOrgId}
            initialOrganizations={initialOrgOptions}
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
            updateOneTimeScheduleAction={updateOneTimeSchedule}
            updateMultiDayScheduleAction={updateMultiDaySchedule}
            updateMultiRoleScheduleAction={updateMultiRoleSchedule}
            addMultiDaySlotAction={addMultiDaySlot}
            addMultiDayEventAction={addMultiDayEvent}
            addRoleAction={addRole}
            removeDayAction={removeDay}
            removeSlotAction={removeSlot}
            removeRoleAction={removeRole}
          />
        );
      case 4:
        return (
          <VerificationSettings
            verificationMethod={state.verificationMethod}
            requireLogin={state.requireLogin}
            isOrganization={isOrganizationProject()}
            isPrivate={state.isPrivate}
            updateVerificationMethodAction={updateVerificationMethod}
            updateRequireLoginAction={updateRequireLogin}
            updateIsPrivateAction={updateIsPrivate}
          />
        );
      case 5:
        return (
          <Finalize 
            state={state} 
            setCoverImage={setCoverImage}
            setDocuments={setDocuments}
          />
        );
      default:
        return null;
    }
  };
  
  return (
    <>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">
          Create a Volunteering Project
        </h1>
        
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
      <div className="space-y-6 sm:space-y-8">
        {renderStep()}
        {getValidationMessage() && (
          <Alert variant="destructive" className="animate-in fade-in">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{getValidationMessage()}</AlertDescription>
          </Alert>
        )}
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
            disabled={!canProceed() || isSubmitting}
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
    </>
  );
}
