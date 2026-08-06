import "server-only";

import {
  CSF_IMPORT_CONTRACT_VERSION,
  CSF_IMPORT_MAX_ROWS,
  CSF_IMPORT_SENSITIVITIES,
  SHA256_HEX,
  WARNING_ORDER,
  canonicalJson,
  compareCsfImportCodeUnits,
  hashCsfNormalizedImportRow,
  sha256,
  type CsfImportCandidateRow,
  type CsfImportJsonObject,
  type CsfImportJsonValue,
  type CsfImportSourceInput,
  type CsfImportWarningCode,
  type CsfNormalizedImportSnapshot,
  type MutableRejectedField,
} from "./csf-import-contract-core";
import {
  buildAllowlist,
  deepFreeze,
  hasSubstantiveValue,
  isPlainObject,
  positiveInteger,
  requiredBoundedString,
  sanitizeObject,
  validateSourceEvidence,
} from "./csf-import-contract-sanitize";

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
    throw new TypeError(
      "source.contentHash must be a canonical lowercase SHA-256 hex digest.",
    );
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
  const startRow = positiveInteger(
    input.populatedRange.startRow,
    "source.populatedRange.startRow",
  );
  const endRow = positiveInteger(
    input.populatedRange.endRow,
    "source.populatedRange.endRow",
  );
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
    const normalizedTabName = requiredBoundedString(
      tab.tabName,
      "workbook tab name",
      128,
    );
    if (seenTabs.has(normalizedTabName)) {
      throw new TypeError(`Duplicate workbook tab "${normalizedTabName}".`);
    }
    seenTabs.add(normalizedTabName);
    if (!["visible", "hidden", "very_hidden"].includes(tab.visibility)) {
      throw new TypeError(
        `Workbook tab "${normalizedTabName}" has invalid visibility.`,
      );
    }
    return { tabName: normalizedTabName, visibility: tab.visibility };
  });
  if (!seenTabs.has(tabName)) {
    throw new TypeError(
      "source.workbookTabs does not contain the selected tab.",
    );
  }

  const termId = requiredBoundedString(input.term.id, "source.term.id", 128);
  const termCode = requiredBoundedString(
    input.term.code,
    "source.term.code",
    64,
  );
  if (
    !["officer_selected", "published_policy"].includes(input.term.selection)
  ) {
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
    schemaVersion: requiredBoundedString(
      input.schemaVersion,
      "source.schemaVersion",
      64,
    ),
    importerVersion: requiredBoundedString(
      input.importerVersion,
      "source.importerVersion",
      64,
    ),
    sensitivity: input.sensitivity,
  };
}

export function buildCsfNormalizedImportSnapshot(input: {
  source: CsfImportSourceInput;
  allowlistedPaths: readonly string[];
  rows: readonly CsfImportCandidateRow[];
}): CsfNormalizedImportSnapshot {
  const source = validateSource(input.source);
  const { root: allowlist, normalizedPaths } = buildAllowlist(
    input.allowlistedPaths,
  );

  if (!Array.isArray(input.rows)) {
    throw new TypeError("rows must be an array.");
  }
  if (input.rows.length > CSF_IMPORT_MAX_ROWS) {
    throw new TypeError(
      `At most ${CSF_IMPORT_MAX_ROWS} candidate rows are supported.`,
    );
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

  for (const row of [...input.rows].sort(
    (left, right) => left.sourceRowNumber - right.sourceRowNumber,
  )) {
    const sourceRowNumber = positiveInteger(
      row.sourceRowNumber,
      "row.sourceRowNumber",
    );
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
      throw new TypeError(
        `Row ${sourceRowNumber} candidateData must be a plain object.`,
      );
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
    .sort(
      (left, right) => left.sourceRowNumbers[0] - right.sourceRowNumbers[0],
    );

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
    preflightStatus:
      warnings.length === 0 ? ("clear" as const) : ("review_required" as const),
  };
  const snapshotHash = sha256(
    canonicalJson(snapshotBody as unknown as CsfImportJsonValue),
  );

  return deepFreeze({
    ...snapshotBody,
    snapshotHash,
  });
}
