import "server-only";

import {
  ALLOWLIST_PATH,
  DRIVE_INSTANT,
  EDGE_PADDING,
  FORBIDDEN_SINGLE_TOKENS,
  FORMULA_VALUE,
  MONTH_LENGTHS,
  PROVIDER_VERSION_MAX,
  PROVIDER_VERSION_SHAPE,
  RAW_MARKUP_VALUE,
  SAFE_DIAGNOSTIC_KEY,
  SHA256_HEX,
  STAGING_OBJECT_UUID,
  STORED_INSTANT,
  URL_VALUE,
  VBA_VALUE,
  sha256,
  type AllowlistNode,
  type CsfImportJsonPrimitive,
  type CsfImportJsonValue,
  type CsfImportRejectedFieldReason,
  type CsfImportSourceInput,
  type MutableJsonObject,
  type MutableRejectedField,
  type PathSegment,
} from "./csf-import-contract-core";

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function requiredBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
) {
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

export function positiveInteger(value: unknown, label: string) {
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
export function exactCoordinate(
  value: unknown,
  label: string,
  maxLength: number,
) {
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
    throw new TypeError(
      `${label} must not be padded; an exact coordinate is taken as written.`,
    );
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
export function isCanonicalProviderVersionText(value: string) {
  if (!PROVIDER_VERSION_SHAPE.test(value)) return false;
  if (value.length > PROVIDER_VERSION_MAX.length) return false;
  return !(
    value.length === PROVIDER_VERSION_MAX.length && value > PROVIDER_VERSION_MAX
  );
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
export function isRealCivilDateTime(fields: RegExpExecArray) {
  const [, year, month, day, hour, minute, second] = fields;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return false;
  const yearNumber = Number(year);
  // `0000` satisfies `\d{4}` and names a proleptic year PostgreSQL `timestamptz`
  // cannot retain as the same Gregorian year -- the AD era it stores has no year
  // zero, so a round trip returns 1 BC. A coordinate that cannot survive the
  // column it will be compared against is not evidence, in either grammar.
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
 * A real numeric offset, or false. `-00:00` is RFC 3339's "offset unknown"
 * spelling: it names no zone at all, so reading it as UTC would invent evidence
 * rather than read it.
 */
export function hasRealUtcOffset(zone: string) {
  if (zone === "Z") return true;
  const negative = zone[0] === "-";
  const hour = Number(zone.slice(1, 3));
  const minuteText = zone.slice(3).replace(":", "");
  const minute = minuteText.length === 0 ? 0 : Number(minuteText);
  if (hour > 23 || minute > 59) return false;
  return !(negative && hour === 0 && minute === 0);
}

/** Drive's own `modifiedTime` spelling, naming an instant that exists. */
export function isProviderInstantText(value: string) {
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
export function isStoredInstantText(value: string) {
  const fields = STORED_INSTANT.exec(value);
  return (
    fields !== null &&
    isRealCivilDateTime(fields) &&
    hasRealUtcOffset(fields[8])
  );
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
export function validateSourceEvidence(input: CsfImportSourceInput) {
  switch (input.provider) {
    case "google_sheets": {
      const fileId = exactCoordinate(input.fileId, "source.fileId", 512);
      if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(fileId)) {
        throw new TypeError(
          "source.fileId must be a provider identifier, not a public URL.",
        );
      }
      const revision = exactCoordinate(input.revision, "source.revision", 256);
      if (!isCanonicalProviderVersionText(revision)) {
        throw new TypeError(
          "source.revision must be the provider's canonical positive int64 version text for a Google Sheets source.",
        );
      }
      const modifiedAt = exactCoordinate(
        input.modifiedAt,
        "source.modifiedAt",
        64,
      );
      if (!isProviderInstantText(modifiedAt)) {
        throw new TypeError(
          "source.modifiedAt must be the provider's own UTC modified-time spelling for a Google Sheets source.",
        );
      }
      return {
        provider: "google_sheets" as const,
        fileId,
        revision,
        modifiedAt,
      };
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
      const modifiedAt = exactCoordinate(
        input.modifiedAt,
        "source.modifiedAt",
        64,
      );
      if (!isStoredInstantText(modifiedAt)) {
        throw new TypeError(
          "source.modifiedAt must be the claimed staging object's ready timestamp for an uploaded source.",
        );
      }
      return {
        provider: "uploaded_file" as const,
        fileId,
        revision,
        modifiedAt,
      };
    }
    default:
      throw new TypeError(
        "source.provider is not an implemented CSF import provider; its evidence semantics are undefined.",
      );
  }
}

export function normalizedKeyTokens(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

export function hasTokenPair(
  tokens: readonly string[],
  first: string,
  second: string,
) {
  return tokens.includes(first) && tokens.includes(second);
}

export function forbiddenKeyReason(
  key: string,
): Exclude<
  CsfImportRejectedFieldReason,
  "not_allowlisted" | "unsupported_value"
> | null {
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
    ["href", "link", "links", "url", "urls"].some((token) =>
      tokens.includes(token),
    )
  ) {
    return "external_link";
  }

  return null;
}

export function forbiddenValueReason(
  value: string,
): CsfImportRejectedFieldReason | null {
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

export function safeDiagnosticPath(path: readonly PathSegment[]) {
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

export function rejectField(
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

export function parseAllowlistPath(path: string) {
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

export function buildAllowlist(paths: readonly string[]) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError("At least one allowlisted path is required.");
  }
  if (paths.length > 256) {
    throw new TypeError("At most 256 allowlisted paths are supported.");
  }

  const normalizedPaths = [
    ...new Set(
      paths.map((path) => requiredBoundedString(path, "allowlisted path", 256)),
    ),
  ].sort();
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
        throw new TypeError(
          `Allowlisted path "${path}" conflicts on array shape.`,
        );
      }
      const node = existing ?? {
        key: segment.key,
        array: segment.array,
        terminal: false,
        children: new Map<string, AllowlistNode>(),
      };
      level.set(segment.key, node);

      if (node.terminal && index < segments.length - 1) {
        throw new TypeError(
          `Allowlisted path "${path}" extends a scalar field.`,
        );
      }
      if (index === segments.length - 1) {
        if (node.children.size > 0) {
          throw new TypeError(
            `Allowlisted path "${path}" replaces an object field.`,
          );
        }
        node.terminal = true;
      } else {
        level = node.children;
      }
    });
  }

  return { root, normalizedPaths };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sanitizeScalar(
  value: unknown,
  sourceRowNumber: number,
  path: readonly PathSegment[],
  rejectedFields: MutableRejectedField[],
): CsfImportJsonPrimitive | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
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

export function sanitizeNode(
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
          rejectField(
            rejectedFields,
            sourceRowNumber,
            itemPath,
            "unsupported_value",
          );
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

      const sanitized = sanitizeScalar(
        item,
        sourceRowNumber,
        itemPath,
        rejectedFields,
      );
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

export function sanitizeObject(
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
      rejectField(
        rejectedFields,
        sourceRowNumber,
        fieldPath,
        "not_allowlisted",
      );
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

export function hasSubstantiveValue(value: CsfImportJsonValue): boolean {
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
