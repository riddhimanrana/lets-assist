"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  getSlotDetails,
  isMultiDaySlotPastByScheduleId,
} from "@/utils/project";
import { revalidatePath } from "next/cache";
import { type AnonymousSignupData, type WaiverSignatureInput } from "@/types";
import { toOrganizationPluginAccessRole } from "@/lib/plugins/access-role";
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { validateWaiverPayload } from "@/lib/waiver/validate-waiver-payload";
import { getPluginRegistry } from "@/lib/plugins/registry";
import { runPluginOnSignup } from "@/lib/plugins/lifecycle";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import { createAnonymousSignupContinuation } from "@/lib/anonymous-signup-continuation";
import {
  canCurrentUserManageProject,
  getProject,
  getProjectWaiver,
} from "./access";
import { logSignupDebug } from "./shared";
import { getCurrentSignups } from "./waiver-assets";
import { registerAnonymousSignup } from "./signup-anonymous";
import { registerAuthenticatedSignup } from "./signup-registered";

export type SignupActionResult = {
  success?: boolean;
  error?: string;
  canResend?: boolean;
  needsConfirmation?: boolean;
  signupId?: string;
  projectId?: string;
  traceId?: string;
  anonymousSignupId?: string | null;
  anonymousContinuationToken?: string;
  message?: string;
};

export async function togglePauseSignups(
  projectId: string,
  pauseState: boolean,
) {
  "use server";
  const supabase = await createClient();

  try {
    // Check if user has permission
    const isAllowed = await canCurrentUserManageProject(projectId);

    if (!isAllowed) {
      return { error: "You don't have permission to modify this project" };
    }

    // Update the pause state
    const { error } = await supabase
      .from("projects")
      .update({ pause_signups: pauseState })
      .eq("id", projectId);

    if (error) {
      console.error("Error updating pause state:", error);
      return { error: "Failed to update signup status" };
    }

    // Revalidate paths to refresh data
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error toggling pause state:", error);
    return { error: "An unexpected error occurred" };
  }
}

export async function signUpForProject(
  projectId: string,
  scheduleId: string,
  anonymousData?: AnonymousSignupData,
  volunteerComment?: string,
  waiverSignature?: WaiverSignatureInput | null,
  formData?: Record<string, unknown>,
): Promise<SignupActionResult> {
  "use server";
  const supabase = await createClient();
  const serviceSupabase = getAdminClient();
  // The actor is whatever the verified session says it is. A guest payload is
  // only ever honored when there is no session at all, so a signed-in caller
  // cannot supply an arbitrary guest email to slip past the waiver, domain, or
  // confirmation gates and still be persisted as themselves.
  const { user } = await getAuthUser();
  const hasGuestPayload = !!anonymousData;
  const isAnonymous = !user && hasGuestPayload;
  const requestedSkipAnonymousConfirmationEmail =
    !!anonymousData?.skipConfirmationEmail;
  const selectedSlotCount = Math.max(
    1,
    Number(anonymousData?.selectedSlotCount ?? 1),
  );
  let createdSignupId: string | undefined = undefined; // Track the created signup ID
  let createdAnonymousSignupId: string | null = null;
  let anonymousProfileAlreadyConfirmed = false;
  let anonymousContinuationToken: string | undefined;
  const traceId = crypto.randomUUID();

  if (user && hasGuestPayload) {
    logSignupDebug(traceId, "blocked_conflicting_identity");
    return {
      error:
        "You are signed in, so this signup cannot be submitted as a guest. Please reload the page and try again.",
      traceId,
    };
  }

  try {
    logSignupDebug(traceId, "start", {
      projectId,
      scheduleId,
      isAnonymous,
      hasVolunteerComment: Boolean(volunteerComment || anonymousData?.comment),
      hasWaiverSignature: Boolean(waiverSignature),
      hasFormData: Boolean(formData && Object.keys(formData).length > 0),
      selectedSlotCount,
    });

    // Get project details
    const { project, error: projectError } = await getProject(projectId);

    if (!project || projectError) {
      logSignupDebug(traceId, "project_lookup_failed", {
        projectId,
        projectError,
      });
      return { error: "Project not found" };
    }

    logSignupDebug(traceId, "project_loaded", {
      eventType: project.event_type,
      verificationMethod: project.verification_method,
      status: project.status,
      workflowStatus: project.workflow_status,
      requireLogin: project.require_login,
      pauseSignups: project.pause_signups,
      organizationId: project.organization_id,
      hasSignupFormSchema: Boolean(project.signup_form_schema),
      restrictToOrgDomains: project.restrict_to_org_domains,
    });

    const isSignupOnlyProject = project.verification_method === "signup-only";
    const anonymousEmailConfirmationRequired =
      !isSignupOnlyProject || project.restrict_to_org_domains === true;
    const rawComment = (
      anonymousData?.comment ??
      volunteerComment ??
      ""
    ).trim();
    const normalizedComment =
      rawComment.length > 0 ? rawComment.slice(0, 1000) : null;
    const volunteerCommentToSave = project.enable_volunteer_comments
      ? normalizedComment
      : null;

    if (project.waiver_required && !waiverSignature && !isAnonymous) {
      return {
        error: "This project requires a waiver signature before signing up.",
      };
    }

    if (waiverSignature) {
      const hasDefinitionId =
        typeof waiverSignature.definitionId === "string" &&
        waiverSignature.definitionId.trim().length > 0;
      const hasWaiverPdfUrl =
        typeof waiverSignature.waiverPdfUrl === "string" &&
        waiverSignature.waiverPdfUrl.trim().length > 0;

      if (
        !hasDefinitionId &&
        !hasWaiverPdfUrl &&
        waiverSignature.signatureType === "upload"
      ) {
        return {
          error:
            "Please attach or reference a waiver document before uploading a signed copy.",
        };
      }

      if (
        waiverSignature.signatureType === "upload" &&
        project.waiver_allow_upload === false &&
        project.waiver_disable_esignature !== true
      ) {
        return { error: "Waiver uploads are not allowed for this project." };
      }

      if (
        waiverSignature.signatureType === "draw" &&
        !waiverSignature.signatureImageDataUrl
      ) {
        return { error: "Please draw your signature to continue." };
      }

      if (
        waiverSignature.signatureType === "typed" &&
        !waiverSignature.signatureText?.trim()
      ) {
        return { error: "Please type your signature to continue." };
      }

      if (
        waiverSignature.signatureType === "upload" &&
        !waiverSignature.uploadFileDataUrl
      ) {
        return { error: "Please upload a signed waiver to continue." };
      }

      if (
        waiverSignature.signatureType === "multi-signer" &&
        !waiverSignature.payload
      ) {
        return {
          error:
            "Please complete every required waiver signer before continuing.",
        };
      }

      // Phase 5: Validate waiver payload against definition
      if (
        waiverSignature.signatureType === "multi-signer" &&
        waiverSignature.payload
      ) {
        // Check if project has a waiver definition
        const waiverInfo = await getProjectWaiver(projectId);

        if ("error" in waiverInfo) {
          return { error: "Failed to load waiver configuration" };
        }

        const { definition } = waiverInfo;

        if (definition) {
          // Validate against waiver definition
          // Phase 4: Enable strict field validation as UI now collects fields
          const validationResult = validateWaiverPayload(
            waiverSignature.payload,
            definition,
            true,
          );

          if (!validationResult.valid) {
            return {
              error: `Waiver validation failed: ${validationResult.errors.join(", ")}`,
            };
          }

          // Log warnings if any
          if (
            validationResult.warnings &&
            validationResult.warnings.length > 0
          ) {
            console.warn(
              "Waiver validation warnings:",
              validationResult.warnings,
            );
          }
        }
      }
    }

    // Check if signups are paused
    if (project.pause_signups) {
      logSignupDebug(traceId, "blocked_pause_signups");
      return {
        error:
          "Signups for this project are temporarily paused by the organizer",
      };
    }

    // Check if project is available for signup
    // Check if project is available for signup
    if (project.status === "cancelled") {
      logSignupDebug(traceId, "blocked_cancelled");
      return { error: "This project has been cancelled" };
    }

    if (project.status === "completed") {
      logSignupDebug(traceId, "blocked_completed");
      return { error: "This project has been completed" };
    }

    // --- Domain Restriction Check ---
    if (
      project.restrict_to_org_domains &&
      project.organization?.allowed_email_domains &&
      project.organization.allowed_email_domains.length > 0
    ) {
      const allowedDomains = project.organization
        .allowed_email_domains as string[];
      let hasValidEmail = false;

      // Helper to check domain
      const checkDomain = (email: string) => {
        const domain = email.split("@")[1]?.toLowerCase();
        return domain && allowedDomains.includes(domain);
      };

      if (user) {
        // A session actor is only ever measured against verified identity:
        // the session email, then its verified secondary addresses.
        if (user.email && checkDomain(user.email)) {
          hasValidEmail = true;
        } else {
          const { data: secondaryEmails } = await supabase
            .from("user_emails")
            .select("email")
            .eq("user_id", user.id)
            .not("verified_at", "is", null);

          if (secondaryEmails) {
            for (const record of secondaryEmails) {
              if (checkDomain(record.email)) {
                hasValidEmail = true;
                break;
              }
            }
          }
        }
      } else if (isAnonymous && anonymousData?.email) {
        hasValidEmail = checkDomain(anonymousData.email) === true;
      }

      if (!hasValidEmail) {
        logSignupDebug(traceId, "blocked_domain_restriction", {
          isAnonymous,
          allowedDomainCount: allowedDomains.length,
        });
        return {
          error: `This project is restricted to users with the following email domains: ${allowedDomains.join(", ")}. Please use a verified email with one of these domains.`,
        };
      }
    }

    // For multiDay events, validate that the specific day/slot hasn't passed
    if (project.event_type === "multiDay" && project.schedule.multiDay) {
      if (isMultiDaySlotPastByScheduleId(project, scheduleId)) {
        logSignupDebug(traceId, "blocked_slot_past");
        return { error: "This time slot has already passed" };
      }
    }

    // Fix: Don't await getSlotDetails since it's no longer async
    const slotDetails = getSlotDetails(project, scheduleId);
    if (!slotDetails) {
      logSignupDebug(traceId, "invalid_schedule_slot", {
        scheduleId,
        projectId,
      });
      return { error: "Invalid schedule slot" };
    }

    logSignupDebug(traceId, "slot_loaded", {
      scheduleId,
      volunteers: slotDetails.volunteers,
      hasStartTime: Boolean(slotDetails.startTime),
      hasEndTime: Boolean(slotDetails.endTime),
    });

    // Check if slot is full (only count 'approved/attended' signups towards capacity)
    const currentSignups = await getCurrentSignups(projectId, scheduleId);
    logSignupDebug(traceId, "slot_capacity_loaded", {
      currentSignups,
      maxVolunteers: slotDetails.volunteers,
    });

    if (currentSignups >= slotDetails.volunteers) {
      logSignupDebug(traceId, "blocked_slot_full", {
        currentSignups,
        maxVolunteers: slotDetails.volunteers,
      });
      return { error: "This slot is full" };
    }

    // If project requires login but user isn't logged in
    if (project.require_login && !user) {
      logSignupDebug(traceId, "blocked_login_required");
      return { error: "You must be logged in to sign up for this project" };
    }

    logSignupDebug(traceId, "auth_loaded", {
      hasUser: Boolean(user),
      userId: user?.id,
    });

    // Keep registered and anonymous persistence isolated so provider,
    // confirmation, and identity rules cannot leak across the two flows.
    if (user) {
      const registeredResult = await registerAuthenticatedSignup({
        supabase,
        user,
        project,
        projectId,
        scheduleId,
        volunteerComment: volunteerCommentToSave,
        waiverSignature,
        formData,
        traceId,
      });
      if ("response" in registeredResult && registeredResult.response) {
        return registeredResult.response;
      }
      createdSignupId = registeredResult.createdSignupId;
    } else if (isAnonymous && anonymousData) {
      const anonymousResult = await registerAnonymousSignup({
        serviceSupabase,
        anonymousData,
        project,
        projectId,
        scheduleId,
        volunteerComment: volunteerCommentToSave,
        waiverSignature,
        formData,
        traceId,
        requestedSkipConfirmationEmail: requestedSkipAnonymousConfirmationEmail,
        selectedSlotCount,
        confirmationRequired: anonymousEmailConfirmationRequired,
      });
      if ("response" in anonymousResult && anonymousResult.response) {
        return anonymousResult.response;
      }
      createdSignupId = anonymousResult.createdSignupId;
      createdAnonymousSignupId = anonymousResult.createdAnonymousSignupId;
      anonymousProfileAlreadyConfirmed =
        anonymousResult.anonymousProfileAlreadyConfirmed;
    } else {
      return {
        error: "Cannot sign up without user login or anonymous details.",
      };
    }

    // --- Trigger Plugin onSignup Hooks ---
    if (project.organization_id && createdSignupId) {
      try {
        logSignupDebug(traceId, "plugin_hooks_start", {
          organizationId: project.organization_id,
          signupId: createdSignupId,
        });

        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", project.organization_id)
          .eq("user_id", user?.id || "00000000-0000-0000-0000-000000000000") // Fallback for anon
          .maybeSingle();

        const viewerRole =
          toOrganizationPluginAccessRole(orgMember?.role) ?? "member";
        const installedPlugins = await resolveOrganizationPlugins({
          organizationId: project.organization_id,
          userRole: viewerRole,
        });

        const registry = getPluginRegistry();

        // Prepare formData with a compatibility shim for plugins that expect .get()
        const pluginFormData = {
          ...(formData || {}),
          get: (key: string) => formData?.[key] ?? null,
        };

        for (const resolved of installedPlugins) {
          const definition = registry.get(resolved.key);
          if (definition && definition.lifecycle?.onSignup) {
            await runPluginOnSignup(definition, {
              organization: { id: project.organization_id, role: viewerRole },
              actor: user ? { id: user.id, type: "user" } : undefined,
              projectId: project.id,
              signupId: createdSignupId,
              userId: user?.id,
              anonymousId: createdAnonymousSignupId,
              formData: pluginFormData,
            });
          }
        }

        logSignupDebug(traceId, "plugin_hooks_complete", {
          installedPluginCount: installedPlugins.length,
        });
      } catch (pluginError) {
        logSignupDebug(traceId, "plugin_hooks_failed", {
          error:
            pluginError instanceof Error
              ? pluginError.message
              : String(pluginError),
        });
        // Don't fail the whole signup if plugins fail
      }
    }

    // --- Revalidate paths ---
    logSignupDebug(traceId, "revalidate_start", {
      projectId,
      organizationId: project.organization_id,
      hasUser: Boolean(user),
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/signups`); // Revalidate signups page too
    if (project.organization_id) {
      revalidatePath(`/organization/${project.organization_id}`);
    }
    if (user) {
      revalidatePath(`/profile/${user.id}`);
    }

    if (isAnonymous && createdAnonymousSignupId && anonymousData?.email) {
      try {
        anonymousContinuationToken = createAnonymousSignupContinuation({
          anonymousSignupId: createdAnonymousSignupId,
          projectId,
          email: anonymousData.email,
        });
      } catch (continuationError) {
        logSignupDebug(traceId, "anonymous_continuation_unavailable", {
          error:
            continuationError instanceof Error
              ? continuationError.message
              : String(continuationError),
        });
      }
    }

    // --- Return success with signup ID for calendar integration ---
    logSignupDebug(traceId, "success", {
      signupId: createdSignupId,
      needsConfirmation: isAnonymous
        ? !anonymousProfileAlreadyConfirmed
        : false,
      projectId: project.id,
    });

    return {
      success: true,
      needsConfirmation: isAnonymous
        ? !anonymousProfileAlreadyConfirmed
        : false,
      signupId: createdSignupId,
      projectId: project.id,
      traceId,
      anonymousContinuationToken,
    };
  } catch (error) {
    logSignupDebug(traceId, "unhandled_exception", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { error: "An unexpected error occurred during signup.", traceId };
  }
}
