import "server-only";
import {
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
} from "@/utils/project";
import { type Project } from "@/types";
import { headers } from "next/headers";
import { getAdminClient } from "@/lib/supabase/admin";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";

// Define your site URL (replace with environment variable ideally)
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
  if (code === "invalid_slot") {
    return "This project slot is no longer available.";
  }

  return "Failed to sign up. Please try again.";
}

export async function insertProjectSignupAtomically(
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
