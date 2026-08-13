import "server-only";

import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { type WaiverSignatureInput } from "@/types";
import {
  MAX_WAIVER_SIGNATURE_BYTES,
  MAX_WAIVER_UPLOAD_BYTES,
  WAIVER_SIGNATURE_BUCKET,
  getRequestMetadata,
  isMissingWaiverDisableEsignatureColumnError,
  parseDataUrl,
} from "./shared";

export async function uploadWaiverAsset(params: {
  bucket: string;
  dataUrl: string;
  fileName: string;
  maxBytes: number;
  allowedTypes?: string[];
}) {
  const parsed = parseDataUrl(params.dataUrl);
  if (!parsed) {
    return { error: "Invalid file data." };
  }

  if (
    params.allowedTypes &&
    !params.allowedTypes.includes(parsed.contentType)
  ) {
    return { error: "Unsupported file type." };
  }

  if (parsed.size > params.maxBytes) {
    return { error: "File is too large." };
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
    console.error("Error uploading waiver asset:", uploadError);
    return { error: "Failed to upload waiver file." };
  }

  return { path: params.fileName, contentType: parsed.contentType };
}

export async function getCurrentSignups(
  projectId: string,
  scheduleId: string,
): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("project_signups")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("schedule_id", scheduleId)
    .in("status", ["approved", "attended"]);

  return count || 0;
}

export async function persistWaiverSignature(params: {
  projectId: string;
  signupId: string;
  userId?: string | null;
  anonymousId?: string | null;
  signerName: string;
  signerEmail: string;
  waiverSignature: WaiverSignatureInput;
}) {
  const serviceSupabase = getAdminClient();

  // Check for project-specific waiver PDF first
  let { data: project } = await serviceSupabase
    .from("projects")
    .select(
      "waiver_pdf_url, waiver_pdf_storage_path, waiver_allow_upload, waiver_disable_esignature, waiver_definition_id",
    )
    .eq("id", params.projectId)
    .maybeSingle();

  if (!project) {
    const { data: fallbackProject, error: fallbackError } =
      await serviceSupabase
        .from("projects")
        .select(
          "waiver_pdf_url, waiver_pdf_storage_path, waiver_allow_upload, waiver_definition_id",
        )
        .eq("id", params.projectId)
        .maybeSingle();

    if (
      fallbackError &&
      !isMissingWaiverDisableEsignatureColumnError(fallbackError)
    ) {
      console.error("Error fetching project waiver settings:", fallbackError);
    }

    if (fallbackProject) {
      project = {
        ...fallbackProject,
        waiver_disable_esignature: false,
      };
    }
  }

  if (!project) {
    return { error: "Project not found." };
  }

  const waiverDefinitionIdInput =
    params.waiverSignature.definitionId?.trim() || null;
  const waiverDefinitionId: string | null =
    waiverDefinitionIdInput || project.waiver_definition_id;

  let waiverPdfUrl: string | null = project.waiver_pdf_url || null;
  let waiverPdfStoragePath: string | null =
    project.waiver_pdf_storage_path || null;
  // Phase 1: Default to true for backward compatibility with projects created before this feature
  const waiverAllowUpload = project?.waiver_disable_esignature
    ? true
    : (project?.waiver_allow_upload ?? true);

  // New system: waiver_definitions are the canonical waiver source (PDF + placements).
  if (waiverDefinitionId) {
    if (project.waiver_definition_id !== waiverDefinitionId) {
      return {
        error: "The waiver definition does not belong to this project.",
      };
    }

    const { data: definition, error: defError } = await serviceSupabase
      .from("waiver_definitions")
      .select("id, pdf_public_url, pdf_storage_path")
      .eq("id", waiverDefinitionId)
      .eq("project_id", params.projectId)
      .limit(1)
      .maybeSingle();

    if (defError || !definition) {
      console.error("Invalid waiver definition in signature payload", {
        projectId: params.projectId,
        signupId: params.signupId,
        waiverDefinitionId,
        defError,
      });
      return { error: "Invalid waiver definition." };
    }

    // A definition is the immutable source used by historical signatures.
    waiverPdfUrl = definition.pdf_public_url || waiverPdfUrl;
    waiverPdfStoragePath = definition.pdf_storage_path || waiverPdfStoragePath;
  }

  // No global waiver fallback - projects must have custom waivers

  const { ipAddress, userAgent } = await getRequestMetadata();
  let signaturePayload: Record<string, unknown> | null = null;
  let signatureStoragePath: string | null = null;
  let uploadStoragePath: string | null = null;
  const uploadedSignaturePaths: string[] = [];

  const removeUploadedSignatureAssets = async () => {
    if (uploadedSignaturePaths.length === 0) return;

    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .remove(uploadedSignaturePaths);

    if (error) {
      console.error("Failed to roll back uploaded waiver assets:", error);
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
      if (signer.method === "upload" && !waiverAllowUpload) {
        return { error: "Signature upload is not allowed for this project." };
      }
    }

    // Process each signer (upload assets)
    for (const signer of rawPayload.signers) {
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

        const fileName = `waiver_${params.signupId}_${signer.role_key}_${Date.now()}.${fileExt}`;

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
          console.error("Error uploading signer asset", {
            signerRoleKey: signer.role_key,
            uploadError: uploadResult.error,
          });
          return {
            error: "Failed to upload one of the required signature assets.",
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
      fileName: `signatures/${params.projectId}/${params.signupId}/${crypto.randomUUID()}.${extension}`,
      maxBytes: MAX_WAIVER_SIGNATURE_BYTES,
      allowedTypes: ["image/png", "image/jpeg", "image/jpg"],
    });

    if (uploadResult.error || !uploadResult.path) {
      return { error: "Failed to store the drawn signature." };
    }

    signatureStoragePath = uploadResult.path;
    uploadedSignaturePaths.push(uploadResult.path);
  }

  if (params.waiverSignature.signatureType === "upload") {
    if (!waiverAllowUpload) {
      await removeUploadedSignatureAssets();
      return {
        error: "Signed waiver uploads are not allowed for this project.",
      };
    }

    if (!waiverPdfStoragePath && !waiverPdfUrl) {
      await removeUploadedSignatureAssets();
      return {
        error:
          "A configured waiver document is required before uploading a signed copy.",
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
      fileName: `signed-waivers/${params.projectId}/${params.signupId}/${crypto.randomUUID()}.${extension}`,
      maxBytes: MAX_WAIVER_UPLOAD_BYTES,
      allowedTypes: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
    });

    if (uploadResult.error || !uploadResult.path) {
      await removeUploadedSignatureAssets();
      return { error: "Failed to store the signed waiver upload." };
    }

    uploadStoragePath = uploadResult.path;
    uploadedSignaturePaths.push(uploadResult.path);
  }

  const { error: insertError } = await serviceSupabase
    .from("waiver_signatures")
    .insert({
      waiver_definition_id: waiverDefinitionId,
      waiver_pdf_url: waiverPdfUrl,
      waiver_pdf_storage_path: waiverPdfStoragePath,
      project_id: params.projectId,
      signup_id: params.signupId,
      user_id: params.userId ?? null,
      anonymous_id: params.anonymousId ?? null,
      signer_name: params.signerName,
      signer_email: params.signerEmail,
      signature_type: params.waiverSignature.signatureType,
      signature_text:
        params.waiverSignature.signatureType === "typed"
          ? params.waiverSignature.signatureText?.trim() || null
          : null,
      signature_storage_path: signatureStoragePath,
      upload_storage_path: uploadStoragePath,
      signature_payload: signaturePayload,
      form_data: params.waiverSignature.formData ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertError) {
    await removeUploadedSignatureAssets();
    console.error("Error saving waiver signature:", insertError);
    return { error: "Failed to store waiver signature." };
  }

  return { success: true };
}

export async function cloneAnonymousWaiverSignatureToSignup(params: {
  projectId: string;
  anonymousId: string;
  signupId: string;
}) {
  const serviceSupabase = getAdminClient();

  const { data: latestSignature, error: fetchError } = await serviceSupabase
    .from("waiver_signatures")
    .select(
      `
      waiver_definition_id,
      waiver_pdf_url,
      waiver_pdf_storage_path,
      signer_name,
      signer_email,
      signature_type,
      signature_text,
      signature_storage_path,
      upload_storage_path,
      signature_payload,
      form_data
    `,
    )
    .eq("project_id", params.projectId)
    .eq("anonymous_id", params.anonymousId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "Error fetching reusable anonymous waiver signature:",
      fetchError,
    );
    return { error: "Failed to reuse existing waiver signature." };
  }

  if (!latestSignature) {
    return {
      error: "No existing waiver signature found for this anonymous profile.",
    };
  }

  const copiedPaths: string[] = [];
  const copiedPathBySource = new Map<string, string>();

  const removeCopiedEvidence = async () => {
    if (copiedPaths.length === 0) return;
    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .remove(copiedPaths);
    if (error) {
      console.error("Failed to roll back cloned waiver evidence:", error);
    }
  };

  const copyEvidencePath = async (
    sourcePath: unknown,
  ): Promise<string | null> => {
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
      return null;
    }

    // Legacy inline/remote values are not Storage objects and must never be
    // copied as if they were trusted private evidence.
    if (/^(data:|https?:\/\/)/iu.test(sourcePath)) {
      return sourcePath;
    }

    const existingCopy = copiedPathBySource.get(sourcePath);
    if (existingCopy) return existingCopy;

    const extensionMatch = sourcePath.match(/\.([a-z0-9]{1,5})$/iu);
    const extension = extensionMatch?.[1]?.toLowerCase() ?? "bin";
    const destinationPath = `cloned-waiver-evidence/${params.projectId}/${params.signupId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .copy(sourcePath, destinationPath);

    if (error) {
      throw new Error("Failed to copy waiver evidence");
    }

    copiedPaths.push(destinationPath);
    copiedPathBySource.set(sourcePath, destinationPath);
    return destinationPath;
  };

  let clonedSignatureStoragePath: string | null;
  let clonedUploadStoragePath: string | null;
  let clonedSignaturePayload = latestSignature.signature_payload;

  try {
    clonedSignatureStoragePath = await copyEvidencePath(
      latestSignature.signature_storage_path,
    );
    clonedUploadStoragePath = await copyEvidencePath(
      latestSignature.upload_storage_path,
    );

    if (
      clonedSignaturePayload &&
      typeof clonedSignaturePayload === "object" &&
      !Array.isArray(clonedSignaturePayload)
    ) {
      const payload = clonedSignaturePayload as {
        signers?: unknown;
        [key: string]: unknown;
      };

      if (Array.isArray(payload.signers)) {
        const clonedSigners = [];
        for (const rawSigner of payload.signers) {
          if (
            !rawSigner ||
            typeof rawSigner !== "object" ||
            Array.isArray(rawSigner)
          ) {
            clonedSigners.push(rawSigner);
            continue;
          }

          const signer = rawSigner as {
            method?: unknown;
            data?: unknown;
            [key: string]: unknown;
          };
          const shouldCopy =
            signer.method === "draw" || signer.method === "upload";
          clonedSigners.push({
            ...signer,
            data: shouldCopy
              ? await copyEvidencePath(signer.data)
              : signer.data,
          });
        }

        clonedSignaturePayload = { ...payload, signers: clonedSigners };
      }
    }
  } catch (error) {
    await removeCopiedEvidence();
    console.error("Error copying reusable anonymous waiver evidence:", error);
    return {
      error: "Failed to attach existing waiver evidence to this signup.",
    };
  }

  const { ipAddress, userAgent } = await getRequestMetadata();

  const { error: insertError } = await serviceSupabase
    .from("waiver_signatures")
    .insert({
      ...latestSignature,
      signature_storage_path: clonedSignatureStoragePath,
      upload_storage_path: clonedUploadStoragePath,
      signature_payload: clonedSignaturePayload,
      project_id: params.projectId,
      signup_id: params.signupId,
      user_id: null,
      anonymous_id: params.anonymousId,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertError) {
    await removeCopiedEvidence();
    console.error("Error cloning anonymous waiver signature:", insertError);
    return {
      error: "Failed to attach existing waiver signature to this signup.",
    };
  }

  return { success: true };
}
