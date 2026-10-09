"use client";

import { Controller, type UseFormReturn } from "react-hook-form";
import { Download, Eye, Settings, Upload } from "lucide-react";

import {
  FormGroup,
  StepSection,
  ToggleRow,
} from "@/app/projects/create/form-parts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/utils";
import { MAX_WAIVER_PDF_SIZE, type FormValues } from "./edit-project-form";
import type { EditProjectMedia } from "./useEditProjectMedia";

/** Whether volunteers sign a waiver, how, and which PDF they see. */
export function EditProjectWaiver({
  form,
  media,
  projectWaiverPdfUrl,
  blockedReason,
}: {
  form: UseFormReturn<FormValues>;
  media: EditProjectMedia;
  projectWaiverPdfUrl?: string | null;
  /** Why a waiver cannot be required, when it cannot. */
  blockedReason?: string;
}) {
  const waiverRequired = form.watch("waiver_required");
  const esignatureDisabled = form.watch("waiver_disable_esignature");
  const pdfUrl = media.waiverPdfUrl || projectWaiverPdfUrl || null;
  const uploading = media.waiverPdfUploading;

  return (
    <StepSection title="Waiver">
      <FormGroup>
        <Controller
          control={form.control}
          name="waiver_required"
          render={({ field }) => (
            <ToggleRow
              id={field.name}
              label="Require waiver signature"
              description={
                blockedReason && !field.value
                  ? blockedReason
                  : "Volunteers must sign your waiver PDF or the active global waiver definition before signing up."
              }
              checked={field.value}
              onCheckedChange={field.onChange}
              // Turning it off always stays possible.
              disabled={Boolean(blockedReason) && !field.value}
            />
          )}
        />
        <Controller
          control={form.control}
          name="waiver_disable_esignature"
          render={({ field }) => (
            <ToggleRow
              id={field.name}
              label="Enable e-signatures"
              description="Let volunteers draw or type signatures. Print and upload remains available as a backup."
              checked={!field.value}
              onCheckedChange={(checked) => field.onChange(!checked)}
              disabled={!waiverRequired}
            />
          )}
        />
        <Controller
          control={form.control}
          name="waiver_allow_upload"
          render={({ field }) => (
            <ToggleRow
              id={field.name}
              label="Print and upload (backup)"
              description="Print and upload is always available as a backup option for volunteers."
              checked={true}
              onCheckedChange={() => field.onChange(true)}
              disabled
            />
          )}
        />
      </FormGroup>

      {waiverRequired && (
        <FormGroup
          title="Project waiver PDF"
          description="Upload a PDF waiver to show volunteers during signup."
        >
          <input
            ref={media.waiverPdfInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={media.handleWaiverPdfUpload}
            disabled={uploading}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => media.waiverPdfInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" aria-hidden="true" />
              )}
              {uploading
                ? "Uploading waiver..."
                : pdfUrl
                  ? "Replace PDF"
                  : "Click to upload waiver PDF"}
            </Button>
            {pdfUrl ? (
              <>
                {!esignatureDisabled && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => media.setWaiverBuilderOpen(true)}
                  >
                    <Settings data-icon="inline-start" aria-hidden="true" />
                    Configure
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    media.openPreview(pdfUrl, "Waiver PDF", "application/pdf")
                  }
                >
                  <Eye data-icon="inline-start" aria-hidden="true" />
                  Preview
                </Button>
                <Button variant="outline" render={<a href={pdfUrl} download />}>
                  <Download data-icon="inline-start" aria-hidden="true" />
                  Download
                </Button>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  onClick={media.handleRemoveWaiverPdf}
                  disabled={uploading}
                >
                  Remove
                </Button>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">
                Max size: {formatBytes(MAX_WAIVER_PDF_SIZE)}
              </span>
            )}
          </div>

          {media.waiverPdfError && (
            <p className="text-destructive text-sm" role="alert">
              {media.waiverPdfError}
            </p>
          )}

          {media.waiverPdfValidation && (
            <Alert
              variant={
                media.waiverPdfValidation.hasSignatureFields
                  ? "success"
                  : "warning"
              }
            >
              <AlertDescription>
                {media.waiverPdfValidation.hasSignatureFields
                  ? "Signature fields detected. Volunteers can sign directly on the PDF."
                  : media.waiverPdfValidation.warnings.join(" ")}
              </AlertDescription>
            </Alert>
          )}

          {!pdfUrl && (
            <Alert variant="info">
              <AlertDescription>
                If you don&apos;t upload a custom waiver, we&apos;ll use the
                active global waiver definition (or the default Let&apos;s
                Assist waiver text if none is configured yet).
              </AlertDescription>
            </Alert>
          )}
        </FormGroup>
      )}
    </StepSection>
  );
}
