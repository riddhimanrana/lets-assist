import "server-only";
import { safeConsole } from "@/lib/safe-console";

import { getAdminClient } from "@/lib/supabase/admin";
import { type WaiverSignatureInput } from "@/types";
import {
  SIGNED_WAIVER_UPLOAD_MAX_BYTES,
  SIGNED_WAIVER_UPLOAD_TYPES,
  signedWaiverUploadFailureMessage,
} from "@/lib/waiver/upload-limits";
import {
  MAX_WAIVER_SIGNATURE_BYTES,
  WAIVER_SIGNATURE_BUCKET,
  parseDataUrl,
} from "./shared";
import { buildWaiverEvidencePath } from "@/lib/waiver/evidence-path";
import { waiverFileProblem } from "@/lib/waiver/file-validation";

export async function uploadWaiverAsset(params: {
  bucket: string;
  dataUrl: string;
  fileName: string;
  maxBytes: number;
  allowedTypes?: string[];
}) {
  const parsed = parseDataUrl(params.dataUrl);
  if (!parsed) {
    return { error: "Invalid file data.", reason: "invalid" as const };
  }

  if (
    params.allowedTypes &&
    !params.allowedTypes.includes(parsed.contentType)
  ) {
    return { error: "Unsupported file type.", reason: "type" as const };
  }

  if (parsed.size > params.maxBytes) {
    return { error: "File is too large.", reason: "size" as const };
  }

  if (await waiverFileProblem(parsed.buffer, parsed.contentType)) {
    return {
      error: "The waiver file could not be read.",
      reason: "invalid" as const,
    };
  }

  const serviceSupabase = getAdminClient();
  const { error: uploadError } = await serviceSupabase.storage
    .from(params.bucket)
    .upload(params.fileName, parsed.buffer, {
      contentType: parsed.contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    safeConsole.error("Error uploading waiver asset:", uploadError);
    return {
      error: "Failed to upload waiver file.",
      reason: "storage" as const,
    };
  }

  return { path: params.fileName, contentType: parsed.contentType };
}

export type StoredWaiverSignatureAssets =
  | {
      signaturePayload: Record<string, unknown> | null;
      signatureStoragePath: string | null;
      uploadStoragePath: string | null;
      uploadedPaths: string[];
    }
  | { error: string; uploadedPaths: string[] };

/**
 * Stores the signature assets of one submission in the private evidence
 * bucket. The caller has already proven the placement against the source PDF,
 * and it alone builds the evidence row from the paths returned here.
 */
export async function storeWaiverSignatureAssets(params: {
  projectId: string;
  evidenceKey: string;
  waiverSignature: WaiverSignatureInput;
  waiverAllowUpload: boolean;
  hasWaiverSource: boolean;
  adminClient: ReturnType<typeof getAdminClient>;
}): Promise<StoredWaiverSignatureAssets> {
  let signaturePayload: Record<string, unknown> | null = null;
  let signatureStoragePath: string | null = null;
  let uploadStoragePath: string | null = null;
  const uploadedSignaturePaths: string[] = [];

  const removeUploadedSignatureAssets = async () => {
    if (uploadedSignaturePaths.length === 0) return;

    const { error } = await params.adminClient.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .remove(uploadedSignaturePaths);

    if (error) {
      safeConsole.error("Failed to roll back uploaded waiver assets:", error);
    }
  };

  // Handle Multi-Signer Payload (Phase 4)
  if (
    params.waiverSignature.signatureType === "multi-signer" &&
    params.waiverSignature.payload
  ) {
    const rawPayload = params.waiverSignature.payload;
    const processedSigners = [];

    // Phase 1: Validate upload permissions for multi-signer flow
    for (const signer of rawPayload.signers) {
      if (signer.method === "upload" && !params.waiverAllowUpload) {
        return {
          error: "Signature upload is not allowed for this project.",
          uploadedPaths: uploadedSignaturePaths,
        };
      }
    }

    // Process each signer (upload assets)
    for (const signer of rawPayload.signers) {
      // Checked here for every project, with or without a waiver definition.
      // A signer whose method is not one of these would keep its `data` as
      // sent, and that value is later read as a storage path.
      if (
        signer.method !== "draw" &&
        signer.method !== "typed" &&
        signer.method !== "upload"
      ) {
        await removeUploadedSignatureAssets();
        return {
          error: "One of the waiver signatures is not in a supported format.",
          uploadedPaths: uploadedSignaturePaths,
        };
      }
      const processedSigner = { ...signer };

      if (
        signer.data &&
        (signer.method === "draw" || signer.method === "upload")
      ) {
        // Phase 1: Multi-signer signatures are ONLY images, never full PDFs
        // The "upload" method here refers to uploading a signature image, not a full waiver PDF
        const bucket = WAIVER_SIGNATURE_BUCKET; // Always use signature bucket for multi-signer assets
        const maxBytes = MAX_WAIVER_SIGNATURE_BYTES;
        const allowedTypes = ["image/png", "image/jpeg", "image/jpg"]; // Images only

        // Detect file extension from data URL for proper storage
        const parsed = parseDataUrl(signer.data);
        let fileExt = "png"; // default
        if (
          parsed?.contentType === "image/jpeg" ||
          parsed?.contentType === "image/jpg"
        ) {
          fileExt = "jpg";
        }

        const fileName = buildWaiverEvidencePath({
          folder: "signatures",
          projectId: params.projectId,
          evidenceKey: params.evidenceKey,
          extension: fileExt,
        });

        // Upload asset
        const uploadResult = await uploadWaiverAsset({
          bucket,
          dataUrl: signer.data,
          fileName,
          maxBytes,
          allowedTypes,
        });

        if (uploadResult.error) {
          await removeUploadedSignatureAssets();
          safeConsole.error("Error uploading signer asset", {
            signerRoleKey: signer.role_key,
            uploadError: uploadResult.error,
          });
          return {
            error: "Failed to upload one of the required signature assets.",
            uploadedPaths: uploadedSignaturePaths,
          };
        }

        // Replace data with storage path
        processedSigner.data = uploadResult.path || "";
        if (uploadResult.path) uploadedSignaturePaths.push(uploadResult.path);
      }
      processedSigners.push(processedSigner);
    }

    signaturePayload = {
      ...rawPayload,
      signers: processedSigners,
    };
  }

  if (params.waiverSignature.signatureType === "draw") {
    const drawContentType = parseDataUrl(
      params.waiverSignature.signatureImageDataUrl ?? "",
    )?.contentType;
    const extension =
      drawContentType === "image/jpeg" || drawContentType === "image/jpg"
        ? "jpg"
        : "png";
    const uploadResult = await uploadWaiverAsset({
      bucket: WAIVER_SIGNATURE_BUCKET,
      dataUrl: params.waiverSignature.signatureImageDataUrl ?? "",
      fileName: buildWaiverEvidencePath({
        folder: "signatures",
        projectId: params.projectId,
        evidenceKey: params.evidenceKey,
        extension,
      }),
      maxBytes: MAX_WAIVER_SIGNATURE_BYTES,
      allowedTypes: ["image/png", "image/jpeg", "image/jpg"],
    });

    if (uploadResult.error || !uploadResult.path) {
      return {
        error: "Failed to store the drawn signature.",
        uploadedPaths: uploadedSignaturePaths,
      };
    }

    signatureStoragePath = uploadResult.path;
    uploadedSignaturePaths.push(uploadResult.path);
  }

  if (params.waiverSignature.signatureType === "upload") {
    if (!params.waiverAllowUpload) {
      await removeUploadedSignatureAssets();
      return {
        error: "Signed waiver uploads are not allowed for this project.",
        uploadedPaths: uploadedSignaturePaths,
      };
    }

    if (!params.hasWaiverSource) {
      await removeUploadedSignatureAssets();
      return {
        error:
          "A configured waiver document is required before uploading a signed copy.",
        uploadedPaths: uploadedSignaturePaths,
      };
    }

    const contentType = parseDataUrl(
      params.waiverSignature.uploadFileDataUrl ?? "",
    )?.contentType;
    const extension =
      contentType === "application/pdf"
        ? "pdf"
        : contentType === "image/jpeg" || contentType === "image/jpg"
          ? "jpg"
          : "png";
    const uploadResult = await uploadWaiverAsset({
      bucket: WAIVER_SIGNATURE_BUCKET,
      dataUrl: params.waiverSignature.uploadFileDataUrl ?? "",
      fileName: buildWaiverEvidencePath({
        folder: "signed-waivers",
        projectId: params.projectId,
        evidenceKey: params.evidenceKey,
        extension,
      }),
      maxBytes: SIGNED_WAIVER_UPLOAD_MAX_BYTES,
      allowedTypes: [...SIGNED_WAIVER_UPLOAD_TYPES, "image/jpg"],
    });

    if (uploadResult.error || !uploadResult.path) {
      await removeUploadedSignatureAssets();
      return {
        // Say which rule the file broke, so the volunteer can fix it.
        error: signedWaiverUploadFailureMessage(uploadResult.reason),
        uploadedPaths: uploadedSignaturePaths,
      };
    }

    uploadStoragePath = uploadResult.path;
    uploadedSignaturePaths.push(uploadResult.path);
  }

  return {
    signaturePayload,
    signatureStoragePath,
    uploadStoragePath,
    uploadedPaths: uploadedSignaturePaths,
  };
}
