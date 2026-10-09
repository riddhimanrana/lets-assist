"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useRef, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  FileText,
  Loader2,
  X,
} from "lucide-react";

import { UploadIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import {
  WaiverBuilderDialog,
  WaiverDefinitionInput,
} from "@/components/waiver/WaiverBuilderDialog";
import { cn } from "@/lib/utils";
import { SIGNED_WAIVER_RETENTION_NOTICE } from "@/lib/waiver/retention";

import { FormField, FormGroup, ToggleRow } from "./form-parts";

export interface WaiverSettingsProps {
  waiverRequired: boolean;
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
  /** What still blocks this step, shown once Continue was pressed. */
  error?: string;
}

export function WaiverSettings({
  waiverRequired,
  waiverDisableEsignature,
  waiverPdfFile,
  waiverPdfUrl,
  waiverPdfValidation,
  waiverDefinition,
  detectedFields,
  showWaiverReuploadNotice = false,
  updateWaiverRequiredAction,
  updateWaiverAllowUploadAction,
  updateWaiverDisableEsignatureAction,
  updateWaiverPdfFileAction,
  updateWaiverPdfValidationAction,
  updateWaiverDefinitionAction,
  updateDetectedFieldsAction,
  clearWaiverPdfAction,
  error,
}: WaiverSettingsProps) {
  const [isValidatingPdf, setIsValidatingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB

  const validatePdfFile = useCallback(
    async (file: File) => {
      setIsValidatingPdf(true);
      setPdfError(null);

      try {
        // ... existing checks ...
        // Check file type
        if (file.type !== "application/pdf") {
          setPdfError("Please upload a PDF file");
          setIsValidatingPdf(false);
          return;
        }

        // Check file size
        if (file.size > MAX_PDF_SIZE) {
          setPdfError("File size must be less than 10MB");
          setIsValidatingPdf(false);
          return;
        }

        // Read file and validate structure
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Check PDF header
        const header = String.fromCharCode(...bytes.slice(0, 5));
        if (header !== "%PDF-") {
          setPdfError("Invalid PDF file");
          setIsValidatingPdf(false);
          return;
        }

        // Use PDF.js-based widget detection with dynamic import to avoid server-side issues
        const { detectPdfWidgets } =
          await import("@/lib/waiver/pdf-field-detect");
        const detectionResult = await detectPdfWidgets(file);

        const warnings: string[] = [];

        // Simplified user-facing messages
        if (!detectionResult.success) {
          // Log technical details to console for debugging
          if (detectionResult.errors) {
            safeConsole.warn("PDF analysis warnings:", detectionResult.errors);
          }
        }

        if (!detectionResult.hasSignatureFields) {
          warnings.push(
            "No pre-filled signature fields detected. You can configure custom signature placements in the next step.",
          );
        } else if (
          detectionResult.success &&
          detectionResult.fields.length > 0
        ) {
          const sigFields = detectionResult.fields.filter(
            (f) => f.fieldType === "signature",
          );
          warnings.push(
            `Found ${sigFields.length} signature field(s) and ${detectionResult.fields.length - sigFields.length} other form field(s).`,
          );
        }

        // Update state
        updateWaiverPdfFileAction?.(file);
        updateWaiverPdfValidationAction?.({
          hasSignatureFields: detectionResult.hasSignatureFields,
          warnings,
        });

        // Store detected fields and open builder
        if (detectionResult.success) {
          updateDetectedFieldsAction?.(detectionResult.fields);
          // Open builder automatically
          setShowBuilder(true);
        }
      } catch (error) {
        safeConsole.error("Error validating PDF:", error);
        setPdfError("Error reading PDF file. Please try again.");
      } finally {
        setIsValidatingPdf(false);
      }
    },
    [
      updateWaiverPdfFileAction,
      updateWaiverPdfValidationAction,
      updateDetectedFieldsAction,
    ],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        validatePdfFile(file);
      }
    },
    [validatePdfFile],
  );

  const handleRemovePdf = useCallback(() => {
    clearWaiverPdfAction?.();
    setPdfError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [clearWaiverPdfAction]);

  const hasWaiverPdf = waiverPdfFile || waiverPdfUrl;
  const uploadIcon = useAnimatedIcon();

  return (
    <FormGroup
      title="Waiver and consent"
      description="Upload your organization's waiver PDF and require volunteers to sign it during signup. Supports e-signatures (draw or type)."
    >
      <ToggleRow
        id="waiver-required"
        label="Require waiver signature"
        description="Volunteers must sign your waiver before completing signup."
        checked={waiverRequired}
        onCheckedChange={updateWaiverRequiredAction}
      />

      {waiverRequired && (
        <>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant={hasWaiverPdf ? "warning" : "destructive"}>
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>
                {hasWaiverPdf
                  ? "Waiver-enabled projects must be created directly; drafts aren't available for these projects."
                  : "Upload the waiver PDF before you can continue or save this project."}
              </AlertDescription>
            </Alert>
          )}

          {showWaiverReuploadNotice && !hasWaiverPdf && (
            <Alert variant="warning">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>
                <span className="text-foreground font-medium">
                  Draft restored:
                </span>{" "}
                Your waiver signer configuration was saved, but waiver PDFs are
                not stored in drafts. Please re-upload your waiver PDF to use
                your saved configuration.
                {waiverDefinition?.signers?.length
                  ? ` (${waiverDefinition.signers.length} signer role${waiverDefinition.signers.length !== 1 ? "s" : ""} ready.)`
                  : ""}
              </AlertDescription>
            </Alert>
          )}

          {/* PDF Upload Section */}
          {!hasWaiverPdf ? (
            <FormField
              label="Waiver document (PDF)"
              htmlFor="waiver-pdf"
              description="Projects must have custom waivers. Upload a PDF to enable waiver collection."
              error={pdfError}
            >
              <button
                id="waiver-pdf"
                type="button"
                disabled={isValidatingPdf}
                aria-invalid={pdfError ? true : undefined}
                onClick={() => fileInputRef.current?.click()}
                {...uploadIcon.triggerProps}
                className={cn(
                  "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center outline-none transition-colors focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50",
                  pdfError && "border-destructive",
                )}
              >
                {isValidatingPdf ? (
                  <>
                    <Loader2
                      aria-hidden="true"
                      className="text-muted-foreground size-5 animate-spin"
                    />
                    <span className="text-muted-foreground text-sm">
                      Validating PDF...
                    </span>
                  </>
                ) : (
                  <>
                    <UploadIcon
                      ref={uploadIcon.ref}
                      size={20}
                      aria-hidden="true"
                      className="text-muted-foreground"
                    />
                    <span className="text-sm font-medium">
                      Click to upload your waiver PDF
                    </span>
                    <span className="text-muted-foreground text-xs">
                      Max size: 10MB
                    </span>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </FormField>
          ) : (
            <FormField label="Waiver document (PDF)">
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <FileText
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0"
                />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="truncate text-sm font-medium">
                    {waiverPdfFile?.name || "Waiver PDF"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {waiverPdfFile?.size !== undefined
                      ? `${(waiverPdfFile.size / 1024).toFixed(1)} KB`
                      : "Uploaded"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="icon"
                  aria-label="Remove waiver PDF"
                  onClick={handleRemovePdf}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>

              {/* Validation Feedback */}
              {waiverPdfValidation &&
                (waiverPdfValidation.hasSignatureFields ? (
                  <Alert variant="success">
                    <CheckCircle2 aria-hidden="true" />
                    <AlertDescription>
                      Signature fields detected in the PDF.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="warning">
                    <AlertTriangle aria-hidden="true" />
                    <AlertDescription>
                      {waiverPdfValidation.warnings.join(" ")}
                    </AlertDescription>
                  </Alert>
                ))}

              {/* Builder Trigger */}
              {waiverDefinition ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="grid gap-0.5">
                    <p className="text-sm font-medium">Waiver configured</p>
                    <p className="text-muted-foreground text-xs">
                      {waiverDefinition.signers.length} signer role(s) defined.
                    </p>
                  </div>
                  {!waiverDisableEsignature && (
                    <Button
                      variant="outline"
                      onClick={() => setShowBuilder(true)}
                    >
                      Edit configuration
                    </Button>
                  )}
                </div>
              ) : (
                !waiverDisableEsignature && (
                  <div className="grid gap-2">
                    <Button
                      variant="outline"
                      className="justify-self-start"
                      onClick={() => setShowBuilder(true)}
                    >
                      <FileSignature
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      Configure waiver signers & fields
                    </Button>
                    <p className="text-muted-foreground text-sm">
                      You must configure signature placements before continuing.
                    </p>
                  </div>
                )
              )}
            </FormField>
          )}

          {/* Waiver Builder Dialog */}
          {showBuilder && (
            <WaiverBuilderDialog
              open={showBuilder}
              onOpenChange={setShowBuilder}
              pdfFile={waiverPdfFile || null}
              pdfUrl={waiverPdfUrl || null}
              detectedFields={detectedFields || []}
              onSave={async (def) => {
                updateWaiverDefinitionAction?.(def);
              }}
              existingDefinition={undefined} // No existing DB definition yet
              existingDraftDefinition={waiverDefinition ?? null}
              autoSaveDraft
            />
          )}

          {/* E-Signature Option */}
          <ToggleRow
            id="waiver-enable-esign"
            label="Enable e-signatures"
            description="Let volunteers draw or type signatures. Print and upload remains available as backup."
            checked={!waiverDisableEsignature}
            onCheckedChange={(checked) =>
              updateWaiverDisableEsignatureAction(!checked)
            }
            disabled={!waiverRequired}
          />

          {/* Print & Upload Backup */}
          <ToggleRow
            id="waiver-allow-upload"
            label="Print and upload (backup)"
            description="Always available as a backup option for volunteers."
            checked={true}
            onCheckedChange={() => updateWaiverAllowUploadAction(true)}
            disabled
          />

          <p className="text-muted-foreground text-sm">
            {SIGNED_WAIVER_RETENTION_NOTICE}
          </p>
        </>
      )}

      {!waiverRequired && (
        <p className="text-muted-foreground text-sm">
          Enable this if your organization requires volunteers to sign a
          liability waiver or consent form.
        </p>
      )}
    </FormGroup>
  );
}
