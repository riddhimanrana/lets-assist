"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { waiverFileProblem } from "@/lib/waiver/file-validation";
import {
  ENCRYPTED_WAIVER_PDF_MESSAGE,
  WAIVER_SOURCE_REMOVE_LOCKED_MESSAGE,
  WAIVER_SOURCE_REPLACE_LOCKED_MESSAGE,
  isWaiverSourceLocked,
} from "@/lib/waiver/source-replacement-policy";
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

    // The database refuses this write on a published, waiver-required project.
    // Say so before any file is stored, instead of failing after the upload.
    const { data: currentProject, error: currentProjectError } = await supabase
      .from("projects")
      .select("workflow_status, waiver_required")
      .eq("id", projectId)
      .maybeSingle();

    if (currentProjectError || !currentProject) {
      return { error: "Project not found" };
    }

    if (isWaiverSourceLocked(currentProject)) {
      return { error: WAIVER_SOURCE_REPLACE_LOCKED_MESSAGE };
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

    // A protected source can never be stamped with signatures later.
    const pdfProblem = await waiverFileProblem(
      parsed.buffer,
      parsed.contentType,
    );
    if (pdfProblem === "encrypted") {
      return { error: ENCRYPTED_WAIVER_PDF_MESSAGE };
    }
    if (pdfProblem)
      return {
        error:
          "The waiver PDF could not be read. Choose a valid PDF and try again.",
      };

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
      safeConsole.error("Error uploading waiver PDF:", uploadError);
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
      safeConsole.error("Error updating project with waiver PDF:", updateError);
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
    safeConsole.error("Error uploading project waiver:", error);
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

    // Get the current waiver snapshot. The detach below only applies to it.
    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select(
        "waiver_pdf_storage_path, waiver_pdf_url, waiver_definition_id, workflow_status, waiver_required",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (fetchError || !project) {
      return { error: "Project not found" };
    }

    // The database refuses this write on a published, waiver-required project.
    // Refuse here first, with a sentence that says why.
    if (isWaiverSourceLocked(project)) {
      return { error: WAIVER_SOURCE_REMOVE_LOCKED_MESSAGE };
    }

    const previousPath: string | null = project.waiver_pdf_storage_path ?? null;

    // Detach first. The stored PDF is never deleted while the project row
    // still points at it, and the detach is refused if the source or the
    // definition was replaced after the snapshot above was read.
    let detach = supabase.from("projects").update({
      waiver_pdf_url: null,
      waiver_pdf_storage_path: null,
      // Detach the current definition while preserving historical versions.
      waiver_definition_id: null,
    });
    detach = detach.eq("id", projectId);
    for (const column of [
      "waiver_pdf_storage_path",
      "waiver_pdf_url",
      "waiver_definition_id",
    ] as const) {
      const expected = project[column] ?? null;
      detach =
        expected === null
          ? detach.is(column, null)
          : detach.eq(column, expected);
    }
    const { data: detached, error: updateError } = await detach
      .select("id")
      .maybeSingle();

    if (updateError) {
      safeConsole.error("Error removing waiver PDF from project:", updateError);
      return { error: "Failed to remove waiver PDF" };
    }
    if (!detached) {
      return {
        error:
          "The waiver PDF changed while it was being removed. Reload the page and try again.",
      };
    }

    // The object is never deleted here. It is handed to the durable cleanup
    // queue, whose worker deletes it only if no project, definition, or
    // signature names it at that moment. The project is already detached, so a
    // queueing failure is logged and does not undo or misreport the removal.
    // The same holds when the call itself throws, for example on a transport
    // fault: the detach is committed and the database already queued the
    // object in that transaction.
    if (previousPath) {
      try {
        const { error: queueError } = await getAdminClient().rpc(
          "enqueue_superseded_waiver_source",
          { p_object_path: previousPath },
        );
        if (queueError) {
          safeConsole.error(
            "Failed to queue detached waiver PDF for cleanup:",
            queueError,
          );
        }
      } catch (queueError) {
        safeConsole.error(
          "Failed to queue detached waiver PDF for cleanup:",
          queueError,
        );
      }
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true };
  } catch (error) {
    safeConsole.error("Error removing project waiver:", error);
    return { error: "An unexpected error occurred" };
  }
}
