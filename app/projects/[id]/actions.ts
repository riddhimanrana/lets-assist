"use server";

import { createClient } from "@/lib/supabase/server";
import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  canCancelProject,
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
  getSlotDetails,
  isMultiDaySlotPastByScheduleId,
  isProjectVisible,
} from "@/utils/project";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
// Make sure AnonymousSignup is imported from the correct types definition
import {
  type Project,
  type AnonymousSignupData,
  type ProjectSignup,
  type SignupStatus,
  type WaiverSignatureInput,
  type WaiverDefinitionFull,
} from "@/types";
import { toOrganizationPluginAccessRole } from "@/lib/plugins/access-role";
import { headers } from "next/headers";
import crypto from "crypto";
// Import centralized email service
import { sendEmail } from "@/services/email";
// Import React Email templates
import AnonymousSignupConfirmation from "@/emails/anonymous-signup-confirmation";
import UserSignupConfirmation from "@/emails/user-signup-confirmation";
import * as React from "react";

import { NotificationService } from "@/services/notifications";
import {
  removeCalendarEventForSignup,
  removeCalendarEventForProject,
} from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { getProjectCreatorProfileById } from "@/lib/profile/public";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";
import { validateWaiverPayload } from "@/lib/waiver/validate-waiver-payload";
import { waiverDefinitionInputSchema } from "@/lib/waiver/definition-input";
import {
  mapDetectedFieldsForDb,
  mapCustomPlacementsForDb,
} from "@/lib/waiver/map-definition-input";
import { getPluginRegistry } from "@/lib/plugins/registry";
import { runProjectClone, runPluginOnSignup } from "@/lib/plugins/lifecycle";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import {
  createAnonymousSignupContinuation,
  verifyAnonymousSignupContinuation,
} from "@/lib/anonymous-signup-continuation";
import { resolveServerCheckoutTime } from "@/lib/attendance/checkout";
import { confirmAnonymousSignupWithCapacity } from "@/lib/projects/signup-capacity";
import { canManageProjectAccess } from "@/lib/projects/management-access";

// Define your site URL (replace with environment variable ideally)
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

function formatTimeTo12Hour(timeStr: string | undefined): string {
  if (!timeStr || timeStr === "TBD") return "TBD";
  try {
    // Expected format "HH:mm" or "HH:mm:ss"
    const [hours, minutes] = timeStr.split(":").map(Number);
    if (
      hours === undefined ||
      minutes === undefined ||
      isNaN(hours) ||
      isNaN(minutes)
    )
      return timeStr;

    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    const minStr = minutes.toString().padStart(2, "0");

    return `${hour12}:${minStr} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function parseLocalDate(dateStr: string): Date {
  // Parse date string "YYYY-MM-DD" as a local date, not UTC
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateWithWeekday(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const WAIVER_SIGNATURE_BUCKET = "waiver-signatures";
const WAIVER_UPLOAD_BUCKET = "waiver-uploads";
const MAX_WAIVER_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_WAIVER_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

type PostgrestErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function isMissingWaiverDisableEsignatureColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  const combined =
    `${pgError.message ?? ""} ${pgError.details ?? ""} ${pgError.hint ?? ""}`.toLowerCase();
  const referencesColumn = combined.includes("waiver_disable_esignature");
  const schemaCacheLike =
    combined.includes("schema cache") ||
    combined.includes("could not find") ||
    combined.includes("column");
  const knownCode = pgError.code === "PGRST204" || pgError.code === "42703";

  return referencesColumn && (knownCode || schemaCacheLike);
}

function summarizePostgrestError(error: unknown) {
  if (!error || typeof error !== "object") return error;

  const pgError = error as PostgrestErrorLike;
  return {
    code: pgError.code,
    message: pgError.message,
    details: pgError.details,
    hint: pgError.hint,
  };
}

function logSignupDebug(
  traceId: string,
  step: string,
  details: Record<string, unknown> = {},
) {
  console.log(
    "[signup-debug]",
    JSON.stringify({
      traceId,
      step,
      ...details,
    }),
  );
}

function getProjectSignupInsertErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object"
      ? (error as PostgrestErrorLike).code
      : undefined;

  if (code === "slot_full") {
    return "This slot just filled up. Please choose another time.";
  }
  if (code === "already_exists") {
    return "You have already signed up for this slot.";
  }
  if (code === "rejected") {
    return "You have been rejected for this project and cannot sign up again.";
  }
  if (code === "project_closed") {
    return "Signups for this project are no longer available.";
  }
  if (code === "invalid_slot") {
    return "This project slot is no longer available.";
  }

  return "Failed to sign up. Please try again.";
}

async function insertProjectSignupAtomically(
  signupData: Record<string, unknown>,
  traceId?: string,
): Promise<{ data: { id: string } | null; error: unknown | null }> {
  if (traceId) {
    logSignupDebug(traceId, "project_signup_atomic_insert_attempt", {
      hasResponseData: signupData.response_data != null,
      projectId: signupData.project_id,
      scheduleId: signupData.schedule_id,
      status: signupData.status,
      isAnonymous: Boolean(signupData.anonymous_id),
      hasUser: Boolean(signupData.user_id),
    });
  }

  const serviceSupabase = getAdminClient();
  const { data, error } = await serviceSupabase.rpc(
    "insert_project_signup_with_capacity",
    {
      p_project_id: signupData.project_id ?? null,
      p_schedule_id: signupData.schedule_id ?? null,
      p_user_id: signupData.user_id ?? null,
      p_anonymous_id: signupData.anonymous_id ?? null,
      p_status: signupData.status ?? null,
      p_volunteer_comment: signupData.volunteer_comment ?? null,
      p_response_data: signupData.response_data ?? null,
    },
  );

  type AtomicSignupInsertRow = {
    signup_id: string | null;
    outcome: string;
    slot_capacity: number | null;
    active_count: number;
  };
  const result = (data as AtomicSignupInsertRow[] | null)?.[0] ?? null;

  if (error || !result || result.outcome !== "inserted" || !result.signup_id) {
    const atomicError = error ?? {
      code: result?.outcome ?? "atomic_insert_failed",
      message: result?.outcome ?? "Atomic signup insert failed",
    };
    if (traceId) {
      logSignupDebug(traceId, "project_signup_atomic_insert_error", {
        error: summarizePostgrestError(atomicError),
        slotCapacity: result?.slot_capacity,
        activeCount: result?.active_count,
      });
    }
    return { data: null, error: atomicError };
  }

  if (traceId) {
    logSignupDebug(traceId, "project_signup_atomic_insert_success", {
      signupId: result.signup_id,
      slotCapacity: result.slot_capacity,
      activeCountBeforeInsert: result.active_count,
    });
  }
  return { data: { id: result.signup_id }, error: null };
}

type ParsedDataUrl = {
  contentType: string;
  buffer: Buffer;
  size: number;
};

function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return null;
  const contentType = matches[1];
  const base64 = matches[2];
  const buffer = Buffer.from(base64, "base64");
  return { contentType, buffer, size: buffer.length };
}

async function getRequestMetadata() {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp || null;
  const userAgent = requestHeaders.get("user-agent");

  return { ipAddress, userAgent };
}

async function validateAnonymousSignupCaptcha(
  captchaToken?: string | null,
): Promise<{ success: true } | { error: string }> {
  if (!isTurnstileEnabled()) {
    return { success: true };
  }

  const normalizedToken = captchaToken?.trim();

  if (!normalizedToken) {
    return { error: "Please complete the security verification challenge." };
  }

  const isValid = await verifyTurnstileToken(normalizedToken);

  if (!isValid) {
    return {
      error:
        "Security verification failed. Please refresh the challenge and try again.",
    };
  }

  return { success: true };
}

// Function to extract schedule details for email notifications
function getScheduleDetails(project: Project, scheduleId: string) {
  if (project.event_type === "oneTime") {
    const schedule = project.schedule.oneTime;
    if (!schedule)
      return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const date = formatDateWithWeekday(schedule.date);

    const start12 = formatTimeTo12Hour(schedule.startTime);
    const end12 = formatTimeTo12Hour(schedule.endTime);
    const timeRange =
      schedule.startTime && schedule.endTime
        ? `${start12} - ${end12}`
        : start12;

    return {
      date,
      time: start12,
      timeRange,
      slotLabel: "Slot 1",
    };
  } else if (project.event_type === "multiDay") {
    const slotData = getMultiDaySlotByScheduleId(project, scheduleId);
    if (slotData) {
      const { day, slot, slotIndex } = slotData;
      const date = formatDateWithWeekday(day.date);

      const start12 = formatTimeTo12Hour(slot.startTime);
      const end12 = formatTimeTo12Hour(slot.endTime);
      const timeRange =
        slot.startTime && slot.endTime ? `${start12} - ${end12}` : start12;

      return {
        date,
        time: start12,
        timeRange,
        slotLabel: getMultiDaySlotDisplayName(slot, slotIndex),
      };
    }
  } else if (project.event_type === "sameDayMultiArea") {
    const schedule = project.schedule.sameDayMultiArea;
    if (!schedule)
      return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const date = formatDateWithWeekday(schedule.date);

    const role = schedule.roles.find((r) => r.name === scheduleId);

    const start12 = formatTimeTo12Hour(
      role?.startTime || schedule.overallStart,
    );
    const end12 = formatTimeTo12Hour(role?.endTime || schedule.overallEnd);

    const timeRange =
      start12 !== "TBD" && end12 !== "TBD" ? `${start12} - ${end12}` : start12;

    return {
      date,
      time: start12,
      timeRange,
      slotLabel: role?.name || "Slot",
    };
  }

  return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };
}

export async function isProjectCreator(projectId: string) {
  try {
    const supabase = await createClient();

    // Get current user using getClaims() for better performance
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return false;
    }

    // Check project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id")
      .eq("id", projectId)
      .single();

    return project?.creator_id === user.id;
  } catch {
    return false;
  }
}

type ManageableProjectRecord = {
  creator_id?: string | null;
  organization_id?: string | null;
  organization?: { id?: string | null } | null;
  can_be_managed_by_staff?: boolean;
};

type CurrentUserProjectPermissions = {
  userId: string | null;
  isCreator: boolean;
  isOrgAdmin: boolean;
  canManageProject: boolean;
};

const getManageableProjectOrganizationId = (
  project?: ManageableProjectRecord | null,
) => project?.organization_id ?? project?.organization?.id ?? null;

async function canUserManageProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  project: ManageableProjectRecord | null | undefined,
  userId: string,
) {
  if (!project) return false;

  const orgId = getManageableProjectOrganizationId(project);
  if (project.creator_id === userId || !orgId) {
    return canManageProjectAccess({
      creatorId: project.creator_id ?? null,
      userId,
      canBeManagedByStaff: project.can_be_managed_by_staff,
    });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .single();

  return canManageProjectAccess({
    creatorId: project.creator_id ?? null,
    userId,
    organizationRole: membership?.role,
    canBeManagedByStaff: project.can_be_managed_by_staff,
  });
}

export async function getCurrentUserProjectPermissions(
  projectId: string,
): Promise<CurrentUserProjectPermissions> {
  try {
    const supabase = await createClient();
    const { user, error: userError } = await getAuthUser();

    if (userError || !user) {
      return {
        userId: null,
        isCreator: false,
        isOrgAdmin: false,
        canManageProject: false,
      };
    }

    const { data: project } = await supabase
      .from("projects")
      .select("creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return {
        userId: user.id,
        isCreator: false,
        isOrgAdmin: false,
        canManageProject: false,
      };
    }

    const isCreator = project.creator_id === user.id;
    const canManageProject = await canUserManageProject(
      supabase,
      project,
      user.id,
    );

    // Check if they are an admin specifically (for other UI purposes)
    const orgId = project.organization_id;
    let isOrgAdmin = false;
    if (orgId && !isCreator) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .single();
      isOrgAdmin = membership?.role === "admin";
    }

    return {
      userId: user.id,
      isCreator,
      isOrgAdmin,
      canManageProject,
    };
  } catch {
    return {
      userId: null,
      isCreator: false,
      isOrgAdmin: false,
      canManageProject: false,
    };
  }
}

export async function canCurrentUserManageProject(projectId: string) {
  const permissions = await getCurrentUserProjectPermissions(projectId);
  return permissions.canManageProject;
}

export async function getProject(projectId: string) {
  const supabase = await createClient();

  // Get the current user if logged in using getClaims() for better performance
  const { user } = await getAuthUser();

  // Fetch the project
  const { data: project, error } = (await supabase
    .from("projects")
    .select(
      `
      *,
      organization:organizations (
        id,
        name,
        username,
        logo_url,
        verified,
        type,
        allowed_email_domains
      )
    `,
    )
    .eq("id", projectId)
    .single()) as {
    data: Project | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error("Error fetching project:", JSON.stringify(error, null, 2));
    return { error: "Failed to fetch project" };
  }

  // Calculate and update the project status
  if (project) {
    if (project.workflow_status === "draft") {
      if (!user) {
        return { error: "unauthorized", project: null };
      }

      const canManageDraft = await canUserManageProject(
        supabase,
        project,
        user.id,
      );
      if (!canManageDraft) {
        return { error: "unauthorized", project: null };
      }
    }

    // Check if the project is organization-only and the user has permission to view it
    if (project.visibility === "organization_only") {
      // If it's an organization-only project, check user's organization memberships
      if (!user) {
        return { error: "unauthorized", project: null };
      }

      // Get user's organization memberships
      const { data: userOrgs } = (await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)) as {
        data: { organization_id: string; role: string }[] | null;
        error: { message: string } | null;
      };

      // Check if user is a member of the project's organization
      const hasAccess = isProjectVisible(project, user.id, userOrgs || []);

      if (!hasAccess) {
        return { error: "unauthorized", project: null };
      }
    }
  }

  return { project };
}

export async function getCreatorProfile(userId: string) {
  const { data: profile, error } = await getProjectCreatorProfileById(userId);

  if (error) {
    console.error("Error fetching creator profile:", error);
    return { error: "Failed to fetch creator profile" };
  }

  return { profile };
}

// Get project-specific waiver or fall back to global waiver definition
export async function getProjectWaiver(projectId: string) {
  try {
    const supabase = await createClient();
    const serviceSupabase = getAdminClient();

    // Resolve the project through the request-scoped client first so public
    // callers cannot use the service role to inspect a project they cannot see.
    let { data: project, error: projectError } = await supabase
      .from("projects")
      .select(
        "waiver_required, waiver_allow_upload, waiver_disable_esignature, waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (
      projectError &&
      isMissingWaiverDisableEsignatureColumnError(projectError)
    ) {
      const fallbackResult = await supabase
        .from("projects")
        .select(
          "waiver_required, waiver_allow_upload, waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id",
        )
        .eq("id", projectId)
        .maybeSingle();

      projectError = fallbackResult.error;
      project = fallbackResult.data
        ? {
            ...fallbackResult.data,
            waiver_disable_esignature: false,
          }
        : null;
    }

    if (projectError) {
      console.error("Error fetching project waiver config:", projectError);
      return { error: "Failed to load project waiver configuration" };
    }

    if (!project) {
      return { error: "Project not found" };
    }

    // Phase 4: Check for Waiver Definition (New System)
    if (project.waiver_definition_id) {
      const { data: definition, error: defError } = await serviceSupabase
        .from("waiver_definitions")
        .select("*")
        .eq("id", project.waiver_definition_id)
        .eq("project_id", projectId)
        .single();

      if (!defError && definition) {
        return {
          waiverConfig: {
            waiverRequired: project.waiver_required ?? true,
            waiverAllowUpload: project.waiver_disable_esignature
              ? true
              : (project.waiver_allow_upload ?? true),
            waiverPdfUrl: definition.pdf_public_url || project.waiver_pdf_url, // Prefer definition PDF
            waiverPdfStoragePath: definition.pdf_storage_path,
            isProjectSpecific: true,
            isWaiverDefinition: true,
          },
          definition,
        };
      }
    }

    // If project has a custom waiver PDF, use that
    if (project.waiver_pdf_url) {
      return {
        waiverConfig: {
          waiverRequired: project.waiver_required ?? false,
          waiverAllowUpload: project.waiver_disable_esignature
            ? true
            : (project.waiver_allow_upload ?? true),
          waiverPdfUrl: project.waiver_pdf_url,
          waiverPdfStoragePath: project.waiver_pdf_storage_path,
          isProjectSpecific: true,
        },
        definition: null,
      };
    }

    // No global waiver fallback - projects must have custom waivers
    return {
      waiverConfig: {
        waiverRequired: project.waiver_required ?? true,
        waiverAllowUpload: project.waiver_disable_esignature
          ? true
          : (project.waiver_allow_upload ?? true),
        waiverPdfUrl: null,
        waiverPdfStoragePath: null,
        isProjectSpecific: false,
      },
      definition: null,
    };
  } catch (error) {
    console.error("Error fetching project waiver:", error);
    return { error: "Failed to load project waiver" };
  }
}

// Upload project waiver PDF
export async function uploadProjectWaiverPdf(
  projectId: string,
  pdfDataUrl: string,
  fileName: string,
) {
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

async function uploadWaiverAsset(params: {
  bucket: string;
  dataUrl: string;
  fileName: string;
  maxBytes: number;
  allowedTypes?: string[];
}) {
  const parsed = parseDataUrl(params.dataUrl);
  if (!parsed) {
    return { error: "Invalid file data." };
  }

  if (
    params.allowedTypes &&
    !params.allowedTypes.includes(parsed.contentType)
  ) {
    return { error: "Unsupported file type." };
  }

  if (parsed.size > params.maxBytes) {
    return { error: "File is too large." };
  }

  const serviceSupabase = getAdminClient();
  const { error: uploadError } = await serviceSupabase.storage
    .from(params.bucket)
    .upload(params.fileName, parsed.buffer, {
      contentType: parsed.contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.error("Error uploading waiver asset:", uploadError);
    return { error: "Failed to upload waiver file." };
  }

  return { path: params.fileName, contentType: parsed.contentType };
}

async function getCurrentSignups(
  projectId: string,
  scheduleId: string,
): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("project_signups")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("schedule_id", scheduleId)
    .in("status", ["approved", "attended"]);

  return count || 0;
}

async function persistWaiverSignature(params: {
  projectId: string;
  signupId: string;
  userId?: string | null;
  anonymousId?: string | null;
  signerName: string;
  signerEmail: string;
  waiverSignature: WaiverSignatureInput;
}) {
  const serviceSupabase = getAdminClient();

  // Check for project-specific waiver PDF first
  let { data: project } = await serviceSupabase
    .from("projects")
    .select(
      "waiver_pdf_url, waiver_pdf_storage_path, waiver_allow_upload, waiver_disable_esignature, waiver_definition_id",
    )
    .eq("id", params.projectId)
    .maybeSingle();

  if (!project) {
    const { data: fallbackProject, error: fallbackError } =
      await serviceSupabase
        .from("projects")
        .select(
          "waiver_pdf_url, waiver_pdf_storage_path, waiver_allow_upload, waiver_definition_id",
        )
        .eq("id", params.projectId)
        .maybeSingle();

    if (
      fallbackError &&
      !isMissingWaiverDisableEsignatureColumnError(fallbackError)
    ) {
      console.error("Error fetching project waiver settings:", fallbackError);
    }

    if (fallbackProject) {
      project = {
        ...fallbackProject,
        waiver_disable_esignature: false,
      };
    }
  }

  if (!project) {
    return { error: "Project not found." };
  }

  const waiverDefinitionIdInput =
    params.waiverSignature.definitionId?.trim() || null;
  const waiverDefinitionId: string | null =
    waiverDefinitionIdInput || project.waiver_definition_id;

  let waiverPdfUrl: string | null = project.waiver_pdf_url || null;
  let waiverPdfStoragePath: string | null =
    project.waiver_pdf_storage_path || null;
  // Phase 1: Default to true for backward compatibility with projects created before this feature
  const waiverAllowUpload = project?.waiver_disable_esignature
    ? true
    : (project?.waiver_allow_upload ?? true);

  // New system: waiver_definitions are the canonical waiver source (PDF + placements).
  if (waiverDefinitionId) {
    if (project.waiver_definition_id !== waiverDefinitionId) {
      return {
        error: "The waiver definition does not belong to this project.",
      };
    }

    const { data: definition, error: defError } = await serviceSupabase
      .from("waiver_definitions")
      .select("id, pdf_public_url, pdf_storage_path")
      .eq("id", waiverDefinitionId)
      .eq("project_id", params.projectId)
      .limit(1)
      .maybeSingle();

    if (defError || !definition) {
      console.error("Invalid waiver definition in signature payload", {
        projectId: params.projectId,
        signupId: params.signupId,
        waiverDefinitionId,
        defError,
      });
      return { error: "Invalid waiver definition." };
    }

    // A definition is the immutable source used by historical signatures.
    waiverPdfUrl = definition.pdf_public_url || waiverPdfUrl;
    waiverPdfStoragePath = definition.pdf_storage_path || waiverPdfStoragePath;
  }

  // No global waiver fallback - projects must have custom waivers

  const { ipAddress, userAgent } = await getRequestMetadata();
  let signaturePayload: Record<string, unknown> | null = null;
  let signatureStoragePath: string | null = null;
  let uploadStoragePath: string | null = null;
  const uploadedSignaturePaths: string[] = [];

  const removeUploadedSignatureAssets = async () => {
    if (uploadedSignaturePaths.length === 0) return;

    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .remove(uploadedSignaturePaths);

    if (error) {
      console.error("Failed to roll back uploaded waiver assets:", error);
    }
  };

  // Handle Multi-Signer Payload (Phase 4)
  if (
    params.waiverSignature.signatureType === "multi-signer" &&
    params.waiverSignature.payload
  ) {
    const rawPayload = params.waiverSignature.payload;
    const processedSigners = [];

    // Phase 1: Validate upload permissions for multi-signer flow
    for (const signer of rawPayload.signers) {
      if (signer.method === "upload" && !waiverAllowUpload) {
        return { error: "Signature upload is not allowed for this project." };
      }
    }

    // Process each signer (upload assets)
    for (const signer of rawPayload.signers) {
      const processedSigner = { ...signer };

      if (
        signer.data &&
        (signer.method === "draw" || signer.method === "upload")
      ) {
        // Phase 1: Multi-signer signatures are ONLY images, never full PDFs
        // The "upload" method here refers to uploading a signature image, not a full waiver PDF
        const bucket = WAIVER_SIGNATURE_BUCKET; // Always use signature bucket for multi-signer assets
        const maxBytes = MAX_WAIVER_SIGNATURE_BYTES;
        const allowedTypes = ["image/png", "image/jpeg", "image/jpg"]; // Images only

        // Detect file extension from data URL for proper storage
        const parsed = parseDataUrl(signer.data);
        let fileExt = "png"; // default
        if (
          parsed?.contentType === "image/jpeg" ||
          parsed?.contentType === "image/jpg"
        ) {
          fileExt = "jpg";
        }

        const fileName = `waiver_${params.signupId}_${signer.role_key}_${Date.now()}.${fileExt}`;

        // Upload asset
        const uploadResult = await uploadWaiverAsset({
          bucket,
          dataUrl: signer.data,
          fileName,
          maxBytes,
          allowedTypes,
        });

        if (uploadResult.error) {
          await removeUploadedSignatureAssets();
          console.error("Error uploading signer asset", {
            signerRoleKey: signer.role_key,
            uploadError: uploadResult.error,
          });
          return {
            error: "Failed to upload one of the required signature assets.",
          };
        }

        // Replace data with storage path
        processedSigner.data = uploadResult.path || "";
        if (uploadResult.path) uploadedSignaturePaths.push(uploadResult.path);
      }
      processedSigners.push(processedSigner);
    }

    signaturePayload = {
      ...rawPayload,
      signers: processedSigners,
    };
  }

  if (params.waiverSignature.signatureType === "draw") {
    const drawContentType = parseDataUrl(
      params.waiverSignature.signatureImageDataUrl ?? "",
    )?.contentType;
    const extension =
      drawContentType === "image/jpeg" || drawContentType === "image/jpg"
        ? "jpg"
        : "png";
    const uploadResult = await uploadWaiverAsset({
      bucket: WAIVER_SIGNATURE_BUCKET,
      dataUrl: params.waiverSignature.signatureImageDataUrl ?? "",
      fileName: `signatures/${params.projectId}/${params.signupId}/${crypto.randomUUID()}.${extension}`,
      maxBytes: MAX_WAIVER_SIGNATURE_BYTES,
      allowedTypes: ["image/png", "image/jpeg", "image/jpg"],
    });

    if (uploadResult.error || !uploadResult.path) {
      return { error: "Failed to store the drawn signature." };
    }

    signatureStoragePath = uploadResult.path;
    uploadedSignaturePaths.push(uploadResult.path);
  }

  if (params.waiverSignature.signatureType === "upload") {
    if (!waiverAllowUpload) {
      await removeUploadedSignatureAssets();
      return {
        error: "Signed waiver uploads are not allowed for this project.",
      };
    }

    if (!waiverPdfStoragePath && !waiverPdfUrl) {
      await removeUploadedSignatureAssets();
      return {
        error:
          "A configured waiver document is required before uploading a signed copy.",
      };
    }

    const contentType = parseDataUrl(
      params.waiverSignature.uploadFileDataUrl ?? "",
    )?.contentType;
    const extension =
      contentType === "application/pdf"
        ? "pdf"
        : contentType === "image/jpeg" || contentType === "image/jpg"
          ? "jpg"
          : "png";
    const uploadResult = await uploadWaiverAsset({
      bucket: WAIVER_SIGNATURE_BUCKET,
      dataUrl: params.waiverSignature.uploadFileDataUrl ?? "",
      fileName: `signed-waivers/${params.projectId}/${params.signupId}/${crypto.randomUUID()}.${extension}`,
      maxBytes: MAX_WAIVER_UPLOAD_BYTES,
      allowedTypes: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
    });

    if (uploadResult.error || !uploadResult.path) {
      await removeUploadedSignatureAssets();
      return { error: "Failed to store the signed waiver upload." };
    }

    uploadStoragePath = uploadResult.path;
    uploadedSignaturePaths.push(uploadResult.path);
  }

  const { error: insertError } = await serviceSupabase
    .from("waiver_signatures")
    .insert({
      waiver_definition_id: waiverDefinitionId,
      waiver_pdf_url: waiverPdfUrl,
      waiver_pdf_storage_path: waiverPdfStoragePath,
      project_id: params.projectId,
      signup_id: params.signupId,
      user_id: params.userId ?? null,
      anonymous_id: params.anonymousId ?? null,
      signer_name: params.signerName,
      signer_email: params.signerEmail,
      signature_type: params.waiverSignature.signatureType,
      signature_text:
        params.waiverSignature.signatureType === "typed"
          ? params.waiverSignature.signatureText?.trim() || null
          : null,
      signature_storage_path: signatureStoragePath,
      upload_storage_path: uploadStoragePath,
      signature_payload: signaturePayload,
      form_data: params.waiverSignature.formData ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertError) {
    await removeUploadedSignatureAssets();
    console.error("Error saving waiver signature:", insertError);
    return { error: "Failed to store waiver signature." };
  }

  return { success: true };
}

async function cloneAnonymousWaiverSignatureToSignup(params: {
  projectId: string;
  anonymousId: string;
  signupId: string;
}) {
  const serviceSupabase = getAdminClient();

  const { data: latestSignature, error: fetchError } = await serviceSupabase
    .from("waiver_signatures")
    .select(
      `
      waiver_definition_id,
      waiver_pdf_url,
      waiver_pdf_storage_path,
      signer_name,
      signer_email,
      signature_type,
      signature_text,
      signature_storage_path,
      upload_storage_path,
      signature_payload,
      form_data
    `,
    )
    .eq("project_id", params.projectId)
    .eq("anonymous_id", params.anonymousId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "Error fetching reusable anonymous waiver signature:",
      fetchError,
    );
    return { error: "Failed to reuse existing waiver signature." };
  }

  if (!latestSignature) {
    return {
      error: "No existing waiver signature found for this anonymous profile.",
    };
  }

  const copiedPaths: string[] = [];
  const copiedPathBySource = new Map<string, string>();

  const removeCopiedEvidence = async () => {
    if (copiedPaths.length === 0) return;
    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .remove(copiedPaths);
    if (error) {
      console.error("Failed to roll back cloned waiver evidence:", error);
    }
  };

  const copyEvidencePath = async (
    sourcePath: unknown,
  ): Promise<string | null> => {
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
      return null;
    }

    // Legacy inline/remote values are not Storage objects and must never be
    // copied as if they were trusted private evidence.
    if (/^(data:|https?:\/\/)/iu.test(sourcePath)) {
      return sourcePath;
    }

    const existingCopy = copiedPathBySource.get(sourcePath);
    if (existingCopy) return existingCopy;

    const extensionMatch = sourcePath.match(/\.([a-z0-9]{1,5})$/iu);
    const extension = extensionMatch?.[1]?.toLowerCase() ?? "bin";
    const destinationPath = `cloned-waiver-evidence/${params.projectId}/${params.signupId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await serviceSupabase.storage
      .from(WAIVER_SIGNATURE_BUCKET)
      .copy(sourcePath, destinationPath);

    if (error) {
      throw new Error("Failed to copy waiver evidence");
    }

    copiedPaths.push(destinationPath);
    copiedPathBySource.set(sourcePath, destinationPath);
    return destinationPath;
  };

  let clonedSignatureStoragePath: string | null;
  let clonedUploadStoragePath: string | null;
  let clonedSignaturePayload = latestSignature.signature_payload;

  try {
    clonedSignatureStoragePath = await copyEvidencePath(
      latestSignature.signature_storage_path,
    );
    clonedUploadStoragePath = await copyEvidencePath(
      latestSignature.upload_storage_path,
    );

    if (
      clonedSignaturePayload &&
      typeof clonedSignaturePayload === "object" &&
      !Array.isArray(clonedSignaturePayload)
    ) {
      const payload = clonedSignaturePayload as {
        signers?: unknown;
        [key: string]: unknown;
      };

      if (Array.isArray(payload.signers)) {
        const clonedSigners = [];
        for (const rawSigner of payload.signers) {
          if (
            !rawSigner ||
            typeof rawSigner !== "object" ||
            Array.isArray(rawSigner)
          ) {
            clonedSigners.push(rawSigner);
            continue;
          }

          const signer = rawSigner as {
            method?: unknown;
            data?: unknown;
            [key: string]: unknown;
          };
          const shouldCopy =
            signer.method === "draw" || signer.method === "upload";
          clonedSigners.push({
            ...signer,
            data: shouldCopy
              ? await copyEvidencePath(signer.data)
              : signer.data,
          });
        }

        clonedSignaturePayload = { ...payload, signers: clonedSigners };
      }
    }
  } catch (error) {
    await removeCopiedEvidence();
    console.error("Error copying reusable anonymous waiver evidence:", error);
    return {
      error: "Failed to attach existing waiver evidence to this signup.",
    };
  }

  const { ipAddress, userAgent } = await getRequestMetadata();

  const { error: insertError } = await serviceSupabase
    .from("waiver_signatures")
    .insert({
      ...latestSignature,
      signature_storage_path: clonedSignatureStoragePath,
      upload_storage_path: clonedUploadStoragePath,
      signature_payload: clonedSignaturePayload,
      project_id: params.projectId,
      signup_id: params.signupId,
      user_id: null,
      anonymous_id: params.anonymousId,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertError) {
    await removeCopiedEvidence();
    console.error("Error cloning anonymous waiver signature:", insertError);
    return {
      error: "Failed to attach existing waiver signature to this signup.",
    };
  }

  return { success: true };
}

export async function togglePauseSignups(
  projectId: string,
  pauseState: boolean,
) {
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
) {
  const supabase = await createClient();
  const serviceSupabase = getAdminClient();
  const isAnonymous = !!anonymousData;
  const requestedSkipAnonymousConfirmationEmail =
    !!anonymousData?.skipConfirmationEmail;
  const selectedSlotCount = Math.max(
    1,
    Number(anonymousData?.selectedSlotCount ?? 1),
  );
  let createdSignupId: string | undefined = undefined; // Track the created signup ID
  let createdAnonymousSignupId: string | null = null;
  let createdNewAnonymousProfile = false;
  let shouldReuseExistingAnonymousWaiver = false;
  let anonymousProfileAlreadyConfirmed = false;
  let anonymousContinuationToken: string | undefined;
  const traceId = crypto.randomUUID();

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
      const userEmailToCheck = isAnonymous
        ? anonymousData?.email
        : (await getAuthUser()).user?.email;

      // Helper to check domain
      const checkDomain = (email: string) => {
        const domain = email.split("@")[1]?.toLowerCase();
        return domain && allowedDomains.includes(domain);
      };

      if (isAnonymous) {
        if (userEmailToCheck && checkDomain(userEmailToCheck)) {
          hasValidEmail = true;
        }
      } else {
        // Logged in user - get user via getClaims() for better performance
        const { user } = await getAuthUser();
        if (user) {
          // 1. Check primary email
          if (user.email && checkDomain(user.email)) {
            hasValidEmail = true;
          } else {
            // 2. Check secondary verified emails
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
        }
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

    // Handle user authentication using getClaims() for better performance
    const { user } = await getAuthUser();

    // If project requires login but user isn't logged in
    if (project.require_login && !user) {
      logSignupDebug(traceId, "blocked_login_required");
      return { error: "You must be logged in to sign up for this project" };
    }

    logSignupDebug(traceId, "auth_loaded", {
      hasUser: Boolean(user),
      userId: user?.id,
    });

    // --- Check for existing signups ---
    if (user) {
      // Logged-in user check
      try {
        // First, check if user was previously rejected for this project
        const { data: previousRejection } = await supabase
          .from("project_signups")
          .select("id")
          .eq("project_id", projectId)
          .eq("schedule_id", scheduleId)
          .eq("user_id", user.id)
          .eq("status", "rejected")
          .maybeSingle();

        if (previousRejection) {
          logSignupDebug(traceId, "blocked_previous_rejection", {
            previousSignupId: previousRejection.id,
          });
          return {
            error:
              "You have been rejected for this project and cannot sign up again.",
          };
        }

        const { data: existingSignup } = await supabase
          .from("project_signups")
          .select("id")
          .eq("project_id", projectId)
          .eq("schedule_id", scheduleId)
          .eq("user_id", user.id)
          .in("status", ["approved", "pending"]) // Check for approved or pending
          .maybeSingle();

        if (existingSignup) {
          logSignupDebug(traceId, "blocked_existing_signup", {
            existingSignupId: existingSignup.id,
          });
          return { error: "You have already signed up for this slot" };
        }

        // Create project signup record for logged-in user (status 'approved')
        const signupData: Omit<ProjectSignup, "id" | "created_at"> = {
          project_id: projectId,
          schedule_id: scheduleId,
          user_id: user.id,
          status: "approved", // Logged-in users are approved by default
          anonymous_id: null,
          volunteer_comment: volunteerCommentToSave,
          response_data: formData || null,
        };

        const { data: insertedSignup, error: signupError } =
          await insertProjectSignupAtomically(signupData, traceId);

        if (signupError || !insertedSignup) {
          logSignupDebug(traceId, "registered_insert_failed", {
            error: summarizePostgrestError(signupError),
          });
          return { error: getProjectSignupInsertErrorMessage(signupError) };
        }

        // Store the signup ID for return
        createdSignupId = insertedSignup.id;
        // Send confirmation email to logged-in user
        try {
          // Get user profile for email
          const { data: userProfile } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", user.id)
            .single();

          if (userProfile?.email) {
            // Get schedule details for email
            const { date, timeRange } = getScheduleDetails(project, scheduleId);
            const projectUrl = `${siteUrl}/projects/${projectId}`;

            const { data: emailData, error: emailError } = await sendEmail({
              to: userProfile.email,
              subject: `Signup confirmed for ${project.title}`,
              react: React.createElement(UserSignupConfirmation, {
                projectName: project.title,
                userName: userProfile.full_name || "Volunteer",
                projectDate: date,
                projectTime: timeRange,
                projectLocation: project.location,
                projectUrl,
              }),
              userId: user.id,
              type: "transactional", // Signup confirmation is transactional
            });

            if (emailError) {
              logSignupDebug(traceId, "registered_confirmation_email_failed", {
                error: summarizePostgrestError(emailError),
              });
              // Don't fail the signup if email fails
            } else {
              logSignupDebug(traceId, "registered_confirmation_email_sent", {
                emailId:
                  typeof emailData === "object" && emailData
                    ? (emailData as { id?: string }).id
                    : undefined,
              });
            }
          }
        } catch (emailError) {
          logSignupDebug(traceId, "registered_confirmation_email_exception", {
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          });
          // Don't fail the signup if email fails
        }

        // Explicitly log success for debugging
        logSignupDebug(traceId, "registered_signup_created", {
          userId: user.id,
          projectId,
          scheduleId,
          signupId: createdSignupId,
        });
      } catch (error) {
        logSignupDebug(traceId, "registered_signup_exception", {
          error: error instanceof Error ? error.message : String(error),
        });
        return { error: "An error occurred during signup" };
      }
    } else if (isAnonymous && anonymousData) {
      // Anonymous user check
      const emailToCheck = (anonymousData.email ?? "").toLowerCase();
      logSignupDebug(traceId, "anonymous_flow_start", {
        hasEmail: Boolean(emailToCheck),
        hasExistingSelectedSlotCount: Boolean(anonymousData.selectedSlotCount),
        skipConfirmationEmail: requestedSkipAnonymousConfirmationEmail,
        isSignupOnlyProject,
      });

      // Check if an anonymous profile already exists for this email + project
      const { data: existingAnonProfile, error: anonLookupError } =
        await serviceSupabase
          .from("anonymous_signups")
          .select("id, confirmed_at, token")
          .eq("project_id", projectId)
          .ilike("email", emailToCheck)
          .maybeSingle();

      if (anonLookupError) {
        logSignupDebug(traceId, "anonymous_lookup_failed", {
          error: summarizePostgrestError(anonLookupError),
        });
        return { error: "An error occurred while checking signup status." };
      }

      logSignupDebug(traceId, "anonymous_lookup_complete", {
        hasExistingAnonProfile: Boolean(existingAnonProfile),
        existingAnonConfirmed: Boolean(existingAnonProfile?.confirmed_at),
      });

      const hasContinuationCapability = existingAnonProfile
        ? verifyAnonymousSignupContinuation(anonymousData.continuationToken, {
            anonymousSignupId: existingAnonProfile.id,
            projectId,
            email: emailToCheck,
          })
        : false;
      const skipConfirmationForThisRequest =
        requestedSkipAnonymousConfirmationEmail && hasContinuationCapability;

      // Every independent anonymous request must pass bot verification. Only a
      // short-lived capability returned by the immediately preceding slot can
      // continue a multi-slot signup without consuming another Turnstile token.
      if (!hasContinuationCapability) {
        const captchaValidation = await validateAnonymousSignupCaptcha(
          anonymousData.captchaToken,
        );

        if ("error" in captchaValidation) {
          return { error: captchaValidation.error };
        }
      }

      // First, check if a registered Let's Assist account exists with this email using efficient RPC
      const { data: emailExists, error: rpcError } = await serviceSupabase.rpc(
        "check_email_exists",
        { email_to_check: emailToCheck },
      );

      if (rpcError) {
        logSignupDebug(traceId, "anonymous_email_exists_rpc_failed", {
          error: summarizePostgrestError(rpcError),
        });
        return {
          error: "An error occurred while checking email availability.",
        };
      }

      if (emailExists) {
        logSignupDebug(traceId, "blocked_email_has_account");
        return {
          error:
            "This email is associated with an existing Let's Assist account. Please log in to sign up for this project.",
        };
      }

      // If profile exists, check if THIS specific slot already has a signup
      if (existingAnonProfile) {
        const { data: existingSlotSignup, error: slotError } =
          await serviceSupabase
            .from("project_signups")
            .select("id, status")
            .eq("project_id", projectId)
            .eq("schedule_id", scheduleId)
            .eq("anonymous_id", existingAnonProfile.id)
            .maybeSingle();

        if (slotError) {
          logSignupDebug(traceId, "anonymous_existing_slot_lookup_failed", {
            error: summarizePostgrestError(slotError),
          });
          return { error: "An error occurred while checking signup status." };
        }

        if (existingSlotSignup) {
          const signupStatus = existingSlotSignup.status;
          logSignupDebug(traceId, "anonymous_existing_slot_found", {
            existingSignupId: existingSlotSignup.id,
            signupStatus,
          });

          if (
            !anonymousEmailConfirmationRequired &&
            signupStatus === "pending"
          ) {
            const confirmation = await confirmAnonymousSignupWithCapacity(
              existingAnonProfile.id,
            );
            if (confirmation.error || !confirmation.data) {
              logSignupDebug(traceId, "anonymous_atomic_confirmation_failed", {
                error: summarizePostgrestError(confirmation.error),
              });
              return {
                error: "Failed to confirm this signup. Please try again.",
              };
            }
            if (confirmation.data.outcome === "slot_full") {
              return {
                error: "This slot just filled up. Please choose another time.",
              };
            }
            if (
              confirmation.data.outcome !== "confirmed" &&
              confirmation.data.outcome !== "already_confirmed"
            ) {
              return { error: "This signup can no longer be confirmed." };
            }

            return {
              success: true,
              signupId: existingSlotSignup.id,
              anonymousSignupId: existingAnonProfile.id,
              message: "You're already on the signup list.",
            };
          }

          if (signupStatus === "pending") {
            return {
              error:
                "You've already signed up for this slot but haven't confirmed your email yet.",
              canResend: true,
              anonymousSignupId: existingAnonProfile.id,
            };
          } else if (signupStatus === "approved") {
            return {
              error:
                "This email has already signed up and confirmed for this slot.",
            };
          } else if (signupStatus === "rejected") {
            return {
              error:
                "This email has been rejected by the project coordinator. Contact them for more details.",
            };
          }
        }

        if (project.waiver_required && !waiverSignature) {
          if (!hasContinuationCapability) {
            return {
              error:
                "This project requires a new waiver signature before signing up.",
            };
          }

          const { data: existingWaiver, error: existingWaiverError } =
            await serviceSupabase
              .from("waiver_signatures")
              .select("id")
              .eq("project_id", projectId)
              .eq("anonymous_id", existingAnonProfile.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

          if (existingWaiverError) {
            console.error(
              "Error checking existing anonymous waiver signature:",
              existingWaiverError,
            );
            return {
              error:
                "Unable to verify existing waiver signature. Please try again.",
            };
          }

          if (!existingWaiver) {
            return {
              error:
                "This project requires a waiver signature before signing up.",
            };
          }

          shouldReuseExistingAnonymousWaiver = true;
        }

        // Reuse the existing anonymous profile for a new slot signup
        createdAnonymousSignupId = existingAnonProfile.id;

        // A prior confirmation is only reusable when the caller also holds the
        // short-lived continuation capability issued by this signup flow.
        const isProfileConfirmed =
          (hasContinuationCapability && !!existingAnonProfile.confirmed_at) ||
          !anonymousEmailConfirmationRequired;
        anonymousProfileAlreadyConfirmed = isProfileConfirmed;
        const newSignupStatus = isProfileConfirmed ? "approved" : "pending";

        if (
          !anonymousEmailConfirmationRequired &&
          !existingAnonProfile.confirmed_at
        ) {
          await serviceSupabase
            .from("anonymous_signups")
            .update({ confirmed_at: new Date().toISOString() })
            .eq("id", existingAnonProfile.id);
        }

        const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
          project_id: projectId,
          schedule_id: scheduleId,
          user_id: null,
          status: newSignupStatus,
          anonymous_id: createdAnonymousSignupId,
          volunteer_comment: volunteerCommentToSave,
          response_data: formData || null,
        };

        const { data: insertedProjectSignup, error: projectSignupInsertError } =
          await insertProjectSignupAtomically(projectSignupData, traceId);

        if (projectSignupInsertError || !insertedProjectSignup) {
          logSignupDebug(traceId, "anonymous_existing_profile_insert_failed", {
            error: summarizePostgrestError(projectSignupInsertError),
          });
          return {
            error: getProjectSignupInsertErrorMessage(projectSignupInsertError),
          };
        }

        createdSignupId = insertedProjectSignup.id;

        // If profile is already confirmed, send a simple notification about the new slot
        if (
          isProfileConfirmed &&
          anonymousData.email &&
          !skipConfirmationForThisRequest &&
          anonymousEmailConfirmationRequired
        ) {
          const { date, timeRange, slotLabel } = getScheduleDetails(
            project,
            scheduleId,
          );
          const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}?token=${existingAnonProfile.token}`;
          try {
            await sendEmail({
              to: anonymousData.email,
              subject:
                selectedSlotCount > 1
                  ? `You're signed up for ${selectedSlotCount} slots in ${project.title}`
                  : `You're signed up for another slot in ${project.title}`,
              react: React.createElement(AnonymousSignupConfirmation, {
                confirmationUrl: anonymousProfileUrl, // Link to profile, not confirmation
                projectName: project.title,
                userName: anonymousData.name,
                anonymousProfileUrl,
                projectDate: date,
                projectTime: timeRange,
                slotLabel,
                selectedSlotCount,
              }),
              type: "transactional",
            });
          } catch (error) {
            console.error("Error sending slot addition email:", error);
          }
        } else if (
          !isProfileConfirmed &&
          anonymousData.email &&
          !skipConfirmationForThisRequest
        ) {
          // Profile not yet confirmed — resend confirmation email with new token
          const newToken = crypto.randomUUID();
          await serviceSupabase
            .from("anonymous_signups")
            .update({ token: newToken })
            .eq("id", createdAnonymousSignupId);

          const confirmationUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}/confirm?token=${newToken}`;
          const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}?token=${newToken}`;
          const { date, timeRange, slotLabel } = getScheduleDetails(
            project,
            scheduleId,
          );
          try {
            await sendEmail({
              to: anonymousData.email,
              subject: `Confirm your signup for ${project.title}`,
              react: React.createElement(AnonymousSignupConfirmation, {
                confirmationUrl,
                projectName: project.title,
                userName: anonymousData.name,
                anonymousProfileUrl,
                projectDate: date,
                projectTime: timeRange,
                slotLabel,
                selectedSlotCount,
              }),
              type: "transactional",
            });
          } catch (error) {
            console.error("Error sending confirmation email:", error);
          }
        }
      } else {
        if (project.waiver_required && !waiverSignature) {
          return {
            error:
              "This project requires a waiver signature before signing up.",
          };
        }

        // No existing profile — create a new anonymous profile + project signup
        const confirmationToken = crypto.randomUUID();
        const anonSignupData = {
          project_id: projectId,
          email: anonymousData.email ?? "",
          name: anonymousData.name,
          phone_number: anonymousData.phone || null,
          token: confirmationToken,
          confirmed_at: anonymousEmailConfirmationRequired
            ? null
            : new Date().toISOString(),
        };

        logSignupDebug(traceId, "anonymous_profile_insert_attempt", {
          projectId,
          hasEmail: Boolean(anonSignupData.email),
          hasName: Boolean(anonSignupData.name),
          hasPhone: Boolean(anonSignupData.phone_number),
        });
        const { data: insertedAnonSignup, error: anonInsertError } =
          await serviceSupabase
            .from("anonymous_signups")
            .insert(anonSignupData)
            .select("id")
            .single();

        if (anonInsertError || !insertedAnonSignup) {
          logSignupDebug(traceId, "anonymous_profile_insert_failed", {
            error: summarizePostgrestError(anonInsertError),
          });
          return {
            error: "Failed to initiate anonymous signup. Please try again.",
          };
        }
        createdAnonymousSignupId = insertedAnonSignup.id;
        createdNewAnonymousProfile = true;
        anonymousProfileAlreadyConfirmed = !anonymousEmailConfirmationRequired;
        logSignupDebug(traceId, "anonymous_profile_insert_success", {
          anonymousSignupId: createdAnonymousSignupId,
        });

        const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
          project_id: projectId,
          schedule_id: scheduleId,
          user_id: null,
          status: anonymousEmailConfirmationRequired ? "pending" : "approved",
          anonymous_id: createdAnonymousSignupId,
          volunteer_comment: volunteerCommentToSave,
          response_data: formData || null,
        };

        const { data: insertedProjectSignup, error: projectSignupInsertError } =
          await insertProjectSignupAtomically(projectSignupData, traceId);

        if (projectSignupInsertError || !insertedProjectSignup) {
          logSignupDebug(
            traceId,
            "anonymous_new_profile_signup_insert_failed",
            {
              error: summarizePostgrestError(projectSignupInsertError),
            },
          );
          await serviceSupabase
            .from("anonymous_signups")
            .delete()
            .eq("id", createdAnonymousSignupId);
          return {
            error: getProjectSignupInsertErrorMessage(projectSignupInsertError),
          };
        }

        createdSignupId = insertedProjectSignup.id;

        // Send confirmation email
        if (
          anonymousData.email &&
          confirmationToken &&
          createdAnonymousSignupId &&
          anonymousEmailConfirmationRequired
        ) {
          const confirmationUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}/confirm?token=${confirmationToken}`;
          const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}?token=${confirmationToken}`;
          const { date, timeRange, slotLabel } = getScheduleDetails(
            project,
            scheduleId,
          );
          try {
            const { data, error: emailError } = await sendEmail({
              to: anonymousData.email,
              subject: `Confirm your signup for ${project.title}`,
              react: React.createElement(AnonymousSignupConfirmation, {
                confirmationUrl,
                projectName: project.title,
                userName: anonymousData.name,
                anonymousProfileUrl,
                projectDate: date,
                projectTime: timeRange,
                slotLabel,
                selectedSlotCount,
              }),
              type: "transactional",
            });

            if (emailError) {
              console.error("Resend error:", emailError);
            } else {
              console.log("Confirmation email sent successfully:", data);
            }
          } catch (error) {
            console.error("Error sending confirmation email:", error);
          }
        }
      }
    } else {
      // Should not happen if require_login logic is correct, but handle defensively
      return {
        error: "Cannot sign up without user login or anonymous details.",
      };
    }

    if ((project.waiver_required || waiverSignature) && createdSignupId) {
      logSignupDebug(traceId, "waiver_persist_start", {
        waiverRequired: project.waiver_required,
        hasWaiverSignature: Boolean(waiverSignature),
        shouldReuseExistingAnonymousWaiver,
      });

      if (waiverSignature) {
        const userMetadata = user?.user_metadata as
          { full_name?: string } | undefined;
        const signerName =
          (waiverSignature.signerName || "").trim() ||
          (anonymousData?.name || "").trim() ||
          userMetadata?.full_name ||
          "Volunteer";
        const signerEmail =
          (user?.email || "").trim() ||
          (waiverSignature.signerEmail || "").trim() ||
          (anonymousData?.email || "").trim();

        if (!signerEmail) {
          return { error: "Signer email is required for the waiver." };
        }

        const persistResult = await persistWaiverSignature({
          projectId: project.id,
          signupId: createdSignupId,
          userId: user?.id ?? null,
          anonymousId: createdAnonymousSignupId ?? null,
          signerName,
          signerEmail,
          waiverSignature,
        });

        if (persistResult?.error) {
          logSignupDebug(traceId, "waiver_persist_failed", {
            error: persistResult.error,
          });
          await serviceSupabase
            .from("project_signups")
            .delete()
            .eq("id", createdSignupId);
          if (createdAnonymousSignupId && createdNewAnonymousProfile) {
            await serviceSupabase
              .from("anonymous_signups")
              .delete()
              .eq("id", createdAnonymousSignupId);
          }

          return { error: persistResult.error };
        }
      } else if (
        project.waiver_required &&
        shouldReuseExistingAnonymousWaiver &&
        createdAnonymousSignupId
      ) {
        const cloneResult = await cloneAnonymousWaiverSignatureToSignup({
          projectId: project.id,
          anonymousId: createdAnonymousSignupId,
          signupId: createdSignupId,
        });

        if (cloneResult?.error) {
          logSignupDebug(traceId, "waiver_clone_failed", {
            error: cloneResult.error,
          });
          await serviceSupabase
            .from("project_signups")
            .delete()
            .eq("id", createdSignupId);
          if (createdAnonymousSignupId && createdNewAnonymousProfile) {
            await serviceSupabase
              .from("anonymous_signups")
              .delete()
              .eq("id", createdAnonymousSignupId);
          }

          return { error: cloneResult.error };
        }
      } else if (project.waiver_required) {
        logSignupDebug(traceId, "blocked_missing_waiver_signature");
        return {
          error: "Waiver signature is required before completing signup.",
        };
      }
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

// Add this new function to unreject a signup
export async function unrejectSignup(signupId: string) {
  const supabase = await createClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    // Get signup details
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("*, project:projects(creator_id, organization_id)")
      .eq("id", signupId)
      .single();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Permission check: Only project creator or org admin/staff can unreject
    let hasPermission = false;
    if (user) {
      if (signup.project?.creator_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.organization_id) {
        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", signup.project.organization_id)
          .eq("user_id", user.id)
          .single();
        if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
          hasPermission = true;
        }
      }
    }

    if (!hasPermission) {
      return { error: "You don't have permission to unreject this signup" };
    }

    // Update signup status to 'approved'
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({ status: "approved" as SignupStatus })
      .eq("id", signupId);

    if (updateError) {
      throw updateError;
    }

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error unrejecting signup:", error);
    return { error: "Failed to unreject signup" };
  }
}

interface NotificationResult {
  success?: boolean;
  error?: string;
}

export async function createRejectionNotification(
  userId: string,
  projectId: string,
  signupId: string,
): Promise<NotificationResult> {
  "use server";
  const supabase = await createClient();

  try {
    // Fetch the project title before creating the notification
    const { data: projectData, error: projectFetchError } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .single();

    if (projectFetchError || !projectData) {
      throw new Error("Failed to fetch project title");
    }

    const projectTitle = projectData.title;

    // Create notification directly
    await NotificationService.createNotification(
      {
        title: "Project Status Update",
        body: `Your signup to volunteer for "${projectTitle}" has been rejected`,
        type: "project_updates",
        severity: "warning",
        actionUrl: `/projects/${projectId}`,
        data: { projectId, signupId },
      },
      userId,
    );

    return { success: true };
  } catch (error) {
    console.error("Server notification error:", error);
    return { error: "Failed to send notification" };
  }
}

export async function cancelSignup(
  signupId: string,
  anonymousSignupId?: string,
  anonymousSignupToken?: string,
) {
  const supabase = await createClient();
  const adminSupabase = getAdminClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    const isAnonymousCancellation = !user && !!anonymousSignupId;
    const signupLookupClient = isAnonymousCancellation
      ? adminSupabase
      : supabase;

    // Get signup details, including anonymous_id
    const { data: signup, error: signupError } = await signupLookupClient
      .from("project_signups")
      .select("*") // Fetch all signup details without join alias
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Permission check: User who signed up OR project creator/org admin/staff OR valid anonymous signup owner
    let hasPermission = false;

    // Check if this is an anonymous cancellation with valid anonymousSignupId
    if (anonymousSignupId && signup.anonymous_id === anonymousSignupId) {
      const { data: anonSignup, error: anonAccessError } =
        await getAnonymousSignupAccessRecord({
          anonymousSignupId,
          token: anonymousSignupToken,
          columns: "id",
        });

      if (!anonAccessError && anonSignup) {
        hasPermission = true;
      }
    }

    if (!hasPermission && user) {
      if (signup.user_id === user.id) {
        hasPermission = true;
      } else {
        // Check if user is creator or org admin/staff
        const { data: project } = await supabase
          .from("projects")
          .select("creator_id, organization_id, can_be_managed_by_staff")
          .eq("id", signup.project_id)
          .single();

        if (project?.creator_id === user.id) {
          hasPermission = true;
        } else if (project?.organization_id) {
          const { data: orgMember } = await supabase
            .from("organization_members")
            .select("role")
            .eq("organization_id", project.organization_id)
            .eq("user_id", user.id)
            .single();
          if (
            orgMember?.role === "admin" ||
            (orgMember?.role === "staff" &&
              project.can_be_managed_by_staff === true)
          ) {
            hasPermission = true;
          }
        }
      }
    }

    if (!hasPermission && !user && !anonymousSignupId) {
      return { error: "Authentication required to cancel signup." };
    }

    if (!hasPermission) {
      return { error: "You don't have permission to cancel this signup" };
    }

    // Remove calendar event if it exists (non-blocking)
    try {
      await removeCalendarEventForSignup(signupId);
    } catch (calendarError) {
      console.error("Error removing calendar event:", calendarError);
      // Don't fail the cancellation if calendar removal fails
    }

    const deleteClient = isAnonymousCancellation ? adminSupabase : supabase;

    const { data: cancelledSignup, error: cancelError } = await deleteClient
      .from("project_signups")
      .update({ status: "cancelled" })
      .eq("id", signupId)
      .select("id")
      .maybeSingle();

    if (cancelError || !cancelledSignup) {
      console.error("Failed to cancel signup:", cancelError);
      return { error: "Failed to cancel signup" };
    }

    console.log("Signup record cancelled successfully.");

    let removedAnonymousProfile = false;

    if (anonymousSignupId && signup.anonymous_id === anonymousSignupId) {
      const { count, error: remainingError } = await adminSupabase
        .from("project_signups")
        .select("id", { count: "exact", head: true })
        .eq("anonymous_id", anonymousSignupId);

      if (remainingError) {
        console.error(
          "Error checking remaining anonymous signups:",
          remainingError,
        );
      } else if ((count ?? 0) === 0) {
        const { error: removeAnonymousError } = await adminSupabase
          .from("anonymous_signups")
          .delete()
          .eq("id", anonymousSignupId);

        if (removeAnonymousError) {
          console.error(
            "Error deleting empty anonymous signup profile:",
            removeAnonymousError,
          );
        } else {
          removedAnonymousProfile = true;
        }
      }
    }

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true, removedAnonymousProfile };
  } catch (error) {
    console.error("Error cancelling signup:", error);
    return { error: "Failed to cancel signup" };
  }
}

export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  cancellationReason?: string,
) {
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
      hasPermission = ["admin", "staff"].includes(orgMember.role);
    }
  }

  if (!hasPermission) {
    return { error: "You don't have permission to update this project" };
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

  const { error: updateError } = await supabase
    .from("projects")
    .update(updateData)
    .eq("id", projectId);

  if (updateError) {
    console.error("Error updating project status:", updateError);
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

      const { error: enqueueError } = await serviceSupabase
        .from("project_cancellation_jobs")
        .upsert(
          {
            project_id: projectId,
            cancelled_at: cancelledAt,
            cancellation_reason: cancellationReason!,
            created_by: user.id,
            status: "pending",
            cursor: 0,
            attempts: 0,
            last_error: null,
            processing_started_at: null,
            completed_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" },
        );

      if (enqueueError) {
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
  revalidatePath(`/organization/${project.organization?.id}`);
  revalidatePath("/home");

  return { success: true, cancellationNotifications };
}

export async function cloneProject(projectId: string) {
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

/**
 * Manually check in a participant by the project creator
 */
export async function checkInParticipant(
  signupId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser({ sensitive: true });
    if (!user) {
      return { success: false, error: "Authentication required" };
    }

    // Get the signup to verify it exists
    const { data: signup, error: fetchError } = await supabase
      .from("project_signups")
      .select("id, project_id, check_in_time")
      .eq("id", signupId)
      .single();

    if (fetchError || !signup) {
      return {
        success: false,
        error: "Signup record not found",
      };
    }

    const { data: project } = await supabase
      .from("projects")
      .select("creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", signup.project_id)
      .maybeSingle();

    if (!project || !(await canUserManageProject(supabase, project, user.id))) {
      return { success: false, error: "Unauthorized" };
    }

    if (signup.check_in_time) {
      return { success: true };
    }

    // Update the check-in time
    const now = new Date().toISOString();
    const admin = getAdminClient();
    const { data: updatedRows, error: updateError } = await admin
      .from("project_signups")
      .update({ check_in_time: now, status: "attended" })
      .eq("id", signupId)
      .eq("project_id", signup.project_id)
      .is("check_in_time", null)
      .in("status", ["approved", "attended"])
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return {
        success: false,
        error: "Failed to update check-in time",
      };
    }

    // Revalidate the project page to reflect the changes
    revalidatePath(`/projects/${signup.project_id}`);

    return { success: true };
  } catch (error) {
    console.error("Error checking in participant:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Manually checks out a participant using the server clock. This organizer
 * path is intentionally separate from participant self-checkout so every
 * update is protected by the shared project-management authorization rules.
 */
export async function checkOutParticipant(
  signupId: string,
): Promise<{ success: boolean; checkOutTime?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthUser({
      sensitive: true,
      checkMfa: true,
    });
    if (authError || !user) {
      return { success: false, error: "Authentication required" };
    }

    const admin = getAdminClient();
    const { data: signup, error: signupError } = await admin
      .from("project_signups")
      .select("id, project_id, check_in_time")
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return {
        success: false,
        error: "Signup record not found or access denied",
      };
    }

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", signup.project_id)
      .maybeSingle();

    if (
      projectError ||
      !project ||
      !(await canUserManageProject(supabase, project, user.id))
    ) {
      return {
        success: false,
        error: "Signup record not found or access denied",
      };
    }

    const checkout = resolveServerCheckoutTime(signup.check_in_time);
    if (!checkout.ok) {
      return {
        success: false,
        error:
          checkout.reason === "missing_check_in"
            ? "Cannot check out before check-in"
            : "The recorded check-in time is invalid",
      };
    }

    const { data: updatedRows, error: updateError } = await admin
      .from("project_signups")
      .update({
        check_out_time: checkout.checkOutTime,
        status: "attended",
      })
      .eq("id", signup.id)
      .eq("project_id", signup.project_id)
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return { success: false, error: "Failed to update checkout time" };
    }

    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/attendance`);
    revalidatePath(`/projects/${signup.project_id}/hours`);
    revalidatePath(`/attend/${signup.project_id}`);

    return { success: true, checkOutTime: checkout.checkOutTime };
  } catch (error) {
    console.error("Error checking out participant:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function getUserProfile() {
  const supabase = await createClient();

  try {
    // Get current user using getClaims() for better performance
    const { user, error: userError } = await getAuthUser();

    if (userError || !user) {
      return { error: "Not authenticated" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Error fetching profile:", profileError);
      return { error: "Failed to fetch profile" };
    }

    return {
      profile: {
        full_name: profile.full_name || null,
        email: user.email || null,
        phone: profile.phone || null,
      },
    };
  } catch (error) {
    console.error("Error in getUserProfile:", error);
    return { error: "An unexpected error occurred" };
  }
}

export async function getWaiverDownloadUrl(
  signupId: string,
  anonymousSignupId?: string,
  anonymousSignupToken?: string,
) {
  const supabase = await createClient();
  const serviceSupabase = getAdminClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    type SignupForWaiver = {
      id: string;
      user_id: string | null;
      anonymous_id: string | null;
      project?: {
        creator_id: string | null;
        organization_id: string | null;
      } | null;
    };

    const { data: signup, error: signupError } = (await serviceSupabase
      .from("project_signups")
      .select(
        "id, user_id, anonymous_id, project:projects(creator_id, organization_id)",
      )
      .eq("id", signupId)
      .single()) as {
      data: SignupForWaiver | null;
      error: { message?: string } | null;
    };

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    let hasPermission = false;

    if (user) {
      if (signup.user_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.creator_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.organization_id) {
        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", signup.project.organization_id)
          .eq("user_id", user.id)
          .single();

        if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
          hasPermission = true;
        }
      }
    } else if (anonymousSignupId && signup.anonymous_id === anonymousSignupId) {
      const { data: anonSignup, error: anonAccessError } =
        await getAnonymousSignupAccessRecord({
          anonymousSignupId,
          token: anonymousSignupToken,
          columns: "id",
        });

      if (!anonAccessError && anonSignup) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return { error: "Unauthorized" };
    }

    const { data: waiverSignature, error: waiverError } = await serviceSupabase
      .from("waiver_signatures")
      .select(
        "id, signature_type, signature_storage_path, upload_storage_path, signature_payload, signature_text, signed_at, signer_name",
      )
      .eq("signup_id", signupId)
      .maybeSingle();

    if (waiverError || !waiverSignature) {
      return { error: "Waiver signature not found" };
    }

    // Priority 1: Offline upload (direct file)
    if (waiverSignature.upload_storage_path) {
      const { data: signedUrl, error: urlError } = await serviceSupabase.storage
        .from(WAIVER_SIGNATURE_BUCKET)
        .createSignedUrl(waiverSignature.upload_storage_path, 3600);

      if (!urlError && signedUrl?.signedUrl) {
        return { url: signedUrl.signedUrl, signatureId: waiverSignature.id };
      }
    }

    // Priority 2: Legacy signature (single image/file)
    if (waiverSignature.signature_storage_path) {
      const { data: signedUrl, error: urlError } = await serviceSupabase.storage
        .from(WAIVER_SIGNATURE_BUCKET)
        .createSignedUrl(waiverSignature.signature_storage_path, 3600);

      if (!urlError && signedUrl?.signedUrl) {
        return { url: signedUrl.signedUrl, signatureId: waiverSignature.id };
      }
    }

    // Priority 3: Multi-signer payload (needs on-demand generation)
    if (waiverSignature.signature_payload) {
      // Return the signature ID so client can use download API
      return {
        signatureId: waiverSignature.id,
        // No direct URL - client will use /api/waivers/[signatureId]/download
      };
    }

    // Fallback for typed signatures
    if (
      waiverSignature.signature_text ||
      waiverSignature.signature_type === "typed"
    ) {
      return {
        signatureId: waiverSignature.id,
        signature: waiverSignature,
      };
    }

    return { error: "No waiver data available" };
  } catch (error) {
    console.error("Error generating waiver download URL:", error);
    return { error: "Failed to generate waiver URL" };
  }
}

export async function getAnonymousWaiverSignatureMeta(
  signupId: string,
  anonymousSignupId: string,
  anonymousSignupToken?: string,
): Promise<
  | {
      signatureId: string;
      signature_type: string | null;
      signed_at: string | null;
    }
  | { signatureId: null; signature_type: null; signed_at: null }
  | { error: string }
> {
  const admin = getAdminClient();

  try {
    const { data: anonSignup, error: anonAccessError } =
      await getAnonymousSignupAccessRecord({
        anonymousSignupId,
        token: anonymousSignupToken,
        columns: "id",
      });

    if (anonAccessError || !anonSignup) {
      return { error: "Unauthorized" };
    }

    // Anonymous-only helper: verify the anonymous signup owns this project_signup.
    const { data: signup, error: signupError } = await admin
      .from("project_signups")
      .select("id, anonymous_id")
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    if (!signup.anonymous_id || signup.anonymous_id !== anonymousSignupId) {
      return { error: "Unauthorized" };
    }
    const { data: sig, error: sigError } = await admin
      .from("waiver_signatures")
      .select("id, signature_type, signed_at")
      .eq("signup_id", signupId)
      .order("signed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sigError) {
      console.error("Error loading anonymous waiver signature meta:", sigError);
      return { error: "Failed to load waiver" };
    }

    if (!sig) {
      return { signatureId: null, signature_type: null, signed_at: null };
    }

    return {
      signatureId: sig.id,
      signature_type: sig.signature_type ?? null,
      signed_at: sig.signed_at ?? null,
    };
  } catch (error) {
    console.error("Error in getAnonymousWaiverSignatureMeta:", error);
    return { error: "Failed to load waiver" };
  }
}

export async function getMyWaiverSignatures(projectId: string): Promise<
  | {
      signatures: Array<{
        id: string;
        signed_at: string | null;
        created_at: string;
      }>;
    }
  | { error: string }
> {
  try {
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return { error: "Not authenticated" };
    }

    const admin = getAdminClient();

    const { data, error } = await admin
      .from("waiver_signatures")
      .select(
        `
        id,
        signed_at,
        created_at
      `,
      )
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .order("signed_at", { ascending: false });

    if (error) {
      console.error("Error fetching my waiver signatures:", error);
      return { error: "Failed to load waivers" };
    }

    return { signatures: data ?? [] };
  } catch (error) {
    console.error("Error in getMyWaiverSignatures:", error);
    return { error: "Failed to load waivers" };
  }
}

/**
 * Resend confirmation email for an anonymous signup
 * @param anonymousSignupId - The ID of the anonymous signup record
 * @returns Object with success or error message
 */
export async function resendAnonymousConfirmationEmail(
  anonymousSignupId: string,
  captchaToken?: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const captchaValidation =
      await validateAnonymousSignupCaptcha(captchaToken);

    if ("error" in captchaValidation) {
      return { error: captchaValidation.error };
    }

    const admin = getAdminClient();
    const { ipAddress } = await getRequestMetadata();
    const rateLimitKey = crypto
      .createHash("sha256")
      .update(`${anonymousSignupId}:${ipAddress ?? "unknown"}`)
      .digest("hex");
    const { data: rateLimitData, error: rateLimitError } = await admin.rpc(
      "consume_api_rate_limit",
      {
        p_key: `anonymous-confirmation:${rateLimitKey}`,
        p_limit: 1,
        p_window_seconds: 60,
      },
    );
    const rateLimit = Array.isArray(rateLimitData)
      ? rateLimitData[0]
      : rateLimitData;

    if (rateLimitError || !rateLimit?.allowed) {
      return {
        error: "Please wait before requesting another confirmation email.",
      };
    }

    const { data: anonSignup, error: fetchError } = await admin
      .from("anonymous_signups")
      .select("id, email, name, project_id, confirmed_at, token, created_at")
      .eq("id", anonymousSignupId)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching anonymous signup:", fetchError);
      return { error: "Unable to resend the confirmation email." };
    }

    // Keep the public response non-enumerating for missing/already-confirmed IDs.
    if (!anonSignup || anonSignup.confirmed_at) {
      return { success: true };
    }

    // Get project title for the email
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("title, event_type, schedule")
      .eq("id", anonSignup.project_id)
      .single();

    if (projectError || !project) {
      console.error("Error fetching project:", projectError);
      return { error: "Failed to fetch project details." };
    }

    // Generate a new confirmation token for security (invalidates old links)
    const newToken = crypto.randomUUID();

    // Update the token in the database
    const { error: updateError } = await admin
      .from("anonymous_signups")
      .update({ token: newToken })
      .eq("id", anonymousSignupId);

    if (updateError) {
      console.error("Error updating token:", updateError);
      return { error: "Failed to generate new confirmation link." };
    }

    // Send the confirmation email
    const confirmationUrl = `${siteUrl}/anonymous/${anonymousSignupId}/confirm?token=${newToken}`;
    const anonymousProfileUrl = `${siteUrl}/anonymous/${anonymousSignupId}?token=${newToken}`;

    const { data: signupRecord } = await admin
      .from("project_signups")
      .select("schedule_id")
      .eq("anonymous_id", anonymousSignupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const scheduleId = signupRecord?.schedule_id;
    const scheduleDetails = scheduleId
      ? getScheduleDetails(project as Project, scheduleId)
      : { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const restorePreviousToken = async () => {
      await admin
        .from("anonymous_signups")
        .update({ token: anonSignup.token })
        .eq("id", anonymousSignupId)
        .eq("token", newToken);
    };

    let emailError: unknown = null;
    try {
      const result = await sendEmail({
        to: anonSignup.email,
        subject: `Confirm your signup for ${project.title}`,
        react: React.createElement(AnonymousSignupConfirmation, {
          confirmationUrl,
          projectName: project.title,
          userName: anonSignup.name,
          anonymousProfileUrl,
          projectDate: scheduleDetails.date,
          projectTime: scheduleDetails.timeRange,
          slotLabel: scheduleDetails.slotLabel,
        }),
        type: "transactional",
      });
      emailError = result.error;
    } catch (sendError) {
      emailError = sendError;
    }

    if (emailError) {
      console.error("Error sending confirmation email:", emailError);
      await restorePreviousToken();
      return { error: "Failed to send confirmation email. Please try again." };
    }

    console.log("Resent confirmation email to:", anonSignup.email);
    return { success: true };
  } catch (error) {
    console.error("Error in resendAnonymousConfirmationEmail:", error);
    return { error: "An unexpected error occurred." };
  }
}

// Get waiver definition for a project
export async function getWaiverDefinition(projectId: string): Promise<{
  success: boolean;
  definition?: WaiverDefinitionFull | null;
  error?: string;
}> {
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
