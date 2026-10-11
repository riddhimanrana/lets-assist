"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { type WaiverDefinitionFull } from "@/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { waiverDefinitionInputSchema } from "@/lib/waiver/definition-input";
import {
  mapDetectedFieldsForDb,
  mapCustomPlacementsForDb,
} from "@/lib/waiver/map-definition-input";
import {
  findDefinitionFieldProblem,
  sameWaiverSource,
  waiverSourceSnapshot,
  type WaiverBoundaryProblem,
} from "@/lib/waiver/source-boundary";
import { canCurrentUserManageProject } from "./access";

// Fixed sentences for an organizer. None quotes the document or a field.
const DEFINITION_SAVE_REFUSALS: Record<WaiverBoundaryProblem, string> = {
  missing_source: "Upload the waiver PDF before configuring its fields.",
  unreadable_source:
    "The waiver PDF could not be read. Upload a valid PDF and try again.",
  encrypted_source:
    "The waiver PDF is password protected. Upload a copy without a password and try again.",
  stale_waiver:
    "The waiver document or its fields changed while you were saving. Reload the page and try again.",
  unplaceable_field:
    "One or more fields are placed outside the pages of the waiver PDF. Move them onto a page and save again.",
  unplaceable_signature:
    "A signature field is placed outside the pages of the waiver PDF. Move it onto a page and save again.",
  missing_evidence: "Failed to save waiver definition",
};

// Get waiver definition for a project
export async function getWaiverDefinition(projectId: string): Promise<{
  success: boolean;
  definition?: WaiverDefinitionFull | null;
  error?: string;
}> {
  "use server";
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser();

    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    // Get project to check waiver_definition_id
    const { data: project } = await supabase
      .from("projects")
      .select("waiver_definition_id")
      .eq("id", projectId)
      .single();

    if (!project?.waiver_definition_id) {
      return { success: true, definition: null };
    }

    // Fetch the definition with related data
    const serviceSupabase = getAdminClient();
    const { data: definition, error } = await serviceSupabase
      .from("waiver_definitions")
      .select("*")
      .eq("id", project.waiver_definition_id)
      .eq("project_id", projectId)
      .single();

    if (error) {
      safeConsole.error("Error fetching waiver definition:", error);
      return { success: false, error: "Failed to fetch waiver definition" };
    }

    return {
      success: true,
      definition: definition as WaiverDefinitionFull,
    };
  } catch (error) {
    safeConsole.error("Error in getWaiverDefinition:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// Save waiver definition for a project
export async function saveWaiverDefinition(
  projectId: string,
  definitionInput: unknown,
): Promise<{ success: boolean; definitionId?: string; error?: string }> {
  "use server";
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser();

    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    // Check if user can manage the project
    const canManageProject = await canCurrentUserManageProject(projectId);
    if (!canManageProject) {
      return {
        success: false,
        error: "Only project managers can configure waivers",
      };
    }

    const parsedDefinition =
      waiverDefinitionInputSchema.safeParse(definitionInput);
    if (!parsedDefinition.success) {
      return { success: false, error: "Invalid waiver definition" };
    }
    const definition = parsedDefinition.data;

    // Get project info
    const { data: project } = await supabase
      .from("projects")
      .select("waiver_definition_id, waiver_pdf_url, waiver_pdf_storage_path")
      .eq("id", projectId)
      .single();

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const serviceSupabase = getAdminClient();

    // Process signers and fields for JSONB insert/update
    const signersToInsert = definition.signers.map(
      (
        signer: {
          roleKey?: string;
          label?: string;
          required?: boolean;
          orderIndex?: number;
          rules?: Record<string, unknown> | null;
        },
        index: number,
      ) => ({
        role_key: signer.roleKey,
        label: signer.label,
        required: signer.required ?? true,
        order_index: signer.orderIndex ?? index,
        rules: signer.rules || null,
      }),
    );

    const fieldsToInsert: Record<string, unknown>[] = [];
    if (definition.fields) {
      if (definition.fields.detected) {
        const detectedFieldMappings = Object.entries(
          definition.fields.detected,
        ).map(([fieldKey, mapping]) => ({
          fieldKey: mapping.fieldKey || fieldKey,
          fieldType: mapping.fieldType || "text",
          pageIndex: mapping.pageIndex,
          rect: mapping.rect,
          pdfFieldName: mapping.pdfFieldName || fieldKey,
          label: mapping.label || fieldKey,
          required: mapping.required ?? false,
          signerRoleKey: mapping.signerRoleKey || undefined,
          meta: mapping.meta ?? null,
        }));

        const detectedFields = mapDetectedFieldsForDb(
          "dummy",
          detectedFieldMappings,
        );
        fieldsToInsert.push(
          ...detectedFields.map(({ waiver_definition_id: _, ...rest }) => rest),
        );
      }

      if (definition.fields.custom && definition.fields.custom.length > 0) {
        const customPlacements = definition.fields.custom.map((field) => ({
          id: field.id || field.fieldKey,
          fieldKey: field.fieldKey,
          label: field.label || undefined,
          fieldType: field.fieldType || "signature",
          pageIndex: field.pageIndex,
          rect: field.rect,
          signerRoleKey: field.signerRoleKey || undefined,
          required: field.required ?? undefined,
          meta: field.meta ?? null,
        }));

        const customFields = mapCustomPlacementsForDb(
          "dummy",
          customPlacements,
        );
        fieldsToInsert.push(
          ...customFields.map(({ waiver_definition_id: _, ...rest }) => rest),
        );
      }
    }

    // The new version is pinned to the project's source PDF, or to the current
    // definition's source for a project row that predates source paths. That
    // is the same choice the versioning RPC makes.
    let source = waiverSourceSnapshot(
      project.waiver_pdf_storage_path,
      project.waiver_pdf_url,
    );
    if (project.waiver_definition_id && source.storagePath === null) {
      const { data: currentDefinition, error: currentDefinitionError } =
        await serviceSupabase
          .from("waiver_definitions")
          .select("id, pdf_storage_path, pdf_public_url")
          .eq("id", project.waiver_definition_id)
          .eq("project_id", projectId)
          .maybeSingle();

      if (currentDefinitionError) {
        safeConsole.error(
          "Error loading current waiver definition:",
          currentDefinitionError,
        );
        return { success: false, error: "Failed to save waiver definition" };
      }
      const pinnedSource = waiverSourceSnapshot(
        currentDefinition?.pdf_storage_path,
        currentDefinition?.pdf_public_url,
      );
      // The new version would be pinned to the current definition's document.
      // If the project's legacy URL names a different one, the two disagree
      // and only a fresh upload settles which PDF the fields belong to.
      if (
        currentDefinition &&
        source.publicUrl !== null &&
        !sameWaiverSource(projectId, source, pinnedSource)
      ) {
        return {
          success: false,
          error: "Upload the waiver PDF again before configuring its fields.",
        };
      }
      source = waiverSourceSnapshot(
        pinnedSource.storagePath,
        source.publicUrl ?? pinnedSource.publicUrl,
      );
    }

    // Placements are checked against the actual bytes of that PDF. Page sizes
    // and page counts reported by the browser are never trusted.
    const fieldProblem = await findDefinitionFieldProblem({
      projectId,
      source,
      fields: fieldsToInsert,
      adminClient: serviceSupabase,
    });
    if (fieldProblem) {
      return { success: false, error: DEFINITION_SAVE_REFUSALS[fieldProblem] };
    }

    // Always create a new immutable version and repoint the project in one
    // transaction. Historical signatures keep their original definition row.
    // The save is refused if the source or the current definition changed
    // after the snapshot above was read.
    const { data: definitionId, error: saveError } = await serviceSupabase.rpc(
      "save_project_waiver_definition_version_checked",
      {
        p_project_id: projectId,
        p_actor_id: user.id,
        p_title: definition.title || "Project Waiver",
        p_signers: signersToInsert,
        p_fields: fieldsToInsert,
        p_expected_storage_path: project.waiver_pdf_storage_path ?? null,
        p_expected_public_url: project.waiver_pdf_url ?? null,
        p_expected_definition_id: project.waiver_definition_id ?? null,
      },
    );

    if (saveError || !definitionId) {
      safeConsole.error("Error versioning waiver definition:", saveError);
      return {
        success: false,
        error:
          saveError?.code === "40001"
            ? "The waiver document or its fields changed while you were saving. Reload the page and try again."
            : "Failed to save waiver definition",
      };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true, definitionId: String(definitionId) };
  } catch (error) {
    safeConsole.error("Error in saveWaiverDefinition:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}
