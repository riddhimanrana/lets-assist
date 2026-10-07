"use client";

import React from "react";

import type { useEventForm } from "@/hooks/use-event-form";

import BasicInfo from "./BasicInfo";
import EventTypeStep from "./EventType";
import Finalize from "./Finalize";
import { FormGroup, StepSection } from "./form-parts";
import Schedule from "./Schedule";
import type { useProjectFileUploads } from "./use-project-file-uploads";
import type { useStepValidation } from "./use-step-validation";
import VerificationSettings from "./VerificationSettings";

export interface CreatePluginStep {
  id: string;
  title: string;
  description?: string;
  content: React.ReactNode;
}

export interface CreateOrgOption {
  id: string;
  name: string;
  logo_url?: string | null;
  role: string;
  allowed_email_domains?: string[] | null;
}

/** Renders the step the form is on. The step order and every prop are unchanged. */
export function CreateStepContent({
  form,
  validation,
  uploads,
  pluginSteps,
  finalStep,
  initialOrgId,
  initialOrgOptions,
  canUsePublicVisibility,
  showLocationPointer,
  onLocationPointerDismiss,
  showWaiverReuploadNotice,
  hasProfanity,
}: {
  form: ReturnType<typeof useEventForm>;
  validation: ReturnType<typeof useStepValidation>;
  uploads: ReturnType<typeof useProjectFileUploads>;
  pluginSteps: CreatePluginStep[];
  finalStep: number;
  initialOrgId?: string;
  initialOrgOptions?: CreateOrgOption[];
  canUsePublicVisibility: boolean;
  showLocationPointer: boolean;
  onLocationPointerDismiss: () => void;
  showWaiverReuploadNotice: boolean;
  hasProfanity: boolean;
}) {
  const {
    state,
    setEventType,
    addMultiDaySlot,
    addMultiDayEvent,
    addRole,
    updateVerificationMethod,
    updateRequireLogin,
    updateVisibility,
    removeDay,
    removeSlot,
    removeRole,
    updateRestrictToOrgDomains,
    updateSignupFormSchema,
    updateEnableVolunteerComments,
    updateShowAttendeesPublicly,
    updateWaiverRequired,
    updateWaiverAllowUpload,
    updateWaiverDisableEsignature,
    updateWaiverPdfFile,
    updateWaiverPdfValidation,
    updateWaiverDefinition,
    updateDetectedFields,
    clearWaiverPdf,
    updateRecurrence,
    updatePluginData,
  } = form;
  const {
    basicInfoErrors,
    scheduleErrors,
    verificationErrors,
    setVerificationErrors,
    validationAttempted,
    handleBasicInfoUpdate,
    handleOneTimeScheduleUpdate,
    handleMultiDayScheduleUpdate,
    handleMultiRoleScheduleUpdate,
    getFieldError,
  } = validation;
  const {
    setCoverImage,
    setDocuments,
    coverImageUploadState,
    setCoverImageUploadState,
    documentUploadStates,
    setDocumentUploadStates,
    getUploadKey,
  } = uploads;

  // If it's a plugin step
  if (state.step > 4 && state.step <= 4 + pluginSteps.length) {
    const pluginStep = pluginSteps[state.step - 5];
    return (
      <StepSection
        title={pluginStep.title}
        description={pluginStep.description}
      >
        <FormGroup>
          {React.isValidElement(pluginStep.content)
            ? React.cloneElement(
                pluginStep.content as React.ReactElement<
                  Record<string, unknown>
                >,
                {
                  pluginData: state.pluginData,
                  updatePluginData,
                  signupFormSchema: state.signupFormSchema,
                  updateSignupFormSchema,
                },
              )
            : pluginStep.content}
        </FormGroup>
      </StepSection>
    );
  }

  switch (state.step) {
    case 1:
      return (
        <BasicInfo
          state={state}
          updateBasicInfoAction={handleBasicInfoUpdate}
          initialOrgId={initialOrgId}
          initialOrganizations={initialOrgOptions}
          showLocationPointer={showLocationPointer}
          onLocationPointerDismiss={onLocationPointerDismiss}
          errors={{
            title: getFieldError("title", basicInfoErrors),
            location: getFieldError("location", basicInfoErrors),
            description: getFieldError("description", basicInfoErrors),
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
          isOrganization={!!state.basicInfo.organizationId}
          visibility={state.visibility}
          canUsePublicVisibility={canUsePublicVisibility}
          enableVolunteerComments={state.enableVolunteerComments}
          showAttendeesPublicly={state.showAttendeesPublicly}
          waiverRequired={state.waiverRequired}
          waiverAllowUpload={state.waiverAllowUpload}
          waiverDisableEsignature={state.waiverDisableEsignature}
          waiverPdfFile={state.waiverPdfFile}
          waiverPdfUrl={state.waiverPdfUrl}
          waiverPdfValidation={state.waiverPdfValidation}
          waiverDefinition={state.waiverDefinition}
          detectedFields={state.detectedFields}
          showWaiverReuploadNotice={showWaiverReuploadNotice}
          updateWaiverDefinitionAction={updateWaiverDefinition}
          updateDetectedFieldsAction={updateDetectedFields}
          restrictToOrgDomains={state.restrictToOrgDomains}
          allowedEmailDomains={
            state.basicInfo.organizationId
              ? initialOrgOptions?.find(
                  (o) => o.id === state.basicInfo.organizationId,
                )?.allowed_email_domains
              : undefined
          }
          updateVerificationMethodAction={(method) => {
            if (validationAttempted) {
              setVerificationErrors((prev) =>
                prev.filter(
                  (error) => !error.path.includes("verificationMethod"),
                ),
              );
            }
            updateVerificationMethod(method);
          }}
          updateRequireLoginAction={(value) => {
            if (validationAttempted) {
              setVerificationErrors((prev) =>
                prev.filter((error) => !error.path.includes("requireLogin")),
              );
            }
            updateRequireLogin(value);
          }}
          updateVisibilityAction={(value) => {
            if (validationAttempted) {
              setVerificationErrors((prev) =>
                prev.filter((error) => !error.path.includes("visibility")),
              );
            }
            updateVisibility(value);
          }}
          updateEnableVolunteerCommentsAction={updateEnableVolunteerComments}
          updateShowAttendeesPubliclyAction={updateShowAttendeesPublicly}
          updateWaiverRequiredAction={updateWaiverRequired}
          updateWaiverAllowUploadAction={updateWaiverAllowUpload}
          updateWaiverDisableEsignatureAction={updateWaiverDisableEsignature}
          updateWaiverPdfFileAction={updateWaiverPdfFile}
          updateWaiverPdfValidationAction={updateWaiverPdfValidation}
          clearWaiverPdfAction={clearWaiverPdf}
          updateRestrictToOrgDomainsAction={updateRestrictToOrgDomains}
          errors={{
            verificationMethod: getFieldError(
              "verificationMethod",
              verificationErrors,
            ),
          }}
        />
      );
    default:
      if (state.step === finalStep) {
        return (
          <Finalize
            state={state}
            setCoverImageAction={(file) => {
              setCoverImage(file);
              setCoverImageUploadState("idle");
            }}
            setDocumentsAction={(nextDocuments) => {
              setDocuments(nextDocuments);
              setDocumentUploadStates((current) => {
                const nextKeys = new Set(nextDocuments.map(getUploadKey));
                return Object.fromEntries(
                  Object.entries(current).filter(([key]) => nextKeys.has(key)),
                );
              });
            }}
            hasProfanity={hasProfanity}
            coverImageUploadState={coverImageUploadState}
            documentUploadStates={documentUploadStates}
            getUploadKey={getUploadKey}
          />
        );
      }
      return null;
  }
}
