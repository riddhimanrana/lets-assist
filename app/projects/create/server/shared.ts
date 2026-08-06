import "server-only";

import { sanitizeRichTextHtml } from "@/lib/security/html.server";
import type { EventFormState } from "@/hooks/use-event-form";

export const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];

export type UploadedProjectDocument = {
  name: string;
  originalName: string;
  type: string;
  size: number;
  url: string;
};

export function sanitizeDraftData(
  projectData: Partial<EventFormState>,
): Partial<EventFormState> {
  const sanitizedDescription =
    typeof projectData.basicInfo?.description === "string"
      ? sanitizeRichTextHtml(projectData.basicInfo.description)
      : projectData.basicInfo?.description;

  return {
    ...projectData,
    basicInfo: projectData.basicInfo
      ? {
          ...projectData.basicInfo,
          ...(typeof sanitizedDescription === "string"
            ? { description: sanitizedDescription }
            : {}),
        }
      : projectData.basicInfo,
    // Persist waiver configuration, but never persist uploaded PDF/file-specific data in drafts.
    waiverPdfFile: null,
    waiverPdfUrl: null,
    waiverPdfValidation: null,
    pluginData: projectData.pluginData || {},
  };
}

export function isMissingProjectColumnError(
  error: unknown,
  columnName: string,
): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };

  const combined =
    `${pgError.message ?? ""} ${pgError.details ?? ""} ${pgError.hint ?? ""}`.toLowerCase();
  const referencesColumn = combined.includes(columnName.toLowerCase());
  const schemaCacheLike =
    combined.includes("schema cache") ||
    combined.includes("could not find") ||
    combined.includes("column");
  const knownCode = pgError.code === "PGRST204" || pgError.code === "42703";

  return referencesColumn && (knownCode || schemaCacheLike);
}

export function isMissingWaiverDisableEsignatureColumnError(
  error: unknown,
): boolean {
  return isMissingProjectColumnError(error, "waiver_disable_esignature");
}

export function isMissingSignupFormSchemaColumnError(error: unknown): boolean {
  return isMissingProjectColumnError(error, "signup_form_schema");
}

export function omitProjectColumns(
  payload: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> {
  const next = { ...payload };

  for (const column of columns) {
    delete next[column];
  }

  return next;
}

export function normalizeRequireLoginForVerificationMethod(
  verificationMethod: EventFormState["verificationMethod"] | undefined,
  requireLogin: boolean,
) {
  return verificationMethod === "signup-only" ? false : requireLogin;
}

// Helper function to check if date/time is in the past, using user's local time
export const _isDateTimeInPast = (
  date: string,
  time: string,
  userNow: Date,
): boolean => {
  const [hours, minutes] = time.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);

  const datetime = new Date(year, month - 1, day);
  datetime.setHours(hours, minutes, 0, 0);

  return datetime < userNow;
};
