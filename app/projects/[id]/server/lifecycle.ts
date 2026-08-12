"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
import { type Project } from "@/types";
import { toOrganizationPluginAccessRole } from "@/lib/plugins/access-role";
import { removeCalendarEventForProject } from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPluginRegistry } from "@/lib/plugins/registry";
import { runProjectClone } from "@/lib/plugins/lifecycle";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import { canUserManageProject, getProject } from "./access";

export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  cancellationReason?: string,
) {
  "use server";
  const supabase = await createClient();
  let cancellationNotifications:
    | { enqueued: boolean; triggerAttempted: boolean; error?: string }
    | undefined;

  // Get current user using getClaims() for better performance
  const { user, error: userError } = await getAuthUser();
  if (!user || userError) {
    return { error: "You must be logged in to update project status" };
  }

  // Verify user has permission to update the project
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  if (newStatus === "cancelled") {
    if (!cancellationReason) {
      return { error: "Cancellation reason is required" };
    }
    if (project.status !== "upcoming" && project.status !== "cancelled") {
      return { error: "Only an upcoming project can be cancelled" };
    }

    // The RPC rechecks permission under the project-row lock, performs the real
    // upcoming -> cancelled transition, and freezes the exact audience/outbox in
    // the same transaction. There is no service-role enqueue transaction to lose.
    const { data: cancellationResult, error: cancellationError } =
      await supabase.rpc("cancel_project_transactional", {
        p_project_id: projectId,
        p_cancellation_reason: cancellationReason,
      });

    const cancellationReceipt = cancellationResult as {
      outcome?: unknown;
      jobStatus?: unknown;
      accepted?: unknown;
    } | null;
    const validJobStatus = [
      "pending",
      "processing",
      "completed",
      "failed",
      "needs_review",
      "missing",
    ].includes(String(cancellationReceipt?.jobStatus));
    const validReceipt =
      validJobStatus &&
      ((cancellationReceipt?.outcome === "cancelled" &&
        cancellationReceipt.jobStatus === "pending" &&
        cancellationReceipt.accepted === true) ||
        (cancellationReceipt?.outcome === "already_cancelled" &&
          ["pending", "processing", "completed"].includes(
            String(cancellationReceipt.jobStatus),
          ) &&
          cancellationReceipt.accepted === true) ||
        (cancellationReceipt?.outcome ===
          "already_cancelled_review_required" &&
          ["needs_review", "failed", "missing"].includes(
            String(cancellationReceipt.jobStatus),
          ) &&
          cancellationReceipt.accepted === false));

    if (cancellationError || !validReceipt) {
      if (process.env.NODE_ENV !== "test") {
        console.error("Error cancelling project transactionally:", {
          code: cancellationError?.code,
        });
      }
      return { error: "Failed to cancel project" };
    }

    const receipt = cancellationReceipt as {
      outcome:
        | "cancelled"
        | "already_cancelled"
        | "already_cancelled_review_required";
      jobStatus: string;
      accepted: boolean;
    };

    cancellationNotifications = {
      enqueued: receipt.accepted,
      triggerAttempted: false,
    };

    if (receipt.outcome === "cancelled") {
      try {
        await removeCalendarEventForProject(projectId);
      } catch (calendarError) {
        console.error(
          "Error removing calendar event for cancelled project:",
          calendarError,
        );
      }
    }

    if (!receipt.accepted) {
      cancellationNotifications.error =
        "Cancellation notifications require manual review.";
    } else if (receipt.jobStatus === "pending") {
      const workerEnabled =
        process.env.PROJECT_CANCELLATION_WORKER_ENABLED === "true";
      const workerBaseUrl = process.env.NEXT_PUBLIC_SITE_URL;
      const workerToken =
        process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN;

      if (!workerEnabled) {
        cancellationNotifications.error =
          "Project cancellation worker is disabled.";
      } else if (workerBaseUrl && workerToken) {
        cancellationNotifications.triggerAttempted = true;
        void fetch(`${workerBaseUrl}/api/cron/project-cancellations`, {
          method: "POST",
          headers: { authorization: `Bearer ${workerToken}` },
        }).catch((err) => {
          if (process.env.NODE_ENV !== "test") {
            console.error("Failed to trigger project cancellation worker:", err);
          }
        });
      } else {
        cancellationNotifications.error =
          "Project cancellation worker is not configured.";
      }
    }
  } else {
    if (!(await canUserManageProject(supabase, project, user.id))) {
      return { error: "You don't have permission to update this project" };
    }

    const { data: updatedProject, error: updateError } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", projectId)
      .select("id")
      .maybeSingle();

    if (updateError || !updatedProject) {
      console.error("Error updating project status:", updateError);
      return { error: "Failed to update project status" };
    }
  }

  // Revalidate project pages
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/organization/${project.organization?.id}`);
  revalidatePath("/home");

  return { success: true, cancellationNotifications };
}

export async function cloneProject(projectId: string) {
  "use server";
  const supabase = await createClient();
  const { user } = await getAuthUser();
  if (!user) return { error: "You must be logged in to clone a project" };

  // Fetch source project
  const { data: source, error: fetchError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (fetchError || !source) return { error: "Project not found" };

  const hasPermission = await canUserManageProject(supabase, source, user.id);

  if (!hasPermission) {
    return { error: "You don't have permission to clone this project" };
  }

  // Prepare new project data
  const {
    id: _,
    created_at: __,
    updated_at: ___,
    creator_id: ____,
    status: _____,
    workflow_status: ______,
    creator_calendar_event_id: _______,
    creator_synced_at: ________,
    published: _________,
    certificates: __________,
    ...clonableData
  } = source;

  const newProjectData = {
    ...clonableData,
    title: `${source.title} (Copy)`,
    creator_id: user.id,
    status: "draft",
    workflow_status: "draft",
  };

  // Insert new project
  const { data: newProject, error: insertError } = await supabase
    .from("projects")
    .insert(newProjectData)
    .select("id")
    .single();

  if (insertError) {
    console.error("Error creating clone:", insertError);
    return { error: `Failed to create clone: ${insertError.message}` };
  }

  // Trigger plugin hooks if organization-scoped
  if (source.organization_id) {
    try {
      const { data: orgMember } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", source.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      const viewerRole = toOrganizationPluginAccessRole(orgMember?.role);
      const installedPlugins = await resolveOrganizationPlugins({
        organizationId: source.organization_id,
        userRole: viewerRole,
      });

      const registry = getPluginRegistry();

      for (const resolved of installedPlugins) {
        const definition = registry.get(resolved.key);
        if (definition && definition.lifecycle?.onProjectClone) {
          await runProjectClone(definition, {
            organization: {
              id: source.organization_id,
              role: viewerRole ?? "member",
            },
            actor: { id: user.id, type: "user" },
            sourceProjectId: projectId,
            newProjectId: newProject.id,
          });
        }
      }
    } catch (pluginError) {
      console.error("Error triggering plugin clone hooks:", pluginError);
      // Don't fail the whole clone if plugins fail
    }
  }

  revalidatePath(`/projects/${newProject.id}`);
  if (source.organization_id) {
    revalidatePath(`/organization/${source.organization_id}`);
  }
  revalidatePath("/home");

  return { success: true, newProjectId: newProject.id };
}

export async function deleteProject(projectId: string) {
  "use server";
  const supabase = await createClient();

  // Get current user using getClaims() for better performance
  const { user, error: userError } = await getAuthUser();
  if (!user || userError) {
    return { error: "You must be logged in to delete a project" };
  }

  // Verify user has permission to delete the project
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if user has permission
  let hasPermission = project.creator_id === user.id;
  if (project.organization && !hasPermission) {
    const { data: orgMember } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization.id)
      .eq("user_id", user.id)
      .single();

    if (orgMember?.role) {
      hasPermission = orgMember.role === "admin"; // Only admins can delete projects
    }
  }

  if (!hasPermission) {
    return { error: "You don't have permission to delete this project" };
  }

  const serviceSupabase = getAdminClient();
  const { count: signedWaiverCount, error: signedWaiverError } =
    await serviceSupabase
      .from("waiver_signatures")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

  if (signedWaiverError) {
    return { error: "Unable to verify the project's waiver-retention state" };
  }

  if ((signedWaiverCount ?? 0) > 0) {
    return {
      error:
        "Projects with signed waivers must be cancelled and retained until their evidence-retention period ends",
    };
  }

  // Delete project documents from storage if they exist
  if ((project.documents?.length ?? 0) > 0) {
    const { data: storageData } = await supabase.storage
      .from("project-documents")
      .list();

    if (storageData) {
      const projectFiles = storageData.filter((file) =>
        file.name.startsWith(`project_${projectId}`),
      );

      if (projectFiles.length > 0) {
        await supabase.storage
          .from("project-documents")
          .remove(projectFiles.map((file) => file.name));
      }
    }
  }

  // Delete cover image if it exists
  if (project.cover_image_url) {
    const fileName = project.cover_image_url.split("/").pop();
    if (fileName) {
      await supabase.storage.from("project-images").remove([fileName]);
    }
  }

  // Remove calendar event if it exists (non-blocking)
  try {
    await removeCalendarEventForProject(projectId);
  } catch (calendarError) {
    console.error("Error removing calendar event:", calendarError);
    // Don't fail the deletion if calendar removal fails
  }

  // Delete project from database
  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (deleteError) {
    console.error("Error deleting project:", deleteError);
    return { error: "Failed to delete project" };
  }

  // Revalidate paths
  revalidatePath("/home");
  if (project.organization) {
    revalidatePath(`/organization/${project.organization.id}`);
  }

  return { success: true };
}

export async function updateProject(
  projectId: string,
  updates: Partial<Project>,
) {
  "use server";
  try {
    const supabase = await createClient();
    const sanitizedUpdates: Partial<Project> = {
      ...updates,
      ...(typeof updates.description === "string"
        ? { description: sanitizeRichTextHtml(updates.description) }
        : {}),
    };
    const mutableSanitizedUpdates = sanitizedUpdates as Record<string, unknown>;
    const immutableProjectFields = [
      "id",
      "creator_id",
      "organization_id",
      "created_at",
      "session_id",
      "waiver_definition_id",
      "waiver_pdf_storage_path",
      "waiver_pdf_url",
      "creator_calendar_event_id",
      "creator_synced_at",
      "reviewed_by",
      "reviewed_at",
    ] as const;
    for (const field of immutableProjectFields) {
      delete mutableSanitizedUpdates[field];
    }

    // Get current user using getClaims() for better performance
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return { error: "Unauthorized" };
    }

    // Verify project ownership
    const { data: project } = await supabase
      .from("projects")
      .select(
        "creator_id, organization_id, can_be_managed_by_staff, recurrence_parent_id, recurrence_rule, visibility",
      )
      .eq("id", projectId)
      .single();

    if (!project || !(await canUserManageProject(supabase, project, user.id))) {
      return { error: "Unauthorized" };
    }

    const requestsPublicVisibility =
      Object.prototype.hasOwnProperty.call(sanitizedUpdates, "visibility") &&
      sanitizedUpdates.visibility === "public";

    if (requestsPublicVisibility) {
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
              "Only Trusted Members can set project visibility to Public. Keep the project Unlisted or Organization-only, or apply at /trusted-member.",
          };
        }
      }
    }

    const disablesRecurrence =
      Object.prototype.hasOwnProperty.call(
        sanitizedUpdates,
        "recurrence_rule",
      ) && sanitizedUpdates.recurrence_rule === null;
    const isRecurringParent =
      !project.recurrence_parent_id && !!project.recurrence_rule;

    // Update the project
    const { error: updateError } = await supabase
      .from("projects")
      .update(sanitizedUpdates)
      .eq("id", projectId);

    if (updateError) throw updateError;

    let cancelledOccurrences = 0;

    if (disablesRecurrence && isRecurringParent) {
      const nowIso = new Date().toISOString();
      const { data: cancelledRows, error: cancelError } = await supabase
        .from("projects")
        .update({
          status: "cancelled",
          cancelled_at: nowIso,
          cancellation_reason: "Recurring series ended by organizer",
        })
        .eq("recurrence_parent_id", projectId)
        .eq("status", "upcoming")
        .select("id");

      if (cancelError) {
        console.error("Error cancelling recurring occurrences:", cancelError);
      } else {
        cancelledOccurrences = cancelledRows?.length ?? 0;
      }
    }

    return {
      success: true,
      endedRecurringSeries: disablesRecurrence && isRecurringParent,
      cancelledOccurrences,
    };
  } catch (error) {
    console.error("Error updating project:", error);
    return { error: "Failed to update project" };
  }
}
