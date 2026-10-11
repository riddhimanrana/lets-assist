import "server-only";
import { safeConsole } from "@/lib/safe-console";

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { type WaiverSignatureInput } from "@/types";
import {
  WAIVER_SIGNATURE_BUCKET,
  type WaiverSignatureRecord,
  getRequestMetadata,
  isMissingWaiverDisableEsignatureColumnError,
} from "./shared";
import { buildWaiverEvidencePath } from "@/lib/waiver/evidence-path";
import {
  WAIVER_SIGNING_REFUSALS,
  currentEvidenceSource,
  findEvidencePlacementProblem,
  sameWaiverSource,
  waiverSourceSnapshot,
  type StoredWaiverDefinition,
} from "@/lib/waiver/source-boundary";
import { storeWaiverSignatureAssets } from "./waiver-evidence-assets";

// Storage of signature assets lives in its own module. The upload helper stays
// importable from here for its existing callers.
export { uploadWaiverAsset } from "./waiver-evidence-assets";

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

export type PreparedWaiverEvidence =
  | { record: WaiverSignatureRecord; uploadedPaths: string[] }
  | { error: string; uploadedPaths: string[] };

/**
 * Uploads the signature assets and builds the evidence row without writing it.
 *
 * The row is inserted by the same transaction that creates the signup, so an
 * unwritten record only ever leaves inert Storage objects behind.
 */
export async function prepareWaiverSignatureRecord(params: {
  projectId: string;
  evidenceKey: string;
  signerName: string;
  signerEmail: string;
  waiverSignature: WaiverSignatureInput;
}): Promise<PreparedWaiverEvidence> {
  const serviceSupabase = getAdminClient();

  // Check for project-specific waiver PDF first
  let { data: project } = await serviceSupabase
    .from("projects")
    .select(
      "waiver_pdf_url, waiver_pdf_storage_path, waiver_allow_upload, waiver_disable_esignature, waiver_definition_id, project_timezone",
    )
    .eq("id", params.projectId)
    .maybeSingle();

  if (!project) {
    const { data: fallbackProject, error: fallbackError } =
      await serviceSupabase
        .from("projects")
        .select(
          "waiver_pdf_url, waiver_pdf_storage_path, waiver_allow_upload, waiver_definition_id, project_timezone",
        )
        .eq("id", params.projectId)
        .maybeSingle();

    if (
      fallbackError &&
      !isMissingWaiverDisableEsignatureColumnError(fallbackError)
    ) {
      safeConsole.error(
        "Error fetching project waiver settings:",
        fallbackError,
      );
    }

    if (fallbackProject) {
      project = {
        ...fallbackProject,
        waiver_disable_esignature: false,
      };
    }
  }

  if (!project) {
    return { error: "Project not found.", uploadedPaths: [] };
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

  // A full signed copy uploaded by the volunteer is its own document. Every
  // other type is stamped onto the source PDF later.
  const signatureType = params.waiverSignature.signatureType;
  const isSignedCopyUpload = signatureType === "upload";
  let storedDefinition: StoredWaiverDefinition | null = null;

  // New system: waiver_definitions are the canonical waiver source (PDF + placements).
  if (waiverDefinitionId) {
    if (project.waiver_definition_id !== waiverDefinitionId) {
      return {
        error: "The waiver definition does not belong to this project.",
        uploadedPaths: [],
      };
    }

    const { data: definition, error: defError } = await serviceSupabase
      .from("waiver_definitions")
      .select("id, pdf_public_url, pdf_storage_path, signers, fields")
      .eq("id", waiverDefinitionId)
      .eq("project_id", params.projectId)
      .limit(1)
      .maybeSingle();

    if (defError || !definition) {
      safeConsole.error("Invalid waiver definition in signature payload", {
        projectId: params.projectId,
        evidenceKey: params.evidenceKey,
        waiverDefinitionId,
        defError,
      });
      return { error: "Invalid waiver definition.", uploadedPaths: [] };
    }

    // A definition is the immutable source used by historical signatures. Its
    // placements only mean something on the PDF it was saved against, so an
    // e-signature is refused while the project points at a different one.
    const definitionSource = waiverSourceSnapshot(
      definition.pdf_storage_path,
      definition.pdf_public_url,
    );
    const projectSource = waiverSourceSnapshot(
      waiverPdfStoragePath,
      waiverPdfUrl,
    );
    if (
      !isSignedCopyUpload &&
      !sameWaiverSource(params.projectId, definitionSource, projectSource)
    ) {
      return {
        error: WAIVER_SIGNING_REFUSALS.stale_waiver,
        uploadedPaths: [],
      };
    }
    // The snapshot the database requires of every new evidence row.
    const evidenceSource = currentEvidenceSource(
      params.projectId,
      projectSource,
      definitionSource,
    );
    waiverPdfUrl = evidenceSource.publicUrl;
    waiverPdfStoragePath = evidenceSource.storagePath;
    storedDefinition = definition;
  }

  // No global waiver fallback - projects must have custom waivers

  // The placement of an e-signature is proven against the actual bytes of the
  // source PDF before any signature asset is stored. Nothing the browser
  // reports about the document is trusted, and no placement is moved.
  if (!isSignedCopyUpload) {
    const placementProblem = await findEvidencePlacementProblem({
      projectId: params.projectId,
      source: waiverSourceSnapshot(waiverPdfStoragePath, waiverPdfUrl),
      definition: storedDefinition,
      evidence: {
        signaturePayload:
          signatureType === "multi-signer"
            ? (params.waiverSignature.payload ?? null)
            : null,
        hasDrawnSignature: signatureType === "draw",
        typedSignatureText:
          signatureType === "typed"
            ? (params.waiverSignature.signatureText ?? null)
            : null,
        signedAt: null,
      },
      // Measured in the project's zone, as the signed-copy routes stamp it.
      timeZone: project.project_timezone ?? null,
      adminClient: serviceSupabase,
    });
    if (placementProblem) {
      return {
        error: WAIVER_SIGNING_REFUSALS[placementProblem],
        uploadedPaths: [],
      };
    }
  }

  const { ipAddress, userAgent } = await getRequestMetadata();
  // Only reached once the placement above has passed.
  const storedAssets = await storeWaiverSignatureAssets({
    projectId: params.projectId,
    evidenceKey: params.evidenceKey,
    waiverSignature: params.waiverSignature,
    waiverAllowUpload,
    hasWaiverSource: Boolean(waiverPdfStoragePath || waiverPdfUrl),
    adminClient: serviceSupabase,
  });
  if ("error" in storedAssets) return storedAssets;
  const { signaturePayload, signatureStoragePath, uploadStoragePath } =
    storedAssets;

  return {
    record: {
      waiver_definition_id: waiverDefinitionId,
      waiver_pdf_url: waiverPdfUrl,
      waiver_pdf_storage_path: waiverPdfStoragePath,
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
    },
    uploadedPaths: storedAssets.uploadedPaths,
  };
}

/**
 * Copies an existing guest signature's evidence objects and builds the row for
 * a new signup without writing it. The copy is the only side effect until the
 * signup transaction inserts the record.
 */
export async function prepareClonedAnonymousWaiverRecord(params: {
  projectId: string;
  anonymousId: string;
  evidenceKey: string;
}): Promise<PreparedWaiverEvidence> {
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
    safeConsole.error(
      "Error fetching reusable anonymous waiver signature:",
      fetchError,
    );
    return {
      error: "Failed to reuse existing waiver signature.",
      uploadedPaths: [],
    };
  }

  if (!latestSignature) {
    return {
      error: "No existing waiver signature found for this anonymous profile.",
      uploadedPaths: [],
    };
  }

  // Reused evidence is new evidence for a new signup. It is only copied while
  // it still describes the project's current waiver, and nothing is copied
  // before that is known.
  const { data: currentProject, error: currentProjectError } =
    await serviceSupabase
      .from("projects")
      .select(
        "waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id, project_timezone",
      )
      .eq("id", params.projectId)
      .maybeSingle();

  if (currentProjectError || !currentProject) {
    return {
      error: "Failed to reuse existing waiver signature.",
      uploadedPaths: [],
    };
  }

  const reusedSource = waiverSourceSnapshot(
    latestSignature.waiver_pdf_storage_path,
    latestSignature.waiver_pdf_url,
  );
  const projectSource = waiverSourceSnapshot(
    currentProject.waiver_pdf_storage_path,
    currentProject.waiver_pdf_url,
  );
  const reusedDefinitionId = latestSignature.waiver_definition_id ?? null;
  if (
    reusedDefinitionId !== (currentProject.waiver_definition_id ?? null) ||
    !sameWaiverSource(params.projectId, reusedSource, projectSource)
  ) {
    return { error: WAIVER_SIGNING_REFUSALS.stale_waiver, uploadedPaths: [] };
  }

  let reusedDefinition: StoredWaiverDefinition | null = null;
  if (reusedDefinitionId) {
    const { data: definition, error: definitionError } = await serviceSupabase
      .from("waiver_definitions")
      .select("id, pdf_public_url, pdf_storage_path, signers, fields")
      .eq("id", reusedDefinitionId)
      .eq("project_id", params.projectId)
      .maybeSingle();

    if (definitionError || !definition) {
      return { error: WAIVER_SIGNING_REFUSALS.stale_waiver, uploadedPaths: [] };
    }
    reusedDefinition = definition;
  }
  // The new row carries the current snapshot, as freshly signed evidence does.
  const clonedSource = currentEvidenceSource(
    params.projectId,
    projectSource,
    reusedDefinition &&
      waiverSourceSnapshot(
        reusedDefinition.pdf_storage_path,
        reusedDefinition.pdf_public_url,
      ),
  );

  if (!latestSignature.upload_storage_path) {
    const placementProblem = await findEvidencePlacementProblem({
      projectId: params.projectId,
      source: clonedSource,
      definition: reusedDefinition,
      evidence: {
        signaturePayload: latestSignature.signature_payload,
        hasDrawnSignature: Boolean(latestSignature.signature_storage_path),
        typedSignatureText: latestSignature.signature_text,
        signedAt: null,
      },
      timeZone: currentProject.project_timezone ?? null,
      adminClient: serviceSupabase,
    });
    if (placementProblem) {
      return {
        error: WAIVER_SIGNING_REFUSALS[placementProblem],
        uploadedPaths: [],
      };
    }
  }

  const copiedPaths: string[] = [];
  const copiedPathBySource = new Map<string, string>();

  const removeCopiedEvidence = async () => {
    if (copiedPaths.length === 0) return;
    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .remove(copiedPaths);
    if (error) {
      safeConsole.error("Failed to roll back cloned waiver evidence:", error);
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
    const destinationPath = buildWaiverEvidencePath({
      folder: "cloned-waiver-evidence",
      projectId: params.projectId,
      evidenceKey: params.evidenceKey,
      extension,
    });
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
    safeConsole.error(
      "Error copying reusable anonymous waiver evidence:",
      error,
    );
    return {
      error: "Failed to attach existing waiver evidence to this signup.",
      uploadedPaths: copiedPaths,
    };
  }

  const { ipAddress, userAgent } = await getRequestMetadata();

  return {
    record: {
      ...latestSignature,
      waiver_pdf_url: clonedSource.publicUrl,
      waiver_pdf_storage_path: clonedSource.storagePath,
      signature_storage_path: clonedSignatureStoragePath,
      upload_storage_path: clonedUploadStoragePath,
      signature_payload: clonedSignaturePayload,
      ip_address: ipAddress,
      user_agent: userAgent,
    } as WaiverSignatureRecord,
    uploadedPaths: copiedPaths,
  };
}
