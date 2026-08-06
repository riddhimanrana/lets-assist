import { logError } from "@/lib/logger";

export const GOOGLE_SHEETS_API =
  "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";

export type SpreadsheetValueInputOption = "RAW" | "USER_ENTERED";

export type CsfDriveFileAccessState =
  "accessible" | "reconnect_required" | "not_found" | "trashed" | "unknown";

export type CsfDriveFileMetadata = {
  /**
   * The identifier this call asked the provider about.
   *
   * Deliberately distinct from {@link CsfDriveFileMetadata.id}: it is our own
   * input echoed back, never evidence. Commit-time verification compares the
   * two, which is only meaningful while they are separate facts.
   */
  requestedFileId: string;
  /**
   * Exactly what the provider returned, or null when it returned none.
   *
   * This must never fall back to `requestedFileId`. A fabricated identity makes
   * "the provider confirmed this is the file we asked for" unfalsifiable, which
   * is precisely the check the commit boundary depends on.
   */
  id: string | null;
  name: string | null;
  mimeType: string | null;
  /**
   * The provider's EXACT `modifiedTime` spelling, carried as written.
   *
   * Not a normalized rendering of it. This was previously parsed through `Date`
   * and re-emitted as millisecond `toISOString()` text, which accepted a numeric
   * offset, rolled an impossible civil date onto a real one, and discarded a
   * provider's own 6- or 9-digit precision -- so the value later gates compared
   * was authored here. It is now either exactly what Drive can emit, or null.
   */
  modifiedTime: string | null;
  /**
   * The provider's own file version: a monotonically increasing counter Drive
   * advances on every server-side change to the file, including changes that do
   * not move `modifiedTime`.
   *
   * THIS is the freshness coordinate for a native Google Sheet. It is carried as
   * the exact decimal string the provider sent, never as a JavaScript number:
   * Drive documents it as an int64, and `Number` silently rounds past 2^53, so a
   * parsed copy of a large version can compare equal to a different version.
   *
   * Compared only for equality against previously frozen evidence. It is never
   * sorted and never used to decide which of two concurrent reads is newer --
   * that is the source row's `evidence_generation` compare-and-set.
   */
  version: string | null;
  /**
   * Drive's binary-content revision identifier, present only for uploaded
   * binary files. Docs Editors files -- which is what a native Google Sheet is
   * -- never expose one, so this is DIAGNOSTIC ONLY and must never be required,
   * compared, or fallen back on for a Sheet's freshness. `version` is the
   * coordinate the provider actually exposes for one.
   */
  headRevisionId: string | null;
  webViewLink: string | null;
  /**
   * Provider trash state, or null when the provider did not state one.
   *
   * A missing value may not become `false`. "Not stated" and "confirmed not
   * trashed" are opposite answers to the only question that keeps a deleted
   * source out of an import.
   */
  trashed: boolean | null;
  accessState: CsfDriveFileAccessState;
};

/** Google's editor-native spreadsheet MIME. Anything else is not a Sheet. */
export const GOOGLE_SHEETS_MIME_TYPE =
  "application/vnd.google-apps.spreadsheet";

/**
 * Drive's OWN output spelling for `modifiedTime`: UTC `Z`, with a fractional
 * part of exactly 0, 3, 6 or 9 digits.
 *
 * Deliberately narrower than RFC 3339, and identical to the grammar the
 * normalized contract, the frozen provenance and the readiness boundary already
 * enforce. A `+00:00`, a `-00:00` or a `.1234` is not something the provider
 * produced, so accepting one would accept a coordinate authored somewhere
 * between Drive and this reader -- which is what an exact coordinate exists to
 * rule out.
 */
const DRIVE_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}|\d{6}|\d{9}))?Z$/u;
/** Gregorian month lengths. February is decided by the year, not this table. */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/**
 * Edge padding DETECTION for an exact coordinate. Never repair.
 *
 * The three properties are named rather than approximated: `\s` misses U+0085,
 * ECMAScript `trim()` misses U+200B and NUL, and `Cf` is where the invisible
 * formatting characters live. Only the EDGES are refused -- an opaque provider
 * identifier stays opaque, so an ordinary internal character is not this
 * boundary's business.
 */
const EDGE_PADDING =
  /^[\p{White_Space}\p{Cc}\p{Cf}]|[\p{White_Space}\p{Cc}\p{Cf}]$/u;
/** The opaque provider identifier bound, matching the normalized contract. */
const MAX_PROVIDER_FILE_ID = 512;
/** The MIME bound. A media type this long is not one the provider emits. */
const MAX_PROVIDER_MIME = 256;
/** Bounded display provenance. A name is never identity and never compared. */
const MAX_PROVIDER_DISPLAY = 512;
/** The exact `modifiedTime` bound; the grammar above is far shorter than this. */
const MAX_PROVIDER_INSTANT = 64;

/**
 * Whether the captured fields name a day and a clock time that exist.
 *
 * A shape is not a date: `2026-02-30T00:00:00Z` satisfies every character class
 * in the grammar above, and so do 2025-02-29, April 31, hour 24 and second 60.
 * Hour 24 and second 60 are refused outright rather than rolled forward, because
 * a lenient parser moves them to a different instant instead of representing
 * them -- which is exactly the rewrite the predecessor performed.
 */
function isRealCivilDateTime(fields: RegExpExecArray) {
  const [, year, month, day, hour, minute, second] = fields;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return false;
  const yearNumber = Number(year);
  // `0000` satisfies `\d{4}` and names a proleptic year PostgreSQL `timestamptz`
  // cannot retain as the same Gregorian year -- there is no year zero in the AD
  // era it stores, so a round trip comes back as 1 BC. A coordinate that cannot
  // survive the column it will be compared against is not evidence.
  if (yearNumber < 1) return false;
  const leap =
    (yearNumber % 4 === 0 && yearNumber % 100 !== 0) || yearNumber % 400 === 0;
  const dayCount =
    monthNumber === 2 ? (leap ? 29 : 28) : MONTH_LENGTHS[monthNumber - 1];
  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > dayCount) return false;
  return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

/**
 * The provider's exact `modifiedTime`, returned as written or refused.
 *
 * This replaces a `new Date(value.trim()).toISOString()` round trip, which was
 * never a validation. It accepted a numeric offset, accepted surrounding
 * padding, silently rolled an impossible civil date forward onto a real one, and
 * then re-rendered whatever survived as millisecond text -- so the coordinate
 * every later freshness gate compares was authored HERE rather than by Drive,
 * and a 6- or 9-digit provider value lost its own precision on the way in.
 *
 * Nothing is trimmed, parsed or re-rendered. The provider's spelling is either
 * exactly what Drive can emit, or it is not evidence.
 */
function exactProviderTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_INSTANT
  ) {
    return null;
  }
  const fields = DRIVE_INSTANT.exec(value);
  if (!fields || !isRealCivilDateTime(fields)) return null;
  // PostgreSQL `timestamptz` retains MICROseconds. A 9-digit fraction whose
  // final three digits are nonzero names a nanosecond the typed column never
  // stored, so no later comparison against the stored side can be honest about
  // it: truncating it into equality would manufacture agreement, and widening
  // the column is not this reader's to do. It is refused here, before a preview
  // exists, rather than discovered after one has been frozen. Decided on the
  // TEXT, so no digit passes through a numeric parse on the way to the answer.
  const fraction = fields[7] ?? "";
  if (fraction.length === 9 && fraction.slice(6) !== "000") return null;
  return value;
}

/**
 * An exact opaque provider coordinate: a primitive string, nonempty, bounded,
 * and already unpadded.
 *
 * Padding is NOTICED and never removed. A trimmed copy is a different string
 * from the one the provider sent, and this value is only ever compared for exact
 * equality -- so repairing it is how a coordinate that is not the evidence comes
 * to pass the one check whose entire subject is exactness.
 */
function exactProviderText(value: unknown, maxLength: number): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  )
    return null;
  return EDGE_PADDING.test(value) ? null : value;
}

/**
 * Bounded DISPLAY provenance: a name or a link an officer may read.
 *
 * Deliberately separate from {@link exactProviderText} and deliberately still
 * collapsed. A display value is never identity, never compared and never a
 * freshness coordinate -- a rename here is benign and blocks nothing -- so the
 * exactness rule that governs evidence would only make a cosmetic difference
 * fatal. It is bounded because unbounded provider text is not display copy.
 */
function boundedDisplayText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim();
  return collapsed.length > 0 && collapsed.length <= MAX_PROVIDER_DISPLAY
    ? collapsed
    : null;
}

/** A positive decimal integer with no leading zero, so equality is canonical. */
const PROVIDER_VERSION_SHAPE = /^[1-9][0-9]*$/u;
/** Drive documents `version` as an int64; this is its exact ceiling as text. */
const PROVIDER_VERSION_MAX = "9223372036854775807";

/**
 * Drive's `version`, validated as a bounded positive decimal int64 string.
 *
 * Deliberately never touches `Number`. Drive serializes int64 fields as JSON
 * strings precisely because the value does not survive a double, and a version
 * beyond 2^53 rounds to a neighbour that would then compare equal to a
 * genuinely different version. Everything below -- shape, bound, ordering -- is
 * decided on the text.
 *
 * A leading zero is refused rather than normalized: `007` and `7` are the same
 * integer but different strings, and this value is only ever compared for exact
 * equality against previously frozen evidence.
 */
function boundedProviderVersion(value: unknown): string | null {
  // A JSON number reaching here has already been through a double, so there is
  // nothing left to rescue -- it is refused, not repaired.
  if (typeof value !== "string") return null;
  // Not trimmed. A padded version is a value the provider did not send, and
  // repairing `"  58  "` into `"58"` is how a coordinate that is not the
  // evidence comes to compare equal to frozen evidence -- the anchored shape
  // below refuses it instead.
  if (!PROVIDER_VERSION_SHAPE.test(value)) return null;
  // Textual int64 bound. With no leading zeros, a shorter string is the smaller
  // integer and equal lengths compare lexicographically in numeric order.
  if (value.length > PROVIDER_VERSION_MAX.length) return null;
  if (
    value.length === PROVIDER_VERSION_MAX.length &&
    value > PROVIDER_VERSION_MAX
  )
    return null;
  return value;
}

export async function getGoogleDriveFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<CsfDriveFileMetadata> {
  const unavailable = (
    accessState: CsfDriveFileAccessState,
  ): CsfDriveFileMetadata => ({
    requestedFileId: fileId,
    id: null,
    name: null,
    mimeType: null,
    modifiedTime: null,
    version: null,
    headRevisionId: null,
    webViewLink: null,
    trashed: null,
    accessState,
  });

  try {
    // Our own request is a coordinate too. A padded, empty or unbounded id is
    // not something a later commit can compare the provider's answer against,
    // and `encodeURIComponent` would happily carry it to Drive and let whatever
    // came back become "the file we asked for".
    if (exactProviderText(fileId, MAX_PROVIDER_FILE_ID) === null) {
      return unavailable("unknown");
    }
    const params = new URLSearchParams({
      fields:
        "id,name,mimeType,modifiedTime,version,headRevisionId,webViewLink,trashed",
      supportsAllDrives: "true",
    });
    const response = await fetch(
      `${GOOGLE_DRIVE_FILES_API}/${encodeURIComponent(fileId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const accessState: CsfDriveFileAccessState =
        response.status === 401 || response.status === 403
          ? "reconnect_required"
          : response.status === 404
            ? "not_found"
            : "unknown";
      // The requested id is deliberately absent. A log context is the one place
      // an opaque provider coordinate leaves this process without a consumer
      // that needs it, and the status is the entire diagnostic.
      logError(
        "Failed to fetch Google Drive file metadata",
        new Error(`Drive returned ${response.status}`),
        {
          status: response.status,
        },
      );
      return unavailable(accessState);
    }

    let data: Record<string, unknown>;
    try {
      const parsed: unknown = await response.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return unavailable("unknown");
      }
      data = parsed as Record<string, unknown>;
    } catch {
      // A 200 whose body is not an object is not a successful read.
      return unavailable("unknown");
    }

    const providerId = exactProviderText(data.id, MAX_PROVIDER_FILE_ID);
    const mimeType = exactProviderText(data.mimeType, MAX_PROVIDER_MIME);
    const modifiedTime = exactProviderTimestamp(data.modifiedTime);
    const version = boundedProviderVersion(data.version);
    const trashed = typeof data.trashed === "boolean" ? data.trashed : null;
    // The provider answered about the file we asked for, and that file is a
    // native Google Sheet.
    //
    // Both are decided HERE rather than only in the wrappers. A 200 whose `id`
    // is some other file, or whose `mimeType` is a Doc or a PDF, is not a
    // successful read of this source -- and reporting it as `accessible` handed
    // every caller a metadata object whose `accessState` says the acquisition
    // succeeded. `getCsfSheetSourceLiveEvidence` re-checks both independently
    // and keeps its own distinct refusal reasons; this is the acquisition
    // refusing to manufacture the fact in the first place, not a replacement
    // for it. Nothing is normalized: a mismatch is `unknown`, never a repaired
    // identity or a substituted type.
    const identityProven = providerId !== null && providerId === fileId;
    const isNativeSheet = mimeType === GOOGLE_SHEETS_MIME_TYPE;

    const metadata: CsfDriveFileMetadata = {
      requestedFileId: fileId,
      id: providerId,
      name: boundedDisplayText(data.name),
      mimeType,
      modifiedTime,
      version,
      headRevisionId: boundedDisplayText(data.headRevisionId),
      webViewLink: boundedDisplayText(data.webViewLink),
      trashed,
      // Incomplete or malformed evidence is not an accessible file. Identity,
      // trash state, a parseable modification time and the provider's own
      // version are the facts every downstream check is built on; without all
      // of them there is nothing to verify against, so this fails closed rather
      // than reporting success and letting a null slip into frozen provenance.
      accessState:
        !identityProven ||
        !isNativeSheet ||
        trashed === null ||
        modifiedTime === null ||
        version === null
          ? "unknown"
          : trashed
            ? "trashed"
            : "accessible",
    };

    if (metadata.accessState === "unknown") {
      logError(
        "Google Drive returned an incomplete file metadata response",
        new Error("Drive 200 response was missing required provenance"),
        {
          // Non-identifying booleans only. `identity_matches` says whether the
          // answer was about the requested file WITHOUT naming either id.
          identity_matches: identityProven,
          is_native_sheet: isNativeSheet,
          has_modified_time: modifiedTime !== null,
          has_version: version !== null,
          has_trashed: trashed !== null,
        },
      );
    }

    return metadata;
  } catch {
    // The caught value is NOT logged. A fetch failure's message and stack carry
    // the request URL, which carries the file id -- so passing it through would
    // reinstate exactly the provider coordinate removed from every context
    // above. It is not even bound: a fixed bounded replacement is the entire
    // diagnostic this reader is allowed to publish.
    logError(
      "Exception while fetching Google Drive file metadata",
      new Error(
        "Drive file metadata request failed before a response was read",
      ),
    );
    return unavailable("unknown");
  }
}

/** Why a commit-time evidence refresh refused. Each maps to distinct officer copy. */
export type CsfSourceEvidenceRefusal =
  | "reconnect_required"
  | "not_found"
  | "trashed"
  | "unknown"
  | "identity_mismatch"
  | "mime_mismatch"
  | "missing_modified_time"
  | "missing_provider_version";

export type CsfSourceLiveEvidence = {
  status: "ok";
  /** The ID we asked for, kept beside what the provider answered. */
  requestedFileId: string;
  /** The provider's own answer. Equal to `requestedFileId`, proved not assumed. */
  providerFileId: string;
  mimeType: string;
  modifiedTime: string;
  /**
   * The provider's own file version, exactly as sent. The native-Sheet freshness
   * coordinate; compared only for equality against frozen evidence.
   */
  version: string;
  /** Diagnostic only. A native Sheet exposes none, and none is required. */
  headRevisionId: string | null;
  /** Display provenance. A rename here is benign and never blocks a commit. */
  name: string | null;
  webViewLink: string | null;
  metadata: CsfDriveFileMetadata;
};

export type CsfSourceLiveEvidenceResult =
  | CsfSourceLiveEvidence
  | {
      status: "refused";
      reason: CsfSourceEvidenceRefusal;
      metadata: CsfDriveFileMetadata;
    };

/**
 * The metadata-only commit-time freshness read.
 *
 * Narrowly extracted on purpose: it calls exactly the Drive `files.get` the
 * preview already uses, reads no sheet values, and broadens no OAuth scope. It
 * exists so the claim path has one place that turns a provider response into
 * either proven evidence or a refusal -- never into a partially-filled object a
 * caller has to remember to re-check.
 */
export async function getCsfSheetSourceLiveEvidence(
  accessToken: string,
  fileId: string,
): Promise<CsfSourceLiveEvidenceResult> {
  const metadata = await getGoogleDriveFileMetadata(accessToken, fileId);

  if (metadata.accessState !== "accessible") {
    return { status: "refused", reason: metadata.accessState, metadata };
  }
  // `accessible` already proves these are non-null, but the narrowing has to be
  // stated for the compiler and it costs nothing to keep the refusal explicit.
  if (metadata.id === null || metadata.id !== metadata.requestedFileId) {
    return { status: "refused", reason: "identity_mismatch", metadata };
  }
  if (metadata.mimeType !== GOOGLE_SHEETS_MIME_TYPE) {
    return { status: "refused", reason: "mime_mismatch", metadata };
  }
  if (metadata.modifiedTime === null) {
    return { status: "refused", reason: "missing_modified_time", metadata };
  }

  // The native-Sheet freshness coordinate. Drive never populates
  // `headRevisionId` or a checksum for a Docs Editors file, so requiring one
  // would be an impossible provider contract; `version` is what a Sheet
  // actually exposes, and its absence is a refusal rather than a fallback.
  if (metadata.version === null) {
    return { status: "refused", reason: "missing_provider_version", metadata };
  }

  return {
    status: "ok",
    requestedFileId: metadata.requestedFileId,
    providerFileId: metadata.id,
    mimeType: metadata.mimeType,
    modifiedTime: metadata.modifiedTime,
    version: metadata.version,
    headRevisionId: metadata.headRevisionId,
    name: metadata.name,
    webViewLink: metadata.webViewLink,
    metadata,
  };
}
