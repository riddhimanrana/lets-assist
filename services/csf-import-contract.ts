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

export const CSF_IMPORT_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted_student",
] as const;

export type CsfImportProvider = (typeof CSF_IMPORT_PROVIDERS)[number];
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
  provider: CsfImportProvider;
  fileId: string;
  revision?: string | null;
  modifiedAt?: string | Date | null;
  contentHash: {
    algorithm: "sha256";
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
    readonly provider: CsfImportProvider;
    readonly fileId: string;
    readonly revision: string | null;
    readonly modifiedAt: string | null;
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

function canonicalJson(value: CsfImportJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const objectValue = value as CsfImportJsonObject;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
    .join(",")}}`;
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

function normalizeModifiedAt(value: string | Date | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("source.modifiedAt must be a valid timestamp.");
  }
  return date.toISOString();
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
  if (!CSF_IMPORT_PROVIDERS.includes(input.provider)) {
    throw new TypeError("source.provider is not supported.");
  }
  if (!CSF_IMPORT_SENSITIVITIES.includes(input.sensitivity)) {
    throw new TypeError("source.sensitivity is not supported.");
  }

  const fileId = requiredBoundedString(input.fileId, "source.fileId", 512);
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(fileId)) {
    throw new TypeError("source.fileId must be a provider identifier, not a public URL.");
  }

  const revision =
    input.revision === null || input.revision === undefined || input.revision === ""
      ? null
      : requiredBoundedString(input.revision, "source.revision", 256);
  const modifiedAt = normalizeModifiedAt(input.modifiedAt);
  if (!revision && !modifiedAt) {
    throw new TypeError("source requires a revision or modifiedAt timestamp.");
  }

  if (
    input.contentHash.algorithm !== "sha256" ||
    !SHA256_HEX.test(input.contentHash.value.toLowerCase())
  ) {
    throw new TypeError("source.contentHash must be a SHA-256 hex digest.");
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
    provider: input.provider,
    fileId,
    revision,
    modifiedAt,
    contentHash: {
      algorithm: "sha256" as const,
      value: input.contentHash.value.toLowerCase(),
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
      left.fieldPath.localeCompare(right.fieldPath) ||
      left.reason.localeCompare(right.reason),
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
