"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Download,
  ExternalLink,
  Loader2,
  PenTool,
  Printer,
  Upload,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  SignerData,
  WaiverDefinitionFull,
  WaiverDefinitionSigner,
} from "@/types/waiver-definitions";
import { SignatureCapture } from "../SignatureCapture";
import { WaiverConsentStep } from "../WaiverConsentStep";
import { WaiverFieldForm } from "../WaiverFieldForm";
import type { WaiverSigningStep } from "./types";

type Props = {
  isDesktop: boolean;
  currentStepIndex: number;
  steps: WaiverSigningStep[];
  currentStep?: WaiverSigningStep;
  hasPdfDocument: boolean;
  generatedWaiverPreview: string;
  safeWaiverPdfUrl: string | null;
  handleDownload: () => Promise<void>;
  handlePrint: () => void;
  handleOfflineUpload: () => void;
  consented: boolean;
  setConsented: Dispatch<SetStateAction<boolean>>;
  effectiveDefinition: WaiverDefinitionFull;
  disableEsignature: boolean;
  allowUpload: boolean;
  handleNext: () => void;
  sortedSigners: WaiverDefinitionSigner[];
  fieldValues: Record<string, string | boolean | number>;
  handleFieldChange: (key: string, value: string | boolean | number) => void;
  handleSignatureComplete: (
    roleKey: string,
    signature: SignerData | null,
  ) => void;
  signatures: Record<string, SignerData>;
  defaultSignerName?: string;
  handleBack: () => void;
  isSubmitting: boolean;
  handleSkipOptionalSigner: () => void;
  handleSubmit: () => Promise<void>;
  isStepValid: boolean;
};

export function WaiverSigningStepsPanel(props: Props) {
  const {
    isDesktop,
    currentStepIndex,
    steps,
    currentStep,
    hasPdfDocument,
    generatedWaiverPreview,
    safeWaiverPdfUrl,
    handleDownload,
    handlePrint,
    handleOfflineUpload,
    consented,
    setConsented,
    effectiveDefinition,
    disableEsignature,
    allowUpload,
    handleNext,
    sortedSigners,
    fieldValues,
    handleFieldChange,
    handleSignatureComplete,
    signatures,
    defaultSignerName,
    handleBack,
    isSubmitting,
    handleSkipOptionalSigner,
    handleSubmit,
    isStepValid,
  } = props;

  return (
    <div
      className={cn(
        "w-full h-full flex flex-col bg-background overflow-hidden transition-all",
        !isDesktop && "absolute inset-0 z-10",
      )}
    >
      {/* Mobile Header (since global header might be covered or we want context) */}
      {!isDesktop && (
        <div className="bg-muted/10 p-2 text-center text-xs font-medium border-b flex justify-between px-4 items-center">
          <span>
            Step {currentStepIndex + 1} of {steps.length}
          </span>
          <span className="text-muted-foreground">{currentStep?.title}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
        {/* Step Content */}
        <div className="space-y-6">
          {/* Review Consent Step */}
          {currentStep?.type === "review" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              {isDesktop && (
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-sm mb-4">
                  Please review the waiver document on the left carefully.
                </div>
              )}

              {/* Always provide explicit PDF actions in the review step */}
              {safeWaiverPdfUrl && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      window.open(
                        safeWaiverPdfUrl,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View PDF
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleDownload}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handlePrint}
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </Button>
                </div>
              )}

              {!hasPdfDocument && (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Generated waiver preview
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap max-h-56 overflow-y-auto leading-6">
                    {generatedWaiverPreview}
                  </p>
                </div>
              )}

              <WaiverConsentStep
                consented={consented}
                onConsent={setConsented}
                waiverTitle={effectiveDefinition.title}
              />

              {/* Choice between E-Sign and Print/Upload */}
              {!disableEsignature && (
                <div className="pt-6 mt-6 border-t">
                  <h4 className="font-semibold text-sm mb-4">
                    How would you like to sign?
                  </h4>
                  <div className="grid gap-3">
                    <div className="p-3 sm:p-4 border-2 border-primary rounded-lg bg-primary/5">
                      <div className="flex flex-col sm:flex-row items-start gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <PenTool className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0 w-full">
                          <h5 className="font-medium text-sm mb-1">
                            Sign Electronically (Recommended)
                          </h5>
                          <p className="text-xs text-muted-foreground mb-3">
                            Complete your signature directly in your browser.
                            Fast and secure.
                          </p>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={handleNext}
                            disabled={!consented}
                            className="w-full"
                          >
                            Continue to E-Sign
                          </Button>
                        </div>
                      </div>
                    </div>

                    {allowUpload && (
                      <div className="p-3 sm:p-4 border rounded-lg">
                        <div className="flex flex-col sm:flex-row items-start gap-3">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <Upload className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0 w-full">
                            <h5 className="font-medium text-sm mb-1">
                              Print, Sign & Upload
                            </h5>
                            <p className="text-xs text-muted-foreground mb-3">
                              Download the waiver, print it, sign manually, and
                              upload a photo or scan.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleOfflineUpload}
                              className="w-full"
                            >
                              <Upload className="mr-2 h-4 w-4" /> Upload Signed
                              Copy
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Print/Upload only mode */}
              {disableEsignature && allowUpload && (
                <div className="pt-8 mt-8 border-t">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-3">
                      This waiver requires a printed and signed copy.
                    </p>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleOfflineUpload}
                      className="w-full"
                    >
                      <Upload className="mr-2 h-4 w-4" /> Upload Signed Waiver
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fields Step */}
          {currentStep?.type === "fields" && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              {currentStep.signer ? (
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">
                    {sortedSigners.indexOf(currentStep.signer) + 1}
                  </span>
                  {currentStep.signer.label} Details
                </h3>
              ) : (
                <h3 className="text-lg font-semibold mb-4">Your Information</h3>
              )}
              <WaiverFieldForm
                fields={
                  currentStep.signer
                    ? effectiveDefinition.fields.filter(
                        (f) =>
                          f.signer_role_key === currentStep.signer?.role_key,
                      )
                    : effectiveDefinition.fields.filter(
                        (f) => !f.signer_role_key,
                      )
                }
                values={fieldValues}
                onChange={handleFieldChange}
                signerRoleKey={currentStep.signer?.role_key}
                showErrors={false} // Could enable this on "next" attempt
                className="pb-4"
              />
            </div>
          )}

          {/* Signature Step */}
          {currentStep?.type === "sign" && currentStep.signer && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              {disableEsignature && (
                <Alert className="mb-4 border-warning/40 bg-warning/10 text-warning">
                  <AlertDescription className="text-sm">
                    ⚠️ This waiver requires a printed, signed, and uploaded
                    copy. E-signatures are not available.
                  </AlertDescription>
                </Alert>
              )}

              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">
                  {sortedSigners.indexOf(currentStep.signer) + 1}
                </span>
                Sign as {currentStep.signer.label}
              </h3>

              {disableEsignature ? (
                <div className="space-y-4">
                  <div className="p-6 border-2 border-dashed rounded-lg text-center">
                    <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium mb-2">
                      Print and Upload Required
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Please download the waiver, print it, sign it, and upload
                      a scanned copy.
                    </p>
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" onClick={handleDownload}>
                        Download Waiver PDF
                      </Button>
                      <Button onClick={handleOfflineUpload}>
                        <Upload className="mr-2 h-4 w-4" /> Upload Signed Copy
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <SignatureCapture
                  signerRole={currentStep.signer}
                  onSignatureComplete={(sig) =>
                    handleSignatureComplete(currentStep.signer!.role_key, sig)
                  }
                  existingSignature={signatures[currentStep.signer.role_key]}
                  userName={defaultSignerName}
                  allowUpload={false} // Only draw/type allowed here. Full upload handled separately.
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="p-4 border-t bg-background shrink-0 flex items-center justify-between gap-4 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {currentStep?.type === "review" && !disableEsignature ? (
          // Special footer for review step with choice - no nav buttons
          <div className="w-full text-center text-xs text-muted-foreground">
            Choose your signing method above to continue
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={isSubmitting || currentStepIndex === 0}
              data-testid="waiver-signer-back"
            >
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>

            <div className="flex gap-2">
              {/* Skip button for optional signers */}
              {(currentStep?.type === "sign" ||
                currentStep?.type === "fields") &&
                currentStep.signer &&
                !currentStep.signer.required && (
                  <Button
                    variant="outline"
                    onClick={handleSkipOptionalSigner}
                    disabled={isSubmitting}
                    className="shadow-sm"
                    data-testid="waiver-signer-skip-optional"
                  >
                    Skip (Optional)
                  </Button>
                )}

              {currentStep?.isLast ? (
                <Button
                  onClick={handleSubmit}
                  disabled={!isStepValid || isSubmitting}
                  className="w-32 shadow-md"
                  variant="default" // Primary action
                  data-testid="waiver-signer-complete"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Complete <CheckCircle className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  disabled={
                    !isStepValid ||
                    (currentStep?.type === "review" && !consented)
                  }
                  className="shadow-sm"
                  data-testid="waiver-signer-next"
                >
                  Next <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
