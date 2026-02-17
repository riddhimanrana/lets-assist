"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { canCancelProject, isProjectVisible } from "@/utils/project";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
// Make sure AnonymousSignup is imported from the correct types definition
import { type Project, type AnonymousSignupData, type ProjectSignup, type SignupStatus, type WaiverSignatureInput } from "@/types";
import { headers } from "next/headers";
import crypto from 'crypto';
// Import centralized email service
import { sendEmail } from '@/services/email';
// Import date-fns utilities
import { parseISO, isAfter } from 'date-fns';
// Import React Email templates
import AnonymousSignupConfirmation from '@/emails/anonymous-signup-confirmation';
import UserSignupConfirmation from '@/emails/user-signup-confirmation';
import * as React from 'react';

import { NotificationService } from "@/services/notifications";
import { removeCalendarEventForSignup, removeCalendarEventForProject } from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { validateWaiverPayload, validateLegacyWaiverPayload } from "@/lib/waiver/validate-waiver-payload";
import { mapDetectedFieldsForDb, mapCustomPlacementsForDb } from "@/lib/waiver/map-definition-input";

// Define your site URL (replace with environment variable ideally)
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

function formatTimeTo12Hour(timeStr: string | undefined): string {
  if (!timeStr || timeStr === "TBD") return "TBD";
  try {
    // Expected format "HH:mm" or "HH:mm:ss"
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (hours === undefined || minutes === undefined || isNaN(hours) || isNaN(minutes)) return timeStr;

    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const minStr = minutes.toString().padStart(2, '0');

    return `${hour12}:${minStr} ${ampm}`;
  } catch {
    return timeStr;
  }
}

const WAIVER_SIGNATURE_BUCKET = "waiver-signatures";
const WAIVER_UPLOAD_BUCKET = "waiver-uploads";
const MAX_WAIVER_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_WAIVER_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

const LEGACY_WAIVER_FIELD_TYPES = new Set([
  "signature",
  "text",
  "checkbox",
  "radio",
  "dropdown",
  "date",
]);

type PostgrestErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function normalizeWaiverFieldTypeForLegacyConstraint(fieldType: unknown): string {
  const normalized = typeof fieldType === "string" ? fieldType.trim().toLowerCase() : "";

  if (LEGACY_WAIVER_FIELD_TYPES.has(normalized)) {
    return normalized;
  }

  switch (normalized) {
    case "name":
    case "email":
    case "phone":
    case "address":
    case "initial":
      return "text";
    default:
      return "text";
  }
}

function isWaiverFieldTypeConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  const joined = `${pgError.message ?? ""} ${pgError.details ?? ""} ${pgError.hint ?? ""}`.toLowerCase();

  return joined.includes("field_type") && (joined.includes("check constraint") || joined.includes("violat"));
}

function isMissingWaiverDisableEsignatureColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  const combined = `${pgError.message ?? ""} ${pgError.details ?? ""} ${pgError.hint ?? ""}`.toLowerCase();
  const referencesColumn = combined.includes("waiver_disable_esignature");
  const schemaCacheLike =
    combined.includes("schema cache") ||
    combined.includes("could not find") ||
    combined.includes("column");
  const knownCode = pgError.code === "PGRST204" || pgError.code === "42703";

  return referencesColumn && (knownCode || schemaCacheLike);
}

function toLegacyCompatibleWaiverFields(fields: Array<Record<string, unknown>>) {
  let changed = false;

  const normalizedFields = fields.map((field) => {
    const originalFieldType = typeof field.field_type === "string" ? field.field_type : "text";
    const nextFieldType = normalizeWaiverFieldTypeForLegacyConstraint(originalFieldType);

    if (nextFieldType === originalFieldType) {
      return field;
    }

    changed = true;

    const currentMeta =
      field.meta && typeof field.meta === "object" && !Array.isArray(field.meta)
        ? (field.meta as Record<string, unknown>)
        : {};

    return {
      ...field,
      field_type: nextFieldType,
      meta: {
        ...currentMeta,
        original_field_type: originalFieldType,
      },
    };
  });

  return { normalizedFields, changed };
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

// Function to extract schedule details for email notifications
function getScheduleDetails(project: Project, scheduleId: string) {
  if (project.event_type === "oneTime") {
    const schedule = project.schedule.oneTime;
    if (!schedule) return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const date = new Date(schedule.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const start12 = formatTimeTo12Hour(schedule.startTime);
    const end12 = formatTimeTo12Hour(schedule.endTime);
    const timeRange = schedule.startTime && schedule.endTime
      ? `${start12} - ${end12}`
      : start12;

    return {
      date,
      time: start12,
      timeRange,
      slotLabel: "Slot 1"
    };
  } else if (project.event_type === "multiDay") {
    const parts = scheduleId.split("-");
    if (parts.length >= 2) {
      const slotIndexStr = parts.pop();
      const dateStr = parts.join("-");

      const day = project.schedule.multiDay?.find(d => d.date === dateStr);
      if (!day) return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

      const slotIndex = parseInt(slotIndexStr!, 10);
      const slot = day.slots[slotIndex];
      if (!slot) return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

      const date = new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const start12 = formatTimeTo12Hour(slot.startTime);
      const end12 = formatTimeTo12Hour(slot.endTime);
      const timeRange = slot.startTime && slot.endTime
        ? `${start12} - ${end12}`
        : start12;

      return {
        date,
        time: start12,
        timeRange,
        slotLabel: `Slot ${slotIndex + 1}`
      };
    }
  } else if (project.event_type === "sameDayMultiArea") {
    const schedule = project.schedule.sameDayMultiArea;
    if (!schedule) return { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const date = new Date(schedule.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const role = schedule.roles.find(r => r.name === scheduleId);

    const start12 = formatTimeTo12Hour(role?.startTime || schedule.overallStart);
    const end12 = formatTimeTo12Hour(role?.endTime || schedule.overallEnd);

    const timeRange = start12 !== "TBD" && end12 !== "TBD"
      ? `${start12} - ${end12}`
      : start12;

    return {
      date,
      time: start12,
      timeRange,
      slotLabel: role?.name || "Slot"
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

export async function getProject(projectId: string) {
  const supabase = await createClient();

  // Get the current user if logged in using getClaims() for better performance
  const { user } = await getAuthUser();

  // Fetch the project
  const { data: project, error } = (await supabase
    .from("projects")
    .select(`
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
    `)
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

    if (project.workflow_status === "draft" && (!user || project.creator_id !== user.id)) {
      return { error: "unauthorized", project: null };
    }


    // Check if the project is organization-only and the user has permission to view it
    if (project.visibility === 'organization_only') {
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
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Error fetching creator profile:", error);
    return { error: "Failed to fetch creator profile" };
  }

  return { profile };
}

export async function getActiveWaiverTemplate() {
  try {
    const serviceSupabase = getAdminClient();
    const { data, error } = await serviceSupabase
      .from("waiver_templates")
      .select("*")
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error fetching waiver template:", error);
      return { error: "Failed to load waiver template" };
    }

    return { template: data };
  } catch (error) {
    console.error("Error fetching waiver template:", error);
    return { error: "Failed to load waiver template" };
  }
}

import { getActiveGlobalTemplate } from '@/app/admin/waivers/actions';

// Get project-specific waiver or fall back to global template
export async function getProjectWaiver(projectId: string) {
  try {
    const serviceSupabase = getAdminClient();

    // First get the project's waiver config
    let { data: project, error: projectError } = await serviceSupabase
      .from("projects")
      .select("waiver_required, waiver_allow_upload, waiver_disable_esignature, waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError && isMissingWaiverDisableEsignatureColumnError(projectError)) {
      const fallbackResult = await serviceSupabase
        .from("projects")
        .select("waiver_required, waiver_allow_upload, waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id")
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
        .select(`
          *,
          signers:waiver_definition_signers(*),
          fields:waiver_definition_fields(*)
        `)
        .eq("id", project.waiver_definition_id)
        .single();

      if (!defError && definition) {
        return {
          waiverConfig: {
             waiverRequired: project.waiver_required ?? true,
            waiverAllowUpload: project.waiver_disable_esignature ? true : (project.waiver_allow_upload ?? true),
             waiverPdfUrl: definition.pdf_public_url || project.waiver_pdf_url, // Prefer definition PDF
             waiverPdfStoragePath: definition.pdf_storage_path,
             isProjectSpecific: true,
             isWaiverDefinition: true,
          },
          definition,
          template: null
        };
      }
    }

    // If project has a custom waiver PDF, use that
    if (project.waiver_pdf_url) {
      return {
        waiverConfig: {
          waiverRequired: project.waiver_required ?? false,
          waiverAllowUpload: project.waiver_disable_esignature ? true : (project.waiver_allow_upload ?? true),
          waiverPdfUrl: project.waiver_pdf_url,
          waiverPdfStoragePath: project.waiver_pdf_storage_path,
          isProjectSpecific: true,
        },
        template: null,
      };
    }

    // Fall back to active global template (Phase 6)
    const activeGlobalTemplate = await getActiveGlobalTemplate();
    
    if (activeGlobalTemplate) {
        return {
            waiverConfig: {
                waiverRequired: project.waiver_required ?? true,
                waiverAllowUpload: project.waiver_disable_esignature ? true : (project.waiver_allow_upload ?? true),
                waiverPdfUrl: activeGlobalTemplate.pdf_public_url,
                waiverPdfStoragePath: activeGlobalTemplate.pdf_storage_path,
                isProjectSpecific: false,
                isWaiverDefinition: true,
            },
            definition: activeGlobalTemplate,
            template: null
        };
    }

    // Fall back to legacy global template if no new definition
    const { template, error: templateError } = await getActiveWaiverTemplate();

    if (templateError) {
      return { error: templateError };
    }

    return {
      waiverConfig: {
        waiverRequired: project.waiver_required ?? false,
        waiverAllowUpload: project.waiver_disable_esignature ? true : (project.waiver_allow_upload ?? true),
        waiverPdfUrl: null,
        waiverPdfStoragePath: null,
        isProjectSpecific: false,
      },
      template,
    };
  } catch (error) {
    console.error("Error fetching project waiver:", error);
    return { error: "Failed to load project waiver" };
  }
}

// Upload project waiver PDF
export async function uploadProjectWaiverPdf(projectId: string, pdfDataUrl: string, fileName: string) {
  try {
    const supabase = await createClient();

    // Check if user has permission
    const isAllowed = await isProjectCreator(projectId);
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
    const storagePath = `project_waivers/${projectId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

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
      await serviceSupabase.storage.from(WAIVER_UPLOAD_BUCKET).remove([storagePath]);
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
    const isAllowed = await isProjectCreator(projectId);
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

    // Remove from storage if exists
    if (project.waiver_pdf_storage_path) {
      await serviceSupabase.storage
        .from(WAIVER_UPLOAD_BUCKET)
        .remove([project.waiver_pdf_storage_path]);
    }

    // Update project to remove waiver PDF info
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        waiver_pdf_url: null,
        waiver_pdf_storage_path: null,
        // Also detach the project waiver definition so we fall back to the global template.
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

  if (params.allowedTypes && !params.allowedTypes.includes(parsed.contentType)) {
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

// Fix: Remove async keyword as this function doesn't perform async operations
function getSlotDetails(project: Project, scheduleId: string) {
  console.log("Server: Getting slot details for", { scheduleId, projectType: project.event_type });

  if (project.event_type === "oneTime") {
    return project.schedule.oneTime;
  } else if (project.event_type === "multiDay") {
    // Improved parsing for multi-day schedules
    const parts = scheduleId.split("-");
    if (parts.length >= 2) {
      const slotIndexStr = parts.pop(); // Get last element (slot index)
      const date = parts.join("-"); // Rejoin the rest as the date

      console.log("Server: Parsing multiDay scheduleId:", { date, slotIndexStr });

      const day = project.schedule.multiDay?.find(d => d.date === date);
      if (!day) {
        console.error("Server: Day not found for multiDay event:", { date, scheduleId });
        return null;
      }

      const slotIndex = parseInt(slotIndexStr!, 10);
      if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= day.slots.length) {
        console.error("Server: Invalid slot index for multiDay event:", {
          slotIndexStr, slotIndex, slotsLength: day.slots.length
        });
        return null;
      }

      return day.slots[slotIndex];
    } else {
      console.error("Server: Invalid multiDay scheduleId format:", scheduleId);
      return null;
    }
  } else if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === scheduleId);
    return role;
  }

  return null;
}

async function getCurrentSignups(projectId: string, scheduleId: string): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("project_signups")
    .select("*", { count: 'exact', head: true })
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
    .select("waiver_pdf_url, waiver_allow_upload, waiver_disable_esignature")
    .eq("id", params.projectId)
    .maybeSingle();

  if (!project) {
    const { data: fallbackProject, error: fallbackError } = await serviceSupabase
      .from("projects")
      .select("waiver_pdf_url, waiver_allow_upload")
      .eq("id", params.projectId)
      .maybeSingle();

    if (fallbackError && !isMissingWaiverDisableEsignatureColumnError(fallbackError)) {
      console.error("Error fetching project waiver settings:", fallbackError);
    }

    if (fallbackProject) {
      project = {
        ...fallbackProject,
        waiver_disable_esignature: false,
      };
    }
  }

  const waiverDefinitionId: string | null = params.waiverSignature.definitionId?.trim() || null;

  const rawTemplateId = typeof params.waiverSignature.templateId === "string" ? params.waiverSignature.templateId.trim() : "";
  let templateId: string | null = rawTemplateId === "project-pdf" ? null : (rawTemplateId || null);

  let waiverPdfUrl: string | null = project?.waiver_pdf_url || params.waiverSignature.waiverPdfUrl || null;
  // Phase 1: Default to true for backward compatibility with projects created before this feature
  const waiverAllowUpload = project?.waiver_disable_esignature ? true : (project?.waiver_allow_upload ?? true);

  // New system: waiver_definitions are a complete waiver source (PDF + placements).
  // If definitionId is present, we should NOT require / validate legacy waiver_templates.
  if (waiverDefinitionId) {
    const { data: definition, error: defError } = await serviceSupabase
      .from("waiver_definitions")
      .select("id, pdf_public_url")
      .eq("id", waiverDefinitionId)
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

    // Prefer an explicitly provided waiverPdfUrl, otherwise use the definition's PDF.
    waiverPdfUrl = waiverPdfUrl || definition.pdf_public_url || null;
    templateId = null;
  }

  if (!waiverPdfUrl && waiverDefinitionId) {
    return { error: "No waiver PDF is available for this waiver definition." };
  }

  // If using project-specific PDF, we don't need a template
  if (waiverPdfUrl) {
    templateId = null; // Set to null when using project PDF
  } else if (templateId && templateId !== "project-pdf") {
    // Validate template if provided and not using project PDF
    const { data: template, error: templateError } = await serviceSupabase
      .from("waiver_templates")
      .select("id")
      .eq("id", templateId)
      .maybeSingle();

    if (templateError || !template) {
      return { error: "Invalid waiver template." };
    }
  } else {
    // If no PDF and no valid template, get the active global template
    const { data: activeTemplate } = await serviceSupabase
      .from("waiver_templates")
      .select("id")
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeTemplate) {
      templateId = activeTemplate.id;
    } else {
      return { error: "No waiver source available. Please contact support." };
    }
  }

  const { ipAddress, userAgent } = await getRequestMetadata();
  let signatureStoragePath: string | null = null;
  let uploadStoragePath: string | null = null;
  let signaturePayload: Record<string, unknown> | null = null;
  // waiverDefinitionId resolved above

  // Handle Multi-Signer Payload (Phase 4)
  if (params.waiverSignature.signatureType === "multi-signer" && params.waiverSignature.payload) {
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
      
      if (signer.data && (signer.method === "draw" || signer.method === "upload")) {
        // Phase 1: Multi-signer signatures are ONLY images, never full PDFs
        // The "upload" method here refers to uploading a signature image, not a full waiver PDF
        const bucket = WAIVER_SIGNATURE_BUCKET; // Always use signature bucket for multi-signer assets
        const maxBytes = MAX_WAIVER_SIGNATURE_BYTES;
        const allowedTypes = ["image/png", "image/jpeg", "image/jpg"]; // Images only
        
        // Detect file extension from data URL for proper storage
        const parsed = parseDataUrl(signer.data);
        let fileExt = "png"; // default
        if (parsed?.contentType === "image/jpeg" || parsed?.contentType === "image/jpg") {
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
           console.error(`Error uploading signer asset (${signer.role_key}):`, uploadResult.error);
           return { error: `Failed to upload signature for ${signer.role_key}: ${uploadResult.error}` };
        }

        // Replace data with storage path
        processedSigner.data = uploadResult.path || "";
      }
      processedSigners.push(processedSigner);
    }

    signaturePayload = {
      ...rawPayload,
      signers: processedSigners
    };

    // Also populate legacy fields for primary signer/backward compat if reasonable?
    // Maybe not. Just set signature_type to 'multi-signer' and let UI handle it.
  }

  // Legacy/Single Signer Handling
  if (params.waiverSignature.signatureType === "draw") {
    if (!params.waiverSignature.signatureImageDataUrl) {
      return { error: "Signature drawing is required." };
    }

    const fileName = `waiver_${params.signupId}_${Date.now()}.png`;
    const uploadResult = await uploadWaiverAsset({
      bucket: WAIVER_SIGNATURE_BUCKET,
      dataUrl: params.waiverSignature.signatureImageDataUrl,
      fileName,
      maxBytes: MAX_WAIVER_SIGNATURE_BYTES,
      allowedTypes: ["image/png", "image/jpeg"],
    });

    if (uploadResult.error) {
      return { error: uploadResult.error };
    }

    signatureStoragePath = uploadResult.path || null;
  }

  if (params.waiverSignature.signatureType === "upload") {
    // Phase 1: Enforce upload permission server-side
    if (!waiverAllowUpload) {
      return { error: "Waiver upload is not allowed for this project." };
    }
    
    if (!params.waiverSignature.uploadFileDataUrl || !params.waiverSignature.uploadFileName) {
      return { error: "Signed waiver upload is required." };
    }

    const fileExt = params.waiverSignature.uploadFileName.split(".").pop() || "pdf";
    const fileName = `waiver_${params.signupId}_${Date.now()}.${fileExt}`;
    const uploadResult = await uploadWaiverAsset({
      bucket: WAIVER_UPLOAD_BUCKET,
      dataUrl: params.waiverSignature.uploadFileDataUrl,
      fileName,
      maxBytes: MAX_WAIVER_UPLOAD_BYTES,
      allowedTypes: ["application/pdf", "image/png", "image/jpeg"],
    });

    if (uploadResult.error) {
      return { error: uploadResult.error };
    }

    uploadStoragePath = uploadResult.path || null;
  }

  const signatureText =
    params.waiverSignature.signatureType === "typed"
      ? params.waiverSignature.signatureText?.trim() || params.signerName
      : params.waiverSignature.signatureType === "draw"
        ? params.signerName
        : null;

  const { error: insertError } = await serviceSupabase
    .from("waiver_signatures")
    .insert({
      waiver_template_id: templateId,
      waiver_definition_id: waiverDefinitionId,
      waiver_pdf_url: waiverPdfUrl,
      project_id: params.projectId,
      signup_id: params.signupId,
      user_id: params.userId ?? null,
      anonymous_id: params.anonymousId ?? null,
      signer_name: params.signerName,
      signer_email: params.signerEmail,
      signature_type: params.waiverSignature.signatureType,
      signature_text: signatureText,
      signature_storage_path: signatureStoragePath,
      upload_storage_path: uploadStoragePath,
      signature_payload: signaturePayload,
      form_data: params.waiverSignature.formData ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertError) {
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
    .select(`
      waiver_template_id,
      waiver_definition_id,
      waiver_pdf_url,
      signer_name,
      signer_email,
      signature_type,
      signature_text,
      signature_storage_path,
      upload_storage_path,
      signature_payload,
      form_data
    `)
    .eq("project_id", params.projectId)
    .eq("anonymous_id", params.anonymousId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching reusable anonymous waiver signature:", fetchError);
    return { error: "Failed to reuse existing waiver signature." };
  }

  if (!latestSignature) {
    return { error: "No existing waiver signature found for this anonymous profile." };
  }

  const { ipAddress, userAgent } = await getRequestMetadata();

  const { error: insertError } = await serviceSupabase
    .from("waiver_signatures")
    .insert({
      ...latestSignature,
      project_id: params.projectId,
      signup_id: params.signupId,
      user_id: null,
      anonymous_id: params.anonymousId,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertError) {
    console.error("Error cloning anonymous waiver signature:", insertError);
    return { error: "Failed to attach existing waiver signature to this signup." };
  }

  return { success: true };
}

export async function togglePauseSignups(projectId: string, pauseState: boolean) {
  const supabase = await createClient();

  try {
    // Check if user has permission
    const isAllowed = await isProjectCreator(projectId);

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
  waiverSignature?: WaiverSignatureInput | null
) {
  const supabase = await createClient();
  const isAnonymous = !!anonymousData;
  let createdSignupId: string | undefined = undefined; // Track the created signup ID
  let createdAnonymousSignupId: string | null = null;
  let createdNewAnonymousProfile = false;
  let shouldReuseExistingAnonymousWaiver = false;

  try {
    console.log("Starting signup process:", { projectId, scheduleId, isAnonymous });

    // Get project details
    const { project, error: projectError } = await getProject(projectId);

    if (!project || projectError) {
      return { error: "Project not found" };
    }

    const rawComment = (anonymousData?.comment ?? volunteerComment ?? "").trim();
    const normalizedComment = rawComment.length > 0 ? rawComment.slice(0, 1000) : null;
    const volunteerCommentToSave = project.enable_volunteer_comments ? normalizedComment : null;

    if (project.waiver_required && !waiverSignature && !isAnonymous) {
      return { error: "This project requires a waiver signature before signing up." };
    }

    if (waiverSignature) {
      const hasTemplateId = typeof waiverSignature.templateId === "string" && waiverSignature.templateId.trim().length > 0;
      const hasDefinitionId = typeof waiverSignature.definitionId === "string" && waiverSignature.definitionId.trim().length > 0;
      const hasWaiverPdfUrl = typeof waiverSignature.waiverPdfUrl === "string" && waiverSignature.waiverPdfUrl.trim().length > 0;

      if (!hasTemplateId && !hasDefinitionId && !hasWaiverPdfUrl) {
        return { error: "Waiver configuration is missing." };
      }

      if (
        waiverSignature.signatureType === "upload" &&
        project.waiver_allow_upload === false &&
        project.waiver_disable_esignature !== true
      ) {
        return { error: "Waiver uploads are not allowed for this project." };
      }

      if (waiverSignature.signatureType === "draw" && !waiverSignature.signatureImageDataUrl) {
        return { error: "Please draw your signature to continue." };
      }

      if (waiverSignature.signatureType === "typed" && !waiverSignature.signatureText?.trim()) {
        return { error: "Please type your signature to continue." };
      }

      if (waiverSignature.signatureType === "upload" && !waiverSignature.uploadFileDataUrl) {
        return { error: "Please upload a signed waiver to continue." };
      }

      // Phase 5: Validate waiver payload against definition
      if (waiverSignature.signatureType === "multi-signer" && waiverSignature.payload) {
        // Check if project has a waiver definition
        const waiverInfo = await getProjectWaiver(projectId);
        
        if ('error' in waiverInfo) {
          return { error: "Failed to load waiver configuration" };
        }

        const { definition } = waiverInfo;

        if (definition) {
          // Validate against waiver definition
          // Phase 4: Enable strict field validation as UI now collects fields
          const validationResult = validateWaiverPayload(waiverSignature.payload, definition, true);
          
          if (!validationResult.valid) {
            return {
              error: `Waiver validation failed: ${validationResult.errors.join(', ')}`
            };
          }

          // Log warnings if any
          if (validationResult.warnings && validationResult.warnings.length > 0) {
            console.warn('Waiver validation warnings:', validationResult.warnings);
          }
        } else {
          // Legacy system: Basic validation
          const validationResult = validateLegacyWaiverPayload(waiverSignature.payload);
          
          if (!validationResult.valid) {
            return {
              error: `Waiver validation failed: ${validationResult.errors.join(', ')}`
            };
          }
        }
      }
    }

    // Check if signups are paused
    if (project.pause_signups) {
      return { error: "Signups for this project are temporarily paused by the organizer" };
    }

    // Check if project is available for signup
    // Check if project is available for signup
    if (project.status === "cancelled") {
      return { error: "This project has been cancelled" };
    }

    if (project.status === "completed") {
      return { error: "This project has been completed" };
    }

    // --- Domain Restriction Check ---
    if (project.restrict_to_org_domains && project.organization?.allowed_email_domains && project.organization.allowed_email_domains.length > 0) {
      const allowedDomains = project.organization.allowed_email_domains as string[];
      let hasValidEmail = false;
      const userEmailToCheck = isAnonymous ? anonymousData?.email : (await getAuthUser()).user?.email;

      // Helper to check domain
      const checkDomain = (email: string) => {
        const domain = email.split('@')[1]?.toLowerCase();
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
              .from('user_emails')
              .select('email')
              .eq('user_id', user.id)
              .not('verified_at', 'is', null);

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
        return {
          error: `This project is restricted to users with the following email domains: ${allowedDomains.join(', ')}. Please use a verified email with one of these domains.`
        };
      }
    }

    // For multiDay events, validate that the specific day/slot hasn't passed
    if (project.event_type === "multiDay" && project.schedule.multiDay) {
      const parts = scheduleId.split("-");
      if (parts.length >= 2) {
        const slotIndexStr = parts.pop();
        const date = parts.join("-");

        const day = project.schedule.multiDay.find((d) => d.date === date);
        if (day && slotIndexStr) {
          const slotIdx = parseInt(slotIndexStr, 10);
          if (!isNaN(slotIdx) && slotIdx >= 0 && slotIdx < day.slots.length) {
            const slot = day.slots[slotIdx];
            const dayDate = parseISO(date);
            const [hours, minutes] = slot.endTime.split(':').map(Number);
            const slotEndDateTime = new Date(dayDate);
            slotEndDateTime.setHours(hours, minutes, 0, 0);

            if (isAfter(new Date(), slotEndDateTime)) {
              return { error: "This time slot has already passed" };
            }
          }
        }
      }
    }

    // Fix: Don't await getSlotDetails since it's no longer async
    const slotDetails = getSlotDetails(project, scheduleId);
    if (!slotDetails) {
      console.error("Invalid schedule slot:", { scheduleId, projectId });
      return { error: "Invalid schedule slot" };
    }

    // Check if slot is full (only count 'approved/attended' signups towards capacity)
    const currentSignups = await getCurrentSignups(projectId, scheduleId);
    console.log("Current signups:", { currentSignups, maxVolunteers: slotDetails.volunteers });

    if (currentSignups >= slotDetails.volunteers) {
      return { error: "This slot is full" };
    }

    // Handle user authentication using getClaims() for better performance
    const { user } = await getAuthUser();

    // If project requires login but user isn't logged in
    if (project.require_login && !user) {
      return { error: "You must be logged in to sign up for this project" };
    }

    // --- Check for existing signups ---
    if (user) { // Logged-in user check
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
          return { error: "You have been rejected for this project and cannot sign up again." };
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
        };

        const { data: insertedSignup, error: signupError } = await supabase
          .from("project_signups")
          .insert(signupData)
          .select()
          .single();

        if (signupError || !insertedSignup) {
          console.error("Error creating signup for registered user:", signupError);
          return { error: "Failed to sign up. Please try again." };
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
                userName: userProfile.full_name || 'Volunteer',
                projectDate: date,
                projectTime: timeRange,
                projectLocation: project.location,
                projectUrl
              }),
              userId: user.id,
              type: 'transactional' // Signup confirmation is transactional
            });

            if (emailError) {
              console.error("Error sending confirmation email to logged-in user:", emailError);
              // Don't fail the signup if email fails
            } else {
              console.log("Confirmation email sent to logged-in user successfully:", emailData);
            }
          }
        } catch (emailError) {
          console.error("Error in email sending process for logged-in user:", emailError);
          // Don't fail the signup if email fails
        }

        // Explicitly log success for debugging
        console.log("Successfully created signup for registered user:", {
          userId: user.id,
          projectId,
          scheduleId
        });

      } catch (error) {
        console.error("Error in user signup process:", error);
        return { error: "An error occurred during signup" };
      }
    } else if (isAnonymous && anonymousData) { // Anonymous user check
      const emailToCheck = (anonymousData.email ?? "").toLowerCase();
      console.log("Checking anonymous signup for email:", emailToCheck);

      // First, check if a registered Let's Assist account exists with this email using efficient RPC
      const { data: emailExists, error: rpcError } = await supabase
        .rpc('check_email_exists', { email_to_check: emailToCheck });

      if (rpcError) {
        console.error("Error checking for existing account:", rpcError);
        return { error: "An error occurred while checking email availability." };
      }

      if (emailExists) {
        return { error: "This email is associated with an existing Let's Assist account. Please log in to sign up for this project." };
      }

      // Check if an anonymous profile already exists for this email + project
      const { data: existingAnonProfile, error: anonLookupError } = await supabase
        .from('anonymous_signups')
        .select('id, confirmed_at, token')
        .eq('project_id', projectId)
        .ilike('email', emailToCheck)
        .maybeSingle();

      if (anonLookupError) {
        console.error("Error checking for existing anonymous signup:", anonLookupError);
        return { error: "An error occurred while checking signup status." };
      }

      // If profile exists, check if THIS specific slot already has a signup
      if (existingAnonProfile) {
        const { data: existingSlotSignup, error: slotError } = await supabase
          .from('project_signups')
          .select('id, status')
          .eq('project_id', projectId)
          .eq('schedule_id', scheduleId)
          .eq('anonymous_id', existingAnonProfile.id)
          .maybeSingle();

        if (slotError) {
          console.error("Error checking for existing slot signup:", slotError);
          return { error: "An error occurred while checking signup status." };
        }

        if (existingSlotSignup) {
          const signupStatus = existingSlotSignup.status;

          if (signupStatus === "pending") {
            return {
              error: "You've already signed up for this slot but haven't confirmed your email yet.",
              canResend: true,
              anonymousSignupId: existingAnonProfile.id
            };
          } else if (signupStatus === "approved") {
            return { error: "This email has already signed up and confirmed for this slot." };
          } else if (signupStatus === "rejected") {
            return { error: "This email has been rejected by the project coordinator. Contact them for more details." };
          }
        }

        if (project.waiver_required && !waiverSignature) {
          const { data: existingWaiver, error: existingWaiverError } = await supabase
            .from("waiver_signatures")
            .select("id")
            .eq("project_id", projectId)
            .eq("anonymous_id", existingAnonProfile.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingWaiverError) {
            console.error("Error checking existing anonymous waiver signature:", existingWaiverError);
            return { error: "Unable to verify existing waiver signature. Please try again." };
          }

          if (!existingWaiver) {
            return { error: "This project requires a waiver signature before signing up." };
          }

          shouldReuseExistingAnonymousWaiver = true;
        }

        // Reuse the existing anonymous profile for a new slot signup
        createdAnonymousSignupId = existingAnonProfile.id;

        // Determine status: if profile is already confirmed, auto-approve new slot signups
        const isProfileConfirmed = !!existingAnonProfile.confirmed_at;
        const newSignupStatus = isProfileConfirmed ? "approved" : "pending";

        const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
          project_id: projectId,
          schedule_id: scheduleId,
          user_id: null,
          status: newSignupStatus,
          anonymous_id: createdAnonymousSignupId,
          volunteer_comment: volunteerCommentToSave,
        };

        const { data: insertedProjectSignup, error: projectSignupInsertError } = await supabase
          .from("project_signups")
          .insert(projectSignupData)
          .select("id")
          .single();

        if (projectSignupInsertError || !insertedProjectSignup) {
          console.error("Error creating project signup for existing anon profile:", projectSignupInsertError);
          return { error: "Failed to complete signup. Please try again." };
        }

        createdSignupId = insertedProjectSignup.id;

        // If profile is already confirmed, send a simple notification about the new slot
        if (isProfileConfirmed && anonymousData.email) {
          const { date, timeRange, slotLabel } = getScheduleDetails(project, scheduleId);
          const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}`;
          try {
            await sendEmail({
              to: anonymousData.email,
              subject: `You're signed up for another slot in ${project.title}`,
              react: React.createElement(AnonymousSignupConfirmation, {
                confirmationUrl: anonymousProfileUrl, // Link to profile, not confirmation
                projectName: project.title,
                userName: anonymousData.name,
                anonymousProfileUrl,
                projectDate: date,
                projectTime: timeRange,
                slotLabel
              }),
              type: 'transactional'
            });
          } catch (error) {
            console.error("Error sending slot addition email:", error);
          }
        } else if (!isProfileConfirmed && anonymousData.email) {
          // Profile not yet confirmed — resend confirmation email with new token
          const newToken = crypto.randomUUID();
          await supabase
            .from("anonymous_signups")
            .update({ token: newToken })
            .eq("id", createdAnonymousSignupId);

          const confirmationUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}/confirm?token=${newToken}`;
          const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}`;
          const { date, timeRange, slotLabel } = getScheduleDetails(project, scheduleId);
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
                slotLabel
              }),
              type: 'transactional'
            });
          } catch (error) {
            console.error("Error sending confirmation email:", error);
          }
        }
      } else {
        if (project.waiver_required && !waiverSignature) {
          return { error: "This project requires a waiver signature before signing up." };
        }

        // No existing profile — create a new anonymous profile + project signup
        const confirmationToken = crypto.randomUUID();
        const anonSignupData = {
          project_id: projectId,
          email: anonymousData.email ?? "",
          name: anonymousData.name,
          phone_number: anonymousData.phone || null,
          token: confirmationToken,
        };

        console.log("Inserting anonSignupData:", anonSignupData);
        const { data: insertedAnonSignup, error: anonInsertError } = await supabase
          .from("anonymous_signups")
          .insert(anonSignupData)
          .select("id")
          .single();

        if (anonInsertError || !insertedAnonSignup) {
          console.error("Error creating anonymous signup record:", anonInsertError);
          return { error: "Failed to initiate anonymous signup. Please try again." };
        }
        createdAnonymousSignupId = insertedAnonSignup.id;
        createdNewAnonymousProfile = true;
        console.log("Anonymous Signup ID:", createdAnonymousSignupId);

        const projectSignupData: Omit<ProjectSignup, "id" | "created_at"> = {
          project_id: projectId,
          schedule_id: scheduleId,
          user_id: null,
          status: "pending", // New anonymous signups start as pending
          anonymous_id: createdAnonymousSignupId,
          volunteer_comment: volunteerCommentToSave,
        };

        const { data: insertedProjectSignup, error: projectSignupInsertError } = await supabase
          .from("project_signups")
          .insert(projectSignupData)
          .select("id")
          .single();

        if (projectSignupInsertError || !insertedProjectSignup) {
          console.error("Error creating project signup record for anonymous:", projectSignupInsertError);
          await supabase.from("anonymous_signups").delete().eq("id", createdAnonymousSignupId);
          return { error: "Failed to complete signup. Please try again." };
        }

        createdSignupId = insertedProjectSignup.id;

        // Send confirmation email
        if (anonymousData.email && confirmationToken && createdAnonymousSignupId) {
          const confirmationUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}/confirm?token=${confirmationToken}`;
          const anonymousProfileUrl = `${siteUrl}/anonymous/${createdAnonymousSignupId}`;
          const { date, timeRange, slotLabel } = getScheduleDetails(project, scheduleId);
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
                slotLabel
              }),
              type: 'transactional'
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
    } else if (user) {
      // Create project signup record for logged-in user (status 'approved')
      const signupData: Omit<ProjectSignup, "id" | "created_at"> = {
        project_id: projectId,
        schedule_id: scheduleId,
        user_id: (user as { id: string }).id,
        status: "approved", // Logged-in users are approved by default
        anonymous_id: null,
      };

      const { error: signupError } = await supabase
        .from("project_signups")
        .insert(signupData);

      if (signupError) {
        console.error("Error creating signup for registered user:", signupError);
        return { error: "Failed to sign up. Please try again." };
      }
    } else {
      // Should not happen if require_login logic is correct, but handle defensively
      return { error: "Cannot sign up without user login or anonymous details." };
    }

    if ((project.waiver_required || waiverSignature) && createdSignupId) {
      if (waiverSignature) {
        const userMetadata = user?.user_metadata as { full_name?: string } | undefined;
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
          const serviceSupabase = getAdminClient();
          await serviceSupabase.from("project_signups").delete().eq("id", createdSignupId);
          if (createdAnonymousSignupId && createdNewAnonymousProfile) {
            await serviceSupabase.from("anonymous_signups").delete().eq("id", createdAnonymousSignupId);
          }

          return { error: persistResult.error };
        }
      } else if (project.waiver_required && shouldReuseExistingAnonymousWaiver && createdAnonymousSignupId) {
        const cloneResult = await cloneAnonymousWaiverSignatureToSignup({
          projectId: project.id,
          anonymousId: createdAnonymousSignupId,
          signupId: createdSignupId,
        });

        if (cloneResult?.error) {
          const serviceSupabase = getAdminClient();
          await serviceSupabase.from("project_signups").delete().eq("id", createdSignupId);
          if (createdAnonymousSignupId && createdNewAnonymousProfile) {
            await serviceSupabase.from("anonymous_signups").delete().eq("id", createdAnonymousSignupId);
          }

          return { error: cloneResult.error };
        }
      } else if (project.waiver_required) {
        return { error: "Waiver signature is required before completing signup." };
      }
    }

    // --- Revalidate paths ---
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/signups`); // Revalidate signups page too
    if (project.organization_id) {
      revalidatePath(`/organization/${project.organization_id}`);
    }
    if (user) {
      revalidatePath(`/profile/${user.id}`);
    }

    // --- Return success with signup ID for calendar integration ---
    return {
      success: true,
      needsConfirmation: isAnonymous,
      signupId: createdSignupId,
      projectId: project.id
    };
  } catch (error) {
    console.error("Error in signUpForProject:", error);
    return { error: "An unexpected error occurred during signup." };
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
  signupId: string
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
    await NotificationService.createNotification({
      title: "Project Status Update",
      body: `Your signup to volunteer for "${projectTitle}" has been rejected`,
      type: "project_updates",
      severity: "warning",
      actionUrl: `/projects/${projectId}`,
      data: { projectId, signupId }
    }, userId);

    return { success: true };
  } catch (error) {
    console.error("Server notification error:", error);
    return { error: "Failed to send notification" };
  }
}

export async function cancelSignup(signupId: string, anonymousSignupId?: string) {
  const supabase = await createClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    // Get signup details, including anonymous_id
    const { data: signup, error: signupError } = await supabase
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
      // Verify the anonymous signup exists and matches
      const { data: anonSignup, error: anonError } = await supabase
        .from("anonymous_signups")
        .select("id")
        .eq("id", anonymousSignupId)
        .maybeSingle();

      if (!anonError && anonSignup) {
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
          .select("creator_id, organization_id")
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
          if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
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

    const { error: deleteError } = await supabase
      .from("project_signups")
      .delete()
      .eq("id", signupId);

    if (deleteError) {
      console.error("Failed to delete signup:", deleteError);
    } else {
      console.log("Signup record deleted successfully.");
    }

    // Optional: If it was an anonymous signup, maybe update the anonymous_signups table too?
    // e.g., mark it as cancelled? Depends on desired behavior.

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error cancelling signup:", error);
    return { error: "Failed to cancel signup" };
  }
}

export async function updateProjectStatus(
  projectId: string,
  newStatus: ProjectStatus,
  cancellationReason?: string
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
      return { error: "Project can only be cancelled within 24 hours of start time" };
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
      console.error("Error removing calendar event for cancelled project:", calendarError);
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
          { onConflict: "project_id" }
        );

      if (enqueueError) {
        if (process.env.NODE_ENV !== "test") {
          console.error("Error enqueueing project cancellation job:", enqueueError);
        }
        cancellationNotifications.error = "Failed to queue cancellation notifications.";
      } else {
        cancellationNotifications.enqueued = true;

        // Best-effort: kick the worker immediately, but don't block the user.
        // Cron should still run this periodically in production.
        const workerEnabled = process.env.PROJECT_CANCELLATION_WORKER_ENABLED === "true";
        const workerBaseUrl = process.env.NEXT_PUBLIC_SITE_URL;
        const workerToken = process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN;

        if (!workerEnabled) {
          cancellationNotifications.error = "Project cancellation worker is disabled.";
        } else if (workerBaseUrl && workerToken) {
          cancellationNotifications.triggerAttempted = true;
          void fetch(`${workerBaseUrl}/api/cron/project-cancellations`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${workerToken}`,
            },
          }).catch((err) => {
            if (process.env.NODE_ENV !== "test") {
              console.error("Failed to trigger project cancellation worker:", err);
            }
          });
        } else {
          cancellationNotifications.error = "Project cancellation worker is not configured.";
        }
      }
    } catch (notificationError) {
      if (process.env.NODE_ENV !== "test") {
        console.error("Error enqueueing project cancellation notifications:", notificationError);
      }
      cancellationNotifications.error = "Failed to queue cancellation notifications.";
      // Don't fail the cancellation if notifications queueing fails
    }
  }

  // Revalidate project pages
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/organization/${project.organization?.id}`);
  revalidatePath('/home');

  return { success: true, cancellationNotifications };
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

  // Delete project documents from storage if they exist
  if ((project.documents?.length ?? 0) > 0) {
    const { data: storageData } = await supabase.storage
      .from('project-documents')
      .list();

    if (storageData) {
      const projectFiles = storageData.filter(file =>
        file.name.startsWith(`project_${projectId}`)
      );

      if (projectFiles.length > 0) {
        await supabase.storage
          .from('project-documents')
          .remove(projectFiles.map(file => file.name));
      }
    }
  }

  // Delete cover image if it exists
  if (project.cover_image_url) {
    const fileName = project.cover_image_url.split('/').pop();
    if (fileName) {
      await supabase.storage
        .from('project-images')
        .remove([fileName]);
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
  revalidatePath('/home');
  if (project.organization) {
    revalidatePath(`/organization/${project.organization.id}`);
  }

  return { success: true };
}

export async function updateProject(projectId: string, updates: Partial<Project>) {
  try {
    const supabase = await createClient();

    // Get current user using getClaims() for better performance
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return { error: "Unauthorized" };
    }

    // Verify project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id, recurrence_parent_id, recurrence_rule")
      .eq("id", projectId)
      .single();

    if (!project || project.creator_id !== user.id) {
      return { error: "Unauthorized" };
    }

    const disablesRecurrence =
      Object.prototype.hasOwnProperty.call(updates, "recurrence_rule") &&
      updates.recurrence_rule === null;
    const isRecurringParent = !project.recurrence_parent_id && !!project.recurrence_rule;

    // Update the project
    const { error: updateError } = await supabase
      .from("projects")
      .update(updates)
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
  signupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    // Get the signup to verify it exists
    const { data: signup, error: fetchError } = await supabase
      .from("project_signups")
      .select("id, project_id")
      .eq("id", signupId)
      .single();

    if (fetchError || !signup) {
      return {
        success: false,
        error: "Signup record not found"
      };
    }

    // Update the check-in time
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({ check_in_time: now })
      .eq("id", signupId);

    if (updateError) {
      return {
        success: false,
        error: "Failed to update check-in time"
      };
    }

    // Revalidate the project page to reflect the changes
    revalidatePath(`/projects/${signup.project_id}`);

    return { success: true };
  } catch (error) {
    console.error("Error checking in participant:", error);
    return {
      success: false,
      error: "An unexpected error occurred"
    };
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
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching profile:', profileError);
      return { error: "Failed to fetch profile" };
    }

    return {
      profile: {
        full_name: profile.full_name || null,
        email: user.email || null,
        phone: profile.phone || null,
      }
    };
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return { error: "An unexpected error occurred" };
  }
}

export async function getWaiverDownloadUrl(signupId: string, anonymousSignupId?: string) {
  const supabase = await createClient();

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

    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("id, user_id, anonymous_id, project:projects(creator_id, organization_id)")
      .eq("id", signupId)
      .single() as { data: SignupForWaiver | null; error: { message?: string } | null };

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
      const { data: anonSignup, error: anonError } = await supabase
        .from("anonymous_signups")
        .select("id")
        .eq("id", anonymousSignupId)
        .maybeSingle();

      if (!anonError && anonSignup) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return { error: "Unauthorized" };
    }

    const serviceSupabase = getAdminClient();
    const { data: waiverSignature, error: waiverError } = await serviceSupabase
      .from("waiver_signatures")
      .select("id, signature_type, signature_storage_path, upload_storage_path, signature_payload, signature_text, signed_at, signer_name")
      .eq("signup_id", signupId)
      .maybeSingle();

    if (waiverError || !waiverSignature) {
      return { error: "Waiver signature not found" };
    }

    // Priority 1: Offline upload (direct file)
    if (waiverSignature.upload_storage_path) {
      const { data: signedUrl, error: urlError } = await serviceSupabase.storage
        .from(WAIVER_UPLOAD_BUCKET)
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
    if (waiverSignature.signature_text || waiverSignature.signature_type === 'typed') {
      return { 
        signatureId: waiverSignature.id,
        signature: waiverSignature 
      };
    }

    return { error: "No waiver data available" };
  } catch (error) {
    console.error("Error generating waiver download URL:", error);
    return { error: "Failed to generate waiver URL" };
  }
}

export async function getAnonymousWaiverSignatureMeta(signupId: string, anonymousSignupId: string): Promise<
  | { signatureId: string; signature_type: string | null; signed_at: string | null }
  | { signatureId: null; signature_type: null; signed_at: null }
  | { error: string }
> {
  const supabase = await createClient();

  try {
    // Anonymous-only helper: verify the anonymous signup owns this project_signup.
    const { data: signup, error: signupError } = await supabase
      .from('project_signups')
      .select('id, anonymous_id')
      .eq('id', signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return { error: 'Signup not found' };
    }

    if (!signup.anonymous_id || signup.anonymous_id !== anonymousSignupId) {
      return { error: 'Unauthorized' };
    }

    const { data: anonSignup, error: anonError } = await supabase
      .from('anonymous_signups')
      .select('id')
      .eq('id', anonymousSignupId)
      .maybeSingle();

    if (anonError || !anonSignup) {
      return { error: 'Unauthorized' };
    }

    const admin = getAdminClient();
    const { data: sig, error: sigError } = await admin
      .from('waiver_signatures')
      .select('id, signature_type, signed_at')
      .eq('signup_id', signupId)
      .order('signed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sigError) {
      console.error('Error loading anonymous waiver signature meta:', sigError);
      return { error: 'Failed to load waiver' };
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
    console.error('Error in getAnonymousWaiverSignatureMeta:', error);
    return { error: 'Failed to load waiver' };
  }
}

export async function getMyWaiverSignatures(projectId: string): Promise<
  | { signatures: Array<{ id: string; signed_at: string | null; created_at: string }> }
  | { error: string }
> {
  try {
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return { error: 'Not authenticated' };
    }

    const admin = getAdminClient();

    const { data, error } = await admin
      .from('waiver_signatures')
      .select(`
        id,
        signed_at,
        created_at
      `)
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .order('signed_at', { ascending: false });

    if (error) {
      console.error('Error fetching my waiver signatures:', error);
      return { error: 'Failed to load waivers' };
    }

    return { signatures: (data ?? []) as any };
  } catch (error) {
    console.error('Error in getMyWaiverSignatures:', error);
    return { error: 'Failed to load waivers' };
  }
}

/**
 * Resend confirmation email for an anonymous signup
 * @param anonymousSignupId - The ID of the anonymous signup record
 * @returns Object with success or error message
 */
export async function resendAnonymousConfirmationEmail(anonymousSignupId: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();

  try {
    // Rate limiting: check if we've sent an email in the last 60 seconds
    // We'll use the token's creation pattern - regenerating token means new email
    const { data: anonSignup, error: fetchError } = await supabase
      .from("anonymous_signups")
      .select("id, email, name, project_id, confirmed_at, token, created_at")
      .eq("id", anonymousSignupId)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching anonymous signup:", fetchError);
      return { error: "Failed to find signup record." };
    }

    if (!anonSignup) {
      return { error: "Signup record not found." };
    }

    // Check if already confirmed
    if (anonSignup.confirmed_at) {
      return { error: "This signup has already been confirmed." };
    }

    // Get project title for the email
    const { data: project, error: projectError } = await supabase
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
    const { error: updateError } = await supabase
      .from("anonymous_signups")
      .update({ token: newToken })
      .eq("id", anonymousSignupId);

    if (updateError) {
      console.error("Error updating token:", updateError);
      return { error: "Failed to generate new confirmation link." };
    }

    // Send the confirmation email
    const confirmationUrl = `${siteUrl}/anonymous/${anonymousSignupId}/confirm?token=${newToken}`;
    const anonymousProfileUrl = `${siteUrl}/anonymous/${anonymousSignupId}`;

    const { data: signupRecord } = await supabase
      .from("project_signups")
      .select("schedule_id")
      .eq("anonymous_id", anonymousSignupId)
      .maybeSingle();

    const scheduleId = signupRecord?.schedule_id;
    const scheduleDetails = scheduleId
      ? getScheduleDetails(project as Project, scheduleId)
      : { date: "TBD", time: "TBD", timeRange: "TBD", slotLabel: "TBD" };

    const { error: emailError } = await sendEmail({
      to: anonSignup.email,
      subject: `Confirm your signup for ${project.title}`,
      react: React.createElement(AnonymousSignupConfirmation, {
        confirmationUrl,
        projectName: project.title,
        userName: anonSignup.name,
        anonymousProfileUrl,
        projectDate: scheduleDetails.date,
        projectTime: scheduleDetails.timeRange,
        slotLabel: scheduleDetails.slotLabel
      }),
      type: 'transactional'
    });

    if (emailError) {
      console.error("Error sending confirmation email:", emailError);
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
  definition?: any;
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
    const { data: definition, error } = await supabase
      .from("waiver_definitions")
      .select(`
        *,
        signers:waiver_definition_signers(*),
        fields:waiver_definition_fields(*)
      `)
      .eq("id", project.waiver_definition_id)
      .single();

    if (error) {
      console.error("Error fetching waiver definition:", error);
      return { success: false, error: "Failed to fetch waiver definition" };
    }

    return { success: true, definition };
  } catch (error) {
    console.error("Error in getWaiverDefinition:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// Save waiver definition for a project
export async function saveWaiverDefinition(
  projectId: string,
  definitionInput: any
): Promise<{ success: boolean; definitionId?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser();

    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    // Check if user is project creator
    const creator = await isProjectCreator(projectId);
    if (!creator) {
      return { success: false, error: "Only project creator can configure waivers" };
    }

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
    let definitionId = project.waiver_definition_id;

    // If definition exists, update it; otherwise create new
    if (definitionId) {
      // Update existing definition
      const { error: updateError } = await serviceSupabase
        .from("waiver_definitions")
        .update({
          title: definitionInput.title || "Project Waiver",
          updated_at: new Date().toISOString(),
        })
        .eq("id", definitionId);

      if (updateError) {
        console.error("Error updating waiver definition:", updateError);
        return { success: false, error: "Failed to update waiver definition" };
      }

      // Delete existing signers and fields
      await serviceSupabase
        .from("waiver_definition_signers")
        .delete()
        .eq("waiver_definition_id", definitionId);

      await serviceSupabase
        .from("waiver_definition_fields")
        .delete()
        .eq("waiver_definition_id", definitionId);
    } else {
      // Create new definition
      const { data: newDef, error: createError } = await serviceSupabase
        .from("waiver_definitions")
        .insert({
          scope: "project",
          project_id: projectId,
          title: definitionInput.title || "Project Waiver",
          version: 1,
          active: true,
          pdf_storage_path: project.waiver_pdf_storage_path,
          pdf_public_url: project.waiver_pdf_url,
          source: "project_pdf",
          created_by: user.id,
        })
        .select("id")
        .single();

      if (createError) {
        console.error("Error creating waiver definition:", createError);
        return { success: false, error: "Failed to create waiver definition" };
      }

      definitionId = newDef.id;

      // Link project to definition
      await supabase
        .from("projects")
        .update({ waiver_definition_id: definitionId })
        .eq("id", projectId);
    }

    // Insert signers
    if (definitionInput.signers && definitionInput.signers.length > 0) {
      const signersToInsert = definitionInput.signers.map((signer: any, index: number) => ({
        waiver_definition_id: definitionId,
        role_key: signer.roleKey,
        label: signer.label,
        required: signer.required ?? true,
        order_index: signer.orderIndex ?? index,
        rules: signer.rules || null,
      }));

      const { error: signersError } = await serviceSupabase
        .from("waiver_definition_signers")
        .insert(signersToInsert);

      if (signersError) {
        console.error("Error inserting waiver signers:", signersError);
        return { success: false, error: "Failed to save signer configuration" };
      }
    }

    // Insert fields
    if (definitionInput.fields) {
      const fieldsToInsert: any[] = [];

      // Process detected field mappings
      if (definitionInput.fields.detected) {
        const detectedFieldMappings = Object.entries(definitionInput.fields.detected).map(([fieldKey, mapping]: [string, any]) => ({
          fieldKey: mapping.fieldKey || fieldKey,
          fieldType: mapping.fieldType || "text",
          pageIndex: mapping.pageIndex,
          rect: mapping.rect,
          pdfFieldName: mapping.pdfFieldName || fieldKey,
          label: mapping.label || fieldKey,
          required: mapping.required ?? false,
          signerRoleKey: mapping.signerRoleKey || undefined,
        }));
        
        const detectedFields = mapDetectedFieldsForDb(definitionId, detectedFieldMappings);
        fieldsToInsert.push(...detectedFields);
      }

      // Process custom signature placements
      if (definitionInput.fields.custom && definitionInput.fields.custom.length > 0) {
        const customPlacements = definitionInput.fields.custom.map((field: any) => ({
          id: field.id || field.fieldKey,
          label: field.label || undefined,
          fieldType: field.fieldType || "signature",
          pageIndex: field.pageIndex,
          rect: field.rect,
          signerRoleKey: field.signerRoleKey || undefined,
          required: field.required ?? undefined,
        }));
        
        const customFields = mapCustomPlacementsForDb(definitionId, customPlacements);
        fieldsToInsert.push(...customFields);
      }

      // Insert all fields
      if (fieldsToInsert.length > 0) {
        const { error: initialFieldsError } = await serviceSupabase
          .from("waiver_definition_fields")
          .insert(fieldsToInsert);

        let fieldsError = initialFieldsError;

        // Backward compatibility: some environments still enforce a narrower
        // field_type check constraint than the app-level waiver field taxonomy.
        if (fieldsError && isWaiverFieldTypeConstraintError(fieldsError)) {
          const { normalizedFields, changed } = toLegacyCompatibleWaiverFields(
            fieldsToInsert as Array<Record<string, unknown>>
          );

          if (changed) {
            const { error: retryFieldsError } = await serviceSupabase
              .from("waiver_definition_fields")
              .insert(normalizedFields);

            if (!retryFieldsError) {
              console.warn("Waiver fields saved with legacy field_type compatibility mapping", {
                projectId,
                definitionId,
              });
            }

            fieldsError = retryFieldsError;
          }
        }

        if (fieldsError) {
          console.error("Error inserting waiver fields:", fieldsError);
          return { success: false, error: "Failed to save field configuration" };
        }
      }
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true, definitionId };
  } catch (error) {
    console.error("Error in saveWaiverDefinition:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

