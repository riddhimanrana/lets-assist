import { createHash } from "node:crypto";

import { logError } from "@/lib/logger";
import {
  writeThenClearStaleSpreadsheetValues,
  type SpreadsheetReplaceResult,
} from "@/lib/organization/spreadsheet-replace-core";

const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";

type SpreadsheetValueInputOption = "RAW" | "USER_ENTERED";

export type CsfDriveFileAccessState =
  | "accessible"
  | "reconnect_required"
  | "not_found"
  | "trashed"
  | "unknown";

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
export const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

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
const EDGE_PADDING = /^[\p{White_Space}\p{Cc}\p{Cf}]|[\p{White_Space}\p{Cc}\p{Cf}]$/u;
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
  const leap = (yearNumber % 4 === 0 && yearNumber % 100 !== 0) || yearNumber % 400 === 0;
  const dayCount = monthNumber === 2 ? (leap ? 29 : 28) : MONTH_LENGTHS[monthNumber - 1];
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
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROVIDER_INSTANT) {
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
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
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
  return collapsed.length > 0 && collapsed.length <= MAX_PROVIDER_DISPLAY ? collapsed : null;
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
  if (value.length === PROVIDER_VERSION_MAX.length && value > PROVIDER_VERSION_MAX) return null;
  return value;
}

export async function getGoogleDriveFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<CsfDriveFileMetadata> {
  const unavailable = (accessState: CsfDriveFileAccessState): CsfDriveFileMetadata => ({
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
      fields: "id,name,mimeType,modifiedTime,version,headRevisionId,webViewLink,trashed",
      supportsAllDrives: "true",
    });
    const response = await fetch(
      `${GOOGLE_DRIVE_FILES_API}/${encodeURIComponent(fileId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const accessState: CsfDriveFileAccessState = response.status === 401 || response.status === 403
        ? "reconnect_required"
        : response.status === 404
          ? "not_found"
          : "unknown";
      // The requested id is deliberately absent. A log context is the one place
      // an opaque provider coordinate leaves this process without a consumer
      // that needs it, and the status is the entire diagnostic.
      logError("Failed to fetch Google Drive file metadata", new Error(`Drive returned ${response.status}`), {
        status: response.status,
      });
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
        !identityProven
          || !isNativeSheet
          || trashed === null
          || modifiedTime === null
          || version === null
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
      new Error("Drive file metadata request failed before a response was read"),
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
  | { status: "refused"; reason: CsfSourceEvidenceRefusal; metadata: CsfDriveFileMetadata };

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

const GOOGLE_SHEETS_MAX_COLUMN_INDEX = 18_278; // ZZZ
const CSF_SHEET_MAX_BOUNDED_CELLS = 250_000;

const columnToIndex = (column: string) => {
  const normalized = column.toUpperCase();
  if (!/^[A-Z]{1,3}$/u.test(normalized)) return Number.NaN;

  const index = normalized
    .split("")
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
  return Number.isSafeInteger(index) && index <= GOOGLE_SHEETS_MAX_COLUMN_INDEX
    ? index
    : Number.NaN;
};

const indexToColumn = (index: number) => {
  if (
    !Number.isSafeInteger(index)
    || index < 1
    || index > GOOGLE_SHEETS_MAX_COLUMN_INDEX
  ) {
    throw new RangeError("Google Sheets column index is outside the supported A1 range.");
  }

  let value = index;
  let column = "";
  while (value > 0) {
    const modulo = (value - 1) % 26;
    column = String.fromCharCode(65 + modulo) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
};

const parseA1Cell = (cell: string) => {
  const match = cell.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  const columnIndex = columnToIndex(match[1]);
  const row = Number.parseInt(match[2], 10);
  if (
    !Number.isSafeInteger(columnIndex)
    || !Number.isSafeInteger(row)
    || row < 1
  ) {
    return null;
  }
  return {
    column: match[1].toUpperCase(),
    row,
  };
};

const parseA1Range = (range: string) => {
  const trimmed = range.trim();
  if (!trimmed) return null;
  // Numbered groups rather than named ones: this project's TypeScript target
  // predates ES2018, so a named capture group is a compile error here.
  // Group 1 is the optional tab, 2 the start cell, 3 the optional end cell.
  const match = /^(?:('(?:[^']|'')*'|[^'!]+)!)?([A-Za-z]+\d+)(?::([A-Za-z]+\d+))?$/u.exec(
    trimmed,
  );
  if (!match) return null;
  const start = parseA1Cell(match[2]);
  const end = match[3] ? parseA1Cell(match[3]) : null;
  if (!start) return null;
  const rawTabPart = match[1];
  const tabPart = rawTabPart?.startsWith("'")
    ? rawTabPart.slice(1, -1).replace(/''/g, "'")
    : rawTabPart;
  return {
    tabName: tabPart || null,
    start,
    end,
  };
};

const formatSheetNameForA1 = (tabName: string) => {
  const escaped = tabName.replace(/'/g, "''");
  return `'${escaped}'`;
};

export function buildWriteRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][]
) {
  const totalRows = Math.max(rows.length, 1);
  const totalColumns = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1
  );
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startIndex = columnToIndex(startColumn);
  const endColumn = indexToColumn(startIndex + totalColumns - 1);
  const endRow = startRow + totalRows - 1;
  const resolvedTab = parsed?.tabName || tabName;

  return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${endColumn}${endRow}`;
}

export function buildClearRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][]
) {
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startIndex = columnToIndex(startColumn);
  const totalColumns = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1
  );
  const resolvedTab = parsed?.tabName || tabName;

  if (parsed?.end) {
    return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${parsed.end.column}${parsed.end.row}`;
  }

  const endColumn = indexToColumn(Math.max(startIndex + totalColumns - 1, 26));
  const endRow = Math.max(startRow + rows.length + 50, 1000);
  return `${formatSheetNameForA1(resolvedTab)}!${startColumn}${startRow}:${endColumn}${endRow}`;
}

export function buildStaleClearRanges(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][],
): string[] {
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startColumnIndex = columnToIndex(startColumn);
  const rowCount = Math.max(rows.length, 1);
  const columnCount = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1,
  );
  const writeEndColumnIndex = startColumnIndex + columnCount - 1;
  const writeEndRow = startRow + rowCount - 1;
  const clearEndColumnIndex = parsed?.end
    ? Math.max(startColumnIndex, columnToIndex(parsed.end.column))
    : Math.max(writeEndColumnIndex, 26);
  const clearEndRow = parsed?.end
    ? Math.max(startRow, parsed.end.row)
    : Math.max(startRow + rows.length + 50, 1000);
  const resolvedTab = parsed?.tabName || tabName;
  const formattedTab = formatSheetNameForA1(resolvedTab);
  const clearEndColumn = indexToColumn(clearEndColumnIndex);
  const staleRanges: string[] = [];

  // Clear cells to the right of a newly narrower report without touching any
  // values that were just written.
  if (clearEndColumnIndex > writeEndColumnIndex && clearEndRow >= startRow) {
    const rightStartColumn = indexToColumn(writeEndColumnIndex + 1);
    const rightEndRow = Math.min(writeEndRow, clearEndRow);
    staleRanges.push(
      `${formattedTab}!${rightStartColumn}${startRow}:${clearEndColumn}${rightEndRow}`,
    );
  }

  // Clear rows left behind by a newly shorter report.
  if (clearEndRow > writeEndRow) {
    staleRanges.push(
      `${formattedTab}!${startColumn}${writeEndRow + 1}:${clearEndColumn}${clearEndRow}`,
    );
  }

  return staleRanges;
}

export async function clearSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId
      )}/values/${encodeURIComponent(range)}:clear`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError('Failed to clear Google spreadsheet values', new Error(error), {
        sheet_id: sheetId,
        range,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError('Exception while clearing Google spreadsheet values', error, {
      sheet_id: sheetId,
      range,
    });
    return false;
  }
}

export async function createSpreadsheet(
  accessToken: string,
  title: string,
  tabName: string
): Promise<{ sheetId: string; sheetUrl: string; tabName: string; sheetTitle: string } | null> {
  try {
    const response = await fetch(GOOGLE_SHEETS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          {
            properties: {
              title: tabName,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError('Failed to create Google spreadsheet', new Error(error), {
        title,
        tab_name: tabName,
      });
      return null;
    }

    const data = await response.json();
    return {
      sheetId: data.spreadsheetId,
      sheetUrl: data.spreadsheetUrl,
      tabName,
      sheetTitle: data.properties?.title || title,
    };
  } catch (error) {
    logError('Exception while creating Google spreadsheet', error, {
      title,
      tab_name: tabName,
    });
    return null;
  }
}

export function extractSpreadsheetId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export function buildSpreadsheetUrl(sheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  sheetId: string
): Promise<{ sheetId: string; sheetTitle: string; tabs: string[] } | null> {
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId
      )}?fields=spreadsheetId,properties.title,sheets.properties.title`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError('Failed to fetch Google spreadsheet metadata', new Error(error), {
        sheet_id: sheetId,
      });
      return null;
    }

    const data = await response.json();
    const tabs = (data.sheets || [])
      .map((sheet: { properties?: { title?: string } }) => sheet.properties?.title)
      .filter((title: string | undefined): title is string => Boolean(title));

    return {
      sheetId: data.spreadsheetId,
      sheetTitle: data.properties?.title || "Untitled Spreadsheet",
      tabs,
    };
  } catch (error) {
    logError('Exception while fetching Google spreadsheet metadata', error, {
      sheet_id: sheetId,
    });
    return null;
  }
}

export async function ensureSpreadsheetTab(
  accessToken: string,
  sheetId: string,
  tabName: string
): Promise<boolean> {
  try {
    const metadata = await getSpreadsheetMetadata(accessToken, sheetId);
    if (!metadata) return false;
    if (metadata.tabs.some((tab) => tab === tabName)) return true;

    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: tabName,
                },
              },
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError('Failed to create Google sheet tab', new Error(error), {
        sheet_id: sheetId,
        tab_name: tabName,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError('Exception while ensuring Google sheet tab', error, {
      sheet_id: sheetId,
      tab_name: tabName,
    });
    return false;
  }
}

export async function updateSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: string[][],
  valueInputOption: SpreadsheetValueInputOption = "USER_ENTERED",
): Promise<boolean> {
  const resolvedRange = range || "A1";
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId
      )}/values/${encodeURIComponent(resolvedRange)}?valueInputOption=${valueInputOption}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range: resolvedRange,
          majorDimension: "ROWS",
          values: rows,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError('Failed to update Google spreadsheet values', new Error(error), {
        sheet_id: sheetId,
        range: resolvedRange,
        rows_count: rows.length,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError('Exception while updating Google spreadsheet values', error, {
      sheet_id: sheetId,
      range: resolvedRange,
      rows_count: rows.length,
    });
    return false;
  }
}

export async function replaceSpreadsheetReportValues(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][],
): Promise<SpreadsheetReplaceResult> {
  const writeRange = buildWriteRange(tabName, rangeA1, rows);
  const staleRanges = buildStaleClearRanges(tabName, rangeA1, rows);

  return writeThenClearStaleSpreadsheetValues(staleRanges, {
    // Report cells are untrusted data, never formulas. RAW prevents names,
    // emails, project titles, or custom labels from being evaluated by Sheets.
    write: () =>
      updateSpreadsheetValues(
        accessToken,
        sheetId,
        writeRange,
        rows,
        "RAW",
      ),
    clear: (range) => clearSpreadsheetValues(accessToken, sheetId, range),
  });
}

export async function batchGetSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  ranges: string[]
): Promise<Array<{ range: string; values: string[][] }> | null> {
  if (ranges.length === 0) return [];

  const params = new URLSearchParams();
  for (const range of ranges) {
    params.append("ranges", range);
  }
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "FORMATTED_VALUE");

  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}/values:batchGet?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to batch read Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        ranges: ranges.join(", "),
      });
      return null;
    }

    const data = await response.json();
    return (data.valueRanges || []).map((valueRange: { range?: string; values?: string[][] }) => ({
      range: valueRange.range || "",
      values: valueRange.values || [],
    }));
  } catch (error) {
    logError("Exception while batch reading Google spreadsheet values", error, {
      sheet_id: sheetId,
      ranges: ranges.join(", "),
    });
    return null;
  }
}

/* -------------------------------------------------------------------------
 * Bounded source acquisition for the normalized CSF import contract.
 *
 * Preflight needs more than cell text: which tab was read, whether that tab or
 * any sibling is hidden, which rows the officer has hidden or filtered out,
 * which cells are formulas rather than typed evidence, and a digest of exactly
 * the bytes that were read. Everything below is derived from the Sheets scopes
 * already in use -- no Drive, Gmail, or Classroom scope is added.
 *
 * Two rules are structural rather than advisory:
 *   1. A failed load is never an empty load. Every failure returns an explicit
 *      `unavailable` result so no caller can mistake "we could not read it" for
 *      "there was nothing there".
 *   2. Grid capacity is never treated as data. Structural evidence is read
 *      only inside the officer's bounded range, and blank capacity is omitted
 *      from both candidate rows and the source digest.
 * ---------------------------------------------------------------------------
 */

export type CsfSheetTabVisibility = "visible" | "hidden" | "very_hidden";

export type CsfSheetSourceUnavailableReason =
  | "reconnect_required"
  | "not_found"
  | "rate_limited"
  | "invalid_range"
  | "unavailable";

export type CsfSheetBounds = {
  tabName: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export type CsfSheetTabEvidence = {
  tabName: string;
  sheetId: number | null;
  visibility: CsfSheetTabVisibility;
  gridRowCount: number | null;
  gridColumnCount: number | null;
};

export type CsfSheetRowEvidence = {
  /** One-based row number in the spreadsheet, not in the selected block. */
  sourceRowNumber: number;
  hiddenByUser: boolean;
  hiddenByFilter: boolean;
  /** One-based column numbers whose cell holds a formula rather than typed input. */
  formulaColumns: number[];
  /** True when at least one cell in the row resolved to a non-empty value. */
  hasEffectiveValue: boolean;
  values: string[];
};

export type CsfSheetSourceSnapshot = {
  status: "ok";
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedTab: CsfSheetTabEvidence;
  tabs: CsfSheetTabEvidence[];
  requestedRange: CsfSheetBounds;
  /** Null when the requested range holds no populated cell at all. */
  populatedRange: CsfSheetBounds | null;
  rows: CsfSheetRowEvidence[];
  contentHash: string;
  hasBasicFilter: boolean;
};

export type CsfSheetSourceSnapshotResult =
  | CsfSheetSourceSnapshot
  | {
      status: "unavailable";
      reason: CsfSheetSourceUnavailableReason;
      message: string;
    };

function unavailableReasonForStatus(status: number): CsfSheetSourceUnavailableReason {
  if (status === 401 || status === 403) return "reconnect_required";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

export function parseCsfSheetBoundedRange(
  range: string,
  fallbackTabName: string,
): CsfSheetBounds | null {
  const parsed = parseA1Range(range);
  if (!parsed?.end) return null;
  const tabName = parsed.tabName || fallbackTabName;
  if (!tabName) return null;

  const startRow = parsed.start.row;
  const endRow = parsed.end.row;
  const startColumn = columnToIndex(parsed.start.column);
  const endColumn = columnToIndex(parsed.end.column);
  const height = endRow - startRow + 1;
  const width = endColumn - startColumn + 1;
  const cellCount = height * width;
  if (
    !Number.isSafeInteger(startRow)
    || !Number.isSafeInteger(endRow)
    || !Number.isSafeInteger(startColumn)
    || !Number.isSafeInteger(endColumn)
    || startRow < 1
    || endRow < startRow
    || startColumn < 1
    || endColumn < startColumn
    || !Number.isSafeInteger(height)
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(cellCount)
    || cellCount > CSF_SHEET_MAX_BOUNDED_CELLS
  ) {
    return null;
  }

  return { tabName, startRow, endRow, startColumn, endColumn };
}

export function formatCsfSheetBounds(bounds: CsfSheetBounds) {
  const height = bounds.endRow - bounds.startRow + 1;
  const width = bounds.endColumn - bounds.startColumn + 1;
  const cellCount = height * width;
  if (
    !bounds.tabName.trim()
    || !Number.isSafeInteger(bounds.startRow)
    || !Number.isSafeInteger(bounds.endRow)
    || !Number.isSafeInteger(bounds.startColumn)
    || !Number.isSafeInteger(bounds.endColumn)
    || bounds.startRow < 1
    || bounds.endRow < bounds.startRow
    || bounds.startColumn < 1
    || bounds.endColumn < bounds.startColumn
    || bounds.endColumn > GOOGLE_SHEETS_MAX_COLUMN_INDEX
    || !Number.isSafeInteger(height)
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(cellCount)
    || cellCount > CSF_SHEET_MAX_BOUNDED_CELLS
  ) {
    throw new RangeError("CSF Google Sheets bounds must describe one safe bounded rectangle.");
  }

  const startColumn = indexToColumn(bounds.startColumn);
  const endColumn = indexToColumn(bounds.endColumn);
  return `${formatSheetNameForA1(bounds.tabName)}!${startColumn}${bounds.startRow}:${endColumn}${bounds.endRow}`;
}

/**
 * Trim a requested block down to the rows and columns that actually hold text.
 * Returns null when nothing in the block is populated, which is a real answer
 * rather than a failure -- callers distinguish it from `unavailable`.
 */
export function narrowCsfSheetBoundsToPopulated(
  requested: CsfSheetBounds,
  values: string[][],
): CsfSheetBounds | null {
  let lastRowOffset = -1;
  let lastColumnOffset = -1;
  let firstRowOffset = -1;
  let firstColumnOffset = -1;

  values.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      if (!String(value ?? "").trim()) return;
      if (firstRowOffset < 0) firstRowOffset = rowOffset;
      lastRowOffset = rowOffset;
      if (firstColumnOffset < 0 || columnOffset < firstColumnOffset) {
        firstColumnOffset = columnOffset;
      }
      if (columnOffset > lastColumnOffset) lastColumnOffset = columnOffset;
    });
  });

  if (firstRowOffset < 0 || firstColumnOffset < 0) return null;

  return {
    tabName: requested.tabName,
    startRow: requested.startRow + firstRowOffset,
    endRow: Math.min(requested.endRow, requested.startRow + lastRowOffset),
    startColumn: requested.startColumn + firstColumnOffset,
    endColumn: Math.min(requested.endColumn, requested.startColumn + lastColumnOffset),
  };
}

export function hashCsfSheetSelection(bounds: CsfSheetBounds, values: string[][]) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        tabName: bounds.tabName,
        startRow: bounds.startRow,
        endRow: bounds.endRow,
        startColumn: bounds.startColumn,
        endColumn: bounds.endColumn,
        values,
      }),
    )
    .digest("hex");
}

type SheetsGridResponse = {
  spreadsheetId?: string;
  properties?: { title?: string };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      hidden?: boolean;
      sheetType?: string;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
    basicFilter?: unknown;
    data?: Array<{
      startRow?: number;
      startColumn?: number;
      rowMetadata?: Array<{ hiddenByUser?: boolean; hiddenByFilter?: boolean }>;
      rowData?: Array<{
        values?: Array<{
          formattedValue?: string;
          effectiveValue?: Record<string, unknown>;
          userEnteredValue?: { formulaValue?: string };
        }>;
      }>;
    }>;
  }>;
};

function tabEvidenceFrom(sheet: NonNullable<SheetsGridResponse["sheets"]>[number]): CsfSheetTabEvidence | null {
  const tabName = sheet.properties?.title;
  if (!tabName) return null;
  return {
    tabName,
    sheetId: typeof sheet.properties?.sheetId === "number" ? sheet.properties.sheetId : null,
    // The Sheets API models visibility as a single `hidden` flag. "Very hidden"
    // is an Excel-package concept surfaced by the uploaded-workbook path, so it
    // is representable here but never invented for a live spreadsheet.
    visibility: sheet.properties?.hidden === true ? "hidden" : "visible",
    gridRowCount: typeof sheet.properties?.gridProperties?.rowCount === "number"
      ? sheet.properties.gridProperties.rowCount
      : null,
    gridColumnCount: typeof sheet.properties?.gridProperties?.columnCount === "number"
      ? sheet.properties.gridProperties.columnCount
      : null,
  };
}

/**
 * Read one officer-selected, bounded Sheet range together with the acquisition
 * evidence preflight needs. Uses only `spreadsheets.values.batchGet` and
 * `spreadsheets.get`, both covered by the Sheets scope already granted.
 */
export async function getCsfSheetSourceSnapshot(
  accessToken: string,
  spreadsheetId: string,
  requestedRangeA1: string,
  fallbackTabName: string,
): Promise<CsfSheetSourceSnapshotResult> {
  const requestedRange = parseCsfSheetBoundedRange(requestedRangeA1, fallbackTabName);
  if (!requestedRange) {
    return {
      status: "unavailable",
      reason: "invalid_range",
      message: "Select a bounded A1 range such as A1:Z1000 on the exact Sheet tab.",
    };
  }

  const formattedRequestedRange = formatCsfSheetBounds(requestedRange);
  const valuesParams = new URLSearchParams();
  valuesParams.append("ranges", formattedRequestedRange);
  valuesParams.set("majorDimension", "ROWS");
  valuesParams.set("valueRenderOption", "FORMATTED_VALUE");

  let requestedValues: string[][];
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${valuesParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      logError(
        "Failed to read Google spreadsheet source values",
        new Error(`Sheets returned ${response.status}`),
        {
          sheet_id: spreadsheetId,
          range: formattedRequestedRange,
          status: response.status,
        },
      );
      return {
        status: "unavailable",
        reason: unavailableReasonForStatus(response.status),
        message: "The selected Sheet range could not be read; no rows were treated as empty.",
      };
    }
    const data = await response.json() as {
      valueRanges?: Array<{ values?: string[][] }>;
    };
    requestedValues = (data.valueRanges?.[0]?.values ?? []).map((row) =>
      // Preserve exact formatted values for the source digest. The importer
      // normalizes fields later, but whitespace-only source drift must still
      // produce a different acquisition snapshot.
      (row ?? []).map((cell) => String(cell ?? ""))
    );
  } catch (error) {
    logError("Exception while reading Google spreadsheet source values", error, {
      sheet_id: spreadsheetId,
      range: formattedRequestedRange,
    });
    return {
      status: "unavailable",
      reason: "unavailable",
      message: "The selected Sheet range could not be read; no rows were treated as empty.",
    };
  }

  const narrowed = narrowCsfSheetBoundsToPopulated(requestedRange, requestedValues);
  // Rows are narrowed to the populated block; the leading column is deliberately
  // left anchored to the officer's range. Saved column mappings are one-based
  // offsets into that range, so trimming leading empty columns here would
  // silently re-point every mapping a column to the left.
  const populatedRange = narrowed
    ? { ...narrowed, startColumn: requestedRange.startColumn }
    : null;

  // The metadata request is intentionally separate from the ranged grid read.
  // Sheets only returns tabs intersecting a `ranges` filter, while preflight
  // must disclose hidden sibling tabs as well as the selected tab.
  const metadataParams = new URLSearchParams({
    includeGridData: "false",
    fields: [
      "spreadsheetId",
      "properties.title",
      "sheets.properties(sheetId,title,hidden,sheetType,gridProperties(rowCount,columnCount))",
    ].join(","),
  });

  let metadata: SheetsGridResponse;
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}?${metadataParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      logError(
        "Failed to read Google spreadsheet tab inventory",
        new Error(`Sheets returned ${response.status}`),
        { sheet_id: spreadsheetId, status: response.status },
      );
      return {
        status: "unavailable",
        reason: unavailableReasonForStatus(response.status),
        message: "The selected Sheet could not be inspected; no rows were treated as empty.",
      };
    }
    metadata = await response.json() as SheetsGridResponse;
  } catch (error) {
    logError("Exception while reading Google spreadsheet tab inventory", error, {
      sheet_id: spreadsheetId,
    });
    return {
      status: "unavailable",
      reason: "unavailable",
      message: "The selected Sheet could not be inspected; no rows were treated as empty.",
    };
  }

  const tabs = (metadata.sheets ?? [])
    .map(tabEvidenceFrom)
    .filter((tab): tab is CsfSheetTabEvidence => tab !== null);
  const selectedTab = tabs.find((tab) => tab.tabName === requestedRange.tabName) ?? null;
  if (!selectedTab) {
    return {
      status: "unavailable",
      reason: "not_found",
      message: `The selected Sheet no longer contains a ${requestedRange.tabName} tab.`,
    };
  }

  // Inspect the complete officer-bounded range, not just the displayed-value
  // extent. This is how hidden rows and formula-filled template capacity remain
  // visible in preflight without treating grid capacity as import records.
  const params = new URLSearchParams();
  params.append("ranges", formattedRequestedRange);
  params.set("includeGridData", "true");
  params.set(
    "fields",
    [
      "sheets.properties(sheetId,title)",
      "sheets.basicFilter.range",
      "sheets.data(startRow,startColumn,rowMetadata(hiddenByUser,hiddenByFilter),rowData.values(formattedValue,effectiveValue,userEnteredValue.formulaValue))",
    ].join(","),
  );

  let grid: SheetsGridResponse;
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      const error = await response.text();
      logError("Failed to read Google spreadsheet acquisition evidence", new Error(error), {
        sheet_id: spreadsheetId,
        range: formattedRequestedRange,
        status: response.status,
      });
      return {
        status: "unavailable",
        reason: unavailableReasonForStatus(response.status),
        message: "The selected Sheet could not be inspected; no rows were treated as empty.",
      };
    }
    grid = await response.json() as SheetsGridResponse;
  } catch (error) {
    logError("Exception while reading Google spreadsheet acquisition evidence", error, {
      sheet_id: spreadsheetId,
      range: formattedRequestedRange,
    });
    return {
      status: "unavailable",
      reason: "unavailable",
      message: "The selected Sheet could not be inspected; no rows were treated as empty.",
    };
  }

  const selectedSheet = (grid.sheets ?? []).find(
    (sheet) => sheet.properties?.title === requestedRange.tabName,
  );
  if (!selectedSheet) {
    return {
      status: "unavailable",
      reason: "not_found",
      message: `The selected Sheet no longer contains a ${requestedRange.tabName} tab.`,
    };
  }
  const block = selectedSheet.data?.[0];
  const blockStartRow = (block?.startRow ?? requestedRange.startRow - 1) + 1;
  const blockStartColumn = (block?.startColumn ?? requestedRange.startColumn - 1) + 1;
  const rowMetadata = block?.rowMetadata ?? [];
  const rowData = block?.rowData ?? [];

  const structuralRows = Array.from(
    { length: Math.max(rowMetadata.length, rowData.length) },
    (_unused, offset) => {
      const metadata = rowMetadata[offset];
      const cells = rowData[offset]?.values ?? [];
      const formulaColumns = cells.flatMap((cell, cellOffset) =>
        typeof cell?.userEnteredValue?.formulaValue === "string"
          ? [blockStartColumn + cellOffset]
          : [],
      );
      const formulaDigests = cells.flatMap((cell, cellOffset) =>
        typeof cell?.userEnteredValue?.formulaValue === "string"
          ? [
              createHash("sha256")
                .update(
                  `${blockStartColumn + cellOffset}\u001f${cell.userEnteredValue.formulaValue}`,
                )
                .digest("hex"),
            ]
          : [],
      );
      return {
        sourceRowNumber: blockStartRow + offset,
        hiddenByUser: metadata?.hiddenByUser === true,
        hiddenByFilter: metadata?.hiddenByFilter === true,
        formulaColumns,
        formulaDigests,
        hasEffectiveValue: cells.some(
          (cell) => cell?.effectiveValue !== undefined
            && String(cell.formattedValue ?? "").trim() !== "",
        ),
      };
    },
  ).filter((row) =>
    row.hiddenByUser
    || row.hiddenByFilter
    || row.formulaColumns.length > 0
    || row.hasEffectiveValue
  );
  const structuralByRow = new Map(
    structuralRows.map((row) => [row.sourceRowNumber, row]),
  );
  const evidenceRowNumbers = new Set<number>(
    structuralRows.map((row) => row.sourceRowNumber),
  );
  requestedValues.forEach((values, offset) => {
    if (values.some((value) => String(value ?? "").trim() !== "")) {
      evidenceRowNumbers.add(requestedRange.startRow + offset);
    }
  });
  const rows: CsfSheetRowEvidence[] = [...evidenceRowNumbers]
    .sort((left, right) => left - right)
    .map((sourceRowNumber) => {
      const structural = structuralByRow.get(sourceRowNumber);
      return {
        sourceRowNumber,
        hiddenByUser: structural?.hiddenByUser === true,
        hiddenByFilter: structural?.hiddenByFilter === true,
        formulaColumns: structural?.formulaColumns ?? [],
        hasEffectiveValue: structural?.hasEffectiveValue === true,
        values: requestedValues[sourceRowNumber - requestedRange.startRow]?.slice(
          0,
          (populatedRange?.endColumn ?? requestedRange.startColumn)
            - requestedRange.startColumn
            + 1,
        ) ?? [],
      };
    });

  const contentHash = createHash("sha256")
    .update(JSON.stringify({
      requestedRange,
      populatedRange,
      tabs: tabs.map((tab) => ({
        tabName: tab.tabName,
        sheetId: tab.sheetId,
        visibility: tab.visibility,
      })),
      hasBasicFilter: Boolean(selectedSheet.basicFilter),
      rows,
      formulas: structuralRows.flatMap((row) =>
        row.formulaDigests.length > 0
          ? [{ sourceRowNumber: row.sourceRowNumber, digests: row.formulaDigests }]
          : []
      ),
    }))
    .digest("hex");

  return {
    status: "ok",
    spreadsheetId: metadata.spreadsheetId || spreadsheetId,
    spreadsheetTitle: metadata.properties?.title || "Untitled Spreadsheet",
    selectedTab,
    tabs,
    requestedRange,
    populatedRange,
    rows,
    contentHash,
    hasBasicFilter: Boolean(selectedSheet.basicFilter),
  };
}

/* -------------------------------------------------------------------------
 * Fenced multi-read acquisition.
 *
 * A preview reads a spreadsheet three ways per tab -- values, workbook metadata,
 * grid evidence -- and a multi-tab import repeats that per tab. Those are
 * separate HTTP requests against a document anybody with edit access can change
 * between them. Nothing prevented a source from being edited mid-read, and the
 * result was a provenance bundle that described no state the workbook was ever
 * actually in: values from before an edit, hidden-row evidence from after it,
 * and one content digest asserting they belong together.
 *
 * Fencing reads the Drive `version` and modified time before the first read and
 * again after the last, and refuses the acquisition if either moved. This cannot
 * make the reads atomic -- only the provider could -- but it does turn a silent
 * inconsistency into an explicit, retryable failure.
 *
 * Both coordinates are required, on both sides. `modifiedTime` alone has
 * one-second granularity, so an edit landing inside the same second as the
 * opening read is invisible to it; `version` advances on every server-side
 * change and is what makes that edit detectable. A fence missing either one
 * cannot show stability, so it is unavailable rather than assumed stable.
 * ---------------------------------------------------------------------------
 */

export type CsfSheetSourceFence = {
  /** The provider's exact `version` string. Never parsed as a number. */
  version: string | null;
  modifiedAt: string | null;
};

export type CsfFencedSheetRequest = {
  rangeA1: string;
  fallbackTabName: string;
};

export type CsfFencedSheetAcquisitionResult =
  | {
      status: "ok";
      fence: CsfSheetSourceFence;
      driveFile: CsfDriveFileMetadata;
      snapshots: CsfSheetSourceSnapshot[];
      attempts: number;
    }
  | {
      status: "unavailable";
      reason: CsfSheetSourceUnavailableReason;
      message: string;
    }
  | {
      status: "drift";
      message: string;
      before: CsfSheetSourceFence;
      after: CsfSheetSourceFence;
      attempts: number;
    };

function fenceOf(metadata: CsfDriveFileMetadata): CsfSheetSourceFence {
  return {
    version: metadata.version ?? null,
    modifiedAt: metadata.modifiedTime ?? null,
  };
}

/** Both coordinates, exactly. Either missing means stability cannot be shown. */
function fenceIsUsable(fence: CsfSheetSourceFence) {
  return fence.version !== null && fence.modifiedAt !== null;
}

/**
 * Exact agreement on both coordinates.
 *
 * An unchanged `modifiedAt` beside a changed `version` is the case this exists
 * for: the file was edited inside the same timestamp granule as the opening
 * read, and only the version says so.
 */
function fencesAgree(before: CsfSheetSourceFence, after: CsfSheetSourceFence) {
  return before.version === after.version && before.modifiedAt === after.modifiedAt;
}

const UNUSABLE_FENCE_MESSAGE =
  "The source file reports no version or modification time, so a consistent read cannot be proven.";

export async function acquireFencedCsfSheetSnapshots(
  accessToken: string,
  spreadsheetId: string,
  requests: readonly CsfFencedSheetRequest[],
  options: { maxAttempts?: number } = {},
): Promise<CsfFencedSheetAcquisitionResult> {
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 2));
  let lastBefore: CsfSheetSourceFence = { version: null, modifiedAt: null };
  let lastAfter: CsfSheetSourceFence = { version: null, modifiedAt: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = await getGoogleDriveFileMetadata(accessToken, spreadsheetId);
    if (before.accessState !== "accessible") {
      return {
        status: "unavailable",
        reason: before.accessState === "reconnect_required"
          ? "reconnect_required"
          : before.accessState === "not_found" || before.accessState === "trashed"
            ? "not_found"
            : "unavailable",
        message: "The source file could not be read before importing; no rows were treated as empty.",
      };
    }
    const beforeFence = fenceOf(before);
    if (!fenceIsUsable(beforeFence)) {
      // Without both the provider version and a modified time there is nothing
      // to compare against, so stability cannot be shown. Reporting success here
      // would be asserting something unproven about a student-data import.
      return {
        status: "unavailable",
        reason: "unavailable",
        message: UNUSABLE_FENCE_MESSAGE,
      };
    }

    const snapshots: CsfSheetSourceSnapshot[] = [];
    let failed: { reason: CsfSheetSourceUnavailableReason; message: string } | null = null;
    for (const request of requests) {
      const snapshot = await getCsfSheetSourceSnapshot(
        accessToken,
        spreadsheetId,
        request.rangeA1,
        request.fallbackTabName,
      );
      if (snapshot.status !== "ok") {
        failed = { reason: snapshot.reason, message: snapshot.message };
        break;
      }
      snapshots.push(snapshot);
    }
    if (failed) {
      return { status: "unavailable", reason: failed.reason, message: failed.message };
    }

    const after = await getGoogleDriveFileMetadata(accessToken, spreadsheetId);
    if (after.accessState !== "accessible") {
      return {
        status: "unavailable",
        reason: after.accessState === "reconnect_required"
          ? "reconnect_required"
          : after.accessState === "not_found" || after.accessState === "trashed"
            ? "not_found"
            : "unavailable",
        message: "The source file could not be re-checked after reading; no rows were treated as empty.",
      };
    }
    const afterFence = fenceOf(after);
    // The closing fence is held to the same requirement as the opening one.
    //
    // Both coordinates are also part of what makes a Drive answer `accessible`,
    // so in practice the reader above refuses an incomplete one first. This is
    // the second line of the same rule, kept because `fencesAgree` must never be
    // reached with a null on either side: a null-against-value comparison
    // reports "drift", which reads as "the file changed" when what actually
    // happened is that nothing was proven.
    if (!fenceIsUsable(afterFence)) {
      return {
        status: "unavailable",
        reason: "unavailable",
        message: UNUSABLE_FENCE_MESSAGE,
      };
    }
    lastBefore = beforeFence;
    lastAfter = afterFence;

    if (fencesAgree(beforeFence, afterFence)) {
      return {
        status: "ok",
        fence: afterFence,
        driveFile: after,
        snapshots,
        attempts: attempt,
      };
    }
  }

  return {
    status: "drift",
    message: "The source file changed while it was being read. Nothing was imported; preview it again.",
    before: lastBefore,
    after: lastAfter,
    attempts: maxAttempts,
  };
}

export async function appendSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: Array<Array<string | number | boolean | null>>,
  valueInputOption: SpreadsheetValueInputOption = "USER_ENTERED",
): Promise<boolean> {
  if (rows.length === 0) return true;

  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(
        range
      )}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range,
          majorDimension: "ROWS",
          values: rows,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError("Failed to append Google spreadsheet values", new Error(error), {
        sheet_id: sheetId,
        range,
        rows_count: rows.length,
      });
      return false;
    }

    return true;
  } catch (error) {
    logError("Exception while appending Google spreadsheet values", error, {
      sheet_id: sheetId,
      range,
      rows_count: rows.length,
    });
    return false;
  }
}
