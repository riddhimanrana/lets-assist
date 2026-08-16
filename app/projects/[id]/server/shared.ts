import "server-only";
import {
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
} from "@/utils/project";
import { type Project } from "@/types";
import { headers } from "next/headers";
import { getAdminClient } from "@/lib/supabase/admin";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";
import { enqueueOrphanedWaiverEvidence } from "@/lib/waiver/cleanup-storage";
import { resolveWaiverSignerIdentity } from "@/lib/waiver/signer-identity";

// Define your site URL (replace with environment variable ideally)
export { resolveWaiverSignerIdentity };

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export function formatTimeTo12Hour(timeStr: string | undefined): string {
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

export function parseLocalDate(dateStr: string): Date {
  // Parse date string "YYYY-MM-DD" as a local date, not UTC
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateWithWeekday(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const WAIVER_SIGNATURE_BUCKET = "waiver-signatures";

export const WAIVER_UPLOAD_BUCKET = "waiver-uploads";

export const MAX_WAIVER_SIGNATURE_BYTES = 2 * 1024 * 1024;

// 2MB
export const MAX_WAIVER_UPLOAD_BYTES = 10 * 1024 * 1024;

// 10MB

export type PostgrestErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

export function isMissingWaiverDisableEsignatureColumnError(
  error: unknown,
): boolean {
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

export function summarizePostgrestError(error: unknown) {
  if (!error || typeof error !== "object") return error;

  const pgError = error as PostgrestErrorLike;
  return {
    code: pgError.code,
    message: pgError.message,
    details: pgError.details,
    hint: pgError.hint,
  };
}

export function logSignupDebug(
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

export function getProjectSignupInsertErrorMessage(error: unknown): string {
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
  if (code === "project_unpublished") {
    return "This project is not open for signups yet.";
  }
  if (code === "invalid_slot") {
    return "This project slot is no longer available.";
  }
  if (code === "waiver_required") {
    return "This project requires a waiver signature before signing up.";
  }
  if (code === "identity_conflict") {
    // The guest profile for this email was created by another request while
    // this one was in flight. Nothing is signed up yet and a retry picks up
    // that profile, so this is genuinely retryable.
    return "Another signup for this email is still being processed. Please try again in a moment.";
  }
  if (code === "conflicting_identity") {
    return "We could not confirm who is signing up. Please reload and try again.";
  }

  return "Failed to sign up. Please try again.";
}

/**
 * The waiver evidence row exactly as the database stores it. Project, signup,
 * and actor identity are supplied separately by the transaction and are never
 * read from this record.
 */
export type WaiverSignatureRecord = {
  waiver_definition_id: string | null;
  waiver_pdf_url: string | null;
  waiver_pdf_storage_path: string | null;
  signer_name: string;
  signer_email: string;
  signature_type: string;
  signature_text: string | null;
  signature_storage_path: string | null;
  upload_storage_path: string | null;
  signature_payload: Record<string, unknown> | null;
  form_data: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
};

export type AnonymousProfileInput = {
  email: string;
  name: string | null;
  phone_number: string | null;
  token: string;
  confirmed: boolean;
};

export type AtomicSignupInsert = {
  id: string;
  anonymousId: string | null;
  waiverSignatureId: string | null;
};

/**
 * Creates the guest identity (when supplied), the capacity-checked signup row,
 * and the waiver evidence row in one database transaction.
 *
 * The transaction is the integrity boundary: a refusal or a crash anywhere in
 * it leaves no approved or pending signup and consumes no capacity, so no
 * caller has to compensate with a delete.
 */
export async function insertProjectSignupAtomically(
  signupData: Record<string, unknown>,
  traceId?: string,
  options?: {
    waiver?: WaiverSignatureRecord | null;
    anonymousProfile?: AnonymousProfileInput | null;
  },
): Promise<{ data: AtomicSignupInsert | null; error: unknown | null }> {
  const waiver = options?.waiver ?? null;
  const anonymousProfile = options?.anonymousProfile ?? null;

  if (traceId) {
    logSignupDebug(traceId, "project_signup_atomic_insert_attempt", {
      hasResponseData: signupData.response_data != null,
      projectId: signupData.project_id,
      scheduleId: signupData.schedule_id,
      status: signupData.status,
      isAnonymous:
        Boolean(signupData.anonymous_id) || Boolean(anonymousProfile),
      hasUser: Boolean(signupData.user_id),
      hasWaiverEvidence: Boolean(waiver),
      createsGuestIdentity: Boolean(anonymousProfile),
    });
  }

  const serviceSupabase = getAdminClient();
  const { data, error } = await serviceSupabase.rpc(
    "insert_project_signup_with_waiver",
    {
      p_project_id: signupData.project_id ?? null,
      p_schedule_id: signupData.schedule_id ?? null,
      p_user_id: signupData.user_id ?? null,
      p_anonymous_id: signupData.anonymous_id ?? null,
      p_status: signupData.status ?? null,
      p_volunteer_comment: signupData.volunteer_comment ?? null,
      p_response_data: signupData.response_data ?? null,
      p_waiver: waiver,
      p_anonymous_profile: anonymousProfile,
    },
  );

  type AtomicSignupInsertRow = {
    signup_id: string | null;
    anonymous_signup_id: string | null;
    waiver_signature_id: string | null;
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
      persistedWaiverEvidence: Boolean(result.waiver_signature_id),
    });
  }
  return {
    data: {
      id: result.signup_id,
      anonymousId: result.anonymous_signup_id ?? null,
      waiverSignatureId: result.waiver_signature_id ?? null,
    },
    error: null,
  };
}

export type ParsedDataUrl = {
  contentType: string;
  buffer: Buffer;
  size: number;
};

export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return null;
  const contentType = matches[1];
  const base64 = matches[2];
  const buffer = Buffer.from(base64, "base64");
  return { contentType, buffer, size: buffer.length };
}

export async function getRequestMetadata() {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp || null;
  const userAgent = requestHeaders.get("user-agent");

  return { ipAddress, userAgent };
}

export async function validateAnonymousSignupCaptcha(
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
export function getScheduleDetails(project: Project, scheduleId: string) {
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

/**
 * Queues signature assets whose signup transaction did not commit.
 *
 * Correctness does not depend on this running: the rolled-back transaction
 * already left no signup, no capacity, and no evidence row, so these objects
 * are unreferenced. Failing to queue them costs storage, never integrity.
 */
export async function releaseUncommittedWaiverEvidence(
  objectPaths: string[],
  traceId?: string,
): Promise<void> {
  if (objectPaths.length === 0) return;

  const serviceSupabase = getAdminClient();
  const { error } = await enqueueOrphanedWaiverEvidence(
    async (rows) =>
      await serviceSupabase
        .from("waiver_storage_deletion_queue")
        .upsert(rows, { onConflict: "bucket_id,object_path" }),
    objectPaths,
  );

  if (error && traceId) {
    logSignupDebug(traceId, "uncommitted_waiver_evidence_queue_failed", {
      objectCount: objectPaths.length,
    });
  }
}
