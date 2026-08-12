"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { canCancelProject } from "@/utils/project";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
import { type Project } from "@/types";
import { toOrganizationPluginAccessRole } from "@/lib/plugins/access-role";
import { removeCalendarEventForProject } from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPluginRegistry } from "@/lib/plugins/registry";
import { runProjectClone } from "@/lib/plugins/lifecycle";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import { canUserManageProject } from "./access";
import {
  validateRecurrenceRule,
  validateProjectSchedule,
  validateProjectTimezone,
} from "@/lib/projects/schedule-validation";

const ALLOWED_PROJECT_STATUS_TRANSITIONS: Record<
  ProjectStatus,
  readonly ProjectStatus[]
> = {
  upcoming: ["in-progress", "completed", "cancelled"],
  "in-progress": ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function isAllowedProjectStatusTransition(
  currentStatus: ProjectStatus,
  nextStatus: ProjectStatus,
) {
  return (
    ALLOWED_PROJECT_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ??
    false
  );
}

async function getProjectForMutation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
) {
  // Keep mutation authorization independent of PostgREST relationship-cache
  // state. These actions only need the project row and its organization_id.
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project || project.id !== projectId) {
    return { project: null, error: error ?? new Error("Project not found") };
  }

  return { project: project as Project, error: null };
}

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
  const { project, error: projectError } = await getProjectForMutation(
    supabase,
    projectId,
  );

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  if (!(await canUserManageProject(supabase, project, user.id))) {
    return { error: "You don't have permission to update this project" };
  }

  if (!isAllowedProjectStatusTransition(project.status, newStatus)) {
    return { error: "Project status transition is not allowed" };
  }

  // If cancelling, validate cancellation is allowed
  if (newStatus === "cancelled") {
    if (!canCancelProject(project)) {
      return {
        error: "Project can only be cancelled within 24 hours of start time",
      };
    }
    if (!cancellationReason) {
      return { error: "Cancellation reason is required" };
    }
  }

  // Update project status
  const updateData: {
    status: ProjectStatus;
    cancelled_at?: string;
    cancellation_reason?: string | null;
  } = { status: newStatus };
  if (newStatus === "cancelled") {
    updateData.cancelled_at = new Date().toISOString();
    updateData.cancellation_reason = cancellationReason;
  }

  const { data: updatedProject, error: updateError } = await supabase
    .from("projects")
    .update(updateData)
    .eq("id", projectId)
    .eq("status", project.status)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Error updating project status:", updateError);
    return { error: "Failed to update project status" };
  }

  if (!updatedProject || updatedProject.id !== projectId) {
    return { error: "Failed to update project status" };
  }

  // If cancelling, remove calendar events (non-blocking) and enqueue notifications.
  if (newStatus === "cancelled") {
    // Remove creator's calendar event (non-blocking)
    try {
      await removeCalendarEventForProject(projectId);
    } catch (calendarError) {
      console.error(
        "Error removing calendar event for cancelled project:",
        calendarError,
      );
      // Don't fail the cancellation if calendar cleanup fails
    }

    // --- ENQUEUE CANCELLATION NOTIFICATIONS (BACKGROUND) ---
    // We enqueue a job for a cron/worker route to process. This is more reliable
    // than doing a potentially large fanout inside the server action.
    cancellationNotifications = { enqueued: false, triggerAttempted: false };
    try {
      const cancelledAt = updateData.cancelled_at ?? new Date().toISOString();
      const serviceSupabase = getAdminClient();

      // Enqueue through the service RPC rather than upserting the row here.
      // The old client-shaped upsert reset status, cursor, attempts, and the
      // lease timestamps on every conflict, so re-cancelling a project could
      // stomp a live worker lease and re-drive an audience mid-flight. The RPC
      // only ever revives a job that provably sent nothing more.
      const { data: enqueueResult, error: enqueueError } =
        await serviceSupabase.rpc("enqueue_project_cancellation_job", {
          p_project_id: projectId,
          p_cancelled_at: cancelledAt,
          p_cancellation_reason: cancellationReason!,
          p_created_by: user.id,
        });

      const enqueueAccepted = Boolean(
        (enqueueResult as { accepted?: boolean } | null)?.accepted,
      );

      if (enqueueError || !enqueueAccepted) {
        if (process.env.NODE_ENV !== "test") {
          console.error(
            "Error enqueueing project cancellation job:",
            enqueueError,
          );
        }
        cancellationNotifications.error =
          "Failed to queue cancellation notifications.";
      } else {
        cancellationNotifications.enqueued = true;

        // Best-effort: kick the worker immediately, but don't block the user.
        // Cron should still run this periodically in production.
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
            headers: {
              authorization: `Bearer ${workerToken}`,
            },
          }).catch((err) => {
            if (process.env.NODE_ENV !== "test") {
              console.error(
                "Failed to trigger project cancellation worker:",
                err,
              );
            }
          });
        } else {
          cancellationNotifications.error =
            "Project cancellation worker is not configured.";
        }
      }
    } catch (notificationError) {
      if (process.env.NODE_ENV !== "test") {
        console.error(
          "Error enqueueing project cancellation notifications:",
          notificationError,
        );
      }
      cancellationNotifications.error =
        "Failed to queue cancellation notifications.";
      // Don't fail the cancellation if notifications queueing fails
    }
  }

  // Revalidate project pages
  revalidatePath(`/projects/${projectId}`);
  if (project.organization_id) {
    revalidatePath(`/organization/${project.organization_id}`);
  }
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

  const scheduleResult = validateProjectSchedule(
    source.event_type,
    source.schedule,
  );
  if (!scheduleResult.ok) {
    return { error: `Cannot clone invalid schedule: ${scheduleResult.error}` };
  }

  const projectTimezone = source.project_timezone;
  const timezoneResult = validateProjectTimezone(projectTimezone);
  if (!timezoneResult.ok) {
    return {
      error: `Cannot clone invalid project timezone: ${timezoneResult.error}`,
    };
  }

  let recurrenceRule = null;
  if (source.recurrence_rule !== null) {
    const ruleResult = validateRecurrenceRule(source.recurrence_rule);
    if (!ruleResult.ok) {
      return {
        error: `Cannot clone invalid recurrence rule: ${ruleResult.error}`,
      };
    }
    recurrenceRule = ruleResult.rule;
  }

  // A clone is a new project identity. Only reviewed user-facing configuration
  // is copied; row identity, workflow/review state, publication state, calendar
  // bindings, and recurrence lineage are deliberately rebuilt or cleared.
  const newProjectData = {
    title: `${source.title} (Copy)`,
    description: source.description,
    location: source.location,
    location_data: source.location_data,
    event_type: source.event_type,
    schedule: scheduleResult.schedule,
    verification_method: source.verification_method,
    require_login: source.require_login,
    enable_volunteer_comments: source.enable_volunteer_comments,
    show_attendees_publicly: source.show_attendees_publicly,
    waiver_required: source.waiver_required,
    waiver_allow_upload: source.waiver_allow_upload,
    waiver_disable_esignature: source.waiver_disable_esignature,
    cover_image_url: source.cover_image_url,
    documents: source.documents,
    organization_id: source.organization_id,
    visibility: source.visibility,
    can_be_managed_by_staff: source.can_be_managed_by_staff,
    project_timezone: projectTimezone,
    restrict_to_org_domains: source.restrict_to_org_domains,
    signup_form_schema: source.signup_form_schema,
    recurrence_rule: recurrenceRule,
    recurrence_parent_id: null,
    recurrence_sequence: null,
    recurrence_occurrence_date: null,
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
  const { project, error: projectError } = await getProjectForMutation(
    supabase,
    projectId,
  );

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if user has permission
  let hasPermission = project.creator_id === user.id;
  if (project.organization_id && !hasPermission) {
    const { data: orgMember, error: orgMemberError } = await supabase
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (orgMemberError) {
      return { error: "Failed to verify project permissions" };
    }

    if ((orgMember?.status ?? "active") === "active" && orgMember?.role) {
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

  if (signedWaiverError || signedWaiverCount === null) {
    return { error: "Unable to verify the project's waiver-retention state" };
  }

  if (signedWaiverCount > 0) {
    return {
      error:
        "Projects with signed waivers must be cancelled and retained until their evidence-retention period ends",
    };
  }

  // Prove the RLS-scoped delete before touching external systems. The project
  // snapshot above retains every cleanup path needed after the row is gone.
  const { data: deletedProject, error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    console.error("Error deleting project:", deleteError);
    return { error: "Failed to delete project" };
  }

  if (!deletedProject || deletedProject.id !== projectId) {
    return { error: "Failed to delete project" };
  }

  // Delete project documents from storage if they exist
  if ((project.documents?.length ?? 0) > 0) {
    const { data: storageData, error: storageListError } =
      await supabase.storage.from("project-documents").list();

    if (storageListError) {
      console.error(
        "Error listing deleted project documents:",
        storageListError,
      );
    } else if (storageData) {
      const projectFiles = storageData.filter((file) =>
        file.name.startsWith(`project_${projectId}`),
      );

      if (projectFiles.length > 0) {
        const { error: documentRemovalError } = await supabase.storage
          .from("project-documents")
          .remove(projectFiles.map((file) => file.name));

        if (documentRemovalError) {
          console.error(
            "Error removing deleted project documents:",
            documentRemovalError,
          );
        }
      }
    }
  }

  // Delete cover image if it exists
  if (project.cover_image_url) {
    const fileName = project.cover_image_url.split("/").pop();
    if (fileName) {
      const { error: coverRemovalError } = await supabase.storage
        .from("project-images")
        .remove([fileName]);

      if (coverRemovalError) {
        console.error(
          "Error removing deleted project cover image:",
          coverRemovalError,
        );
      }
    }
  }

  // Remove calendar event if it exists (non-blocking)
  try {
    await removeCalendarEventForProject(projectId);
  } catch (calendarError) {
    console.error("Error removing calendar event:", calendarError);
    // Don't fail the deletion if calendar removal fails
  }

  // Revalidate paths
  revalidatePath("/home");
  if (project.organization_id) {
    revalidatePath(`/organization/${project.organization_id}`);
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

    // Authentication and authorization first: unauthorized callers must not
    // be able to trigger sanitization/parsing or probe field-level errors.
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

    // Validate project_timezone when being updated (explicit undefined means omitted).
    if (
      Object.prototype.hasOwnProperty.call(
        sanitizedUpdates,
        "project_timezone",
      ) &&
      sanitizedUpdates.project_timezone !== undefined
    ) {
      const tzResult = validateProjectTimezone(
        sanitizedUpdates.project_timezone,
      );
      if (!tzResult.ok) {
        return { error: `Invalid project timezone: ${tzResult.error}` };
      }
    }

    // Validate recurrence_rule when being updated (null clears the rule).
    if (
      Object.prototype.hasOwnProperty.call(
        sanitizedUpdates,
        "recurrence_rule",
      ) &&
      sanitizedUpdates.recurrence_rule !== null &&
      sanitizedUpdates.recurrence_rule !== undefined
    ) {
      const ruleResult = validateRecurrenceRule(
        sanitizedUpdates.recurrence_rule,
      );
      if (!ruleResult.ok) {
        return { error: `Invalid recurrence rule: ${ruleResult.error}` };
      }
      sanitizedUpdates.recurrence_rule = ruleResult.rule;
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
