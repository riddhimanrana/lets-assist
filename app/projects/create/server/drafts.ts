"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import { getWaiverPdfRequirementError } from "@/lib/projects/waiver-validation";
import { revalidatePath } from "next/cache";
import type { EventFormState } from "@/hooks/use-event-form";
import { createBasicProject } from "./create";
import {
  isMissingWaiverDisableEsignatureColumnError,
  normalizeRequireLoginForVerificationMethod,
  sanitizeDraftData,
} from "./shared";

export async function finalizeProject(projectId: string) {
  "use server";
  try {
    // Revalidate the projects list page
    revalidatePath("/projects");
    return { success: true, id: projectId };
  } catch (error) {
    console.error("Error in finalize project action:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

// Wrapper function that creates the project only - no file handling
export async function createProject(formData: FormData) {
  "use server";
  try {
    // Parse project data
    const projectDataStr = formData.get("projectData") as string;
    if (!projectDataStr) return { error: "Missing project data" };
    const projectData = JSON.parse(projectDataStr);

    // Create basic project record
    const basicResult = await createBasicProject(projectData);
    if (basicResult.error) return basicResult;

    // Return the project ID - client will handle file uploads separately
    return { success: true, id: basicResult.id };
  } catch (error) {
    console.error("Error in create project wrapper:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

// Save project as draft - with relaxed validation
// Auto-save draft to database (creates or updates existing autosave draft)
// Always updates the same "autosave" draft for continuous work
export async function autoSaveDraft(
  projectData: Partial<EventFormState>,
  autosaveDraftId?: string,
) {
  "use server";
  try {
    const supabase = await createClient();
    const sanitizedProjectData = sanitizeDraftData(projectData);

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return {
        error: "You must be logged in to autosave a draft",
        autosaved: false,
      };
    }

    const waiverPdfError = getWaiverPdfRequirementError(sanitizedProjectData);
    if (waiverPdfError) {
      return { error: waiverPdfError, autosaved: false };
    }

    // Extract title for easy reference
    const title = sanitizedProjectData.basicInfo?.title || "Untitled Draft";

    // If we have an autosave draft ID, update it; otherwise find or create the autosave draft
    if (autosaveDraftId) {
      // Update existing autosave draft
      const { data: draft, error: updateError } = await supabase
        .from("project_drafts")
        .update({
          title: title,
          draft_data: sanitizedProjectData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", autosaveDraftId)
        .eq("user_id", user.id)
        .select()
        .single();

      if (updateError) {
        console.error("Error updating autosave draft:", updateError);
        return {
          error: "Failed to autosave draft",
          autosaved: false,
          id: autosaveDraftId,
        };
      }

      return { success: true, id: draft.id, autosaved: true };
    } else {
      // Create new autosave draft
      const { data: draft, error: draftError } = await supabase
        .from("project_drafts")
        .insert({
          user_id: user.id,
          title: title,
          draft_data: sanitizedProjectData,
        })
        .select()
        .single();

      if (draftError) {
        console.error("Error creating autosave draft:", draftError);
        return { error: "Failed to autosave draft", autosaved: false };
      }

      return { success: true, id: draft.id, autosaved: true };
    }
  } catch (error) {
    console.error("Error autosaving draft:", error);
    return { error: "Failed to autosave draft", autosaved: false };
  }
}

// Save project as a new draft file (creates a new draft entry)
export async function saveProjectAsNewDraft(formData: FormData) {
  "use server";
  try {
    const supabase = await createClient();

    const projectDataStr = formData.get("projectData") as string;
    if (!projectDataStr) return { error: "Missing project data" };
    const projectData = JSON.parse(projectDataStr);
    const sanitizedProjectData = sanitizeDraftData(projectData);

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return { error: "You must be logged in to save a draft" };
    }

    const waiverPdfError = getWaiverPdfRequirementError(sanitizedProjectData);
    if (waiverPdfError) {
      return { error: waiverPdfError };
    }

    // Extract title for easy reference
    const title = sanitizedProjectData.basicInfo?.title || "Untitled Draft";

    // Always create a new draft entry
    const { data: draft, error: draftError } = await supabase
      .from("project_drafts")
      .insert({
        user_id: user.id,
        title: title,
        draft_data: sanitizedProjectData,
      })
      .select()
      .single();

    if (draftError) {
      console.error("Error saving new draft:", draftError);
      return { error: "Failed to save draft" };
    }

    revalidatePath("/projects/drafts");
    revalidatePath("/projects/create");
    return { success: true, id: draft.id, isDraft: true };
  } catch (error) {
    console.error("Error saving project as new draft:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

export async function saveProjectAsDraft(formData: FormData) {
  "use server";
  try {
    const supabase = await createClient();

    const projectDataStr = formData.get("projectData") as string;
    if (!projectDataStr) return { error: "Missing project data" };
    const projectData = JSON.parse(projectDataStr);
    const sanitizedProjectData = sanitizeDraftData(projectData);

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return { error: "You must be logged in to save a draft" };
    }

    const waiverPdfError = getWaiverPdfRequirementError(sanitizedProjectData);
    if (waiverPdfError) {
      return { error: waiverPdfError };
    }

    // Extract title for easy reference
    const title = sanitizedProjectData.basicInfo?.title || "Untitled Draft";

    // Save as JSON in project_drafts table
    const { data: draft, error: draftError } = await supabase
      .from("project_drafts")
      .insert({
        user_id: user.id,
        title: title,
        draft_data: sanitizedProjectData,
      })
      .select()
      .single();

    if (draftError) {
      console.error("Error saving draft:", draftError);
      return { error: "Failed to save draft" };
    }

    revalidatePath("/projects/drafts");
    revalidatePath("/projects/create");
    return { success: true, id: draft.id, isDraft: true };
  } catch (error) {
    console.error("Error saving project as draft:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

// Publish a draft project and delete the draft after successful creation
export async function publishDraft(draftId: string) {
  "use server";
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be logged in to publish a project" };
  }

  // Get the draft data
  const { data: draft, error: draftError } = await supabase
    .from("project_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("user_id", user.id)
    .single();

  if (draftError || !draft) {
    return { error: "Draft not found" };
  }

  // Create the project from draft data
  const projectData = draft.draft_data;
  const waiverPdfError = getWaiverPdfRequirementError(projectData);
  if (waiverPdfError) {
    return { error: waiverPdfError };
  }
  const basicResult = await createBasicProject(projectData, false);

  if (basicResult.error) {
    return basicResult;
  }

  // Delete the draft after successful project creation
  await supabase.from("project_drafts").delete().eq("id", draftId);

  revalidatePath("/projects");
  revalidatePath("/projects/drafts");
  revalidatePath("/projects/create");
  revalidatePath(`/projects/${basicResult.id}`);

  return { success: true, id: basicResult.id };
}

// Update an existing draft project
export async function updateDraft(
  projectId: string,
  projectData: Partial<EventFormState>,
) {
  "use server";
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to update a draft" };
  }

  // Verify the user owns this draft
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, creator_id, workflow_status, visibility")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return { error: "Project not found" };
  }

  if (project.creator_id !== user.id) {
    return { error: "You don't have permission to edit this project" };
  }

  if (project.workflow_status !== "draft") {
    return { error: "This project is not a draft" };
  }

  if (
    !projectData.basicInfo ||
    !projectData.eventType ||
    !projectData.schedule?.[projectData.eventType]
  ) {
    return { error: "Incomplete project data for draft update" };
  }

  const waiverPdfError = getWaiverPdfRequirementError(projectData);
  if (waiverPdfError) {
    return { error: waiverPdfError };
  }

  const targetVisibility =
    projectData.visibility || project.visibility || "unlisted";

  if (targetVisibility === "public") {
    const { data: tmProfile } = await supabase
      .from("profiles")
      .select("trusted_member")
      .eq("id", user.id)
      .single();

    if (!tmProfile?.trusted_member) {
      const { data: tmApp } = await supabase
        .from("trusted_member")
        .select("status")
        .or(`id.eq.${user.id},user_id.eq.${user.id}`)
        .maybeSingle();

      if (tmApp?.status !== true) {
        return {
          error:
            "Only Trusted Members can set project visibility to Public. Keep this draft Unlisted or Organization-only, or apply at /trusted-member.",
        };
      }
    }
  }

  // Build recurrence rule if enabled
  const recurrenceRule = projectData.recurrence?.enabled
    ? {
        frequency: projectData.recurrence.frequency,
        interval: projectData.recurrence.interval || 1,
        end_type: projectData.recurrence.endType,
        end_date: projectData.recurrence.endDate || null,
        end_occurrences: projectData.recurrence.endOccurrences || null,
        weekdays: projectData.recurrence.weekdays || [],
      }
    : null;

  // Update the draft
  const baseUpdatePayload = {
    title: projectData.basicInfo.title,
    location: projectData.basicInfo.location,
    location_data: projectData.basicInfo.locationData,
    description: sanitizeRichTextHtml(projectData.basicInfo.description),
    event_type: projectData.eventType,
    schedule: projectData.schedule,
    verification_method: projectData.verificationMethod,
    require_login: normalizeRequireLoginForVerificationMethod(
      projectData.verificationMethod,
      projectData.requireLogin ?? true,
    ),
    enable_volunteer_comments: projectData.enableVolunteerComments || false,
    show_attendees_publicly: projectData.showAttendeesPublicly || false,
    waiver_required: projectData.waiverRequired || false,
    waiver_allow_upload: projectData.waiverAllowUpload ?? true,
    visibility: targetVisibility,
    project_timezone:
      projectData.basicInfo.projectTimezone || "America/Los_Angeles",
    restrict_to_org_domains: projectData.restrictToOrgDomains || false,
    recurrence_rule: recurrenceRule,
  };

  let { error: updateError } = await supabase
    .from("projects")
    .update({
      ...baseUpdatePayload,
      waiver_disable_esignature: projectData.waiverDisableEsignature ?? false,
    })
    .eq("id", projectId);

  if (updateError && isMissingWaiverDisableEsignatureColumnError(updateError)) {
    ({ error: updateError } = await supabase
      .from("projects")
      .update(baseUpdatePayload)
      .eq("id", projectId));
  }

  if (updateError) {
    console.error("Error updating draft:", updateError);
    return { error: "Failed to update draft" };
  }

  revalidatePath("/projects/drafts");
  revalidatePath(`/projects/${projectId}`);

  return { success: true, id: projectId };
}

// Delete a draft project
export async function deleteDraft(draftId: string) {
  "use server";
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to delete a draft" };
  }

  // Verify the user owns this draft
  const { data: draft, error: draftError } = await supabase
    .from("project_drafts")
    .select("id, user_id")
    .eq("id", draftId)
    .single();

  if (draftError || !draft) {
    return { error: "Draft not found" };
  }

  if (draft.user_id !== user.id) {
    return { error: "You don't have permission to delete this draft" };
  }

  // Delete the draft from project_drafts table
  const { error: deleteError } = await supabase
    .from("project_drafts")
    .delete()
    .eq("id", draftId)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("Error deleting draft:", deleteError);
    return { error: "Failed to delete draft" };
  }

  revalidatePath("/projects/drafts");
  revalidatePath("/projects/create");

  return { success: true };
}
