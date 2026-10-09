"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import { getWaiverConfigurationError } from "@/lib/projects/waiver-validation";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import { runProjectCreate } from "@/lib/plugins/lifecycle";
import { OrganizationWithRole } from "@/types/plugin";
import { getAdminClient } from "@/lib/supabase/admin";
import { parseCreateProjectPayload } from "@/schemas/project-create-schema";
import {
  buildInitialPublishedState,
  describeProjectWriteError,
  isDuplicateKeyError,
  logProjectWriteError,
  normalizeIdempotencyKey,
} from "./create-support";
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
  /** True when an earlier attempt with the same key already created the row. */
  reusedExistingAttempt?: boolean;
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type StagedAttempt = {
  id: string;
  workflow_status: string | null;
  waiver_required: boolean | null;
  organization_id: string | null;
};
type ProjectWriteResult = { data: { id: string } | null; error: unknown };

async function findCreationAttempt(
  supabase: ServerClient,
  userId: string,
  creationIdempotencyKey: string,
): Promise<StagedAttempt | null> {
  const { data } = await supabase
    .from("projects")
    .select("id, workflow_status, waiver_required, organization_id")
    .eq("creator_id", userId)
    .eq("creation_idempotency_key", creationIdempotencyKey)
    .maybeSingle();

  return data?.id ? data : null;
}

function reusedAttemptResult(attempt: StagedAttempt): CreateBasicProjectResult {
  return {
    success: true,
    id: attempt.id,
    reusedExistingAttempt: true,
    ...(attempt.workflow_status === "draft" && attempt.waiver_required
      ? { requiresWaiverPublication: true }
      : {}),
  };
}

/** Retries a write without columns an older schema does not have yet. */
async function writeWithColumnFallback(
  payloads: Record<string, unknown>[],
  write: (payload: Record<string, unknown>) => PromiseLike<ProjectWriteResult>,
): Promise<ProjectWriteResult> {
  let result: ProjectWriteResult = { data: null, error: null };

  for (const payload of payloads) {
    result = await write(payload);
    if (result.data && !result.error) return result;

    if (
      !isMissingSignupFormSchemaColumnError(result.error) &&
      !isMissingWaiverDisableEsignatureColumnError(result.error)
    ) {
      break;
    }
  }

  return result;
}

export async function createBasicProject(
  input: unknown,
  isDraft: boolean = false,
): Promise<CreateBasicProjectResult> {
  "use server";
  const supabase = await createClient();

  // Authentication first: an anonymous caller must not be able to probe the
  // validation messages or an attempt key.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in to create a project" };
  }

  // A staged waiver project is created before its PDF exists, so a reload or a
  // failed publication has to be able to finish the same row. The creator
  // scoped key makes that convergence durable instead of depending on client
  // memory: the same key always resolves to the same project.
  const creationIdempotencyKey = normalizeIdempotencyKey(
    input && typeof input === "object" && "creationIdempotencyKey" in input
      ? input.creationIdempotencyKey
      : null,
  );
  const existingAttempt = creationIdempotencyKey
    ? await findCreationAttempt(supabase, user.id, creationIdempotencyKey)
    : null;

  // An attempt that already left the staged state is finished. It converges
  // on its row whatever the form holds now.
  if (existingAttempt && existingAttempt.workflow_status !== "draft") {
    return reusedAttemptResult(existingAttempt);
  }

  // The server is authoritative: the payload is parsed with the same schemas
  // the form uses, and nothing unparsed reaches the database.
  const parsed = parseCreateProjectPayload(input);
  if (!parsed.ok) {
    return { error: parsed.error };
  }
  const projectData = parsed.data;
  const requestedVisibility = projectData.visibility;

  // Trusted member gating only for projects that appear in public feed.
  if (requestedVisibility === "public") {
    const { data: isTrustedMember } = await supabase.rpc("is_trusted_member", {
      p_user: user.id,
    });

    if (isTrustedMember !== true) {
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

  // Rate limiting: Check projects created in the last 24 hours. A retry of a
  // staged attempt creates nothing, so it is not counted again.
  if (!existingAttempt) {
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count: projectsCount, error: countError } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id)
      .gte("created_at", twentyFourHoursAgo);

    if (countError) {
      safeConsole.error("Error counting projects for rate limit:", countError);
      // Decide if you want to block creation or allow if count fails. For now, allowing.
    }

    if (projectsCount !== null && projectsCount >= 50) {
      return {
        error:
          "You have created too many projects recently. Please try again in 24 hours.",
      };
    }
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

  // A staged row keeps the organization it was created for: the database
  // treats that association as immutable.
  if (
    existingAttempt &&
    (existingAttempt.organization_id ?? null) !== organizationId
  ) {
    return {
      error:
        "This project was already saved for a different organization. Start a new project to change who it is created as.",
    };
  }

  const waiverConfigurationError = getWaiverConfigurationError(projectData);
  if (waiverConfigurationError) {
    return { error: waiverConfigurationError };
  }

  const stagesWaiverPublication = !isDraft && !!projectData.waiverRequired;

  try {
    const baseProjectPayload = {
      creator_id: user.id,
      title: projectData.basicInfo.title,
      location: projectData.basicInfo.location,
      location_data: projectData.basicInfo.locationData,
      description: sanitizeRichTextHtml(projectData.basicInfo.description),
      event_type: projectData.eventType,
      schedule: projectData.schedule,
      status: "upcoming",
      verification_method: projectData.verificationMethod,
      require_login: normalizeRequireLoginForVerificationMethod(
        projectData.verificationMethod,
        projectData.requireLogin,
      ),
      enable_volunteer_comments: projectData.enableVolunteerComments,
      show_attendees_publicly: projectData.showAttendeesPublicly,
      waiver_required: projectData.waiverRequired,
      waiver_allow_upload: projectData.waiverAllowUpload,
      organization_id: organizationId, // Save organization_id if provided
      visibility: requestedVisibility, // Public requires Trusted Member. Unlisted / org-only do not.
      published: buildInitialPublishedState(projectData.schedule),
      project_timezone: projectData.basicInfo.projectTimezone,
      restrict_to_org_domains: projectData.restrictToOrgDomains,
      // A waiver project is staged unpublished. The client marker for an
      // attached PDF is not proof, so the row stays invisible to the public
      // and unsignable until publish_waiver_staged_project verifies the real
      // Storage object and the signing configuration.
      workflow_status:
        isDraft || stagesWaiverPublication ? "draft" : "published",
      recurrence_rule: projectData.recurrenceRule, // Support recurring projects
      signup_form_schema: projectData.signupFormSchema,
      creation_idempotency_key: creationIdempotencyKey,
      waiver_disable_esignature: projectData.waiverDisableEsignature,
    };

    // The retried attempt already owns a staged row. Its ownership columns
    // and key stay as they are; everything the form controls is rewritten so
    // the row matches what the user sees now.
    if (existingAttempt) {
      const stagedUpdatePayload = omitProjectColumns(baseProjectPayload, [
        "creator_id",
        "organization_id",
        "creation_idempotency_key",
      ]);
      const stagedUpdate = await writeWithColumnFallback(
        [
          stagedUpdatePayload,
          omitProjectColumns(stagedUpdatePayload, ["signup_form_schema"]),
          omitProjectColumns(stagedUpdatePayload, [
            "waiver_disable_esignature",
          ]),
          omitProjectColumns(stagedUpdatePayload, [
            "signup_form_schema",
            "waiver_disable_esignature",
          ]),
        ],
        (payload) =>
          supabase
            .from("projects")
            .update(payload)
            .eq("id", existingAttempt.id)
            .eq("creator_id", user.id)
            .eq("workflow_status", "draft")
            .select("id")
            .maybeSingle(),
      );

      if (stagedUpdate.error) {
        logProjectWriteError(
          "Error updating staged project:",
          stagedUpdate.error,
        );
        return {
          error:
            describeProjectWriteError(stagedUpdate.error) ??
            "Your changes could not be saved to the project. Please try again.",
        };
      }

      // No row matched: another request published it in the meantime.
      if (stagedUpdate.data?.id !== existingAttempt.id) {
        return {
          success: true,
          id: existingAttempt.id,
          reusedExistingAttempt: true,
        };
      }

      return {
        success: true,
        id: existingAttempt.id,
        reusedExistingAttempt: true,
        ...(stagesWaiverPublication ? { requiresWaiverPublication: true } : {}),
      };
    }

    const projectInsertPayloads = [
      baseProjectPayload,
      omitProjectColumns(baseProjectPayload, ["signup_form_schema"]),
      omitProjectColumns(baseProjectPayload, ["waiver_disable_esignature"]),
      omitProjectColumns(baseProjectPayload, [
        "signup_form_schema",
        "waiver_disable_esignature",
      ]),
    ];

    const { data: project, error: projectError } =
      await writeWithColumnFallback(projectInsertPayloads, (payload) =>
        supabase.from("projects").insert(payload).select("id").single(),
      );

    if (projectError || !project) {
      // Two submits of the same attempt race here. The loser resolves to the
      // row the winner created instead of reporting a failure the user would
      // retry into a duplicate.
      if (creationIdempotencyKey && isDuplicateKeyError(projectError)) {
        const racedAttempt = await findCreationAttempt(
          supabase,
          user.id,
          creationIdempotencyKey,
        );

        if (racedAttempt) {
          return reusedAttemptResult(racedAttempt);
        }
      }

      logProjectWriteError("Error creating project:", projectError);
      return {
        error:
          describeProjectWriteError(projectError) ??
          "Failed to create project. Please try again.",
      };
    }

    // Handle plugin hooks after project creation
    if (organizationId) {
      const admin = getAdminClient();
      const { data: organization } = await admin
        .from("organizations")
        .select(
          "id, name, username, description, logo_url, type, verified, allowed_email_domains, show_members_publicly",
        )
        .eq("id", organizationId)
        .single();

      if (organization) {
        const { data: member } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", organizationId)
          .eq("user_id", user.id)
          .eq("status", "active")
          .single();

        const userRole = member?.role || null;

        const plugins = await resolveOrganizationPlugins({
          organizationId,
          userRole,
          viewerUserId: user.id,
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
    safeConsole.error("Error in create project action:", error);
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
      safeConsole.error("Error publishing staged waiver project:", error);
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
    safeConsole.error("Error in publish staged waiver project action:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
