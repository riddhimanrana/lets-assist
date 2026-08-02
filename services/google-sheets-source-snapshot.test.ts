import { afterEach, describe, expect, mock, test } from "bun:test";

// Keep the acquisition tests hermetic: the logger boots OpenTelemetry at import
// time and provider failures are asserted through the returned result, not logs.
mock.module("@/lib/logger", () => ({
  log: () => {},
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
}));

// `server-only` is a build-time boundary marker that throws in a plain runtime.
// CI supplies the same stub through a preload; stating it here as well keeps this
// file runnable on its own, which is how the coordinate assertions below are
// usually reached while iterating.
mock.module("server-only", () => ({}));

const {
  acquireFencedCsfSheetSnapshots,
  formatCsfSheetBounds,
  getCsfSheetSourceSnapshot,
  narrowCsfSheetBoundsToPopulated,
  parseCsfSheetBoundedRange,
} = await import("./google-sheets");

const { buildCsfNormalizedImportSnapshot } = await import("./csf-import-contract");
type CsfImportSourceInput = Parameters<
  typeof buildCsfNormalizedImportSnapshot
>[0]["source"];

const SPREADSHEET_ID = "synthetic-csf-sheet";
const REQUESTED_RANGE = "'Synthetic tab'!A1:Z1000";

// Synthetic only. No real student name, address, or district identifier appears
// in this file.
const SELECTED_VALUES: string[][] = [
  ["First Name", "Last Name", "School Email"],
  ["Avery", "Sample", "avery.sample@school.test"],
  ["Rowan", "Sample", "rowan.sample@school.test"],
  ["", "", ""],
];

function gridResponse(overrides: Record<string, unknown> = {}) {
  return {
    spreadsheetId: SPREADSHEET_ID,
    properties: { title: "Synthetic CSF workbook" },
    sheets: [
      {
        properties: {
          sheetId: 0,
          title: "Synthetic tab",
          gridProperties: { rowCount: 1000, columnCount: 26 },
        },
        basicFilter: { range: { startRowIndex: 0 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowMetadata: [
              {},
              { hiddenByUser: true },
              { hiddenByFilter: true },
              {},
            ],
            rowData: [
              { values: [{ formattedValue: "First Name" }, { formattedValue: "Last Name" }, { formattedValue: "School Email" }] },
              { values: [{ formattedValue: "Avery", effectiveValue: { stringValue: "Avery" } }] },
              { values: [{ formattedValue: "Rowan", effectiveValue: { stringValue: "Rowan" } }] },
              { values: [{ userEnteredValue: { formulaValue: '=IF(A5="","",A5)' } }] },
            ],
          },
        ],
      },
      {
        properties: { sheetId: 1, title: "Archive", hidden: true },
      },
    ],
    ...overrides,
  };
}

type FetchCall = { url: string };

function installFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    return handler(url);
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function okHandler(values: string[][] = SELECTED_VALUES, grid = gridResponse()) {
  return (url: string) => {
    if (url.includes("values:batchGet")) {
      return jsonResponse({ valueRanges: [{ range: REQUESTED_RANGE, values }] });
    }
    return jsonResponse(grid);
  };
}

describe("CSF Google Sheets bounded range parsing", () => {
  test("requires a bounded range and preserves the officer's tab", () => {
    expect(parseCsfSheetBoundedRange("'Synthetic tab'!A1:C40", "Fallback")).toEqual({
      tabName: "Synthetic tab",
      startRow: 1,
      endRow: 40,
      startColumn: 1,
      endColumn: 3,
    });
    expect(parseCsfSheetBoundedRange("A1", "Fallback")).toBeNull();
    expect(parseCsfSheetBoundedRange("'Tab'!C5:A1", "Fallback")).toBeNull();
    expect(parseCsfSheetBoundedRange("Tab!A1:B2:C3", "Fallback")).toBeNull();
    expect(parseCsfSheetBoundedRange(`${"A".repeat(300)}1:${"A".repeat(300)}2`, "Fallback")).toBeNull();
    expect(parseCsfSheetBoundedRange("A9007199254740992:B9007199254740993", "Fallback")).toBeNull();
    expect(parseCsfSheetBoundedRange("'CSF! Archive'!A1:C5", "Fallback")).toEqual({
      tabName: "CSF! Archive",
      startRow: 1,
      endRow: 5,
      startColumn: 1,
      endColumn: 3,
    });
    expect(formatCsfSheetBounds({
      tabName: "Synthetic tab",
      startRow: 2,
      endRow: 9,
      startColumn: 1,
      endColumn: 4,
    })).toBe("'Synthetic tab'!A2:D9");
    expect(() => formatCsfSheetBounds({
      tabName: "Synthetic tab",
      startRow: 1,
      endRow: Number.POSITIVE_INFINITY,
      startColumn: 1,
      endColumn: 2,
    })).toThrow(RangeError);
    expect(() => formatCsfSheetBounds({
      tabName: "Synthetic tab",
      startRow: 1,
      endRow: 1,
      startColumn: 1,
      endColumn: Number.POSITIVE_INFINITY,
    })).toThrow(RangeError);
  });

  test("narrows a default range to the rows that hold data", () => {
    expect(
      narrowCsfSheetBoundsToPopulated(
        { tabName: "Synthetic tab", startRow: 1, endRow: 1000, startColumn: 1, endColumn: 26 },
        SELECTED_VALUES,
      ),
    ).toEqual({
      tabName: "Synthetic tab",
      startRow: 1,
      endRow: 3,
      startColumn: 1,
      endColumn: 3,
    });
    expect(
      narrowCsfSheetBoundsToPopulated(
        { tabName: "Synthetic tab", startRow: 1, endRow: 1000, startColumn: 1, endColumn: 26 },
        [["", ""], [""]],
      ),
    ).toBeNull();
  });
});

describe("CSF Google Sheets acquisition snapshot", () => {
  test("reads the populated block, not the grid, and reports acquisition evidence", async () => {
    const calls = installFetch(okHandler());
    const snapshot = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );

    expect(snapshot.status).toBe("ok");
    if (snapshot.status !== "ok") return;

    const metadataCall = calls.find((call) => call.url.includes("includeGridData=false"));
    expect(metadataCall).toBeDefined();
    expect(metadataCall?.url).not.toContain("ranges=");

    // The structural request inspects the complete officer-bounded range so it
    // can see hidden and formula-only rows. The importer still treats only the
    // returned populated/structural evidence as records, never grid capacity.
    const gridCall = calls.find((call) => call.url.includes("includeGridData=true"));
    expect(gridCall).toBeDefined();
    expect(decodeURIComponent(gridCall?.url ?? "").replaceAll("+", " ")).toContain(
      "'Synthetic tab'!A1:Z1000",
    );

    expect(snapshot.populatedRange).toEqual({
      tabName: "Synthetic tab",
      startRow: 1,
      endRow: 3,
      startColumn: 1,
      endColumn: 3,
    });
    expect(snapshot.requestedRange.endRow).toBe(1000);
    expect(snapshot.spreadsheetTitle).toBe("Synthetic CSF workbook");
    expect(snapshot.selectedTab).toMatchObject({ tabName: "Synthetic tab", visibility: "visible" });
    expect(snapshot.tabs.map((tab) => [tab.tabName, tab.visibility])).toEqual([
      ["Synthetic tab", "visible"],
      ["Archive", "hidden"],
    ]);
    expect(snapshot.hasBasicFilter).toBe(true);
    expect(snapshot.rows.map((row) => row.sourceRowNumber)).toEqual([1, 2, 3, 4]);
    expect(snapshot.rows[1]).toMatchObject({ hiddenByUser: true, hiddenByFilter: false });
    expect(snapshot.rows[2]).toMatchObject({ hiddenByUser: false, hiddenByFilter: true });
    expect(snapshot.rows[0].values).toEqual(["First Name", "Last Name", "School Email"]);
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("keeps the leading column anchored so saved column mappings stay valid", async () => {
    installFetch(okHandler([
      ["", "First Name", "Last Name"],
      ["", "Avery", "Sample"],
    ]));
    const snapshot = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );

    expect(snapshot.status).toBe("ok");
    if (snapshot.status !== "ok") return;
    expect(snapshot.populatedRange?.startColumn).toBe(1);
    expect(snapshot.rows[0].values).toEqual(["", "First Name", "Last Name"]);
  });

  test("surfaces formula-capacity rows as formula evidence rather than data", async () => {
    installFetch(okHandler([
      ["First Name", "Last Name"],
      ["Avery", "Sample"],
    ]));
    const snapshot = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );

    expect(snapshot.status).toBe("ok");
    if (snapshot.status !== "ok") return;
    const formulaRow = snapshot.rows.find((row) => row.sourceRowNumber === 4);
    expect(formulaRow?.formulaColumns).toEqual([1]);
    expect(formulaRow?.hasEffectiveValue).toBe(false);
    expect(formulaRow?.values).toEqual([]);
  });

  test("preserves sparse source coordinates without materializing blank capacity", async () => {
    const sparseValues = Array.from({ length: 1000 }, (_unused, index) => {
      if (index === 0) return ["Header"];
      if (index === 999) return ["Tail evidence"];
      return [];
    });
    const sparseGrid = gridResponse({
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: "Synthetic tab",
            gridProperties: { rowCount: 1000, columnCount: 26 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowMetadata: [{}],
              rowData: [{ values: [{ formattedValue: "Header", effectiveValue: { stringValue: "Header" } }] }],
            },
            {
              startRow: 999,
              startColumn: 0,
              rowMetadata: [{}],
              rowData: [{ values: [{ formattedValue: "Tail evidence", effectiveValue: { stringValue: "Tail evidence" } }] }],
            },
          ],
        },
      ],
    });
    installFetch(okHandler(sparseValues, sparseGrid));

    const snapshot = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );

    expect(snapshot.status).toBe("ok");
    if (snapshot.status !== "ok") return;
    expect(snapshot.rows.map((row) => row.sourceRowNumber)).toEqual([1, 1000]);
    expect(snapshot.rows.map((row) => row.values[0])).toEqual(["Header", "Tail evidence"]);
  });

  test("never reports an unreadable source as an empty source", async () => {
    installFetch((url) => {
      if (url.includes("values:batchGet")) {
        return new Response("permission denied", { status: 403 });
      }
      return jsonResponse(gridResponse());
    });

    const failed = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    expect(failed).toMatchObject({ status: "unavailable", reason: "reconnect_required" });
    expect(failed).not.toHaveProperty("rows");
    if (failed.status === "unavailable") {
      expect(failed.message).toContain("no rows were treated as empty");
    }

    installFetch((url) => {
      if (url.includes("values:batchGet")) {
        return jsonResponse({ valueRanges: [{ range: REQUESTED_RANGE, values: SELECTED_VALUES }] });
      }
      return new Response("token expired", { status: 401 });
    });
    const gridFailure = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    expect(gridFailure).toMatchObject({ status: "unavailable", reason: "reconnect_required" });
  });

  test("refuses an unbounded range and a tab the spreadsheet no longer has", async () => {
    installFetch(okHandler());
    expect(
      await getCsfSheetSourceSnapshot("synthetic-token", SPREADSHEET_ID, "'Synthetic tab'!A1", "Synthetic tab"),
    ).toMatchObject({ status: "unavailable", reason: "invalid_range" });

    installFetch(okHandler());
    expect(
      await getCsfSheetSourceSnapshot("synthetic-token", SPREADSHEET_ID, "'Renamed tab'!A1:C9", "Renamed tab"),
    ).toMatchObject({ status: "unavailable", reason: "not_found" });

    const calls = installFetch(() => {
      throw new Error("An oversized range must be rejected before a provider call.");
    });
    expect(
      await getCsfSheetSourceSnapshot(
        "synthetic-token",
        SPREADSHEET_ID,
        "'Synthetic tab'!A1:Z10000",
        "Synthetic tab",
      ),
    ).toMatchObject({ status: "unavailable", reason: "invalid_range" });
    expect(calls).toHaveLength(0);
  });

  test("digests values and structural evidence so an unchanged source is recognizable", async () => {
    installFetch(okHandler());
    const first = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    installFetch(okHandler());
    const repeat = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    installFetch(okHandler([
      ["First Name", "Last Name", "School Email"],
      ["Avery", "Sample", "avery.changed@school.test"],
    ]));
    const changed = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    installFetch(okHandler([
      ["First Name", "Last Name", "School Email"],
      ["Avery ", "Sample", "avery.sample@school.test"],
      ["Rowan", "Sample", "rowan.sample@school.test"],
    ]));
    const whitespaceChanged = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    const structureChangedGrid = gridResponse();
    const firstSheet = structureChangedGrid.sheets[0];
    if (firstSheet?.data?.[0]?.rowMetadata?.[1]) {
      firstSheet.data[0].rowMetadata[1] = {};
    }
    installFetch(okHandler(SELECTED_VALUES, structureChangedGrid));
    const structurallyChanged = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    const formulaChangedGrid = gridResponse();
    const formulaCell =
      formulaChangedGrid.sheets[0]?.data?.[0]?.rowData?.[3]?.values?.[0];
    if (formulaCell && "userEnteredValue" in formulaCell && formulaCell.userEnteredValue) {
      formulaCell.userEnteredValue.formulaValue = '=IF(B5="","",B5)';
    }
    installFetch(okHandler(SELECTED_VALUES, formulaChangedGrid));
    const formulaChanged = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );
    const capacityChangedGrid = gridResponse();
    const capacity = capacityChangedGrid.sheets[0]?.properties?.gridProperties;
    if (capacity) capacity.rowCount = 2000;
    installFetch(okHandler(SELECTED_VALUES, capacityChangedGrid));
    const capacityChanged = await getCsfSheetSourceSnapshot(
      "synthetic-token",
      SPREADSHEET_ID,
      REQUESTED_RANGE,
      "Synthetic tab",
    );

    expect(first.status).toBe("ok");
    expect(repeat.status).toBe("ok");
    expect(changed.status).toBe("ok");
    expect(whitespaceChanged.status).toBe("ok");
    expect(structurallyChanged.status).toBe("ok");
    expect(formulaChanged.status).toBe("ok");
    expect(capacityChanged.status).toBe("ok");
    if (
      first.status !== "ok"
      || repeat.status !== "ok"
      || changed.status !== "ok"
      || whitespaceChanged.status !== "ok"
      || structurallyChanged.status !== "ok"
      || formulaChanged.status !== "ok"
      || capacityChanged.status !== "ok"
    ) return;
    expect(repeat.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(whitespaceChanged.contentHash).not.toBe(first.contentHash);
    expect(structurallyChanged.contentHash).not.toBe(first.contentHash);
    expect(formulaChanged.contentHash).not.toBe(first.contentHash);
    expect(capacityChanged.contentHash).toBe(first.contentHash);
  });
});

/**
 * A preview issues several reads against a document other people can edit. These
 * tests drive the Drive fence with a stub that changes the workbook partway
 * through, which is the case that previously produced a provenance bundle
 * describing a state the workbook was never in.
 */
describe("CSF Google Sheets fenced acquisition", () => {
  const DRIVE_METADATA = "www.googleapis.com/drive/v3/files";

  /**
   * A native Sheet's Drive answer. `version` is required and `headRevisionId` is
   * deliberately absent by default: Drive populates head revisions and checksums
   * only for binary content, never for a Docs Editors file, so `version` is the
   * only freshness coordinate a Sheet actually has.
   */
  function driveResponse(modifiedTime: string, version = "58") {
    return jsonResponse({
      id: SPREADSHEET_ID,
      name: "Synthetic CSF workbook",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime,
      version,
      trashed: false,
    });
  }

  const REQUESTS = [{ rangeA1: REQUESTED_RANGE, fallbackTabName: "Synthetic tab" }];

  test("returns one stable source state when nothing moved during the read", async () => {
    const calls = installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) return driveResponse("2026-07-29T18:00:00.000Z");
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshots).toHaveLength(1);
    expect(result.fence.modifiedAt).toBe("2026-07-29T18:00:00.000Z");
    expect(result.attempts).toBe(1);
    // Fenced before the first read and after the last.
    const driveCalls = calls.filter((call) => call.url.includes(DRIVE_METADATA));
    expect(driveCalls).toHaveLength(2);
    const firstDrive = calls.findIndex((call) => call.url.includes(DRIVE_METADATA));
    const lastDrive = calls.map((call) => call.url).lastIndexOf(driveCalls[1].url);
    const valuesRead = calls.findIndex((call) => call.url.includes("values:batchGet"));
    expect(valuesRead).toBeGreaterThan(firstDrive);
    expect(lastDrive).toBeGreaterThan(valuesRead);
  });

  test("refuses an acquisition whose source was edited mid-read", async () => {
    let driveReads = 0;
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        driveReads += 1;
        // Every closing fence disagrees with its opening fence: somebody is
        // editing the workbook while it is being read.
        return driveResponse(
          driveReads % 2 === 1 ? "2026-07-29T18:00:00.000Z" : "2026-07-29T18:00:05.000Z",
        );
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS, {
      maxAttempts: 2,
    });

    expect(result.status).toBe("drift");
    if (result.status !== "drift") return;
    expect(result.attempts).toBe(2);
    expect(result.before.modifiedAt).toBe("2026-07-29T18:00:00.000Z");
    expect(result.after.modifiedAt).toBe("2026-07-29T18:00:05.000Z");
    expect(result.message).toContain("changed while it was being read");
  });

  test("retries drift and succeeds once the source settles", async () => {
    let driveReads = 0;
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        driveReads += 1;
        // Attempt 1 drifts; attempt 2 is stable.
        const times = [
          "2026-07-29T18:00:00.000Z",
          "2026-07-29T18:00:05.000Z",
          "2026-07-29T18:00:05.000Z",
          "2026-07-29T18:00:05.000Z",
        ];
        return driveResponse(times[driveReads - 1] ?? "2026-07-29T18:00:05.000Z");
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS, {
      maxAttempts: 2,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.attempts).toBe(2);
    expect(result.fence.modifiedAt).toBe("2026-07-29T18:00:05.000Z");
  });

  test("fences every selected tab, not only the first", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) return driveResponse("2026-07-29T18:00:00.000Z");
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, [
      { rangeA1: REQUESTED_RANGE, fallbackTabName: "Synthetic tab" },
      { rangeA1: REQUESTED_RANGE, fallbackTabName: "Synthetic tab" },
    ]);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshots).toHaveLength(2);
  });

  /**
   * The case the fence exists for, and the one the old `headRevisionId ??
   * modifiedTime` pair could not see.
   *
   * `modifiedTime` has one-second granularity, so an edit landing inside the
   * same second as the opening read leaves it identical. A native Sheet exposes
   * no head revision, so the old fence's `revision` was null on both sides and
   * the fences "agreed" -- reporting one stable source state for a workbook that
   * had changed mid-read. `version` advances on every server-side change, so
   * this is now drift.
   */
  test("a version change is drift even when the modified time is unchanged", async () => {
    let driveReads = 0;
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        driveReads += 1;
        return driveResponse(
          "2026-07-29T18:00:00.000Z",
          driveReads % 2 === 1 ? "58" : "59",
        );
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS, {
      maxAttempts: 1,
    });

    expect(result.status).toBe("drift");
    if (result.status !== "drift") return;
    expect(result.before).toEqual({ version: "58", modifiedAt: "2026-07-29T18:00:00.000Z" });
    expect(result.after).toEqual({ version: "59", modifiedAt: "2026-07-29T18:00:00.000Z" });
  });

  test("a source that reports no version cannot be fenced", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        return jsonResponse({
          id: SPREADSHEET_ID,
          name: "Synthetic",
          mimeType: "application/vnd.google-apps.spreadsheet",
          modifiedTime: "2026-07-29T18:00:00.000Z",
          trashed: false,
        });
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    // A missing version is incomplete provider evidence, so the read is refused
    // as inaccessible before the fence is computed. Reporting a stable read
    // without it would be asserting something unproven about a student-data
    // import.
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("unavailable");
  });

  test("a malformed version cannot be fenced either", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) return driveResponse("2026-07-29T18:00:00.000Z", "v58");
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("unavailable");
  });

  /**
   * The closing read is held to the same requirement as the opening one.
   *
   * A version is part of what makes a Drive answer accessible at all, so this is
   * caught by the reader before the fence is compared -- which is why the
   * message is the closing-read one rather than the fence's. What matters is the
   * outcome: an acquisition that ends without both coordinates is unavailable,
   * never a silent "drift" produced by comparing a value against a null.
   */
  test("a closing read that loses its version is unavailable, not silent drift", async () => {
    let driveReads = 0;
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        driveReads += 1;
        // The opening fence is complete; the closing one drops the version.
        // Comparing a value against a null would report drift and mask the fact
        // that the closing read never proved anything at all.
        return driveReads === 1
          ? driveResponse("2026-07-29T18:00:00.000Z")
          : jsonResponse({
              id: SPREADSHEET_ID,
              name: "Synthetic",
              mimeType: "application/vnd.google-apps.spreadsheet",
              modifiedTime: "2026-07-29T18:00:00.000Z",
              trashed: false,
            });
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS, {
      maxAttempts: 1,
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).toContain("could not be re-checked after reading");
    expect(result.message).toContain("no rows were treated as empty");
  });

  test("an unreadable range is a failure, never an empty acquisition", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) return driveResponse("2026-07-29T18:00:00.000Z");
      if (url.includes("values:batchGet")) return new Response("nope", { status: 403 });
      return jsonResponse(gridResponse());
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("reconnect_required");
    expect(result.message).toContain("no rows were treated as empty");
  });

  test("a source that reports no revision and no modified time cannot be fenced", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        return jsonResponse({ id: SPREADSHEET_ID, name: "Synthetic", trashed: false });
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    // A 200 with no modification time is incomplete provider evidence, so it is
    // refused as inaccessible before the fence is even computed. The invariant
    // this protects is unchanged: a source that cannot state when it last
    // changed never produces a successful acquisition.
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("unavailable");
    expect(result.message).toContain("no rows were treated as empty");
  });

  test("a native Sheet with no head revision fences on its version and modified time", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        return jsonResponse({
          id: SPREADSHEET_ID,
          name: "Synthetic",
          mimeType: "application/vnd.google-apps.spreadsheet",
          modifiedTime: "2026-07-29T18:00:00.000Z",
          version: "58",
          trashed: false,
        });
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.fence).toEqual({ version: "58", modifiedAt: "2026-07-29T18:00:00.000Z" });
    expect(result.driveFile.headRevisionId).toBeNull();
  });

  test("a source that became inaccessible before the read is refused", async () => {
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) return new Response("nope", { status: 401 });
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, REQUESTS);

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("reconnect_required");
  });
});

/**
 * The normalized source revision, per provider family.
 *
 * `previewCsfSheetSyncAction` builds one `CsfImportSourceInput` per selected tab
 * and hands it to this contract. It used to fill `revision` from
 * `driveFile.headRevisionId` unconditionally -- for BOTH families. Drive
 * populates head revisions and content checksums only for binary content and
 * never for a Docs Editors file, so for a native Google Sheet that field is
 * always absent, and the coordinate the reviewed snapshot was supposed to be
 * pinned to simply was not recorded.
 *
 * These assertions are behavioral rather than textual: they build real snapshots
 * and compare their digests, which is what makes "the coordinate was lost"
 * observable instead of merely arguable.
 */
describe("CSF normalized import source revision, by provider family", () => {
  /** Two int64 versions that are DIFFERENT text and the SAME IEEE-754 double. */
  const VERSION_BELOW = "9007199254740992";
  const VERSION_ABOVE = "9007199254740993";
  /** An uploaded workbook's coordinate: the sha256 digest of its exact bytes. */
  const CONTENT_DIGEST = "c".repeat(64);
  const RANGE_DIGEST = "d".repeat(64);

  function sourceInput(
    overrides: Partial<CsfImportSourceInput> = {},
  ): CsfImportSourceInput {
    return {
      provider: "google_sheets",
      fileId: "synthetic-csf-sheet",
      revision: VERSION_BELOW,
      modifiedAt: "2026-07-29T18:00:00.000Z",
      contentHash: { algorithm: "sha256", value: RANGE_DIGEST, scope: "selected_range" },
      populatedRange: {
        kind: "populated",
        tabName: "Synthetic tab",
        startRow: 2,
        endRow: 2,
        startColumn: 1,
        endColumn: 3,
      },
      workbookTabs: [{ tabName: "Synthetic tab", visibility: "visible" }],
      term: { id: "synthetic-term", code: "2026S1", selection: "officer_selected" },
      schemaVersion: "student_roster@1",
      importerVersion: "dvhs-csf-import@csf-normalized-import/v1",
      sensitivity: "restricted_student",
      ...overrides,
    } as CsfImportSourceInput;
  }

  function snapshotOf(source: CsfImportSourceInput) {
    return buildCsfNormalizedImportSnapshot({
      source,
      allowlistedPaths: ["firstName"],
      rows: [
        {
          sourceRowNumber: 2,
          visibility: "visible",
          population: "populated",
          candidateData: { firstName: "Avery" },
        },
      ],
    });
  }

  test("a native Sheet's revision is its exact provider version, carried as text", () => {
    const snapshot = snapshotOf(sourceInput({ revision: VERSION_ABOVE }));

    expect(snapshot.source.revision).toBe(VERSION_ABOVE);
    // Not a number, not a rounded one, and not the modification time under
    // another name.
    expect(typeof snapshot.source.revision).toBe("string");
    expect(snapshot.source.revision).not.toBe(String(Number(VERSION_ABOVE)));
    expect(snapshot.source.revision).not.toBe(snapshot.source.modifiedAt);
  });

  test("two versions that collide as doubles still produce different snapshots", () => {
    // `Number("9007199254740993") === Number("9007199254740992")`. Any code path
    // that parsed this coordinate would make an edit invisible, so the digests
    // diverging is the proof that none does.
    expect(Number(VERSION_ABOVE)).toBe(Number(VERSION_BELOW));

    const before = snapshotOf(sourceInput({ revision: VERSION_BELOW }));
    const after = snapshotOf(sourceInput({ revision: VERSION_ABOVE }));

    expect(before.snapshotHash).not.toBe(after.snapshotHash);
    expect(before.source.revision).toBe(VERSION_BELOW);
    expect(after.source.revision).toBe(VERSION_ABOVE);
  });

  test("taking headRevisionId as a native Sheet's revision erases the coordinate", () => {
    // What the previous unconditional `revision: driveFile.headRevisionId` did:
    // Drive sends no head revision for a Sheet, so `revision` was null, the
    // contract ACCEPTED that because a modified time was present, and two reads
    // either side of an edit inside one granule were indistinguishable here.
    //
    // A null revision is no longer a snapshot at all: this family's revision is
    // required, so the erasure is refused at construction rather than recorded
    // and discovered later.
    expect(() =>
      snapshotOf(sourceInput({ revision: null as never, modifiedAt: "2026-07-29T18:00:00.000Z" })),
    ).toThrow("source.revision must be a string");
    // A timestamp alone is not evidence either, even a valid one.
    expect(() => snapshotOf(sourceInput({ revision: "" as never }))).toThrow("source.revision");
    // And the version-bearing forms of two reads inside one granule do differ.
    expect(snapshotOf(sourceInput({ revision: VERSION_BELOW })).snapshotHash)
      .not.toBe(snapshotOf(sourceInput({ revision: VERSION_ABOVE })).snapshotHash);
  });

  test("an uploaded workbook keeps its sha256 content digest as its revision", () => {
    const uploaded = snapshotOf(
      sourceInput({
        provider: "uploaded_file",
        fileId: "df210000-0000-4000-8000-000000000001",
        revision: CONTENT_DIGEST,
      }),
    );

    expect(uploaded.source.provider).toBe("uploaded_file");
    expect(uploaded.source.revision).toBe(CONTENT_DIGEST);
    expect(uploaded.source.revision).toMatch(/^[0-9a-f]{64}$/u);
    // Deliberately NOT a Drive-style version: an uploaded workbook has no
    // provider to version it, and borrowing those semantics would replace an
    // exact statement about the bytes with a counter.
    expect(uploaded.source.revision).not.toMatch(/^[1-9][0-9]*$/u);
  });

  test("the acquisition a native Sheet produces supplies a version and no head revision", async () => {
    const DRIVE_METADATA = "www.googleapis.com/drive/v3/files";
    installFetch((url) => {
      if (url.includes(DRIVE_METADATA)) {
        return jsonResponse({
          id: SPREADSHEET_ID,
          name: "Synthetic CSF workbook",
          mimeType: "application/vnd.google-apps.spreadsheet",
          modifiedTime: "2026-07-29T18:00:00.000Z",
          version: VERSION_ABOVE,
          trashed: false,
        });
      }
      return okHandler()(url);
    });

    const result = await acquireFencedCsfSheetSnapshots("token", SPREADSHEET_ID, [
      { rangeA1: REQUESTED_RANGE, fallbackTabName: "Synthetic tab" },
    ]);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // The two fields the preview action chooses between. Choosing the second for
    // this family is choosing null.
    expect(result.driveFile.version).toBe(VERSION_ABOVE);
    expect(result.driveFile.headRevisionId).toBeNull();
    // `version` is `string | null` on the production contract, and an `expect`
    // does not narrow it. Guarded explicitly so the synthetic input keeps its
    // required string without weakening what the reader may return.
    const version = result.driveFile.version;
    if (version === null) {
      throw new Error("Synthetic fixture error: the Drive version must be present here.");
    }
    // And the coordinate survives the whole read as exact text.
    expect(snapshotOf(sourceInput({ revision: version })).source.revision)
      .toBe(VERSION_ABOVE);
  });
});
