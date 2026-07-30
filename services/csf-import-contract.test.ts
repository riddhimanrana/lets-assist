import { describe, expect, mock, test } from "bun:test";

import type {
  CsfImportCandidateRow,
  CsfImportSourceInput,
  CsfNormalizedImportSnapshot,
} from "./csf-import-contract";

mock.module("server-only", () => ({}));

const {
  buildCsfNormalizedImportSnapshot,
  hashCsfImportContent,
  hashCsfNormalizedImportRow,
} = await import("./csf-import-contract");

const SYNTHETIC_SOURCE_CONTENT = [
  "response_email,preferred_contact_email,course,grade",
  "avery.member@example.test,avery.family@example.test,Honors English,A",
].join("\n");

function sourceInput(
  overrides: Partial<CsfImportSourceInput> = {},
): CsfImportSourceInput {
  return {
    provider: "google_sheets",
    fileId: "synthetic-sheet-file-id",
    revision: "synthetic-revision-7",
    modifiedAt: "2026-07-29T19:30:00.000Z",
    contentHash: {
      algorithm: "sha256",
      value: hashCsfImportContent(SYNTHETIC_SOURCE_CONTENT),
      scope: "selected_range",
    },
    populatedRange: {
      kind: "populated",
      tabName: "Synthetic applications",
      startRow: 1,
      endRow: 20,
      startColumn: 1,
      endColumn: 8,
    },
    workbookTabs: [
      {
        tabName: "Synthetic applications",
        visibility: "visible",
      },
    ],
    term: {
      id: "00000000-0000-4000-8000-000000000026",
      code: "spring-2026",
      selection: "officer_selected",
    },
    schemaVersion: "application-v2",
    importerVersion: "csf-applications@1.0.0",
    sensitivity: "restricted_student",
    ...overrides,
  };
}

function visibleRow(
  sourceRowNumber: number,
  candidateData: Record<string, unknown>,
): CsfImportCandidateRow {
  return {
    sourceRowNumber,
    visibility: "visible",
    population: "populated",
    candidateData,
  };
}

function buildSnapshot(input?: {
  source?: CsfImportSourceInput;
  allowlistedPaths?: readonly string[];
  rows?: readonly CsfImportCandidateRow[];
}) {
  return buildCsfNormalizedImportSnapshot({
    source: input?.source ?? sourceInput(),
    allowlistedPaths: input?.allowlistedPaths ?? [
      "responseEmail",
      "preferredContactEmail",
      "courses[].name",
      "courses[].grade",
    ],
    rows:
      input?.rows ??
      [
        visibleRow(2, {
          responseEmail: "avery.member@example.test",
          preferredContactEmail: "avery.family@example.test",
          courses: [{ name: "Honors English", grade: "A" }],
        }),
      ],
  });
}

function assertDeepFrozen(snapshot: CsfNormalizedImportSnapshot) {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.source)).toBe(true);
  expect(Object.isFrozen(snapshot.source.contentHash)).toBe(true);
  expect(Object.isFrozen(snapshot.source.populatedRange)).toBe(true);
  expect(Object.isFrozen(snapshot.source.workbookTabs)).toBe(true);
  expect(Object.isFrozen(snapshot.source.workbookTabs[0])).toBe(true);
  expect(Object.isFrozen(snapshot.source.term)).toBe(true);
  expect(Object.isFrozen(snapshot.rows)).toBe(true);
  expect(Object.isFrozen(snapshot.rows[0])).toBe(true);
  expect(Object.isFrozen(snapshot.rows[0].normalizedData)).toBe(true);
  expect(Object.isFrozen(snapshot.rejectedFields)).toBe(true);
  expect(Object.isFrozen(snapshot.diagnostics)).toBe(true);
  expect(Object.isFrozen(snapshot.warnings)).toBe(true);
}

describe("CSF normalized import contract", () => {
  test("builds an immutable, explicit source snapshot without retaining its input objects", () => {
    const candidate = {
      responseEmail: "avery.member@example.test",
      preferredContactEmail: "avery.family@example.test",
      courses: [{ grade: "A", name: "Honors English" }],
    };
    const snapshot = buildSnapshot({
      rows: [visibleRow(2, candidate)],
    });

    expect(snapshot.contractVersion).toBe("csf-normalized-import/v1");
    expect(snapshot.source).toEqual({
      provider: "google_sheets",
      fileId: "synthetic-sheet-file-id",
      revision: "synthetic-revision-7",
      modifiedAt: "2026-07-29T19:30:00.000Z",
      contentHash: {
        algorithm: "sha256",
        value: hashCsfImportContent(SYNTHETIC_SOURCE_CONTENT),
        scope: "selected_range",
      },
      populatedRange: {
        kind: "populated",
        tabName: "Synthetic applications",
        startRow: 1,
        endRow: 20,
        startColumn: 1,
        endColumn: 8,
      },
      workbookTabs: [
        {
          tabName: "Synthetic applications",
          visibility: "visible",
        },
      ],
      term: {
        id: "00000000-0000-4000-8000-000000000026",
        code: "spring-2026",
        selection: "officer_selected",
      },
      schemaVersion: "application-v2",
      importerVersion: "csf-applications@1.0.0",
      sensitivity: "restricted_student",
    });
    expect(snapshot.allowlistedPaths).toEqual([
      "courses[].grade",
      "courses[].name",
      "preferredContactEmail",
      "responseEmail",
    ]);
    expect(snapshot.rows).toEqual([
      {
        sourceRowNumber: 2,
        normalizedData: candidate,
        rowHash: hashCsfNormalizedImportRow(candidate),
      },
    ]);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.preflightStatus).toBe("clear");
    expect(snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    assertDeepFrozen(snapshot);

    candidate.courses[0].grade = "B";
    candidate.responseEmail = "changed@example.test";
    expect(snapshot.rows[0].normalizedData).toEqual({
      courses: [{ grade: "A", name: "Honors English" }],
      preferredContactEmail: "avery.family@example.test",
      responseEmail: "avery.member@example.test",
    });
    expect(() => {
      (snapshot.source as { provider: string }).provider = "uploaded_file";
    }).toThrow();
  });

  test("uses canonical JSON for stable row hashes and keeps array order meaningful", () => {
    const first = {
      profile: {
        lastName: "Member",
        firstName: "Avery",
      },
      courses: [
        { name: "English", grade: "A" },
        { name: "Math", grade: "B" },
      ],
    };
    const reorderedKeys = {
      courses: [
        { grade: "A", name: "English" },
        { grade: "B", name: "Math" },
      ],
      profile: {
        firstName: "Avery",
        lastName: "Member",
      },
    };
    const reorderedCourses = {
      ...reorderedKeys,
      courses: [...reorderedKeys.courses].reverse(),
    };

    expect(hashCsfNormalizedImportRow(first)).toBe(
      hashCsfNormalizedImportRow(reorderedKeys),
    );
    expect(hashCsfNormalizedImportRow(first)).not.toBe(
      hashCsfNormalizedImportRow(reorderedCourses),
    );
    expect(hashCsfImportContent("synthetic")).toBe(
      "b3cc0475bb78a5026098858e9889acf666d31062d513d303314eca31d36e72f2",
    );
  });

  test("recursively enforces the allowlist and never returns rejected values", () => {
    const snapshot = buildSnapshot({
      allowlistedPaths: [
        "responseEmail",
        "courses[].name",
        "courses[].grade",
        "proofFileId",
        "clubAlias",
        "publicDescription",
        "officerComment",
        "observedAt",
      ],
      rows: [
        visibleRow(2, {
          responseEmail: "avery.member@example.test",
          password: "SyntheticSecret-Do-Not-Retain",
          token: "SyntheticAccessToken-Do-Not-Retain",
          rawData: {
            transcript: "Synthetic raw transcript content",
          },
          externalLink: "https://outside.example.test/private",
          studentEssay: "Synthetic qualitative response that is not needed",
          courses: [
            {
              name: "Honors English",
              grade: "A",
              password: "NestedSyntheticSecret",
              rawPayload: {
                source: "Nested raw payload",
              },
              irrelevantResponse: "Nested qualitative response",
            },
            {
              name: "=WEBSERVICE(\"https://outside.example.test\")",
              grade: "B",
            },
          ],
          proofFileId: "https://outside.example.test/proof",
          clubAlias: "=IMPORTXML(\"https://outside.example.test\")",
          publicDescription: "<script>syntheticRawHtml()</script>",
          officerComment: "Review the file at https://outside.example.test/embedded",
          observedAt: new Date("2026-07-29T00:00:00.000Z"),
        }),
      ],
    });

    expect(snapshot.rows[0].normalizedData).toEqual({
      courses: [
        {
          grade: "A",
          name: "Honors English",
        },
        {
          grade: "B",
        },
      ],
      responseEmail: "avery.member@example.test",
    });
    expect(new Set(snapshot.rejectedFields.map((field) => field.reason))).toEqual(
      new Set([
        "secret",
        "raw_content",
        "external_link",
        "not_allowlisted",
        "macro_or_formula",
        "unsupported_value",
      ]),
    );
    expect(
      snapshot.rejectedFields.some(
        (field) => field.fieldPath === "courses[0].password" && field.reason === "secret",
      ),
    ).toBe(true);
    expect(
      snapshot.rejectedFields.some(
        (field) =>
          field.fieldPath === "courses[0].rawPayload" &&
          field.reason === "raw_content",
      ),
    ).toBe(true);
    expect(
      snapshot.rejectedFields.every(
        (field) =>
          !("value" in field) &&
          /^[a-f0-9]{64}$/u.test(field.fieldKeyHash),
      ),
    ).toBe(true);
    expect(snapshot.warnings).toContainEqual({
      code: "rejected_fields_present",
      count: snapshot.rejectedFields.length,
    });
    expect(snapshot.preflightStatus).toBe("review_required");

    const serialized = JSON.stringify(snapshot);
    for (const excludedValue of [
      "SyntheticSecret-Do-Not-Retain",
      "SyntheticAccessToken-Do-Not-Retain",
      "NestedSyntheticSecret",
      "Synthetic raw transcript content",
      "Nested raw payload",
      "Synthetic qualitative response that is not needed",
      "https://outside.example.test/private",
      "https://outside.example.test/proof",
      "https://outside.example.test/embedded",
      "syntheticRawHtml",
    ]) {
      expect(serialized).not.toContain(excludedValue);
    }
  });

  test("surfaces hidden tabs and excludes hidden, filtered, formula-capacity, blank, and empty rows", () => {
    const snapshot = buildSnapshot({
      source: sourceInput({
        workbookTabs: [
          {
            tabName: "Synthetic applications",
            visibility: "visible",
          },
          {
            tabName: "Officer notes",
            visibility: "hidden",
          },
          {
            tabName: "Legacy formulas",
            visibility: "very_hidden",
          },
        ],
      }),
      allowlistedPaths: ["responseEmail"],
      rows: [
        visibleRow(2, { responseEmail: "avery.member@example.test" }),
        {
          ...visibleRow(3, { responseEmail: "hidden.member@example.test" }),
          visibility: "hidden",
        },
        {
          ...visibleRow(4, { responseEmail: "filtered.member@example.test" }),
          visibility: "filtered_out",
        },
        {
          ...visibleRow(5, { responseEmail: "=A2" }),
          population: "formula_capacity",
        },
        {
          ...visibleRow(6, { responseEmail: "blank.member@example.test" }),
          population: "blank",
        },
        visibleRow(7, { responseEmail: "  " }),
        {
          sourceRowNumber: 8,
          visibility: "hidden",
          population: "formula_capacity",
          candidateData: {
            responseEmail: "hidden.formula@example.test",
          },
        },
      ],
    });

    expect(snapshot.rows.map((row) => row.sourceRowNumber)).toEqual([2]);
    expect(snapshot.diagnostics).toMatchObject({
      hiddenTabs: [
        {
          tabName: "Officer notes",
          visibility: "hidden",
        },
        {
          tabName: "Legacy formulas",
          visibility: "very_hidden",
        },
      ],
      hiddenRows: [3, 8],
      filteredOutRows: [4],
      formulaCapacityRows: [5, 8],
      blankRows: [6],
      emptyAfterNormalizationRows: [7],
    });
    expect(snapshot.warnings).toEqual([
      { code: "hidden_tabs_present", count: 2 },
      { code: "hidden_rows_excluded", count: 2 },
      { code: "filtered_rows_excluded", count: 1 },
      { code: "formula_capacity_rows_excluded", count: 2 },
      { code: "blank_rows_excluded", count: 1 },
      { code: "empty_rows_excluded", count: 1 },
    ]);
    expect(snapshot.preflightStatus).toBe("review_required");
  });

  test("surfaces a hidden selected tab without silently dropping populated preview rows", () => {
    const snapshot = buildSnapshot({
      source: sourceInput({
        workbookTabs: [
          {
            tabName: "Synthetic applications",
            visibility: "hidden",
          },
        ],
      }),
    });

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.warnings).toEqual([
      { code: "hidden_tabs_present", count: 1 },
      { code: "selected_tab_hidden", count: 1 },
    ]);
    expect(snapshot.preflightStatus).toBe("review_required");
  });

  test("uses identical hashes to surface duplicate canonical rows while preserving their row locations", () => {
    const first = {
      responseEmail: "duplicate.member@example.test",
      preferredContactEmail: "duplicate.family@example.test",
      courses: [{ name: "Math", grade: "A" }],
    };
    const duplicateWithDifferentKeyOrder = {
      courses: [{ grade: "A", name: "Math" }],
      preferredContactEmail: "duplicate.family@example.test",
      responseEmail: "duplicate.member@example.test",
    };
    const snapshot = buildSnapshot({
      rows: [
        visibleRow(9, duplicateWithDifferentKeyOrder),
        visibleRow(3, first),
      ],
    });

    expect(snapshot.rows.map((row) => row.sourceRowNumber)).toEqual([3, 9]);
    expect(snapshot.rows[0].rowHash).toBe(snapshot.rows[1].rowHash);
    expect(snapshot.diagnostics.duplicateRows).toEqual([
      {
        rowHash: snapshot.rows[0].rowHash,
        sourceRowNumbers: [3, 9],
      },
    ]);
    expect(snapshot.warnings).toContainEqual({
      code: "duplicate_rows_present",
      count: 1,
    });
  });

  test("reports an empty authoritative snapshot without retaining excluded row content", () => {
    const snapshot = buildSnapshot({
      allowlistedPaths: ["responseEmail"],
      rows: [
        {
          sourceRowNumber: 2,
          visibility: "visible",
          population: "formula_capacity",
          candidateData: {
            responseEmail: "formula.placeholder@example.test",
            password: "SyntheticFormulaSecret",
          },
        },
      ],
    });

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.rejectedFields).toEqual([]);
    expect(snapshot.warnings).toEqual([
      { code: "formula_capacity_rows_excluded", count: 1 },
      { code: "no_authoritative_rows", count: 1 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("SyntheticFormulaSecret");
  });
});

describe("CSF import contract validation", () => {
  test("requires provider identity, revision evidence, a content hash, and officer/policy term selection", () => {
    expect(() =>
      buildSnapshot({
        source: sourceInput({
          fileId: "https://docs.google.com/spreadsheets/d/synthetic",
        }),
      }),
    ).toThrow("provider identifier, not a public URL");

    expect(() =>
      buildSnapshot({
        source: sourceInput({
          revision: null,
          modifiedAt: null,
        }),
      }),
    ).toThrow("requires a revision or modifiedAt");

    expect(() =>
      buildSnapshot({
        source: sourceInput({
          contentHash: {
            algorithm: "sha256",
            value: "not-a-content-hash",
            scope: "file",
          },
        }),
      }),
    ).toThrow("SHA-256");

    expect(() =>
      buildSnapshot({
        source: sourceInput({
          term: {
            id: "00000000-0000-4000-8000-000000000026",
            code: "spring-2026",
            selection: "filename" as never,
          },
        }),
      }),
    ).toThrow("filenames are not authority");

    expect(() =>
      buildSnapshot({
        source: sourceInput({
          provider: "unknown_provider" as never,
        }),
      }),
    ).toThrow("provider is not supported");
  });

  test("requires a structurally bounded populated range and a complete tab inventory", () => {
    expect(() =>
      buildSnapshot({
        source: sourceInput({
          populatedRange: {
            kind: "populated",
            tabName: "Synthetic applications",
            startRow: 20,
            endRow: 1,
            startColumn: 1,
            endColumn: 8,
          },
        }),
      }),
    ).toThrow("bounds are reversed");

    expect(() =>
      buildSnapshot({
        source: sourceInput({
          workbookTabs: [
            {
              tabName: "Different tab",
              visibility: "visible",
            },
          ],
        }),
      }),
    ).toThrow("does not contain the selected tab");

    expect(() =>
      buildSnapshot({
        source: sourceInput({
          workbookTabs: [
            {
              tabName: "Synthetic applications",
              visibility: "visible",
            },
            {
              tabName: "Synthetic applications",
              visibility: "hidden",
            },
          ],
        }),
      }),
    ).toThrow("Duplicate workbook tab");
  });

  test("rejects conflicting, duplicate, malformed, or forbidden allowlist paths", () => {
    expect(() =>
      buildSnapshot({
        allowlistedPaths: ["profile.email", "profile"],
      }),
    ).toThrow(/(?:extends a scalar|replaces an object) field/u);

    expect(() =>
      buildSnapshot({
        allowlistedPaths: ["courses.name", "courses[].grade"],
      }),
    ).toThrow("conflicts on array shape");

    expect(() =>
      buildSnapshot({
        allowlistedPaths: ["responseEmail", "responseEmail"],
      }),
    ).toThrow("must be unique");

    expect(() =>
      buildSnapshot({
        allowlistedPaths: ["not a canonical path"],
      }),
    ).toThrow("Invalid allowlisted path");

    expect(() =>
      buildSnapshot({
        allowlistedPaths: ["profile.password"],
      }),
    ).toThrow("forbidden secret field");

    expect(() =>
      buildSnapshot({
        allowlistedPaths: ["source.rawPayload"],
      }),
    ).toThrow("forbidden raw_content field");
  });

  test("rejects rows outside the populated range, duplicate row locations, and non-plain candidates", () => {
    expect(() =>
      buildSnapshot({
        rows: [visibleRow(21, { responseEmail: "outside.range@example.test" })],
      }),
    ).toThrow("outside the declared populated range");

    expect(() =>
      buildSnapshot({
        rows: [
          visibleRow(2, { responseEmail: "first@example.test" }),
          visibleRow(2, { responseEmail: "second@example.test" }),
        ],
      }),
    ).toThrow("Duplicate source row number 2");

    expect(() =>
      buildSnapshot({
        rows: [
          {
            sourceRowNumber: 2,
            visibility: "visible",
            population: "populated",
            candidateData: new Date() as unknown as Record<string, unknown>,
          },
        ],
      }),
    ).toThrow("candidateData must be a plain object");
  });
});
