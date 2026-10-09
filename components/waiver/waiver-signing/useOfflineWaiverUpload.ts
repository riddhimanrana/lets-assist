"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import {
  SIGNED_WAIVER_UNREADABLE_MESSAGE,
  SIGNED_WAIVER_UPLOAD_ACCEPT,
  signedWaiverUploadProblem,
} from "@/lib/waiver/upload-limits";
import type { WaiverSignatureInput } from "@/types/waiver";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error(SIGNED_WAIVER_UNREADABLE_MESSAGE));
    reader.onerror = () => reject(new Error(SIGNED_WAIVER_UNREADABLE_MESSAGE));
    reader.readAsDataURL(file);
  });
}

/**
 * The "print, sign and upload" path. It bypasses the signing steps and hands
 * the chosen file to the caller as a single `upload` signature.
 *
 * The picker and the checks here mirror what the server accepts, and a failure
 * shows the reason the caller reported, not a fixed sentence.
 */
export function useOfflineWaiverUpload({
  definitionId,
  waiverPdfUrl,
  signerName,
  signerEmail,
  onComplete,
  onUploaded,
  setIsSubmitting,
}: {
  definitionId?: string;
  waiverPdfUrl: string | null;
  signerName?: string;
  signerEmail?: string;
  onComplete: (payload: WaiverSignatureInput) => Promise<void>;
  onUploaded: () => void;
  setIsSubmitting: (submitting: boolean) => void;
}) {
  return useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = SIGNED_WAIVER_UPLOAD_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const problem = signedWaiverUploadProblem(file);
      if (problem) {
        toast.error(problem);
        return;
      }

      setIsSubmitting(true);
      try {
        await onComplete({
          definitionId,
          signatureType: "upload",
          uploadFileDataUrl: await readAsDataUrl(file),
          uploadFileName: file.name,
          uploadFileType: file.type,
          waiverPdfUrl: waiverPdfUrl || undefined,
          signerName,
          signerEmail,
        });
        onUploaded();
        toast.success("Waiver uploaded successfully!");
      } catch (error) {
        toast.error("The signed waiver was not uploaded", {
          description:
            error instanceof Error && error.message
              ? error.message
              : "Please check your file and try again.",
        });
      } finally {
        setIsSubmitting(false);
      }
    };
    input.click();
  }, [
    definitionId,
    waiverPdfUrl,
    signerName,
    signerEmail,
    onComplete,
    onUploaded,
    setIsSubmitting,
  ]);
}
