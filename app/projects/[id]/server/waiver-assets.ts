"use server";

import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { canCurrentUserManageProject } from "./access";
import {
  MAX_WAIVER_UPLOAD_BYTES,
  WAIVER_UPLOAD_BUCKET,
  parseDataUrl,
} from "./shared";

// Upload project waiver PDF
export async function uploadProjectWaiverPdf(
  projectId: string,
  pdfDataUrl: string,
  fileName: string,
) {
  "use server";
  try {
    const supabase = await createClient();

    // Check if user has permission
    const isAllowed = await canCurrentUserManageProject(projectId);
    if (!isAllowed) {
      return { error: "You don't have permission to modify this project" };
    }

    const serviceSupabase = getAdminClient();

    // Parse and validate the PDF data URL
    const parsed = parseDataUrl(pdfDataUrl);
    if (!parsed) {
      return { error: "Invalid file data" };
    }

    if (parsed.contentType !== "application/pdf") {
      return { error: "Only PDF files are allowed" };
    }

    if (parsed.size > MAX_WAIVER_UPLOAD_BYTES) {
      return { error: "File size must be less than 10MB" };
    }

    // Generate storage path
    const storagePath = `project_waivers/${projectId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    // Upload to storage
    const { error: uploadError } = await serviceSupabase.storage
      .from(WAIVER_UPLOAD_BUCKET)
      .upload(storagePath, parsed.buffer, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Error uploading waiver PDF:", uploadError);
      return { error: "Failed to upload waiver PDF" };
    }

    // Get the public URL
    const { data: urlData } = serviceSupabase.storage
      .from(WAIVER_UPLOAD_BUCKET)
      .getPublicUrl(storagePath);

    // Update project with waiver PDF info
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        waiver_pdf_url: urlData.publicUrl,
        waiver_pdf_storage_path: storagePath,
      })
      .eq("id", projectId);

    if (updateError) {
      console.error("Error updating project with waiver PDF:", updateError);
      // Clean up uploaded file
      await serviceSupabase.storage
        .from(WAIVER_UPLOAD_BUCKET)
        .remove([storagePath]);
      return { error: "Failed to save waiver PDF to project" };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return {
      success: true,
      waiverPdfUrl: urlData.publicUrl,
      waiverPdfStoragePath: storagePath,
    };
  } catch (error) {
    console.error("Error uploading project waiver:", error);
    return { error: "An unexpected error occurred" };
  }
}

// Remove project waiver PDF
export async function removeProjectWaiverPdf(projectId: string) {
  "use server";
  try {
    const supabase = await createClient();

    // Check if user has permission
    const isAllowed = await canCurrentUserManageProject(projectId);
    if (!isAllowed) {
      return { error: "You don't have permission to modify this project" };
    }

    // Get current waiver PDF path
    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("waiver_pdf_storage_path")
      .eq("id", projectId)
      .maybeSingle();

    if (fetchError || !project) {
      return { error: "Project not found" };
    }

    const serviceSupabase = getAdminClient();

    // Historical definitions/signatures retain immutable source paths. Never
    // delete a source object while evidence still references it.
    if (project.waiver_pdf_storage_path) {
      const [
        { data: signatureReference, error: signatureReferenceError },
        { data: definitionReference, error: definitionReferenceError },
      ] = await Promise.all([
        serviceSupabase
          .from("waiver_signatures")
          .select("id")
          .eq("project_id", projectId)
          .eq("waiver_pdf_storage_path", project.waiver_pdf_storage_path)
          .limit(1)
          .maybeSingle(),
        serviceSupabase
          .from("waiver_definitions")
          .select("id")
          .eq("project_id", projectId)
          .eq("pdf_storage_path", project.waiver_pdf_storage_path)
          .limit(1)
          .maybeSingle(),
      ]);

      if (signatureReferenceError || definitionReferenceError) {
        console.error("Failed to verify waiver source retention references", {
          signatureReferenceError,
          definitionReferenceError,
        });
        return {
          error: "Failed to verify whether the waiver PDF can be removed",
        };
      }

      if (!signatureReference && !definitionReference) {
        const { error: removeError } = await serviceSupabase.storage
          .from(WAIVER_UPLOAD_BUCKET)
          .remove([project.waiver_pdf_storage_path]);

        if (removeError) {
          console.error(
            "Failed to remove unreferenced waiver PDF:",
            removeError,
          );
          return { error: "Failed to remove waiver PDF" };
        }
      }
    }

    // Update project to remove waiver PDF info
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        waiver_pdf_url: null,
        waiver_pdf_storage_path: null,
        // Detach the current definition while preserving historical versions.
        waiver_definition_id: null,
      })
      .eq("id", projectId);

    if (updateError) {
      console.error("Error removing waiver PDF from project:", updateError);
      return { error: "Failed to remove waiver PDF" };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true };
  } catch (error) {
    console.error("Error removing project waiver:", error);
    return { error: "An unexpected error occurred" };
  }
}
