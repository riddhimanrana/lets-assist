"use client";

import { VerificationMethod, ProjectVisibility } from "@/types";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import type { WaiverDefinitionInput } from "@/components/waiver/WaiverBuilderDialog";

import { StepSection } from "./form-parts";
import { DomainSettings, SignupSettings } from "./SettingsSignup";
import { TrackingSettings } from "./SettingsTracking";
import { VisibilitySettings } from "./SettingsVisibility";
import { WaiverSettings } from "./SettingsWaiver";

interface VerificationSettingsProps {
  verificationMethod: VerificationMethod;
  requireLogin: boolean;
  isOrganization: boolean; // Add this to detect if creating for an organization
  visibility: ProjectVisibility; // Project visibility setting
  canUsePublicVisibility: boolean;
  enableVolunteerComments: boolean;
  showAttendeesPublicly: boolean;
  waiverRequired: boolean;
  waiverAllowUpload: boolean;
  waiverDisableEsignature: boolean;
  waiverPdfFile?: File | null;
  waiverPdfUrl?: string | null;
  waiverPdfValidation?: {
    hasSignatureFields: boolean;
    warnings: string[];
  } | null;
  waiverDefinition?: WaiverDefinitionInput | null;
  detectedFields?: DetectedPdfField[] | null;
  showWaiverReuploadNotice?: boolean;
  updateVerificationMethodAction: (method: VerificationMethod) => void;
  updateRequireLoginAction: (requireLogin: boolean) => void;
  updateVisibilityAction: (visibility: ProjectVisibility) => void;
  updateEnableVolunteerCommentsAction: (enabled: boolean) => void;
  updateShowAttendeesPubliclyAction: (enabled: boolean) => void;
  updateWaiverRequiredAction: (enabled: boolean) => void;
  updateWaiverAllowUploadAction: (enabled: boolean) => void;
  updateWaiverDisableEsignatureAction: (disabled: boolean) => void;
  updateWaiverPdfFileAction?: (file: File | null) => void;
  updateWaiverPdfValidationAction?: (
    validation: { hasSignatureFields: boolean; warnings: string[] } | null,
  ) => void;
  updateWaiverDefinitionAction?: (
    definition: WaiverDefinitionInput | null,
  ) => void;
  updateDetectedFieldsAction?: (fields: DetectedPdfField[] | null) => void;
  clearWaiverPdfAction?: () => void;
  restrictToOrgDomains?: boolean;
  updateRestrictToOrgDomainsAction?: (restrict: boolean) => void;
  allowedEmailDomains?: string[] | null;
  errors?: {
    verificationMethod?: string;
    requireLogin?: string;
    visibility?: string;
    waiver?: string;
  };
  /** Why a waiver cannot be required, when it cannot. */
  waiverBlockedReason?: string;
}

export default function VerificationSettings({
  verificationMethod,
  requireLogin,
  isOrganization,
  visibility,
  canUsePublicVisibility,
  enableVolunteerComments,
  showAttendeesPublicly,
  waiverRequired,
  waiverDisableEsignature,
  waiverPdfFile,
  waiverPdfUrl,
  waiverPdfValidation,
  waiverDefinition,
  detectedFields,
  showWaiverReuploadNotice = false,
  updateVerificationMethodAction,
  updateRequireLoginAction,
  updateVisibilityAction,
  updateEnableVolunteerCommentsAction,
  updateShowAttendeesPubliclyAction,
  updateWaiverRequiredAction,
  updateWaiverAllowUploadAction,
  updateWaiverDisableEsignatureAction,
  updateWaiverPdfFileAction,
  updateWaiverPdfValidationAction,
  updateWaiverDefinitionAction,
  updateDetectedFieldsAction,
  clearWaiverPdfAction,
  restrictToOrgDomains = false,
  updateRestrictToOrgDomainsAction,
  allowedEmailDomains,
  errors = {},
  waiverBlockedReason,
}: VerificationSettingsProps) {
  const isSignupOnly = verificationMethod === "signup-only";

  return (
    <StepSection title="Settings">
      <TrackingSettings
        verificationMethod={verificationMethod}
        updateVerificationMethodAction={updateVerificationMethodAction}
        updateRequireLoginAction={updateRequireLoginAction}
        error={errors.verificationMethod}
      />

      <SignupSettings
        isSignupOnly={isSignupOnly}
        requireLogin={requireLogin}
        enableVolunteerComments={enableVolunteerComments}
        showAttendeesPublicly={showAttendeesPublicly}
        updateRequireLoginAction={updateRequireLoginAction}
        updateEnableVolunteerCommentsAction={
          updateEnableVolunteerCommentsAction
        }
        updateShowAttendeesPubliclyAction={updateShowAttendeesPubliclyAction}
        error={errors.requireLogin}
      />

      <WaiverSettings
        waiverRequired={waiverRequired}
        waiverDisableEsignature={waiverDisableEsignature}
        waiverPdfFile={waiverPdfFile}
        waiverPdfUrl={waiverPdfUrl}
        waiverPdfValidation={waiverPdfValidation}
        waiverDefinition={waiverDefinition}
        detectedFields={detectedFields}
        showWaiverReuploadNotice={showWaiverReuploadNotice}
        updateWaiverRequiredAction={updateWaiverRequiredAction}
        updateWaiverAllowUploadAction={updateWaiverAllowUploadAction}
        updateWaiverDisableEsignatureAction={
          updateWaiverDisableEsignatureAction
        }
        updateWaiverPdfFileAction={updateWaiverPdfFileAction}
        updateWaiverPdfValidationAction={updateWaiverPdfValidationAction}
        updateWaiverDefinitionAction={updateWaiverDefinitionAction}
        updateDetectedFieldsAction={updateDetectedFieldsAction}
        clearWaiverPdfAction={clearWaiverPdfAction}
        error={errors.waiver}
        blockedReason={waiverBlockedReason}
      />

      {/* Project Visibility - available to everyone */}
      <VisibilitySettings
        visibility={visibility}
        isOrganization={isOrganization}
        canUsePublicVisibility={canUsePublicVisibility}
        updateVisibilityAction={updateVisibilityAction}
        error={errors.visibility}
      />

      {/* Domain Restriction Section - Only show if organization has allowed domains */}
      {isOrganization &&
        allowedEmailDomains &&
        allowedEmailDomains.length > 0 &&
        updateRestrictToOrgDomainsAction && (
          <DomainSettings
            restrictToOrgDomains={restrictToOrgDomains}
            allowedEmailDomains={allowedEmailDomains}
            updateRestrictToOrgDomainsAction={updateRestrictToOrgDomainsAction}
          />
        )}
    </StepSection>
  );
}
