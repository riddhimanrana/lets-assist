/**
 * The one shared definition of the moderation report description format.
 *
 * A stored report body is plain text with an optional block of server-composed
 * metadata lines appended to the reporter's own notes. Composition (the API
 * boundary) and parsing (the moderation dashboard) both live against this
 * module so the two can never drift into an asymmetry a reporter can exploit:
 * anything the parser is willing to recognize must be something the composer is
 * willing to neutralize in reporter-controlled text.
 *
 * This module is deliberately dependency-free so the browser bundle can import
 * it without pulling in server-only code.
 */

export const REPORT_METADATA_FIELDS = [
  { key: "contentUrl", label: "Content URL:" },
  { key: "contentTitle", label: "Content Title:" },
  { key: "contentCreator", label: "Content Creator:" },
  { key: "context", label: "Context:" },
  { key: "reportedAt", label: "Reported at:" },
] as const;

export type ReportMetadataKey = (typeof REPORT_METADATA_FIELDS)[number]["key"];

export type ParsedReportDescription = {
  notes: string;
  metadata: Partial<Record<ReportMetadataKey, string>>;
};

/**
 * C0/C1 controls plus the bidi, zero-width, and byte-order characters used to
 * disguise text. Newline and tab are excluded here: a report body keeps its
 * line structure, and a single-line metadata value collapses its whitespace
 * instead.
 */
const DISALLOWED_TEXT = String.raw`\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff`;
const DISALLOWED_TEXT_PATTERN = new RegExp(`[${DISALLOWED_TEXT}]`, "gu");
const HAS_DISALLOWED_TEXT_PATTERN = new RegExp(`[${DISALLOWED_TEXT}]`, "u");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Whitespace-tolerant, case-insensitive marker patterns.
 *
 * The parser only accepts an exact, line-leading label, so recognizing a strict
 * superset here is safe and is the point: `Content\nURL:` and `content  url :`
 * both have to be neutralized, because a later whitespace collapse or a
 * lenient reader would otherwise turn them into a real marker.
 */
const METADATA_MARKER_PATTERNS = REPORT_METADATA_FIELDS.map((field) => {
  const words = field.label.slice(0, -1).trim().split(/\s+/u).map(escapeRegExp);
  return new RegExp(`${words.join("\\s*")}\\s*:`, "giu");
});

/** U+FE55 SMALL COLON: reads like a colon, is not the marker delimiter. */
const NEUTRALIZED_COLON = "\uFE55";

export function escapeReportMetadataMarkers(value: string): string {
  let escaped = value;
  for (const pattern of METADATA_MARKER_PATTERNS) {
    escaped = escaped.replace(
      pattern,
      (match) => `${match.slice(0, -1)}${NEUTRALIZED_COLON}`,
    );
  }
  return escaped;
}

/** A multi-line body: control and bidi characters out, line structure kept. */
export function sanitizeReportBody(value: string): string {
  return value.replace(DISALLOWED_TEXT_PATTERN, "").trim();
}

/** A single metadata value: normalized to one line before anything reads it. */
export function sanitizeReportLine(value: string): string {
  return value
    .replace(DISALLOWED_TEXT_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Read back a composed description.
 *
 * A metadata field is only recognized when its exact label begins a line, so
 * reporter prose can never contribute a field no matter where a look-alike
 * label appears inside it. The first occurrence of each label wins.
 */
export function parseReportDescription(
  description?: string | null,
): ParsedReportDescription {
  const raw = (description ?? "").replace(/\r\n?/gu, "\n");
  const metadata: ParsedReportDescription["metadata"] = {};

  if (!raw.trim()) return { notes: "", metadata };

  const lines = raw.split("\n");
  let firstMetadataLine = lines.length;

  lines.forEach((line, index) => {
    const field = REPORT_METADATA_FIELDS.find((candidate) =>
      line.startsWith(candidate.label),
    );
    if (!field) return;

    if (index < firstMetadataLine) firstMetadataLine = index;
    if (metadata[field.key] !== undefined) return;

    const value = sanitizeReportLine(line.slice(field.label.length));
    if (value) metadata[field.key] = value;
  });

  return {
    notes: sanitizeReportBody(lines.slice(0, firstMetadataLine).join("\n")),
    metadata,
  };
}

/**
 * The only URL shape the dashboard will ever link to.
 *
 * A stored location is an application-relative path composed by the server. A
 * value that is absolute, scheme-relative, backslash-bearing, whitespace- or
 * control-bearing, or simply too long is not rendered at all: the caller falls
 * back to the path derived from the report's own authoritative target type and
 * identifier. Legacy rows written before locations were normalized therefore
 * degrade to that derived link instead of becoming a clickable off-origin one.
 */
export function resolveSafeReportPath(
  value?: string | null,
): string | undefined {
  if (!value) return undefined;

  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 2_048) return undefined;
  if (!candidate.startsWith("/")) return undefined;
  if (candidate.startsWith("//")) return undefined;
  if (candidate.includes("\\")) return undefined;
  if (/\s/u.test(candidate)) return undefined;
  if (HAS_DISALLOWED_TEXT_PATTERN.test(candidate)) return undefined;

  return candidate;
}
