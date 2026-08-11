"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  SignerData,
  SignaturePayload,
  WaiverDefinitionFull,
  WaiverDefinitionField,
} from "@/types/waiver-definitions";
import { WaiverSignatureInput } from "@/types/waiver";
import { validateWaiverFieldValue } from "./WaiverFieldForm";
import { Loader2, Upload } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

const PdfViewerWithOverlay = dynamic(
  () =>
    import("./PdfViewerWithOverlay").then(
      (module) => module.PdfViewerWithOverlay,
    ),
  {
    ssr: false,
    loading: () => <Loader2 className="h-8 w-8 animate-spin text-primary" />,
  },
);

const WaiverSigningPdfPane = dynamic(
  () =>
    import("./WaiverSigningPdfPane").then(
      (module) => module.WaiverSigningPdfPane,
    ),
  {
    ssr: false,
    loading: () => <Loader2 className="h-8 w-8 animate-spin text-primary" />,
  },
);

interface WaiverSigningDialogProps {
  isOpen: boolean;
  onClose: (open: boolean) => void;
  waiverDefinition?: WaiverDefinitionFull | null;
  waiverPdfUrl?: string | null;
  onComplete: (payload: WaiverSignatureInput) => Promise<void>;
  defaultSignerName?: string;
  defaultSignerEmail?: string;
  allowUpload?: boolean; // Print/upload backup enabled
  disableEsignature?: boolean; // Print/upload only mode
}

const ALLOWED_WAIVER_URL_PROTOCOLS = new Set(["http:", "https:", "blob:"]);

function normalizeWaiverPdfUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url, window.location.origin);
    if (!ALLOWED_WAIVER_URL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

import { WaiverSigningStepsPanel } from "./waiver-signing/WaiverSigningStepsPanel";
import { useWaiverSigningDefinition } from "./waiver-signing/useWaiverSigningDefinition";

export function WaiverSigningDialog({
  isOpen,
  onClose,
  waiverDefinition,
  waiverPdfUrl,
  onComplete,
  defaultSignerName,
  defaultSignerEmail,
  allowUpload = true,
  disableEsignature = false,
}: WaiverSigningDialogProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [consented, setConsented] = useState(false);
  const [fieldValues, setFieldValues] = useState<
    Record<string, string | boolean | number>
  >({});
  const [signatures, setSignatures] = useState<Record<string, SignerData>>({});
  const [skippedSigners, setSkippedSigners] = useState<Set<string>>(new Set());
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const safeWaiverPdfUrl = useMemo(
    () => normalizeWaiverPdfUrl(waiverPdfUrl),
    [waiverPdfUrl],
  );

  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      setConsented(false);
      setFieldValues({});
      setSignatures({});
      setSkippedSigners(new Set());
      setSelectedFieldKey(null);
    }
  }, [isOpen]);

  const {
    effectiveDefinition,
    sortedSigners,
    steps,
    generatedWaiverPreview,
    allPlacements,
  } = useWaiverSigningDefinition(waiverDefinition, safeWaiverPdfUrl);
  const currentStep = steps[currentStepIndex];
  const hasPdfDocument = Boolean(safeWaiverPdfUrl);

  // Logic to determine if current step is valid
  const isStepValid = useMemo(() => {
    if (!currentStep) return false;

    if (currentStep.type === "review") {
      return consented;
    }

    if (currentStep.type === "fields") {
      let stepFields: WaiverDefinitionField[] = [];
      if (currentStep.signer) {
        stepFields = effectiveDefinition.fields.filter(
          (f) =>
            f.signer_role_key === currentStep.signer?.role_key &&
            f.field_type !== "signature",
        );
      } else if (currentStep.id === "global-fields") {
        stepFields = effectiveDefinition.fields.filter(
          (f) => !f.signer_role_key && f.field_type !== "signature",
        );
      }

      return stepFields.every((field) => {
        const value = fieldValues[field.field_key];
        return validateWaiverFieldValue(field, value).valid;
      });
    }

    if (currentStep.type === "sign" && currentStep.signer) {
      // Optional signers can be skipped (valid without signature)
      if (!currentStep.signer.required) {
        return true;
      }
      return !!signatures[currentStep.signer.role_key];
    }

    return true;
  }, [
    currentStep,
    consented,
    fieldValues,
    signatures,
    effectiveDefinition.fields,
  ]);

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleSkipOptionalSigner = () => {
    if (
      currentStep?.type === "sign" &&
      currentStep.signer &&
      !currentStep.signer.required
    ) {
      setSkippedSigners((prev) =>
        new Set(prev).add(currentStep.signer!.role_key),
      );
      handleNext();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleSignatureComplete = (roleKey: string, sig: SignerData | null) => {
    setSignatures((prev) => {
      const next = { ...prev };
      if (sig) {
        next[roleKey] = sig;
      } else {
        delete next[roleKey];
      }
      return next;
    });
  };

  const handleFieldChange = (key: string, value: string | boolean | number) => {
    setFieldValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      // Filter out skipped signers from payload
      const activeSigners = Object.values(signatures).filter(
        (sig) => !skippedSigners.has(sig.role_key),
      );

      const payload: SignaturePayload = {
        signers: activeSigners,
        fields: fieldValues as unknown as Record<
          string,
          string | boolean | string[]
        >,
      };

      // Convert to WaiverSignatureInput
      const input: WaiverSignatureInput = {
        definitionId: waiverDefinition?.id,
        signatureType: "multi-signer",
        payload: payload,
        signerName: defaultSignerName,
        signerEmail: defaultSignerEmail,
        waiverPdfUrl: safeWaiverPdfUrl || undefined,
      };

      await onComplete(input);
      onClose(false);
      toast.success("Waiver signed successfully!");
    } catch (error) {
      console.error("Submission failed", error);
      toast.error("Failed to sign waiver", {
        description:
          error instanceof Error ? error.message : "Please try again.",
        action: {
          label: "Retry",
          onClick: () => handleSubmit(),
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = async () => {
    if (!safeWaiverPdfUrl) return;

    try {
      const response = await fetch(safeWaiverPdfUrl);
      if (!response.ok) {
        throw new Error(`Failed to download waiver: ${response.status}`);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "waiver-document.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Download failed", error);
      toast.error("Failed to download waiver PDF");
    }
  };

  const handlePrint = () => {
    if (!safeWaiverPdfUrl) return;
    window.open(safeWaiverPdfUrl, "_blank", "noopener,noreferrer");
  };

  // Offline Upload Handling (Phase 4 Requirement)
  // This essentially bypasses the wizard and uploads a file
  const handleOfflineUpload = () => {
    // Create a hidden file input and click it
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // Convert to base64 data url for submission
      const reader = new FileReader();
      reader.onload = async (item) => {
        const dataUrl = item.target?.result as string;

        setIsSubmitting(true);
        try {
          // This is SINGLE-SIGNATURE offline upload mode
          // Not multi-signer! Use WaiverSignatureInput format
          const uploadInput: WaiverSignatureInput = {
            definitionId: waiverDefinition?.id,
            signatureType: "upload", // Single upload type
            uploadFileDataUrl: dataUrl,
            uploadFileName: file.name,
            uploadFileType: file.type,
            waiverPdfUrl: safeWaiverPdfUrl || undefined,
            signerName: defaultSignerName,
            signerEmail: defaultSignerEmail,
          };

          await onComplete(uploadInput);
          onClose(false);
          toast.success("Waiver uploaded successfully!");
        } catch (err) {
          console.error("Upload failed", err);
          toast.error("Failed to upload waiver", {
            description: "Please check your file and try again.",
          });
        } finally {
          setIsSubmitting(false);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(val) => !isSubmitting && onClose(val)}
      modal={true}
    >
      <DialogContent
        data-testid="waiver-signer-dialog"
        className="w-[98vw] sm:max-w-[calc(100vw-2rem)] lg:max-w-350 h-[95vh] sm:h-[92vh] p-0 gap-0 overflow-hidden flex flex-col top-[2.5vh] translate-y-0"
        showCloseButton={true}
      >
        {/* Loading Overlay During Submission */}
        {isSubmitting && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center">
            <div className="bg-background rounded-lg p-6 shadow-xl">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-sm font-medium">Adding your e-signature...</p>
            </div>
          </div>
        )}

        <DialogHeader className="p-4 border-b shrink-0 bg-background z-20">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>
                {effectiveDefinition?.title || "Review & Sign Waiver"}
              </DialogTitle>
              <DialogDescription className="hidden sm:block">
                {currentStep?.title}
              </DialogDescription>
            </div>
            {/* Global Progress Indicator (Desktop) */}
            {isDesktop && (
              <div className="text-sm text-muted-foreground mr-8">
                Step {currentStepIndex + 1} of {steps.length}
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {isDesktop ? (
            <ResizablePanelGroup
              orientation="horizontal"
              className="h-full w-full"
            >
              <ResizablePanel
                defaultSize="56%"
                minSize="34%"
                maxSize="62%"
                className="min-w-0 bg-muted/20"
              >
                <div className="h-full w-full relative">
                  {hasPdfDocument ? (
                    allPlacements.length > 0 ? (
                      <PdfViewerWithOverlay
                        pdfUrl={safeWaiverPdfUrl!}
                        detectedFields={[]}
                        customPlacements={allPlacements}
                        selectedPlacementId={selectedFieldKey || undefined}
                        onPlacementClick={(placementId) => {
                          setSelectedFieldKey(placementId);
                        }}
                        onDetectedFieldClick={undefined}
                        onAddPlacement={() => {}}
                        onPlacementResize={undefined}
                        mode="view"
                        highlightedField={null}
                        valueLayer={{
                          fieldValues,
                          signatures,
                        }}
                      />
                    ) : (
                      <WaiverSigningPdfPane
                        pdfUrl={safeWaiverPdfUrl!}
                        onDownload={handleDownload}
                        onPrint={handlePrint}
                        className="h-full w-full border-none rounded-none"
                      />
                    )
                  ) : (
                    <div className="h-full flex flex-col bg-muted/20">
                      <div className="px-4 py-3 border-b bg-background/90 text-xs text-muted-foreground">
                        No waiver PDF is configured. Showing a generated waiver
                        preview.
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                        <article className="mx-auto max-w-3xl rounded-lg border bg-background shadow-sm p-5 sm:p-6 space-y-4">
                          <h3 className="text-base font-semibold">
                            {effectiveDefinition?.title || "Waiver"}
                          </h3>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-6">
                            {generatedWaiverPreview}
                          </p>
                          <div className="pt-3 border-t text-xs text-muted-foreground">
                            This generated text is shown because no signed
                            waiver PDF is currently available.
                          </div>
                        </article>
                        {allowUpload && (
                          <div className="mt-4 flex justify-center">
                            <Button
                              variant="outline"
                              onClick={handleOfflineUpload}
                            >
                              <Upload className="mr-2 h-4 w-4" /> Upload Signed
                              Copy Instead
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </ResizablePanel>

              <ResizableHandle
                withHandle
                className="bg-border/70 hover:bg-border transition-colors"
              />

              <ResizablePanel
                defaultSize="44%"
                minSize="38%"
                maxSize="66%"
                className="min-w-0"
              >
                <WaiverSigningStepsPanel
                  isDesktop={true}
                  currentStepIndex={currentStepIndex}
                  steps={steps}
                  currentStep={currentStep}
                  hasPdfDocument={hasPdfDocument}
                  generatedWaiverPreview={generatedWaiverPreview}
                  safeWaiverPdfUrl={safeWaiverPdfUrl}
                  handleDownload={handleDownload}
                  handlePrint={handlePrint}
                  handleOfflineUpload={handleOfflineUpload}
                  consented={consented}
                  setConsented={setConsented}
                  effectiveDefinition={effectiveDefinition}
                  disableEsignature={disableEsignature}
                  allowUpload={allowUpload}
                  handleNext={handleNext}
                  sortedSigners={sortedSigners}
                  fieldValues={fieldValues}
                  handleFieldChange={handleFieldChange}
                  handleSignatureComplete={handleSignatureComplete}
                  signatures={signatures}
                  defaultSignerName={defaultSignerName}
                  handleBack={handleBack}
                  isSubmitting={isSubmitting}
                  handleSkipOptionalSigner={handleSkipOptionalSigner}
                  handleSubmit={handleSubmit}
                  isStepValid={isStepValid}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className="h-full w-full min-h-0 overflow-hidden">
              {/* Right Panel / Steps Container */}
              <WaiverSigningStepsPanel
                isDesktop={false}
                currentStepIndex={currentStepIndex}
                steps={steps}
                currentStep={currentStep}
                hasPdfDocument={hasPdfDocument}
                generatedWaiverPreview={generatedWaiverPreview}
                safeWaiverPdfUrl={safeWaiverPdfUrl}
                handleDownload={handleDownload}
                handlePrint={handlePrint}
                handleOfflineUpload={handleOfflineUpload}
                consented={consented}
                setConsented={setConsented}
                effectiveDefinition={effectiveDefinition}
                disableEsignature={disableEsignature}
                allowUpload={allowUpload}
                handleNext={handleNext}
                sortedSigners={sortedSigners}
                fieldValues={fieldValues}
                handleFieldChange={handleFieldChange}
                handleSignatureComplete={handleSignatureComplete}
                signatures={signatures}
                defaultSignerName={defaultSignerName}
                handleBack={handleBack}
                isSubmitting={isSubmitting}
                handleSkipOptionalSigner={handleSkipOptionalSigner}
                handleSubmit={handleSubmit}
                isStepValid={isStepValid}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
