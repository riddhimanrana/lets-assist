"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";
import {
  parseWaiverDataUrl,
  waiverFileProblem,
} from "@/lib/waiver/file-validation";
import { ENCRYPTED_WAIVER_PDF_MESSAGE } from "@/lib/waiver/source-replacement-policy";
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAX_COVER_IMAGE_SIZE,
  type UploadedProjectDocument,
} from "./shared";

export async function uploadCoverImage(projectId: string, imageBase64: string) {
  "use server";
  const supabase = await createClient();

  try {
    // Skip if no image data - cover images are optional
    if (!imageBase64 || !imageBase64.includes("base64")) {
      return { success: true };
    }

    // Process base64 image
    const base64Str = imageBase64.split(",")[1];
    const buffer = Buffer.from(base64Str, "base64");
    const contentType = imageBase64.split(";")[0].split(":")[1];

    // Validate content type
    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return {
        error: "Invalid cover image type. Please use JPEG, JPG, PNG or WebP.",
      };
    }

    // Validate size (approximate from base64)
    const sizeInBytes = Math.ceil(base64Str.length * 0.75);
    if (sizeInBytes > MAX_COVER_IMAGE_SIZE) {
      return { error: "Cover image is too large. Maximum size is 5MB." };
    }

    // Create unique filename - now directly in the bucket root
    const timestamp = Date.now();
    const fileName = `project_${projectId}_cover_${timestamp}.${contentType.split("/")[1]}`;

    // Upload to Supabase Storage - no subfolder
    const { error: uploadError } = await supabase.storage
      .from("project-images")
      .upload(fileName, buffer, {
        contentType: contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      safeConsole.error("Error uploading cover image:", uploadError);
      return { error: "Failed to upload cover image." };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("project-images")
      .getPublicUrl(fileName);

    // Update project with cover image URL
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        cover_image_url: publicUrlData.publicUrl,
      })
      .eq("id", projectId);

    if (updateError) {
      safeConsole.error("Error linking cover image to project:", updateError);
      return { error: "Failed to link cover image to project." };
    }

    return { success: true, url: publicUrlData.publicUrl };
  } catch (error) {
    safeConsole.error("Error uploading cover image:", error);
    return { error: "An unexpected error occurred during image upload." };
  }
}

// Improved document upload function with stricter size validation
export async function uploadProjectDocument(
  projectId: string,
  documentBase64: string,
  fileName: string,
  fileType: string,
) {
  "use server";
  const supabase = await createClient();

  try {
    // Skip if no document data
    if (!documentBase64 || !documentBase64.includes("base64")) {
      return { success: true };
    }

    // Process base64 document - check size first
    const base64Str = documentBase64.split(",")[1];
    const sizeInBytes = Math.ceil(base64Str.length * 0.75);

    // More strict size validation (10MB max per document)
    if (sizeInBytes > 10 * 1024 * 1024) {
      return { error: "Document is too large. Maximum size is 10MB." };
    }

    const buffer = Buffer.from(base64Str, "base64");
    const contentType = fileType || documentBase64.split(";")[0].split(":")[1];

    // Validate content type
    if (!ALLOWED_DOCUMENT_TYPES.includes(contentType)) {
      return { error: "Invalid document type." };
    }

    // Create unique filename with a smaller random ID
    const timestamp = Date.now();
    const documentId = uuidv4().substring(0, 8);
    const fileExt =
      fileName.split(".").pop() || contentType.split("/")[1] || "file";
    const safeFileName = `project_${projectId}_${documentId}_${timestamp}.${fileExt}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("project-documents")
      .upload(safeFileName, buffer, {
        contentType: contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      safeConsole.error("Error uploading document:", {
        fileName,
        error: uploadError,
      });
      return { error: "Failed to upload document." };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("project-documents")
      .getPublicUrl(safeFileName);

    // Get current documents and append new one
    const { data: projectData } = await supabase
      .from("projects")
      .select("documents")
      .eq("id", projectId)
      .single();

    const currentDocs = projectData?.documents || [];

    // Add new document
    const newDoc = {
      name: fileName,
      originalName: fileName,
      type: contentType,
      size: sizeInBytes,
      url: publicUrlData.publicUrl,
    };

    // Update project with document URLs
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        documents: [...currentDocs, newDoc],
      })
      .eq("id", projectId);

    if (updateError) {
      safeConsole.error("Error linking document to project:", updateError);
      return { error: "Failed to link document to project." };
    }

    return { success: true, document: newDoc };
  } catch (error) {
    safeConsole.error("Error uploading document:", error);
    return { error: "An unexpected error occurred during document upload." };
  }
}

export async function linkProjectUploadedAssets(
  projectId: string,
  assets: {
    coverImageUrl?: string;
    documents?: UploadedProjectDocument[];
  },
) {
  "use server";
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to upload files." };
  }

  const loadProject = async () =>
    await supabase
      .from("projects")
      .select("id, creator_id, organization_id, cover_image_url, documents")
      .eq("id", projectId)
      .single();

  const { data: project, error: projectError } = await loadProject();

  if (projectError || !project) {
    safeConsole.error(
      "Error loading project for uploaded file linking:",
      projectError,
    );
    return { error: "Project not found." };
  }

  let hasPermission = project.creator_id === user.id;

  if (!hasPermission && project.organization_id) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    hasPermission =
      membership?.role === "admin" || membership?.role === "staff";
  }

  if (!hasPermission) {
    return { error: "You don't have permission to update this project." };
  }

  // The stored URL is the document's identity. A URL sent twice, or sent
  // again by a retry, is attached once.
  const requestedUrls = new Set<string>();
  const safeDocuments: UploadedProjectDocument[] = [];
  for (const document of Array.isArray(assets.documents)
    ? assets.documents
    : []) {
    if (
      !document ||
      typeof document.name !== "string" ||
      typeof document.originalName !== "string" ||
      typeof document.type !== "string" ||
      typeof document.size !== "number" ||
      typeof document.url !== "string" ||
      !document.url ||
      !ALLOWED_DOCUMENT_TYPES.includes(document.type) ||
      requestedUrls.has(document.url)
    ) {
      continue;
    }
    requestedUrls.add(document.url);
    safeDocuments.push({
      name: document.name,
      originalName: document.originalName,
      type: document.type,
      size: document.size,
      url: document.url,
    });
  }
  const coverImageUrl =
    typeof assets.coverImageUrl === "string" && assets.coverImageUrl
      ? assets.coverImageUrl
      : null;

  // The documents column is replaced as a whole, so an append is written only
  // while the column still holds the exact value the append was built from.
  // A write that matched no row, or changed nothing, is rebuilt from the row
  // as it is now. Success is reported only for what the row really holds.
  const maxWrites = 3;
  let current: {
    cover_image_url?: unknown;
    documents?: unknown;
  } = project;
  for (let pass = 0; ; pass += 1) {
    const currentDocuments: unknown[] = Array.isArray(current.documents)
      ? current.documents
      : [];
    const attachedUrls = new Set(
      currentDocuments.map((document) =>
        document && typeof document === "object"
          ? (document as { url?: unknown }).url
          : undefined,
      ),
    );
    const missingDocuments = safeDocuments.filter(
      (document) => !attachedUrls.has(document.url),
    );
    const coverPending =
      coverImageUrl !== null && current.cover_image_url !== coverImageUrl;

    if (missingDocuments.length === 0 && !coverPending) {
      return { success: true };
    }

    if (pass === maxWrites) {
      safeConsole.error("Uploaded project assets were not stored on the row.");
      return { error: "Uploaded files could not be attached to the project." };
    }

    const updatePayload: Record<string, unknown> = {};
    if (coverPending) updatePayload.cover_image_url = coverImageUrl;
    let write = supabase
      .from("projects")
      .update(updatePayload)
      .eq("id", projectId);
    if (missingDocuments.length > 0) {
      updatePayload.documents = [...currentDocuments, ...missingDocuments];
      // jsonb equality needs the value as JSON text. SQL NULL equals nothing,
      // so it has its own filter. A cover-only write carries no documents and
      // needs no condition.
      write =
        current.documents === null || current.documents === undefined
          ? write.is("documents", null)
          : write.eq("documents", JSON.stringify(current.documents));
    }

    const { error: updateError } = await write;

    if (updateError) {
      safeConsole.error("Error linking uploaded project assets:", updateError);
      return { error: "Uploaded files could not be attached to the project." };
    }

    const { data: stored, error: storedError } = await loadProject();
    if (storedError || !stored) {
      safeConsole.error(
        "Error confirming uploaded project assets:",
        storedError,
      );
      return { error: "Uploaded files could not be attached to the project." };
    }
    current = stored;
  }
}

// Handle waiver PDF upload for a project
export async function uploadWaiverPdf(
  projectId: string,
  pdfBase64: string,
  fileName: string,
) {
  "use server";
  const supabase = await createClient();

  try {
    const parsed = parseWaiverDataUrl(pdfBase64);
    if (!parsed || parsed.contentType !== "application/pdf") {
      return { error: "Choose a valid waiver PDF and try again." };
    }
    const buffer = parsed.buffer;
    const contentType = "application/pdf";

    // Validate size (10MB max)
    const sizeInBytes = parsed.size;
    if (sizeInBytes > 10 * 1024 * 1024) {
      return { error: "Waiver PDF is too large. Maximum size is 10MB." };
    }
    const pdfProblem = await waiverFileProblem(buffer, contentType);
    if (pdfProblem === "encrypted")
      return { error: ENCRYPTED_WAIVER_PDF_MESSAGE };
    if (pdfProblem)
      return {
        error:
          "The waiver PDF could not be read. Choose a valid PDF and try again.",
      };

    // Create unique filename
    const timestamp = Date.now();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `project_waivers/${projectId}/${timestamp}_${safeFileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("waiver-uploads")
      .upload(storagePath, buffer, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      safeConsole.error("Error uploading waiver PDF:", uploadError);
      return { error: "Failed to upload waiver PDF." };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("waiver-uploads")
      .getPublicUrl(storagePath);

    // Update project with waiver PDF URL
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        waiver_pdf_url: publicUrlData.publicUrl,
        waiver_pdf_storage_path: storagePath,
      })
      .eq("id", projectId);

    if (updateError) {
      safeConsole.error("Error linking waiver PDF to project:", updateError);
      // Clean up uploaded file
      await supabase.storage.from("waiver-uploads").remove([storagePath]);
      return { error: "Failed to link waiver PDF to project." };
    }

    return { success: true, url: publicUrlData.publicUrl };
  } catch (error) {
    safeConsole.error("Error uploading waiver PDF:", error);
    return { error: "An unexpected error occurred during waiver PDF upload." };
  }
}
