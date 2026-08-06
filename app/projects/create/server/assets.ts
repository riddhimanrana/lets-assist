import "server-only";

import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";
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
      console.error("Error uploading cover image:", uploadError);
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
      console.error("Error linking cover image to project:", updateError);
      return { error: "Failed to link cover image to project." };
    }

    return { success: true, url: publicUrlData.publicUrl };
  } catch (error) {
    console.error("Error uploading cover image:", error);
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
      console.error("Error uploading document:", {
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
      console.error("Error linking document to project:", updateError);
      return { error: "Failed to link document to project." };
    }

    return { success: true, document: newDoc };
  } catch (error) {
    console.error("Error uploading document:", error);
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, creator_id, organization_id, documents")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    console.error(
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

  const safeDocuments = (assets.documents ?? []).filter((document) => {
    return (
      document &&
      typeof document.name === "string" &&
      typeof document.originalName === "string" &&
      typeof document.type === "string" &&
      typeof document.size === "number" &&
      typeof document.url === "string" &&
      ALLOWED_DOCUMENT_TYPES.includes(document.type)
    );
  });

  const updatePayload: Record<string, unknown> = {};

  if (assets.coverImageUrl) {
    updatePayload.cover_image_url = assets.coverImageUrl;
  }

  if (safeDocuments.length > 0) {
    const currentDocuments = Array.isArray(project.documents)
      ? project.documents
      : [];
    updatePayload.documents = [...currentDocuments, ...safeDocuments];
  }

  if (Object.keys(updatePayload).length === 0) {
    return { success: true };
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update(updatePayload)
    .eq("id", projectId);

  if (updateError) {
    console.error("Error linking uploaded project assets:", updateError);
    return { error: "Uploaded files could not be attached to the project." };
  }

  return { success: true };
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
    // Skip if no PDF data
    if (!pdfBase64 || !pdfBase64.includes("base64")) {
      return { success: true };
    }

    // Process base64 PDF
    const base64Str = pdfBase64.split(",")[1];
    const buffer = Buffer.from(base64Str, "base64");
    const contentType = "application/pdf";

    // Validate size (10MB max)
    const sizeInBytes = Math.ceil(base64Str.length * 0.75);
    if (sizeInBytes > 10 * 1024 * 1024) {
      return { error: "Waiver PDF is too large. Maximum size is 10MB." };
    }

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
      console.error("Error uploading waiver PDF:", uploadError);
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
      console.error("Error linking waiver PDF to project:", updateError);
      // Clean up uploaded file
      await supabase.storage.from("waiver-uploads").remove([storagePath]);
      return { error: "Failed to link waiver PDF to project." };
    }

    return { success: true, url: publicUrlData.publicUrl };
  } catch (error) {
    console.error("Error uploading waiver PDF:", error);
    return { error: "An unexpected error occurred during waiver PDF upload." };
  }
}
