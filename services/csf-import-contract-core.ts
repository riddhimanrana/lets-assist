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
export const CSF_IMPORT_IMPLEMENTED_PROVIDERS = [
  "google_sheets",
  "uploaded_file",
] as const;

export const CSF_IMPORT_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted_student",
] as const;

export type CsfImportProvider = (typeof CSF_IMPORT_PROVIDERS)[number];
export type CsfImportImplementedProvider =
  (typeof CSF_IMPORT_IMPLEMENTED_PROVIDERS)[number];
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
export type CsfImportJsonObject = {
  readonly [key: string]: CsfImportJsonValue;
};

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

export type MutableJsonObject = { [key: string]: CsfImportJsonValue };

export type AllowlistNode = {
  key: string;
  array: boolean;
  terminal: boolean;
  children: Map<string, AllowlistNode>;
};

export type PathSegment = string | number;

export type MutableRejectedField = {
  sourceRowNumber: number;
  fieldPath: string;
  fieldKeyHash: string;
  reason: CsfImportRejectedFieldReason;
};

export const WARNING_ORDER: readonly CsfImportWarningCode[] = [
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

export const SAFE_DIAGNOSTIC_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
export const ALLOWLIST_PATH =
  /^[A-Za-z][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\])?)*$/u;
export const SHA256_HEX = /^[a-f0-9]{64}$/u;
/**
 * A claimed staging object's own primary key: canonical lowercase 8-4-4-4-12.
 *
 * An uploaded workbook's file identity is the staging generation the preview
 * claimed, never the source row's mutable `uploaded_file_path`. Anything that
 * is not this shape is not an identity the commit boundary can bind.
 */
export const STAGING_OBJECT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/**
 * Edge padding DETECTION for an exact coordinate. Never repair.
 *
 * The three properties are named rather than approximated: `\s` misses U+0085,
 * ECMAScript `trim()` misses U+200B and NUL, and `Cf` is where the invisible
 * formatting characters live. Only the EDGES are refused -- an opaque provider
 * identifier stays opaque, so an ordinary internal character is not this
 * boundary's business.
 */
export const EDGE_PADDING =
  /^[\p{White_Space}\p{Cc}\p{Cf}]|[\p{White_Space}\p{Cc}\p{Cf}]$/u;
/** A positive decimal integer with no sign, no leading zero, no separators. */
export const PROVIDER_VERSION_SHAPE = /^[1-9][0-9]*$/u;
/** Drive documents `version` as an int64. This is its exact ceiling as text. */
export const PROVIDER_VERSION_MAX = "9223372036854775807";
/**
 * Drive's OWN output spelling for `modifiedTime`: UTC `Z`, with a fractional
 * part of exactly 0, 3, 6 or 9 digits. A `+00:00`, a `-00:00` or a `.1234` is
 * not something the provider produced, so accepting one would accept a
 * coordinate authored somewhere between the provider and this contract.
 */
export const DRIVE_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}|\d{6}|\d{9}))?Z$/u;
/**
 * A staging object's `readyAt`, which is a database `timestamptz` rendering
 * rather than provider text: PostgREST writes `+00:00`, PostgreSQL's own text
 * output may use a space separator and abbreviate a whole-hour offset. All of
 * those name an instant, so all are read -- but the zone must be EXPLICIT and
 * real, and the value must be unpadded.
 */
export const STORED_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/u;
/** Gregorian month lengths. February is decided by the year, not this table. */
export const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const URL_VALUE = /(?:https?|ftp):\/\/|mailto:|(?:^|\s)www\./iu;
export const FORMULA_VALUE = /^(?:=|\+|@)|^-\s*[A-Za-z(@=+]/u;
export const RAW_MARKUP_VALUE =
  /^\s*(?:<!doctype\s+html|<html\b|<script\b|<iframe\b)/iu;
export const VBA_VALUE =
  /^\s*(?:attribute\s+vb_|(?:private\s+|public\s+)?(?:sub|function)\s+\w+)/iu;

export const FORBIDDEN_SINGLE_TOKENS = new Map<
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

export function sha256(input: string | Uint8Array) {
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
export const CANONICAL_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

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
export const BIG_ZERO = BigInt(0);
export const BIG_TEN = BigInt(10);

/** Strip trailing decimal zeros so two spellings of one exact value compare equal. */
export function normalizeExactDecimal(input: {
  negative: boolean;
  digits: bigint;
  exponent: number;
}) {
  let { digits, exponent } = input;
  if (digits === BIG_ZERO)
    return { negative: false, digits: BIG_ZERO, exponent: 0 };
  while (digits % BIG_TEN === BIG_ZERO) {
    digits /= BIG_TEN;
    exponent += 1;
  }
  return { negative: input.negative, digits, exponent };
}

export const JSON_NUMBER_LITERAL =
  /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

/** The exact decimal value a JSON number *literal* denotes, before any rounding. */
export function exactDecimalOfLiteral(literal: string) {
  if (!JSON_NUMBER_LITERAL.test(literal)) {
    throw new CsfCanonicalFormError(
      `"${literal}" is not a JSON number literal.`,
    );
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
    (fromLiteral.digits === BIG_ZERO ||
      fromLiteral.negative === fromCanonical.negative)
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

export function canonicalJson(value: CsfImportJsonValue): string {
  if (typeof value === "number") {
    return csfCanonicalNumber(value);
  }
  if (value === null || typeof value !== "object") {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean"
    ) {
      throw new CsfCanonicalFormError(
        `A canonical value may not be ${typeof value}.`,
      );
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
