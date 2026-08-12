import { z } from "zod";

const REPORT_METADATA_LABELS = [
  "Content URL:",
  "Content Title:",
  "Content Creator:",
  "Context:",
  "Reported at:",
] as const;

export const MAX_CONTENT_REPORT_BODY_BYTES = 16 * 1024;

const boundedMetadataText = (max: number) => z.string().trim().min(1).max(max);

export const contentReportSchema = z
  .object({
    contentType: z.enum([
      "project",
      "profile",
      "comment",
      "image",
      "organization",
      "other",
    ]),
    contentId: z.uuid(),
    reason: z.enum([
      "spam",
      "harassment",
      "inappropriate_content",
      "misinformation",
      "copyright",
      "privacy_violation",
      "violence",
      "hate_speech",
      "other",
    ]),
    description: z.string().trim().min(10).max(1_000),
    url: z.string().trim().min(1).max(2_048).optional(),
    metadata: z
      .object({
        title: boundedMetadataText(200).optional(),
        creator: boundedMetadataText(200).optional(),
        context: boundedMetadataText(500).optional(),
        reportedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ContentReportSubmission = z.infer<typeof contentReportSchema>;

export class ContentReportBodyError extends Error {
  constructor(readonly code: "invalid" | "too_large") {
    super(code);
    this.name = "ContentReportBodyError";
  }
}

export async function readBoundedContentReportBody(
  request: Request,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new ContentReportBodyError("invalid");
    }
    if (Number(declaredLength) > MAX_CONTENT_REPORT_BODY_BYTES) {
      throw new ContentReportBodyError("too_large");
    }
  }

  if (!request.body) throw new ContentReportBodyError("invalid");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CONTENT_REPORT_BODY_BYTES) {
        await reader.cancel("content report body exceeded the byte limit");
        throw new ContentReportBodyError("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ContentReportBodyError("invalid");
  }
}

function escapeMetadataMarkers(value: string): string {
  let escaped = value;
  for (const label of REPORT_METADATA_LABELS) {
    escaped = escaped.replaceAll(label, `${label.slice(0, -1)}﹕`);
  }
  return escaped;
}

function oneLineMetadata(value: string): string {
  return escapeMetadataMarkers(value).replace(/\s+/gu, " ").trim();
}

export function normalizeReportedContentUrl(
  value: string | undefined,
  requestUrl: string,
): string | undefined {
  if (!value) return undefined;

  const requestOrigin = new URL(requestUrl).origin;
  const parsed = new URL(value, requestOrigin);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== requestOrigin
  ) {
    throw new ContentReportBodyError("invalid");
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function buildReportDescription(
  input: ContentReportSubmission,
  normalizedUrl: string | undefined,
): string {
  const details = [escapeMetadataMarkers(input.description)];
  if (normalizedUrl) details.push(`\n\nContent URL: ${normalizedUrl}`);
  if (input.metadata?.title) {
    details.push(`\nContent Title: ${oneLineMetadata(input.metadata.title)}`);
  }
  if (input.metadata?.creator) {
    details.push(
      `\nContent Creator: ${oneLineMetadata(input.metadata.creator)}`,
    );
  }
  if (input.metadata?.context) {
    details.push(`\nContext: ${oneLineMetadata(input.metadata.context)}`);
  }
  if (input.metadata?.reportedAt) {
    details.push(`\nReported at: ${input.metadata.reportedAt}`);
  }
  return details.join("");
}
