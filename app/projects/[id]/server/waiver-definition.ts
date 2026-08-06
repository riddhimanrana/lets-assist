"use server";

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
import { canCurrentUserManageProject } from "./access";

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
      console.error("Error fetching waiver definition:", error);
      return { success: false, error: "Failed to fetch waiver definition" };
    }

    return {
      success: true,
      definition: definition as WaiverDefinitionFull,
    };
  } catch (error) {
    console.error("Error in getWaiverDefinition:", error);
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

    // Always create a new immutable version and repoint the project in one
    // transaction. Historical signatures keep their original definition row.
    const { data: definitionId, error: saveError } = await serviceSupabase.rpc(
      "save_project_waiver_definition_version",
      {
        p_project_id: projectId,
        p_actor_id: user.id,
        p_title: definition.title || "Project Waiver",
        p_signers: signersToInsert,
        p_fields: fieldsToInsert,
      },
    );

    if (saveError || !definitionId) {
      console.error("Error versioning waiver definition:", saveError);
      return { success: false, error: "Failed to save waiver definition" };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true, definitionId: String(definitionId) };
  } catch (error) {
    console.error("Error in saveWaiverDefinition:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}
