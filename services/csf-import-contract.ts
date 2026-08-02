import "server-only";

import { createHash } from "node:crypto";

export const CSF_IMPORT_CONTRACT_VERSION = "csf-normalized-import/v1" as const;
export const CSF_IMPORT_MAX_ROWS = 25_000;

export const CSF_IMPORT_PROVIDERS = [
  "google_sheets",
  "google_drive",
  "gmail_attachment",
  "uploaded_file",
  "legacy_export",
] as const;

/**
 * The provider families whose evidence semantics this contract actually
 * defines.
 *
 * `CSF_IMPORT_PROVIDERS` is the historical enumeration of families the plugin
 * may one day acquire from. It is NOT a statement that each of them has a
 * checkable provenance model: `google_drive`, `gmail_attachment` and
 * `legacy_export` have no adapter, so there is no answer to "what is this
 * family's file identity, revision and time, and how does a later gate verify
 * them". Accepting one of those here would record a snapshot whose source
 * evidence nothing downstream can bind, which is exactly the fail-open the
 * exact-coordinate contract exists to close. They fail closed until their
 * adapters define those semantics.
 */
export const CSF_IMPORT_IMPLEMENTED_PROVIDERS = ["google_sheets", "uploaded_file"] as const;

export const CSF_IMPORT_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted_student",
] as const;

export type CsfImportProvider = (typeof CSF_IMPORT_PROVIDERS)[number];
export type CsfImportImplementedProvider = (typeof CSF_IMPORT_IMPLEMENTED_PROVIDERS)[number];
export type CsfImportSensitivity = (typeof CSF_IMPORT_SENSITIVITIES)[number];
export type CsfImportTermSelection = "officer_selected" | "published_policy";
export type CsfImportTabVisibility = "visible" | "hidden" | "very_hidden";
export type CsfImportRowVisibility = "visible" | "hidden" | "filtered_out";
export type CsfImportRowPopulation = "populated" | "formula_capacity" | "blank";

export type CsfImportJsonPrimitive = string | number | boolean | null;
export type CsfImportJsonValue =
  | CsfImportJsonPrimitive
  | ReadonlyArray<CsfImportJsonValue>
  | { readonly [key: string]: CsfImportJsonValue };
export type CsfImportJsonObject = { readonly [key: string]: CsfImportJsonValue };

export type CsfImportSourceInput = {
  /**
   * The acquired family, which selects the evidence grammar below. Only the
   * two families with adapters are accepted; see
   * {@link CSF_IMPORT_IMPLEMENTED_PROVIDERS}.
   */
  provider: CsfImportImplementedProvider;
  /**
   * Exact provider file identity, as written.
   *
   * `google_sheets`: the opaque Sheet id the provider itself returned.
   * `uploaded_file`: the claimed staging object's canonical lowercase UUID.
   *
   * Never trimmed, never case-folded. A padded identifier is a coordinate whose
   * recorded spelling is not the coordinate, and repairing it here would
   * manufacture the agreement every later gate exists to test.
   */
  fileId: string;
  /**
   * Exact freshness revision, required, and family-specific:
   *
   * `google_sheets`: Drive's `version`, as canonical bounded positive decimal
   *   int64 TEXT. A Docs Editors file has no content revision at all, so this
   *   is the only coordinate that moves when a Sheet is edited.
   * `uploaded_file`: the WHOLE-FILE lowercase sha256 of the claimed bytes.
   *
   * Deliberately not optional and deliberately not interchangeable. The
   * predecessor accepted "a revision or a modifiedAt, either will do", which
   * let a Google source carry an sha256, an upload carry a Drive version, and
   * either carry nothing but a timestamp.
   */
  revision: string;
  /**
   * Exact source time, required, and family-specific:
   *
   * `google_sheets`: Drive's own `modifiedTime` output spelling (UTC `Z`, with
   *   a fractional part of exactly 0, 3, 6 or 9 digits).
   * `uploaded_file`: the staging object's `readyAt`, as the database renders it.
   *
   * Returned in the exact spelling it was validated in. Re-rendering it through
   * `Date` would silently drop sub-millisecond digits the stored column keeps.
   */
  modifiedAt: string;
  contentHash: {
    algorithm: "sha256";
    /** Canonical LOWERCASE sha256 hex, as written. Never folded into validity. */
    value: string;
    scope: "file" | "selected_range";
  };
  populatedRange: {
    kind: "populated";
    tabName: string;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  };
  workbookTabs: ReadonlyArray<{
    tabName: string;
    visibility: CsfImportTabVisibility;
  }>;
  term: {
    id: string;
    code: string;
    selection: CsfImportTermSelection;
  };
  schemaVersion: string;
  importerVersion: string;
  sensitivity: CsfImportSensitivity;
};

export type CsfImportCandidateRow = {
  sourceRowNumber: number;
  visibility: CsfImportRowVisibility;
  population: CsfImportRowPopulation;
  /**
   * Source-specific adapters must map into canonical candidate fields before
   * this boundary. Original workbook rows and response payloads do not belong
   * in this contract.
   */
  candidateData: Readonly<Record<string, unknown>>;
};

export type CsfImportRejectedFieldReason =
  | "not_allowlisted"
  | "secret"
  | "raw_content"
  | "external_link"
  | "macro_or_formula"
  | "unsupported_value";

export type CsfImportWarningCode =
  | "hidden_tabs_present"
  | "selected_tab_hidden"
  | "hidden_rows_excluded"
  | "filtered_rows_excluded"
  | "formula_capacity_rows_excluded"
  | "blank_rows_excluded"
  | "empty_rows_excluded"
  | "rejected_fields_present"
  | "duplicate_rows_present"
  | "no_authoritative_rows";

export type CsfNormalizedImportSnapshot = {
  readonly contractVersion: typeof CSF_IMPORT_CONTRACT_VERSION;
  readonly source: {
    readonly provider: CsfImportImplementedProvider;
    readonly fileId: string;
    readonly revision: string;
    readonly modifiedAt: string;
    readonly contentHash: {
      readonly algorithm: "sha256";
      readonly value: string;
      readonly scope: "file" | "selected_range";
    };
    readonly populatedRange: {
      readonly kind: "populated";
      readonly tabName: string;
      readonly startRow: number;
      readonly endRow: number;
      readonly startColumn: number;
      readonly endColumn: number;
    };
    readonly workbookTabs: ReadonlyArray<{
      readonly tabName: string;
      readonly visibility: CsfImportTabVisibility;
    }>;
    readonly term: {
      readonly id: string;
      readonly code: string;
      readonly selection: CsfImportTermSelection;
    };
    readonly schemaVersion: string;
    readonly importerVersion: string;
    readonly sensitivity: CsfImportSensitivity;
  };
  readonly allowlistedPaths: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<{
    readonly sourceRowNumber: number;
    readonly normalizedData: CsfImportJsonObject;
    readonly rowHash: string;
  }>;
  readonly rejectedFields: ReadonlyArray<{
    readonly sourceRowNumber: number;
    readonly fieldPath: string;
    readonly fieldKeyHash: string;
    readonly reason: CsfImportRejectedFieldReason;
  }>;
  readonly diagnostics: {
    readonly hiddenTabs: ReadonlyArray<{
      readonly tabName: string;
      readonly visibility: "hidden" | "very_hidden";
    }>;
    readonly hiddenRows: ReadonlyArray<number>;
    readonly filteredOutRows: ReadonlyArray<number>;
    readonly formulaCapacityRows: ReadonlyArray<number>;
    readonly blankRows: ReadonlyArray<number>;
    readonly emptyAfterNormalizationRows: ReadonlyArray<number>;
    readonly duplicateRows: ReadonlyArray<{
      readonly rowHash: string;
      readonly sourceRowNumbers: ReadonlyArray<number>;
    }>;
  };
  readonly warnings: ReadonlyArray<{
    readonly code: CsfImportWarningCode;
    readonly count: number;
  }>;
  readonly preflightStatus: "clear" | "review_required";
  readonly snapshotHash: string;
};

type MutableJsonObject = { [key: string]: CsfImportJsonValue };

type AllowlistNode = {
  key: string;
  array: boolean;
  terminal: boolean;
  children: Map<string, AllowlistNode>;
};

type PathSegment = string | number;

type MutableRejectedField = {
  sourceRowNumber: number;
  fieldPath: string;
  fieldKeyHash: string;
  reason: CsfImportRejectedFieldReason;
};

const WARNING_ORDER: readonly CsfImportWarningCode[] = [
  "hidden_tabs_present",
  "selected_tab_hidden",
  "hidden_rows_excluded",
  "filtered_rows_excluded",
  "formula_capacity_rows_excluded",
  "blank_rows_excluded",
  "empty_rows_excluded",
  "rejected_fields_present",
  "duplicate_rows_present",
  "no_authoritative_rows",
];

const SAFE_DIAGNOSTIC_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const ALLOWLIST_PATH =
  /^[A-Za-z][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\])?)*$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
/**
 * A claimed staging object's own primary key: canonical lowercase 8-4-4-4-12.
 *
 * An uploaded workbook's file identity is the staging generation the preview
 * claimed, never the source row's mutable `uploaded_file_path`. Anything that
 * is not this shape is not an identity the commit boundary can bind.
 */
const STAGING_OBJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
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
/** A positive decimal integer with no sign, no leading zero, no separators. */
const PROVIDER_VERSION_SHAPE = /^[1-9][0-9]*$/u;
/** Drive documents `version` as an int64. This is its exact ceiling as text. */
const PROVIDER_VERSION_MAX = "9223372036854775807";
/**
 * Drive's OWN output spelling for `modifiedTime`: UTC `Z`, with a fractional
 * part of exactly 0, 3, 6 or 9 digits. A `+00:00`, a `-00:00` or a `.1234` is
 * not something the provider produced, so accepting one would accept a
 * coordinate authored somewhere between the provider and this contract.
 */
const DRIVE_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}|\d{6}|\d{9}))?Z$/u;
/**
 * A staging object's `readyAt`, which is a database `timestamptz` rendering
 * rather than provider text: PostgREST writes `+00:00`, PostgreSQL's own text
 * output may use a space separator and abbreviate a whole-hour offset. All of
 * those name an instant, so all are read -- but the zone must be EXPLICIT and
 * real, and the value must be unpadded.
 */
const STORED_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/u;
/** Gregorian month lengths. February is decided by the year, not this table. */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const URL_VALUE = /(?:https?|ftp):\/\/|mailto:|(?:^|\s)www\./iu;
const FORMULA_VALUE = /^(?:=|\+|@)|^-\s*[A-Za-z(@=+]/u;
const RAW_MARKUP_VALUE = /^\s*(?:<!doctype\s+html|<html\b|<script\b|<iframe\b)/iu;
const VBA_VALUE = /^\s*(?:attribute\s+vb_|(?:private\s+|public\s+)?(?:sub|function)\s+\w+)/iu;

const FORBIDDEN_SINGLE_TOKENS = new Map<
  string,
  Exclude<CsfImportRejectedFieldReason, "not_allowlisted" | "unsupported_value">
>([
  ["password", "secret"],
  ["passwd", "secret"],
  ["passphrase", "secret"],
  ["passcode", "secret"],
  ["secret", "secret"],
  ["token", "secret"],
  ["credential", "secret"],
  ["credentials", "secret"],
  ["authorization", "secret"],
  ["cookie", "secret"],
  ["raw", "raw_content"],
  ["payload", "raw_content"],
  ["html", "raw_content"],
  ["macro", "macro_or_formula"],
  ["macros", "macro_or_formula"],
  ["vba", "macro_or_formula"],
  ["vbaproject", "macro_or_formula"],
  ["hyperlink", "external_link"],
]);

function sha256(input: string | Uint8Array) {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCsfImportContent(input: string | Uint8Array) {
  return sha256(input);
}

/**
 * The ONE ordering rule every persisted CSF import digest depends on:
 * deterministic UTF-16 code-unit comparison.
 *
 * `String.prototype.localeCompare` with no locale argument uses the HOST's
 * default collation, which is an ambient input. ICU orders `a` before `A` in
 * most locales and after it in some, treats punctuation and combining marks as
 * ignorable at the primary strength, and tailors per language -- so a
 * selected-range manifest, a child manifest, a normalized row array or a
 * warnings list sorted on one machine could come out in a different order on
 * another, and the digest built over it would differ for one identical workbook.
 * A content address that depends on the machine that computed it is not a
 * content address.
 *
 * `<` and `>` on strings ARE the UTF-16 code-unit ordering the language
 * specifies, with no locale input at all. This is deliberately NOT "alphabetical
 * for a human": these arrays are hashed, not displayed, and the only property
 * required is a total order every runtime agrees on. Ordering meant for an
 * officer to read belongs at the presentation boundary, not here.
 */
export function compareCsfImportCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The one canonical-form failure. Separate from a plain TypeError so the
 * boundary can tell "this value cannot be canonicalized" apart from every other
 * validation error and refuse before anything is hashed or stored.
 */
export class CsfCanonicalFormError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CsfCanonicalFormError";
  }
}

/**
 * Keys a canonical record may carry.
 *
 * Deliberately ASCII-only. JCS orders object members by UTF-16 code unit, and
 * PostgreSQL has no UTF-16 collation -- for ASCII, `COLLATE "C"` byte order and
 * UTF-16 order are the same sequence, so restricting the key charset is what
 * makes the two implementations provably agree instead of agreeing by luck.
 * String *values* are unrestricted; only key spelling is narrowed.
 */
const CANONICAL_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

/**
 * RFC 8785 §3.2.2.3 number serialization: ECMAScript `Number::toString`.
 *
 * For a finite double `String(value)` *is* that algorithm, so this does not
 * reimplement it -- it only enforces the two preconditions JCS states, because
 * a non-finite value has no JSON spelling at all and `-0` and `0` are the same
 * number but not the same text.
 */
export function csfCanonicalNumber(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CsfCanonicalFormError(
      `A canonical number must be a finite IEEE-754 double; received ${String(value)}.`,
    );
  }
  return String(Object.is(value, -0) ? 0 : value);
}

/**
 * The exact decimal value a JSON number *literal* denotes, before any rounding.
 *
 * Exact, not shortest: `1.0000000000000001` and `1` have the same shortest
 * spelling but different exact values, and telling those apart is the entire
 * job here.
 */
// Written as constructor calls rather than `0n` literals: this module compiles
// under a target below ES2020, where BigInt *literals* are a syntax error but
// the BigInt function is available.
const BIG_ZERO = BigInt(0);
const BIG_TEN = BigInt(10);

/** Strip trailing decimal zeros so two spellings of one exact value compare equal. */
function normalizeExactDecimal(input: { negative: boolean; digits: bigint; exponent: number }) {
  let { digits, exponent } = input;
  if (digits === BIG_ZERO) return { negative: false, digits: BIG_ZERO, exponent: 0 };
  while (digits % BIG_TEN === BIG_ZERO) {
    digits /= BIG_TEN;
    exponent += 1;
  }
  return { negative: input.negative, digits, exponent };
}

const JSON_NUMBER_LITERAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

/** The exact decimal value a JSON number *literal* denotes, before any rounding. */
function exactDecimalOfLiteral(literal: string) {
  if (!JSON_NUMBER_LITERAL.test(literal)) {
    throw new CsfCanonicalFormError(`"${literal}" is not a JSON number literal.`);
  }
  const negative = literal.startsWith("-");
  const unsigned = negative ? literal.slice(1) : literal;
  const [mantissa, exponentText = "0"] = unsigned.split(/[eE]/u);
  const [integerPart, fractionPart = ""] = mantissa.split(".");
  return normalizeExactDecimal({
    negative,
    digits: BigInt(`${integerPart}${fractionPart}`),
    exponent: Number.parseInt(exponentText, 10) - fractionPart.length,
  });
}

/**
 * Whether a JSON number literal survives binary64 unchanged.
 *
 * A literal PostgreSQL can hold exactly in `numeric` but JavaScript silently
 * rounds -- `9007199254740993`, `1.0000000000000001` -- is not a number the two
 * sides can agree on. Accepting it would produce two different canonical
 * strings for one stored row, so it is refused before anything is hashed rather
 * than allowed to collide.
 */
export function isCsfCanonicalNumberLiteral(literal: string): boolean {
  const parsed = Number(literal);
  if (!Number.isFinite(parsed)) return false;

  // Round-trip through the canonical spelling and compare EXACT decimal values,
  // not spellings. Comparing spellings would reject `1e-6`, which canonicalizes
  // to `0.000001` and is a perfectly good literal; comparing the literal against
  // the double's own exact binary value would reject `0.1`, whose exact double
  // is 0.1000000000000000055511151231257827. What matters is only whether the
  // literal and its canonical form denote the same number.
  const fromLiteral = exactDecimalOfLiteral(literal);
  const fromCanonical = exactDecimalOfLiteral(csfCanonicalNumber(parsed));
  return (
    fromLiteral.digits === fromCanonical.digits &&
    fromLiteral.exponent === fromCanonical.exponent &&
    // -0 and 0 denote one number, so their signs are allowed to differ.
    (fromLiteral.digits === BIG_ZERO || fromLiteral.negative === fromCanonical.negative)
  );
}

/**
 * Parse JSON text under the canonical number contract.
 *
 * `JSON.parse` rounds silently, so a literal that binary64 cannot hold is gone
 * by the time a reviver sees it. The literals are therefore scanned in the
 * source text first, which is the only place the original digits still exist.
 */
export function parseCsfCanonicalJsonText(text: string): CsfImportJsonValue {
  if (typeof text !== "string") {
    throw new CsfCanonicalFormError("Canonical JSON text must be a string.");
  }
  // Number literals only: anything inside a string is skipped by consuming
  // whole string tokens, escapes included, before looking for numbers.
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      index += 1;
      while (index < text.length && text[index] !== '"') {
        index += text[index] === "\\" ? 2 : 1;
      }
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) continue;

    let end = index;
    while (end < text.length && /[-+.0-9eE]/u.test(text[end])) end += 1;
    const literal = text.slice(index, end);
    if (!isCsfCanonicalNumberLiteral(literal)) {
      throw new CsfCanonicalFormError(
        `The number ${literal} is not exactly representable as an IEEE-754 double, so it cannot have one canonical form.`,
      );
    }
    index = end - 1;
  }

  return JSON.parse(text) as CsfImportJsonValue;
}

function canonicalJson(value: CsfImportJsonValue): string {
  if (typeof value === "number") {
    return csfCanonicalNumber(value);
  }
  if (value === null || typeof value !== "object") {
    if (value !== null && typeof value !== "string" && typeof value !== "boolean") {
      throw new CsfCanonicalFormError(`A canonical value may not be ${typeof value}.`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const objectValue = value as CsfImportJsonObject;
  return `{${Object.keys(objectValue)
    // JCS orders members by UTF-16 code unit, which is what `Array.sort` does
    // by default. The key charset above keeps that identical to `COLLATE "C"`.
    .sort()
    .map((key) => {
      if (!CANONICAL_KEY.test(key)) {
        throw new CsfCanonicalFormError(
          `"${key}" is not a canonical object key; keys must match ${CANONICAL_KEY.source}.`,
        );
      }
      return `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`;
    })
    .join(",")}}`;
}

/**
 * The shared canonical form. One function, used by every producer of a digest
 * so no second serializer can drift away from the one PostgreSQL mirrors.
 */
export function csfCanonicalJson(value: CsfImportJsonValue): string {
  return canonicalJson(value);
}

/** Canonical form, then SHA-256. The only digest the import boundary accepts. */
export function csfCanonicalDigest(value: CsfImportJsonValue): string {
  return sha256(csfCanonicalJson(value));
}

export function hashCsfNormalizedImportRow(row: CsfImportJsonObject) {
  return sha256(canonicalJson(row));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function requiredBoundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * An exact provenance coordinate: a primitive string, nonempty, bounded, and
 * already unpadded -- returned in the spelling it arrived in.
 *
 * Deliberately NOT {@link requiredBoundedString}, which trims. Trimming an
 * identifier or a revision on the way in repaired ` 1AbC ` into `1AbC`, which
 * then compared equal to the coordinate it was supposed to be checked against.
 * Display strings keep the trimming reader; provenance does not.
 */
function exactCoordinate(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  if (value.length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  if (value.length > maxLength) {
    throw new TypeError(`${label} must be at most ${maxLength} characters.`);
  }
  if (EDGE_PADDING.test(value)) {
    throw new TypeError(`${label} must not be padded; an exact coordinate is taken as written.`);
  }
  return value;
}

/**
 * Drive's `version` as canonical bounded positive decimal int64 TEXT.
 *
 * Never touches `Number`, `parseInt` or `BigInt`: Drive serializes int64 fields
 * as JSON strings precisely because the value does not survive a double, and a
 * version past 2^53 rounds onto a neighbour it is not. With no leading zeros a
 * shorter string is the smaller integer and equal lengths compare
 * lexicographically in numeric order, so shape and bound are both decided on
 * the text.
 */
function isCanonicalProviderVersionText(value: string) {
  if (!PROVIDER_VERSION_SHAPE.test(value)) return false;
  if (value.length > PROVIDER_VERSION_MAX.length) return false;
  return !(value.length === PROVIDER_VERSION_MAX.length && value > PROVIDER_VERSION_MAX);
}

/**
 * Whether the captured fields name a day and a clock time that exist.
 *
 * A shape is not a date: `2026-02-30T00:00:00Z` satisfies every character class
 * in both grammars above, and so do 2025-02-29, April 31, hour 24 and second
 * 60. Hour 24 and second 60 are refused outright rather than rolled forward,
 * because a lenient parser moves them to a different instant instead of
 * representing them.
 */
function isRealCivilDateTime(fields: RegExpExecArray) {
  const [, year, month, day, hour, minute, second] = fields;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return false;
  const yearNumber = Number(year);
  // `0000` satisfies `\d{4}` and names a proleptic year PostgreSQL `timestamptz`
  // cannot retain as the same Gregorian year -- the AD era it stores has no year
  // zero, so a round trip returns 1 BC. A coordinate that cannot survive the
  // column it will be compared against is not evidence, in either grammar.
  if (yearNumber < 1) return false;
  const leap = (yearNumber % 4 === 0 && yearNumber % 100 !== 0) || yearNumber % 400 === 0;
  const dayCount = monthNumber === 2 ? (leap ? 29 : 28) : MONTH_LENGTHS[monthNumber - 1];
  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > dayCount) return false;
  return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

/**
 * A real numeric offset, or false. `-00:00` is RFC 3339's "offset unknown"
 * spelling: it names no zone at all, so reading it as UTC would invent evidence
 * rather than read it.
 */
function hasRealUtcOffset(zone: string) {
  if (zone === "Z") return true;
  const negative = zone[0] === "-";
  const hour = Number(zone.slice(1, 3));
  const minuteText = zone.slice(3).replace(":", "");
  const minute = minuteText.length === 0 ? 0 : Number(minuteText);
  if (hour > 23 || minute > 59) return false;
  return !(negative && hour === 0 && minute === 0);
}

/** Drive's own `modifiedTime` spelling, naming an instant that exists. */
function isProviderInstantText(value: string) {
  const fields = DRIVE_INSTANT.exec(value);
  if (fields === null || !isRealCivilDateTime(fields)) return false;
  // PostgreSQL `timestamptz` retains MICROseconds. A 9-digit fraction whose
  // final three digits are nonzero names a nanosecond the typed column never
  // stored, so no later comparison against the stored side can be honest about
  // it -- truncating it into equality would manufacture agreement. Refused here,
  // before a snapshot exists, and decided on the TEXT so no digit passes through
  // a numeric parse on the way to the answer.
  const fraction = fields[7] ?? "";
  return !(fraction.length === 9 && fraction.slice(6) !== "000");
}

/** A stored `timestamptz` rendering with an explicit real zone. */
function isStoredInstantText(value: string) {
  const fields = STORED_INSTANT.exec(value);
  return fields !== null && isRealCivilDateTime(fields) && hasRealUtcOffset(fields[8]);
}

/**
 * The one provenance decision in this contract: which coordinates a family
 * exposes, and what each of them must exactly be.
 *
 * Runtime discrimination, not a shared "revision or modifiedAt" shape. The
 * predecessor took either coordinate from either family and normalized both,
 * so a Google source carrying a content digest, an uploaded source carrying a
 * Drive version, and a source carrying only a timestamp were all accepted --
 * three snapshots whose recorded evidence no later gate can bind to anything.
 */
function validateSourceEvidence(input: CsfImportSourceInput) {
  switch (input.provider) {
    case "google_sheets": {
      const fileId = exactCoordinate(input.fileId, "source.fileId", 512);
      if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(fileId)) {
        throw new TypeError("source.fileId must be a provider identifier, not a public URL.");
      }
      const revision = exactCoordinate(input.revision, "source.revision", 256);
      if (!isCanonicalProviderVersionText(revision)) {
        throw new TypeError(
          "source.revision must be the provider's canonical positive int64 version text for a Google Sheets source.",
        );
      }
      const modifiedAt = exactCoordinate(input.modifiedAt, "source.modifiedAt", 64);
      if (!isProviderInstantText(modifiedAt)) {
        throw new TypeError(
          "source.modifiedAt must be the provider's own UTC modified-time spelling for a Google Sheets source.",
        );
      }
      return { provider: "google_sheets" as const, fileId, revision, modifiedAt };
    }
    case "uploaded_file": {
      const fileId = exactCoordinate(input.fileId, "source.fileId", 512);
      if (!STAGING_OBJECT_UUID.test(fileId)) {
        throw new TypeError(
          "source.fileId must be the claimed staging object identifier for an uploaded source.",
        );
      }
      // Required even when a valid ready time is also present. The time says
      // when the generation became readable; only the digest says which bytes.
      const revision = exactCoordinate(input.revision, "source.revision", 256);
      if (!SHA256_HEX.test(revision)) {
        throw new TypeError(
          "source.revision must be the canonical lowercase sha256 of the claimed bytes for an uploaded source.",
        );
      }
      const modifiedAt = exactCoordinate(input.modifiedAt, "source.modifiedAt", 64);
      if (!isStoredInstantText(modifiedAt)) {
        throw new TypeError(
          "source.modifiedAt must be the claimed staging object's ready timestamp for an uploaded source.",
        );
      }
      return { provider: "uploaded_file" as const, fileId, revision, modifiedAt };
    }
    default:
      throw new TypeError(
        "source.provider is not an implemented CSF import provider; its evidence semantics are undefined.",
      );
  }
}

function normalizedKeyTokens(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function hasTokenPair(tokens: readonly string[], first: string, second: string) {
  return tokens.includes(first) && tokens.includes(second);
}

function forbiddenKeyReason(
  key: string,
): Exclude<CsfImportRejectedFieldReason, "not_allowlisted" | "unsupported_value"> | null {
  const tokens = normalizedKeyTokens(key);
  for (const token of tokens) {
    const directReason = FORBIDDEN_SINGLE_TOKENS.get(token);
    if (directReason) {
      return directReason;
    }
  }

  if (
    hasTokenPair(tokens, "api", "key") ||
    hasTokenPair(tokens, "private", "key") ||
    hasTokenPair(tokens, "client", "secret") ||
    hasTokenPair(tokens, "access", "token") ||
    hasTokenPair(tokens, "refresh", "token") ||
    hasTokenPair(tokens, "auth", "token") ||
    hasTokenPair(tokens, "session", "token")
  ) {
    return "secret";
  }

  if (
    (tokens.includes("raw") &&
      ["body", "content", "data", "payload", "record", "row"].some((token) =>
        tokens.includes(token),
      )) ||
    (tokens.includes("source") &&
      ["body", "bytes", "content", "document", "payload"].some((token) =>
        tokens.includes(token),
      )) ||
    (tokens.includes("original") &&
      ["body", "content", "payload", "record", "row"].some((token) =>
        tokens.includes(token),
      ))
  ) {
    return "raw_content";
  }

  if (
    tokens.includes("external") &&
    ["href", "link", "links", "url", "urls"].some((token) => tokens.includes(token))
  ) {
    return "external_link";
  }

  return null;
}

function forbiddenValueReason(value: string): CsfImportRejectedFieldReason | null {
  if (FORMULA_VALUE.test(value.trim()) || VBA_VALUE.test(value)) {
    return "macro_or_formula";
  }
  if (RAW_MARKUP_VALUE.test(value)) {
    return "raw_content";
  }
  if (URL_VALUE.test(value.trim())) {
    return "external_link";
  }
  return null;
}

function safeDiagnosticPath(path: readonly PathSegment[]) {
  return path
    .map((segment, index) => {
      if (typeof segment === "number") {
        return `[${segment}]`;
      }
      const safeSegment = SAFE_DIAGNOSTIC_KEY.test(segment)
        ? segment
        : `field_${sha256(segment).slice(0, 12)}`;
      return index === 0 ? safeSegment : `.${safeSegment}`;
    })
    .join("");
}

function rejectField(
  rejectedFields: MutableRejectedField[],
  sourceRowNumber: number,
  path: readonly PathSegment[],
  reason: CsfImportRejectedFieldReason,
) {
  const fieldPath = safeDiagnosticPath(path);
  rejectedFields.push({
    sourceRowNumber,
    fieldPath,
    fieldKeyHash: sha256(path.map(String).join("\u001f")),
    reason,
  });
}

function parseAllowlistPath(path: string) {
  const normalized = requiredBoundedString(path, "allowlisted path", 256);
  if (!ALLOWLIST_PATH.test(normalized)) {
    throw new TypeError(
      `Invalid allowlisted path "${normalized}". Use canonical fields and [] for arrays.`,
    );
  }
  return normalized.split(".").map((segment) => ({
    key: segment.endsWith("[]") ? segment.slice(0, -2) : segment,
    array: segment.endsWith("[]"),
  }));
}

function buildAllowlist(paths: readonly string[]) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError("At least one allowlisted path is required.");
  }
  if (paths.length > 256) {
    throw new TypeError("At most 256 allowlisted paths are supported.");
  }

  const normalizedPaths = [...new Set(paths.map((path) => requiredBoundedString(path, "allowlisted path", 256)))].sort();
  if (normalizedPaths.length !== paths.length) {
    throw new TypeError("Allowlisted paths must be unique.");
  }

  const root = new Map<string, AllowlistNode>();
  for (const path of normalizedPaths) {
    const segments = parseAllowlistPath(path);
    let level = root;

    segments.forEach((segment, index) => {
      const forbiddenReason = forbiddenKeyReason(segment.key);
      if (forbiddenReason) {
        throw new TypeError(
          `Allowlisted path "${path}" contains a forbidden ${forbiddenReason} field.`,
        );
      }

      const existing = level.get(segment.key);
      if (existing && existing.array !== segment.array) {
        throw new TypeError(`Allowlisted path "${path}" conflicts on array shape.`);
      }
      const node =
        existing ??
        {
          key: segment.key,
          array: segment.array,
          terminal: false,
          children: new Map<string, AllowlistNode>(),
        };
      level.set(segment.key, node);

      if (node.terminal && index < segments.length - 1) {
        throw new TypeError(`Allowlisted path "${path}" extends a scalar field.`);
      }
      if (index === segments.length - 1) {
        if (node.children.size > 0) {
          throw new TypeError(`Allowlisted path "${path}" replaces an object field.`);
        }
        node.terminal = true;
      } else {
        level = node.children;
      }
    });
  }

  return { root, normalizedPaths };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeScalar(
  value: unknown,
  sourceRowNumber: number,
  path: readonly PathSegment[],
  rejectedFields: MutableRejectedField[],
): CsfImportJsonPrimitive | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string") {
      const reason = forbiddenValueReason(value);
      if (reason) {
        rejectField(rejectedFields, sourceRowNumber, path, reason);
        return undefined;
      }
    }
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }

  rejectField(rejectedFields, sourceRowNumber, path, "unsupported_value");
  return undefined;
}

function sanitizeNode(
  value: unknown,
  node: AllowlistNode,
  sourceRowNumber: number,
  path: readonly PathSegment[],
  rejectedFields: MutableRejectedField[],
): CsfImportJsonValue | undefined {
  if (node.array) {
    if (!Array.isArray(value)) {
      rejectField(rejectedFields, sourceRowNumber, path, "unsupported_value");
      return undefined;
    }

    const items: CsfImportJsonValue[] = [];
    value.forEach((item, index) => {
      const itemPath = [...path, index];
      if (node.children.size > 0) {
        if (!isPlainObject(item)) {
          rejectField(rejectedFields, sourceRowNumber, itemPath, "unsupported_value");
          return;
        }
        const sanitized = sanitizeObject(
          item,
          node.children,
          sourceRowNumber,
          itemPath,
          rejectedFields,
        );
        if (Object.keys(sanitized).length > 0) {
          items.push(sanitized);
        }
        return;
      }

      const sanitized = sanitizeScalar(item, sourceRowNumber, itemPath, rejectedFields);
      if (sanitized !== undefined) {
        items.push(sanitized);
      }
    });
    return items;
  }

  if (node.children.size > 0) {
    if (!isPlainObject(value)) {
      rejectField(rejectedFields, sourceRowNumber, path, "unsupported_value");
      return undefined;
    }
    const sanitized = sanitizeObject(
      value,
      node.children,
      sourceRowNumber,
      path,
      rejectedFields,
    );
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  return sanitizeScalar(value, sourceRowNumber, path, rejectedFields);
}

function sanitizeObject(
  value: Record<string, unknown>,
  allowlist: Map<string, AllowlistNode>,
  sourceRowNumber: number,
  path: readonly PathSegment[],
  rejectedFields: MutableRejectedField[],
) {
  const normalized: MutableJsonObject = {};

  for (const key of Object.keys(value).sort()) {
    const fieldPath = [...path, key];
    const forbiddenReason = forbiddenKeyReason(key);
    if (forbiddenReason) {
      rejectField(rejectedFields, sourceRowNumber, fieldPath, forbiddenReason);
      continue;
    }

    const node = allowlist.get(key);
    if (!node) {
      rejectField(rejectedFields, sourceRowNumber, fieldPath, "not_allowlisted");
      continue;
    }

    const sanitized = sanitizeNode(
      value[key],
      node,
      sourceRowNumber,
      fieldPath,
      rejectedFields,
    );
    if (sanitized !== undefined) {
      normalized[key] = sanitized;
    }
  }

  return normalized;
}

function hasSubstantiveValue(value: CsfImportJsonValue): boolean {
  if (value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasSubstantiveValue);
  }
  return Object.values(value).some(hasSubstantiveValue);
}

function validateSource(input: CsfImportSourceInput) {
  if (!CSF_IMPORT_SENSITIVITIES.includes(input.sensitivity)) {
    throw new TypeError("source.sensitivity is not supported.");
  }
  // Family first, then that family's own exact coordinates. Nothing below may
  // read `input.provider` again: the discriminated result IS the provenance.
  const evidence = validateSourceEvidence(input);

  // Read as written: `.toLowerCase()` here folded an uppercase digest into the
  // canonical form it is not, which destroys the one property a content
  // address has -- that it names exactly one sequence of bytes.
  if (
    typeof input.contentHash?.value !== "string" ||
    input.contentHash.algorithm !== "sha256" ||
    !SHA256_HEX.test(input.contentHash.value)
  ) {
    throw new TypeError("source.contentHash must be a canonical lowercase SHA-256 hex digest.");
  }
  if (!["file", "selected_range"].includes(input.contentHash.scope)) {
    throw new TypeError("source.contentHash.scope is not supported.");
  }

  if (input.populatedRange.kind !== "populated") {
    throw new TypeError("source.populatedRange must describe populated cells.");
  }
  const tabName = requiredBoundedString(
    input.populatedRange.tabName,
    "source.populatedRange.tabName",
    128,
  );
  const startRow = positiveInteger(input.populatedRange.startRow, "source.populatedRange.startRow");
  const endRow = positiveInteger(input.populatedRange.endRow, "source.populatedRange.endRow");
  const startColumn = positiveInteger(
    input.populatedRange.startColumn,
    "source.populatedRange.startColumn",
  );
  const endColumn = positiveInteger(
    input.populatedRange.endColumn,
    "source.populatedRange.endColumn",
  );
  if (startRow > endRow || startColumn > endColumn) {
    throw new TypeError("source.populatedRange bounds are reversed.");
  }

  if (!Array.isArray(input.workbookTabs) || input.workbookTabs.length === 0) {
    throw new TypeError("source.workbookTabs must include the selected tab.");
  }
  const seenTabs = new Set<string>();
  const workbookTabs = input.workbookTabs.map((tab) => {
    const normalizedTabName = requiredBoundedString(tab.tabName, "workbook tab name", 128);
    if (seenTabs.has(normalizedTabName)) {
      throw new TypeError(`Duplicate workbook tab "${normalizedTabName}".`);
    }
    seenTabs.add(normalizedTabName);
    if (!["visible", "hidden", "very_hidden"].includes(tab.visibility)) {
      throw new TypeError(`Workbook tab "${normalizedTabName}" has invalid visibility.`);
    }
    return { tabName: normalizedTabName, visibility: tab.visibility };
  });
  if (!seenTabs.has(tabName)) {
    throw new TypeError("source.workbookTabs does not contain the selected tab.");
  }

  const termId = requiredBoundedString(input.term.id, "source.term.id", 128);
  const termCode = requiredBoundedString(input.term.code, "source.term.code", 64);
  if (!["officer_selected", "published_policy"].includes(input.term.selection)) {
    throw new TypeError(
      "source.term.selection must be officer_selected or published_policy; filenames are not authority.",
    );
  }

  return {
    provider: evidence.provider,
    fileId: evidence.fileId,
    revision: evidence.revision,
    modifiedAt: evidence.modifiedAt,
    contentHash: {
      algorithm: "sha256" as const,
      value: input.contentHash.value,
      scope: input.contentHash.scope,
    },
    populatedRange: {
      kind: "populated" as const,
      tabName,
      startRow,
      endRow,
      startColumn,
      endColumn,
    },
    workbookTabs,
    term: {
      id: termId,
      code: termCode,
      selection: input.term.selection,
    },
    schemaVersion: requiredBoundedString(input.schemaVersion, "source.schemaVersion", 64),
    importerVersion: requiredBoundedString(input.importerVersion, "source.importerVersion", 64),
    sensitivity: input.sensitivity,
  };
}

export function buildCsfNormalizedImportSnapshot(input: {
  source: CsfImportSourceInput;
  allowlistedPaths: readonly string[];
  rows: readonly CsfImportCandidateRow[];
}): CsfNormalizedImportSnapshot {
  const source = validateSource(input.source);
  const { root: allowlist, normalizedPaths } = buildAllowlist(input.allowlistedPaths);

  if (!Array.isArray(input.rows)) {
    throw new TypeError("rows must be an array.");
  }
  if (input.rows.length > CSF_IMPORT_MAX_ROWS) {
    throw new TypeError(`At most ${CSF_IMPORT_MAX_ROWS} candidate rows are supported.`);
  }

  const seenRowNumbers = new Set<number>();
  const hiddenRows: number[] = [];
  const filteredOutRows: number[] = [];
  const formulaCapacityRows: number[] = [];
  const blankRows: number[] = [];
  const emptyAfterNormalizationRows: number[] = [];
  const rejectedFields: MutableRejectedField[] = [];
  const rows: Array<{
    sourceRowNumber: number;
    normalizedData: CsfImportJsonObject;
    rowHash: string;
  }> = [];

  for (const row of [...input.rows].sort((left, right) => left.sourceRowNumber - right.sourceRowNumber)) {
    const sourceRowNumber = positiveInteger(row.sourceRowNumber, "row.sourceRowNumber");
    if (
      sourceRowNumber < source.populatedRange.startRow ||
      sourceRowNumber > source.populatedRange.endRow
    ) {
      throw new TypeError(
        `Row ${sourceRowNumber} is outside the declared populated range.`,
      );
    }
    if (seenRowNumbers.has(sourceRowNumber)) {
      throw new TypeError(`Duplicate source row number ${sourceRowNumber}.`);
    }
    seenRowNumbers.add(sourceRowNumber);

    if (!["visible", "hidden", "filtered_out"].includes(row.visibility)) {
      throw new TypeError(`Row ${sourceRowNumber} has invalid visibility.`);
    }
    if (!["populated", "formula_capacity", "blank"].includes(row.population)) {
      throw new TypeError(`Row ${sourceRowNumber} has invalid population.`);
    }

    let excludeFromAuthoritativeRows = false;
    if (row.visibility === "hidden") {
      hiddenRows.push(sourceRowNumber);
      excludeFromAuthoritativeRows = true;
    }
    if (row.visibility === "filtered_out") {
      filteredOutRows.push(sourceRowNumber);
      excludeFromAuthoritativeRows = true;
    }
    if (row.population === "formula_capacity") {
      formulaCapacityRows.push(sourceRowNumber);
      excludeFromAuthoritativeRows = true;
    }
    if (row.population === "blank") {
      blankRows.push(sourceRowNumber);
      excludeFromAuthoritativeRows = true;
    }
    if (excludeFromAuthoritativeRows) {
      continue;
    }
    if (!isPlainObject(row.candidateData)) {
      throw new TypeError(`Row ${sourceRowNumber} candidateData must be a plain object.`);
    }

    const normalizedData = sanitizeObject(
      row.candidateData,
      allowlist,
      sourceRowNumber,
      [],
      rejectedFields,
    );
    if (!hasSubstantiveValue(normalizedData)) {
      emptyAfterNormalizationRows.push(sourceRowNumber);
      continue;
    }

    rows.push({
      sourceRowNumber,
      normalizedData,
      rowHash: hashCsfNormalizedImportRow(normalizedData),
    });
  }

  const rowsByHash = new Map<string, typeof rows>();
  for (const row of rows) {
    const matchingRows = rowsByHash.get(row.rowHash) ?? [];
    matchingRows.push(row);
    rowsByHash.set(row.rowHash, matchingRows);
  }
  const duplicateRows = [...rowsByHash.entries()]
    .filter(([, matchingRows]) => matchingRows.length > 1)
    .map(([rowHash, matchingRows]) => ({
      rowHash,
      sourceRowNumbers: matchingRows.map((row) => row.sourceRowNumber),
    }))
    .sort((left, right) => left.sourceRowNumbers[0] - right.sourceRowNumbers[0]);

  rejectedFields.sort(
    (left, right) =>
      left.sourceRowNumber - right.sourceRowNumber ||
      compareCsfImportCodeUnits(left.fieldPath, right.fieldPath) ||
      compareCsfImportCodeUnits(left.reason, right.reason),
  );

  const hiddenTabs = source.workbookTabs
    .filter(
      (
        tab,
      ): tab is {
        tabName: string;
        visibility: "hidden" | "very_hidden";
      } => tab.visibility !== "visible",
    )
    .map((tab) => ({ ...tab }));
  const selectedTab = source.workbookTabs.find(
    (tab) => tab.tabName === source.populatedRange.tabName,
  );

  const warningCounts = new Map<CsfImportWarningCode, number>();
  const warn = (code: CsfImportWarningCode, count: number) => {
    if (count > 0) {
      warningCounts.set(code, count);
    }
  };
  warn("hidden_tabs_present", hiddenTabs.length);
  warn("selected_tab_hidden", selectedTab?.visibility === "visible" ? 0 : 1);
  warn("hidden_rows_excluded", hiddenRows.length);
  warn("filtered_rows_excluded", filteredOutRows.length);
  warn("formula_capacity_rows_excluded", formulaCapacityRows.length);
  warn("blank_rows_excluded", blankRows.length);
  warn("empty_rows_excluded", emptyAfterNormalizationRows.length);
  warn("rejected_fields_present", rejectedFields.length);
  warn("duplicate_rows_present", duplicateRows.length);
  warn("no_authoritative_rows", rows.length === 0 ? 1 : 0);

  const warnings = WARNING_ORDER.flatMap((code) => {
    const count = warningCounts.get(code);
    return count ? [{ code, count }] : [];
  });

  const snapshotBody = {
    contractVersion: CSF_IMPORT_CONTRACT_VERSION,
    source,
    allowlistedPaths: normalizedPaths,
    rows,
    rejectedFields,
    diagnostics: {
      hiddenTabs,
      hiddenRows,
      filteredOutRows,
      formulaCapacityRows,
      blankRows,
      emptyAfterNormalizationRows,
      duplicateRows,
    },
    warnings,
    preflightStatus: warnings.length === 0 ? ("clear" as const) : ("review_required" as const),
  };
  const snapshotHash = sha256(
    canonicalJson(snapshotBody as unknown as CsfImportJsonValue),
  );

  return deepFreeze({
    ...snapshotBody,
    snapshotHash,
  });
}
