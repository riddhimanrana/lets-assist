"use client";
import { safeConsole } from "@/lib/safe-console";

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
import { useOfflineWaiverUpload } from "./waiver-signing/useOfflineWaiverUpload";
import {
  WaiverDefinitionPending,
  useWaiverDefinitionLoad,
} from "./waiver-signing/WaiverDefinitionLoadContext";
import {
  isSkippableStep,
  stepIndexAfterSkippingSigner,
  withoutSkippedSignerValues,
} from "./waiver-signing/skip-optional-signer";

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
  const definitionLoad = useWaiverDefinitionLoad();
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

  const submitWaiver = async (
    signaturesToSend: Record<string, SignerData>,
    skipped: ReadonlySet<string>,
  ) => {
    try {
      setIsSubmitting(true);

      // A skipped signer contributes neither a signature nor field values.
      const payload: SignaturePayload = {
        signers: Object.values(signaturesToSend).filter(
          (sig) => !skipped.has(sig.role_key),
        ),
        fields: withoutSkippedSignerValues(
          fieldValues,
          effectiveDefinition.fields,
          skipped,
        ) as unknown as Record<string, string | boolean | string[]>,
      };

      await onComplete({
        definitionId: waiverDefinition?.id,
        signatureType: "multi-signer",
        payload,
        signerName: defaultSignerName,
        signerEmail: defaultSignerEmail,
        waiverPdfUrl: safeWaiverPdfUrl || undefined,
      });
      onClose(false);
      toast.success("Waiver signed successfully!");
    } catch (error) {
      safeConsole.error("Submission failed", error);
      toast.error("Failed to sign waiver", {
        description:
          error instanceof Error ? error.message : "Please try again.",
        action: {
          label: "Retry",
          onClick: () => submitWaiver(signaturesToSend, skipped),
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => submitWaiver(signatures, skippedSigners);

  // Skipping works from either of an optional signer's steps. It drops any
  // signature they already gave and moves past all of their remaining steps.
  const skipTarget = isSkippableStep(currentStep)
    ? stepIndexAfterSkippingSigner(steps, currentStepIndex)
    : null;
  const handleSkipOptionalSigner = () => {
    if (!isSkippableStep(currentStep)) return;

    const roleKey = currentStep.signer.role_key;
    const nextSkipped = new Set(skippedSigners).add(roleKey);
    const nextSignatures = { ...signatures };
    delete nextSignatures[roleKey];
    setSkippedSigners(nextSkipped);
    setSignatures(nextSignatures);

    if (skipTarget === null) {
      // Their steps were the last ones, so skipping finishes the waiver.
      void submitWaiver(nextSignatures, nextSkipped);
      return;
    }
    setCurrentStepIndex(skipTarget);
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
    if (sig) {
      // Signing after a skip un-skips the signer, so the signature is sent.
      setSkippedSigners((prev) => {
        if (!prev.has(roleKey)) return prev;
        const next = new Set(prev);
        next.delete(roleKey);
        return next;
      });
    }
  };

  const handleFieldChange = (key: string, value: string | boolean | number) => {
    setFieldValues((prev) => ({
      ...prev,
      [key]: value,
    }));
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
      safeConsole.error("Download failed", error);
      toast.error("Failed to download waiver PDF");
    }
  };

  const handlePrint = () => {
    if (!safeWaiverPdfUrl) return;
    window.open(safeWaiverPdfUrl, "_blank", "noopener,noreferrer");
  };

  const handleOfflineUpload = useOfflineWaiverUpload({
    definitionId: waiverDefinition?.id,
    waiverPdfUrl: safeWaiverPdfUrl,
    signerName: defaultSignerName,
    signerEmail: defaultSignerEmail,
    onComplete,
    onUploaded: () => onClose(false),
    setIsSubmitting,
  });

  const stepsPanelProps = {
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
    skipFinishesWaiver: skipTarget === null,
    handleSubmit,
    isStepValid,
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
            <div
              role="status"
              className="bg-background flex items-center gap-3 rounded-lg p-4 shadow-md"
            >
              <Loader2
                aria-hidden="true"
                className="text-muted-foreground size-4 animate-spin"
              />
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
          {definitionLoad.status !== "ready" ? (
            // Never fall back to a generic signer while the real one is missing.
            <WaiverDefinitionPending state={definitionLoad} />
          ) : isDesktop ? (
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
                        <article className="mx-auto max-w-3xl rounded-lg border bg-background p-5 sm:p-6 space-y-4">
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
                              <Upload
                                data-icon="inline-start"
                                aria-hidden="true"
                              />{" "}
                              Upload signed copy instead
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
                  {...stepsPanelProps}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className="h-full w-full min-h-0 overflow-hidden">
              <WaiverSigningStepsPanel isDesktop={false} {...stepsPanelProps} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
