"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import { getWaiverPdfRequirementError } from "@/lib/projects/waiver-validation";
import type { EventFormState } from "@/hooks/use-event-form";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import { runProjectCreate } from "@/lib/plugins/lifecycle";
import { OrganizationWithRole } from "@/types/plugin";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  isMissingSignupFormSchemaColumnError,
  isMissingWaiverDisableEsignatureColumnError,
  normalizeRequireLoginForVerificationMethod,
  omitProjectColumns,
} from "./shared";

export type CreateBasicProjectResult = {
  success?: boolean;
  id?: string;
  error?: string;
  /** True when the row was created unpublished and still needs its waiver. */
  requiresWaiverPublication?: boolean;
};

export async function createBasicProject(
  projectData: EventFormState & { userNow?: string },
  isDraft: boolean = false,
): Promise<CreateBasicProjectResult> {
  "use server";
  // Validate that all dates and times are in the future (using user's local time)
  // if (projectData.eventType === "oneTime") {
  //   if (isDateTimeInPast(projectData.schedule.oneTime.date, projectData.schedule.oneTime.startTime, userNow) ||
  //       isDateTimeInPast(projectData.schedule.oneTime.date, projectData.schedule.oneTime.endTime, userNow)) {
  //     return { error: "Event dates and times must be in the future" };
  //   }
  // } else if (projectData.eventType === "multiDay") {
  //   for (const day of projectData.schedule.multiDay) {
  //     for (const slot of day.slots) {
  //       if (isDateTimeInPast(day.date, slot.startTime, userNow) ||
  //           isDateTimeInPast(day.date, slot.endTime, userNow)) {
  //         return { error: "Event dates and times must be in the future" };
  //       }
  //     }
  //   }
  // } else if (projectData.eventType === "sameDayMultiArea") {
  //   const date = projectData.schedule.sameDayMultiArea.date;
  //   if (isDateTimeInPast(date, projectData.schedule.sameDayMultiArea.overallStart, userNow) ||
  //       isDateTimeInPast(date, projectData.schedule.sameDayMultiArea.overallEnd, userNow)) {
  //     return { error: "Event dates and times must be in the future" };
  //   }
  //   for (const role of projectData.schedule.sameDayMultiArea.roles) {
  //     if (isDateTimeInPast(date, role.startTime, userNow) ||
  //         isDateTimeInPast(date, role.endTime, userNow)) {
  //       return { error: "Event dates and times must be in the future" };
  //     }
  //   }
  // }
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to create a project" };
  }

  const requestedVisibility = projectData.visibility || "unlisted";

  // Trusted member gating only for projects that appear in public feed.
  if (requestedVisibility === "public") {
    const { data: tmProfile } = await supabase
      .from("profiles")
      .select("trusted_member")
      .eq("id", user.id)
      .single();

    if (!tmProfile?.trusted_member) {
      // If profile flag isn't set, allow if application is accepted.
      const { data: tmApp } = await supabase
        .from("trusted_member")
        .select("status")
        .or(`id.eq.${user.id},user_id.eq.${user.id}`)
        .maybeSingle();

      if (tmApp?.status !== true) {
        return {
          error:
            "Only Trusted Members can create Public projects. You can still create Unlisted or Organization-only projects. Visit /trusted-member to apply for Public visibility.",
        };
      }
    }
  }

  // Rate limiting: Check projects created in the last 24 hours
  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const { count: projectsCount, error: countError } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", user.id)
    .gte("created_at", twentyFourHoursAgo);

  if (countError) {
    console.error("Error counting projects for rate limit:", countError);
    // Decide if you want to block creation or allow if count fails. For now, allowing.
  }

  if (projectsCount !== null && projectsCount >= 50) {
    return {
      error:
        "You have created too many projects recently. Please try again in 24 hours.",
    };
  }

  // Get organization_id from the project data
  const organizationId = projectData.basicInfo.organizationId;

  // If organization_id is provided, verify the user has permission to create projects
  if (organizationId) {
    const { data: orgMember, error: orgError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    if (orgError || !orgMember) {
      return {
        error:
          "You don't have permission to create projects for this organization",
      };
    }

    if (orgMember.role !== "admin" && orgMember.role !== "staff") {
      return {
        error: "Only organization admins and staff can create projects",
      };
    }
  }

  const waiverPdfError = getWaiverPdfRequirementError(projectData);
  if (waiverPdfError) {
    return { error: waiverPdfError };
  }

  const stagesWaiverPublication = !isDraft && !!projectData.waiverRequired;

  try {
    // Initialize published field based on event type
    let publishedState: { [key: string]: boolean } = {};

    if (projectData.eventType === "oneTime") {
      // For one-time events, simple oneTime key
      publishedState = { oneTime: false };
    } else if (
      projectData.eventType === "multiDay" &&
      projectData.schedule.multiDay
    ) {
      // For multi-day events, create keys for each day and slot combination
      projectData.schedule.multiDay.forEach(
        (
          day: {
            date: string;
            slots: { startTime: string; endTime: string }[];
          },
          dayIndex: number,
        ) => {
          day.slots.forEach(
            (
              slot: { startTime: string; endTime: string },
              slotIndex: number,
            ) => {
              // Format: "YYYY-MM-DD-dayIndex-slotIndex" (unique even if dates are duplicate)
              const sessionKey = `${day.date}-${dayIndex}-${slotIndex}`;
              publishedState[sessionKey] = false;
            },
          );
        },
      );
    } else if (
      projectData.eventType === "sameDayMultiArea" &&
      projectData.schedule.sameDayMultiArea
    ) {
      // For multi-area events, use role names as keys
      projectData.schedule.sameDayMultiArea.roles.forEach(
        (role: { name: string; startTime: string; endTime: string }) => {
          // Use role name as the key
          publishedState[role.name] = false;
        },
      );
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

    const baseProjectPayload = {
      creator_id: user.id,
      title: projectData.basicInfo.title,
      location: projectData.basicInfo.location,
      location_data: projectData.basicInfo.locationData, // Add locationData field
      description: sanitizeRichTextHtml(projectData.basicInfo.description),
      event_type: projectData.eventType,
      schedule: projectData.schedule,
      status: "upcoming",
      verification_method: projectData.verificationMethod,
      require_login: normalizeRequireLoginForVerificationMethod(
        projectData.verificationMethod,
        projectData.requireLogin,
      ),
      enable_volunteer_comments: projectData.enableVolunteerComments || false,
      show_attendees_publicly: projectData.showAttendeesPublicly || false,
      waiver_required: projectData.waiverRequired || false,
      waiver_allow_upload: projectData.waiverAllowUpload ?? true,
      organization_id: organizationId || null, // Save organization_id if provided
      visibility: requestedVisibility, // Public requires Trusted Member. Unlisted / org-only do not.
      published: publishedState, // Add the published state tracking
      project_timezone:
        projectData.basicInfo.projectTimezone || "America/Los_Angeles", // Save project timezone with fallback
      restrict_to_org_domains: projectData.restrictToOrgDomains || false, // Add domain restriction flag
      // A waiver project is staged unpublished. The client marker for an
      // attached PDF is not proof, so the row stays invisible to the public
      // and unsignable until publish_waiver_staged_project verifies the real
      // Storage object and the signing configuration.
      workflow_status:
        isDraft || stagesWaiverPublication ? "draft" : "published",
      recurrence_rule: recurrenceRule, // Support recurring projects
      signup_form_schema: projectData.signupFormSchema || null,
    };

    const projectInsertPayload = {
      ...baseProjectPayload,
      waiver_disable_esignature: projectData.waiverDisableEsignature ?? false,
    };

    const projectInsertPayloads = [
      projectInsertPayload,
      omitProjectColumns(projectInsertPayload, ["signup_form_schema"]),
      omitProjectColumns(projectInsertPayload, ["waiver_disable_esignature"]),
      omitProjectColumns(projectInsertPayload, [
        "signup_form_schema",
        "waiver_disable_esignature",
      ]),
    ];

    let project: { id: string } | null = null;
    let projectError: unknown = null;

    for (const payload of projectInsertPayloads) {
      const { data, error } = await supabase
        .from("projects")
        .insert(payload)
        .select("id")
        .single();

      if (data && !error) {
        project = data;
        projectError = null;
        break;
      }

      projectError = error;

      const missingSignupFormSchema =
        isMissingSignupFormSchemaColumnError(error);
      const missingWaiverDisableEsignature =
        isMissingWaiverDisableEsignatureColumnError(error);
      if (!missingSignupFormSchema && !missingWaiverDisableEsignature) {
        break;
      }
    }

    if (projectError || !project) {
      console.error("Error creating project:", projectError);
      return { error: "Failed to create project. Please try again." };
    }

    // Handle plugin hooks after project creation
    if (projectData.basicInfo.organizationId) {
      const admin = getAdminClient();
      const { data: organization } = await admin
        .from("organizations")
        .select(
          "id, name, username, description, logo_url, type, verified, allowed_email_domains, show_members_publicly",
        )
        .eq("id", projectData.basicInfo.organizationId)
        .single();

      if (organization) {
        const { data: member } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", projectData.basicInfo.organizationId)
          .eq("user_id", user.id)
          .single();

        const userRole = member?.role || null;

        const plugins = await resolveOrganizationPlugins({
          organizationId: projectData.basicInfo.organizationId,
          userRole,
        });

        for (const resolved of plugins) {
          if (!resolved.enabled) continue;
          const plugin = (
            await import("@/lib/plugins/registry")
          ).getRegisteredPlugin(resolved.key);
          if (plugin && plugin.lifecycle?.onProjectCreate) {
            await runProjectCreate(plugin, {
              organization: {
                ...organization,
                role: userRole,
              } as OrganizationWithRole,
              projectId: project.id,
              pluginData: projectData.pluginData,
              actor: { id: user.id, type: "user" },
            });
          }
        }
      }
    }

    // Return success with the new project ID
    return {
      success: true,
      id: project.id,
      ...(stagesWaiverPublication ? { requiresWaiverPublication: true } : {}),
    };
  } catch (error) {
    console.error("Error in create project action:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

const WAIVER_PUBLICATION_MESSAGES: Record<string, string> = {
  project_not_found: "Project not found.",
  forbidden: "You don't have permission to publish this project.",
  not_waiver_project: "This project does not require a waiver.",
  invalid_state: "This project can no longer be published from the creator.",
  missing_waiver_source:
    "The waiver PDF has not finished uploading yet. Please retry.",
  missing_storage_object:
    "The waiver PDF was not stored successfully. Please upload it again.",
  missing_waiver_definition:
    "Configure the waiver signature placements before publishing.",
  definition_source_mismatch:
    "The waiver configuration does not match the uploaded PDF. Please reconfigure it.",
  definition_missing_signature_field:
    "The waiver configuration needs at least one signature placement.",
  no_signing_mode:
    "Enable e-signatures or print-and-upload so volunteers can sign the waiver.",
  invalid_input: "Project not found.",
};

/**
 * Publishes a staged waiver project once the database can prove its waiver.
 *
 * Retry safe: the check is re-run from scratch on every call, so a lost
 * response or a repeated finalize converges on the same published row instead
 * of creating a second one.
 */
export async function publishWaiverStagedProject(
  projectId: string,
): Promise<{ success?: boolean; alreadyPublished?: boolean; error?: string }> {
  "use server";
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "You must be logged in to publish a project" };
    }

    const admin = getAdminClient();
    const { data, error } = await admin.rpc("publish_waiver_staged_project", {
      p_project_id: projectId,
      p_actor_id: user.id,
    });

    if (error) {
      console.error("Error publishing staged waiver project:", error);
      return { error: "Failed to publish the project. Please try again." };
    }

    const result =
      (data as { outcome: string; workflow_status: string }[] | null)?.[0] ??
      null;

    if (!result) {
      return { error: "Failed to publish the project. Please try again." };
    }

    if (result.outcome === "published") {
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
      return { success: true };
    }

    if (result.outcome === "already_published") {
      revalidatePath(`/projects/${projectId}`);
      return { success: true, alreadyPublished: true };
    }

    return {
      error:
        WAIVER_PUBLICATION_MESSAGES[result.outcome] ??
        "This project cannot be published yet.",
    };
  } catch (error) {
    console.error("Error in publish staged waiver project action:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
