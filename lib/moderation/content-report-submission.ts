import { createHash } from "node:crypto";

import { z } from "zod";

import {
  escapeReportMetadataMarkers,
  resolveSafeReportPath,
  sanitizeReportBody,
  sanitizeReportLine,
} from "@/lib/moderation/report-description";

/**
 * Pure input boundary for `POST /api/report-content`.
 *
 * Everything here is deterministic and free of request-ambient state so the
 * route, the service, and the tests all agree on exactly one interpretation of
 * a submitted report.
 */

export const MAX_CONTENT_REPORT_BODY_BYTES = 16 * 1024;

/**
 * Targets the moderation queue can actually act on.
 *
 * This is also the complete set of reportable types the API advertises. The
 * enum used to include `comment`, `image`, and `other`, none of which resolve
 * to a relation or to any moderator action, so every such submission was
 * accepted by the schema and then refused a step later. The database keeps its
 * historical `content_type` check so pre-existing rows stay readable.
 */
export const CONTENT_REPORT_TARGET_RELATIONS = {
  project: "projects",
  profile: "profiles",
  organization: "organizations",
} as const;

export type ResolvableContentReportType =
  keyof typeof CONTENT_REPORT_TARGET_RELATIONS;

export function isResolvableContentType(
  contentType: string,
): contentType is ResolvableContentReportType {
  return contentType in CONTENT_REPORT_TARGET_RELATIONS;
}

const boundedMetadataText = (max: number) => z.string().trim().min(1).max(max);

export const contentReportSchema = z
  .object({
    contentType: z.enum(["project", "profile", "organization"]),
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

/**
 * Reporter prose, with its line structure kept and every marker neutralized.
 *
 * Sanitization runs before escaping, and the escape itself is
 * whitespace-tolerant, so a label split across a newline, a tab, or several
 * spaces cannot survive into a line the dashboard would read as metadata.
 */
function reportBodyText(value: string): string {
  return escapeReportMetadataMarkers(sanitizeReportBody(value));
}

/**
 * A single metadata value.
 *
 * Collapsing must happen before escaping. Escaping first and collapsing after
 * is what let `Content\nURL: https://evil.test` become a real marker: the
 * escape saw no label, and the collapse then manufactured one.
 */
function reportLineText(value: string): string {
  return escapeReportMetadataMarkers(sanitizeReportLine(value));
}

/** C0/C1 controls plus the bidi and zero-width characters used to disguise a host. */
const DISALLOWED_URL_CODE_POINT_RANGES: ReadonlyArray<
  readonly [number, number]
> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function hasDisallowedUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      DISALLOWED_URL_CODE_POINT_RANGES.some(
        ([start, end]) => codePoint >= start && codePoint <= end,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Reduce a reported location to a path on the trusted application origin.
 *
 * `trustedOrigin` is resolved from configuration by the caller, never from
 * `Host`, `X-Forwarded-Host`, or `request.url`: behind Vercel and any other
 * proxy those are attacker-influenced, and a report that stored an
 * attacker-chosen absolute URL would put a clickable off-origin link in the
 * moderation dashboard. Storing a relative path also keeps evidence valid
 * across origin changes.
 *
 * The location is corroborating detail, not the subject of the report: the
 * target type and identifier are authoritative and are what moderators act on.
 * So a location that is merely *not* the canonical origin is dropped rather
 * than fatal. The browser always sends `window.location.href`, which on a
 * Vercel preview, branch, or custom alias is legitimately a different origin
 * than the configured one; refusing those turned every report filed from an
 * alias into a `400`. Genuinely hostile spellings — control or bidi
 * characters, an authority-relative path, a non-HTTP scheme, embedded
 * credentials — are still refused outright, because there is no benign reading
 * of them.
 */
export function normalizeReportedContentUrl(
  value: string | undefined,
  trustedOrigin: string,
): string | undefined {
  if (value === undefined) return undefined;

  const candidate = value.trim();
  if (!candidate) return undefined;
  if (hasDisallowedUrlCharacter(candidate)) {
    throw new ContentReportBodyError("invalid");
  }
  // `\\evil.test` and `//evil.test` are authority-relative, not path-relative.
  if (candidate.startsWith("//") || candidate.includes("\\")) {
    throw new ContentReportBodyError("invalid");
  }

  const base = new URL(trustedOrigin);
  let parsed: URL;
  try {
    parsed = new URL(candidate, base);
  } catch {
    throw new ContentReportBodyError("invalid");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ContentReportBodyError("invalid");
  }
  if (parsed.username || parsed.password) {
    throw new ContentReportBodyError("invalid");
  }
  // `URL` has already punycoded any confusable host, so origin equality is
  // exact rather than visual. A different origin is simply not something this
  // deployment can vouch for, so nothing is stored for it.
  if (parsed.origin !== base.origin) return undefined;

  return resolveSafeReportPath(
    `${parsed.pathname}${parsed.search}${parsed.hash}`,
  );
}

export function buildReportDescription(
  input: ContentReportSubmission,
  normalizedUrl: string | undefined,
): string {
  const details = [reportBodyText(input.description)];
  if (normalizedUrl) details.push(`\n\nContent URL: ${normalizedUrl}`);
  if (input.metadata?.title) {
    details.push(`\nContent Title: ${reportLineText(input.metadata.title)}`);
  }
  if (input.metadata?.creator) {
    details.push(
      `\nContent Creator: ${reportLineText(input.metadata.creator)}`,
    );
  }
  if (input.metadata?.context) {
    details.push(`\nContext: ${reportLineText(input.metadata.context)}`);
  }
  if (input.metadata?.reportedAt) {
    details.push(`\nReported at: ${input.metadata.reportedAt}`);
  }
  return details.join("");
}

/**
 * The substance of one report, as a stable digest.
 *
 * It identifies *what* was reported by *whom*, and deliberately carries no
 * time component: `metadata.reportedAt` is a client clock reading that changes
 * on every attempt, and no client value may decide how long a retry keeps
 * replaying. The database pairs this fingerprint with its own clock to bound
 * the replay window (see `CONTENT_REPORT_REPLAY_WINDOW_SECONDS`), so a network
 * retry resolves to the report that already exists while an identical report
 * filed after the window — for instance because the first one was reviewed and
 * dismissed — is still allowed to become a new report.
 */
export function buildContentReportFingerprint(input: {
  reporterId: string;
  submission: ContentReportSubmission;
  normalizedUrl: string | undefined;
}): string {
  const { reporterId, submission, normalizedUrl } = input;
  const canonical = JSON.stringify([
    "content-report.v1",
    reporterId,
    submission.contentType,
    submission.contentId,
    submission.reason,
    submission.description,
    normalizedUrl ?? null,
    submission.metadata?.title ?? null,
    submission.metadata?.creator ?? null,
    submission.metadata?.context ?? null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
