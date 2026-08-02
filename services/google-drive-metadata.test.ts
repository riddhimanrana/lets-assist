import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GOOGLE_SHEETS_MIME_TYPE,
  getCsfSheetSourceLiveEvidence,
  getGoogleDriveFileMetadata,
} from "./google-sheets";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respondWith(body: unknown, status = 200) {
  globalThis.fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => (
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  )) as unknown as typeof fetch;
}

/**
 * What Drive actually returns for a native Google Sheet.
 *
 * Deliberately carries NO `headRevisionId` and no checksum. Google's Drive v3
 * `files` resource documents headRevisionId as available only for binary
 * content and checksums as unpopulated for Docs Editors files, so a fixture
 * carrying one would describe a response a Sheet cannot produce -- and every
 * assertion built on it would be proving a contract against fiction. `version`
 * is the freshness coordinate a Sheet does expose.
 */
const NATIVE_SHEET = {
  id: "sheet-1",
  name: "CSF responses",
  mimeType: GOOGLE_SHEETS_MIME_TYPE,
  modifiedTime: "2026-07-15T12:00:00.000Z",
  version: "58",
  webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
  trashed: false,
};

/**
 * The ONE provider-timestamp corpus.
 *
 * Deliberately identical -- value for value -- to the corpus the normalized
 * contract, the frozen provenance and the readiness boundary are exercised
 * against. Four boundaries decide whether a `modifiedTime` is evidence, and a
 * disagreement between them is precisely how a value that acquisition rewrote
 * into validity reached a gate that would have refused the original. Sharing the
 * corpus is what makes "the same grammar" an executable claim rather than a
 * comment.
 *
 * Every value is synthetic and reserved. `.123456000Z` is accepted because its
 * nanosecond digits are zero; `.123456789Z` is refused because PostgreSQL
 * `timestamptz` retains only microseconds, so that precision cannot be compared
 * later without assuming it away.
 */
/** U+200B. ECMAScript `trim()` does not remove it; the padding rule notices it. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

export const CSF_EXACT_PROVIDER_INSTANTS = [
  "2026-07-15T12:00:00Z",
  "2026-07-15T12:00:00.000Z",
  "2026-07-15T12:00:00.123456Z",
  "2026-07-15T12:00:00.123456000Z",
  "2024-02-29T23:59:59Z",
] as const;

export const CSF_REFUSED_PROVIDER_INSTANTS = [
  ["nanoseconds Postgres cannot retain", "2026-07-15T12:00:00.123456789Z"],
  // `\d{4}` accepts it, but PostgreSQL `timestamptz` stores an AD-era year and
  // has no year zero, so the value cannot round-trip as the same Gregorian year
  // it names. A coordinate the column cannot retain is not comparable evidence.
  ["year 0000", "0000-07-15T12:00:00Z"],
  ["a numeric UTC offset", "2026-07-15T12:00:00+00:00"],
  ["the offset-unknown spelling", "2026-07-15T12:00:00-00:00"],
  ["a non-UTC offset", "2026-07-15T12:00:00-07:00"],
  ["four fractional digits", "2026-07-15T12:00:00.1234Z"],
  ["two fractional digits", "2026-07-15T12:00:00.12Z"],
  ["an empty fractional part", "2026-07-15T12:00:00.Z"],
  ["February 30", "2026-02-30T00:00:00Z"],
  ["February 29 in a common year", "2025-02-29T00:00:00Z"],
  ["April 31", "2026-04-31T00:00:00Z"],
  ["month 13", "2026-13-01T00:00:00Z"],
  ["month 00", "2026-00-10T00:00:00Z"],
  ["day 00", "2026-07-00T00:00:00Z"],
  ["hour 24", "2026-07-15T24:00:00Z"],
  ["minute 60", "2026-07-15T12:60:00Z"],
  ["second 60", "2026-07-15T12:00:60Z"],
  ["leading padding", " 2026-07-15T12:00:00Z"],
  ["trailing padding", "2026-07-15T12:00:00Z "],
  // Constructed rather than written literally: a zero-width space in source is
  // invisible to a reviewer, and ECMAScript `trim()` does not see it either --
  // which is exactly why edge padding is detected by character property rather
  // than by `trim()`.
  ["a zero-width padded value", ZERO_WIDTH_SPACE + "2026-07-15T12:00:00Z"],
  ["a space date/time separator", "2026-07-15 12:00:00Z"],
  ["lowercase designators", "2026-07-15t12:00:00z"],
  ["a bare date", "2026-07-15"],
  ["prose", "not a timestamp"],
  ["an empty string", ""],
  ["epoch milliseconds", 1_752_580_800_000],
  ["a boolean", true],
  ["null", null],
  ["absent", undefined],
] as const;

describe("getGoogleDriveFileMetadata", () => {
  /**
   * The acquisition reader's own source, sliced to exactly this function.
   *
   * The redaction rule is about what LEAVES the process in a log context, and a
   * log context is not observable from a return value. Asserting it on the
   * source region is what makes "no provider coordinate is logged here" a
   * statement that cannot quietly regress the next time a diagnostic is added.
   */
  const acquisitionSource = (() => {
    const source = readFileSync(join(import.meta.dir, "google-sheets.ts"), "utf8");
    const start = source.indexOf("export async function getGoogleDriveFileMetadata");
    const end = source.indexOf("/** Why a commit-time evidence refresh refused.", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  })();

  /**
   * Every `logError(...)` call in the reader, sliced by balanced parentheses.
   *
   * Matching on the whole function would be wrong: `fileId` legitimately appears
   * in the request URL and in the returned `requestedFileId`. The rule is about
   * what reaches a LOG, so the probe is scoped to exactly the log call sites.
   */
  const logCallSites = (source: string) => {
    const sites: string[] = [];
    for (
      let index = source.indexOf("logError(");
      index >= 0;
      index = source.indexOf("logError(", index + 1)
    ) {
      let depth = 0;
      let cursor = index + "logError".length;
      for (; cursor < source.length; cursor += 1) {
        if (source[cursor] === "(") depth += 1;
        else if (source[cursor] === ")" && (depth -= 1) === 0) break;
      }
      sites.push(source.slice(index, cursor + 1));
    }
    return sites;
  };

  test("logs no provider coordinate anywhere in this reader", () => {
    const sites = logCallSites(acquisitionSource);
    // All three: the non-OK status, the incomplete 200, and the caught failure.
    expect(sites.length).toBe(3);

    for (const site of sites) {
      // The opaque identifiers and display coordinates, in every spelling they
      // are available under inside this function.
      for (const forbidden of [
        "fileId",
        "file_id",
        "data.id",
        "providerId",
        "metadata.",
        "webViewLink",
        "headRevisionId",
        "boundedDisplayText",
      ]) {
        expect(site, `${forbidden} reaches a log context`).not.toContain(forbidden);
      }
    }

    // And what remains is stated exactly, so a future diagnostic cannot widen it
    // back into identity without this failing.
    expect(acquisitionSource).toContain("        status: response.status,\n      });");
    expect(acquisitionSource).toContain([
      "          identity_matches: identityProven,",
      "          is_native_sheet: isNativeSheet,",
      "          has_modified_time: modifiedTime !== null,",
      "          has_version: version !== null,",
      "          has_trashed: trashed !== null,",
    ].join("\n"));
  });

  test("the caught request failure is replaced rather than logged", () => {
    // `logError` writes `error.message` and `error.stack` into the log. A fetch
    // rejection's message and stack carry the request URL, which carries the
    // file id -- so passing the caught value through would reinstate exactly the
    // coordinate removed from every context above. It is not even bound.
    expect(acquisitionSource).toContain("  } catch {");
    expect(acquisitionSource).not.toContain("} catch (error) {");
    expect(acquisitionSource).toContain(
      'new Error("Drive file metadata request failed before a response was read")',
    );
    // Nothing in the reader forwards a caught value into a log at all.
    expect(acquisitionSource).not.toContain("logError(\"Exception while fetching Google Drive file metadata\", error");
  });

  test("a request that throws is reported as unknown and never rethrown", async () => {
    // The behavioural half: a rejection whose message carries the request URL
    // and the file id resolves to a closed `unknown`, not a thrown error whose
    // sentinel could reach a caller's own logging.
    globalThis.fetch = mock(async () => {
      throw new Error(
        "fetch failed: https://www.googleapis.com/drive/v3/files/SENTINEL-FILE-ID?fields=id",
      );
    }) as unknown as typeof fetch;

    const result = await getGoogleDriveFileMetadata("token", "SENTINEL-FILE-ID");
    expect(result.accessState).toBe("unknown");
    expect(result.id).toBeNull();
    expect(result.modifiedTime).toBeNull();
    // `requestedFileId` is the caller's own input echoed back to it -- not a log,
    // and the caller already holds it. Nothing else carries the sentinel.
    const { requestedFileId, ...withoutEcho } = result;
    expect(requestedFileId).toBe("SENTINEL-FILE-ID");
    expect(JSON.stringify(withoutEcho)).not.toContain("SENTINEL-FILE-ID");
    expect(JSON.stringify(withoutEcho)).not.toContain("googleapis.com");
  });

  test.each([
    ["a different file id", { id: "some-other-sheet" }],
    ["a Google Doc", { mimeType: "application/vnd.google-apps.document" }],
    ["a PDF", { mimeType: "application/pdf" }],
    ["an empty provider id", { id: "" }],
    ["a padded provider id", { id: " sheet-1" }],
  ])("a 200 answering with %s is unknown at acquisition", async (_label, override) => {
    respondWith({ ...NATIVE_SHEET, ...override });

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    // Not normalized, not repaired, not reported as a successful read.
    expect(result.accessState).toBe("unknown");
    // The requested coordinate is unchanged, so a caller can still say what it
    // asked for -- the answer simply is not evidence about it.
    expect(result.requestedFileId).toBe("sheet-1");
  });

  test("identity and type are proven, not assumed, for an accessible read", async () => {
    respondWith(NATIVE_SHEET);
    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.accessState).toBe("accessible");
    expect(result.id).toBe(result.requestedFileId);
    expect(result.mimeType).toBe(GOOGLE_SHEETS_MIME_TYPE);
  });

  test("returns the selected file provenance without fetching row values", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ...NATIVE_SHEET,
      headRevisionId: "revision-7",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toEqual({
      requestedFileId: "sheet-1",
      id: "sheet-1",
      name: "CSF responses",
      mimeType: GOOGLE_SHEETS_MIME_TYPE,
      modifiedTime: "2026-07-15T12:00:00.000Z",
      version: "58",
      headRevisionId: "revision-7",
      webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      trashed: false,
      accessState: "accessible",
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain(
      "fields=id%2Cname%2CmimeType%2CmodifiedTime%2Cversion%2CheadRevisionId%2CwebViewLink%2Ctrashed",
    );
    expect(url).not.toContain("values");
  });

  test("carries the provider version as the exact string Drive sent", async () => {
    // 2^63 - 1. A version this large does not survive a double: `Number` rounds
    // it to 9223372036854775808, which would then compare equal to a genuinely
    // different version. The string is the evidence.
    respondWith({ ...NATIVE_SHEET, version: "9223372036854775807" });

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.version).toBe("9223372036854775807");
    expect(result.accessState).toBe("accessible");
    expect(String(Number(result.version))).not.toBe(result.version);
  });

  test.each([
    ["absent", undefined],
    ["blank", ""],
    ["whitespace only", "   "],
    ["non-numeric", "v58"],
    ["negative", "-58"],
    ["signed", "+58"],
    ["zero", "0"],
    ["leading zero", "058"],
    ["non-integer", "58.0"],
    ["one past the int64 ceiling", "9223372036854775808"],
    ["far past any int64", "9".repeat(25)],
    // A JSON number has already been through a double by the time it arrives,
    // so there is nothing left to rescue: it is refused, not repaired.
    ["a JSON number", 58],
  ] as const)("a %s version fails closed", async (_label, version) => {
    respondWith({ ...NATIVE_SHEET, version });

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.version).toBeNull();
    expect(result.accessState).toBe("unknown");
  });

  test.each([
    ["surrounding whitespace", "  58  "],
    ["a leading space", " 58"],
    ["a trailing newline", "58\n"],
    ["a zero-width prefix", ZERO_WIDTH_SPACE + "58"],
  ] as const)("a version with %s fails closed instead of being repaired", async (_label, version) => {
    // The predecessor trimmed this into "58" and reported the read accessible.
    // That is the whole failure mode: a coordinate the provider did not send
    // was rewritten into one that then compared EQUAL to frozen evidence, so
    // the one check whose entire subject is exactness passed on a repair.
    respondWith({ ...NATIVE_SHEET, version });

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.version).toBeNull();
    expect(result.accessState).toBe("unknown");
  });

  // A shallow mutable view; the corpus stays `as const`, in the same order,
  // byte-identical.
  test.each([...CSF_EXACT_PROVIDER_INSTANTS])(
    "carries the provider modified time %p exactly as sent",
    async (modifiedTime) => {
      respondWith({ ...NATIVE_SHEET, modifiedTime });

      const result = await getGoogleDriveFileMetadata("token", "sheet-1");
      // Byte-for-byte, not "the same instant". A re-rendered copy is a value
      // this reader authored, and a 6- or 9-digit provider spelling does not
      // survive the millisecond round trip that used to happen here.
      expect(result.modifiedTime).toBe(modifiedTime);
      expect(result.accessState).toBe("accessible");
    },
  );

  test("a provider fraction is never re-rendered to milliseconds", async () => {
    respondWith({ ...NATIVE_SHEET, modifiedTime: "2026-07-15T12:00:00.123456Z" });

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.modifiedTime).toBe("2026-07-15T12:00:00.123456Z");
    // What the predecessor would have produced, stated so the regression is
    // named rather than merely absent.
    expect(result.modifiedTime).not.toBe("2026-07-15T12:00:00.123Z");
  });

  test.each(CSF_REFUSED_PROVIDER_INSTANTS)(
    "a modified time with %s fails closed",
    async (_label, modifiedTime) => {
      respondWith({ ...NATIVE_SHEET, modifiedTime });

      const result = await getGoogleDriveFileMetadata("token", "sheet-1");
      expect(result.modifiedTime).toBeNull();
      expect(result.accessState).toBe("unknown");
    },
  );

  test("an impossible civil date is refused rather than rolled forward", async () => {
    // `new Date("2026-02-30T00:00:00Z")` is 2026-03-02. The predecessor stored
    // that: a real instant the provider never named, frozen as evidence.
    respondWith({ ...NATIVE_SHEET, modifiedTime: "2026-02-30T00:00:00Z" });

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.modifiedTime).toBeNull();
    expect(new Date("2026-02-30T00:00:00Z").toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  test.each([
    ["a padded provider id", { id: " sheet-1 " }],
    ["a zero-width padded provider id", { id: ZERO_WIDTH_SPACE + "sheet-1" }],
    ["a padded MIME", { mimeType: ` ${GOOGLE_SHEETS_MIME_TYPE} ` }],
    ["an overlong provider id", { id: "a".repeat(513) }],
  ] as const)("%s fails closed instead of being trimmed into agreement", async (_label, override) => {
    respondWith({ ...NATIVE_SHEET, ...override });

    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toMatchObject({
      accessState: "unknown",
    });
  });

  test("a padded requested id is refused before the provider is asked", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify(NATIVE_SHEET), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Our own request is a coordinate too: a padded id would be carried to the
    // provider and whatever answered would become "the file we asked for".
    const result = await getGoogleDriveFileMetadata("token", " sheet-1 ");
    expect(result.accessState).toBe("unknown");
    expect(result.id).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  test("a display name keeps its bounded display reading", async () => {
    // Display provenance is deliberately NOT held to the exact-coordinate rule:
    // it is never identity, never compared and never a freshness coordinate.
    respondWith({ ...NATIVE_SHEET, name: "  CSF responses  " });

    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toMatchObject({
      name: "CSF responses",
      accessState: "accessible",
    });
  });

  test("turns lost consent into a reconnect state without exposing an error body", async () => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response("private provider detail", { status: 403 })
    )) as unknown as typeof fetch;
    const result = await getGoogleDriveFileMetadata("token", "sheet-2");
    expect(result).toMatchObject({
      requestedFileId: "sheet-2",
      // The requested ID is echoed as the request, never promoted to evidence.
      id: null,
      accessState: "reconnect_required",
    });
    expect(result.name).toBeNull();
  });

  test.each([
    [401, "reconnect_required"],
    [403, "reconnect_required"],
    [404, "not_found"],
    [429, "unknown"],
  ] as const)("maps Drive HTTP %i to %s", async (status, accessState) => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response("provider detail is not surfaced", { status })
    )) as unknown as typeof fetch;
    await expect(getGoogleDriveFileMetadata("token", `sheet-${status}`)).resolves.toMatchObject({ accessState });
  });

  test("marks a selected file that moved to trash without dropping its provenance", async () => {
    respondWith({ ...NATIVE_SHEET, id: "sheet-trashed", name: "Historical CSF source", trashed: true });

    await expect(getGoogleDriveFileMetadata("token", "sheet-trashed")).resolves.toMatchObject({
      requestedFileId: "sheet-trashed",
      id: "sheet-trashed",
      name: "Historical CSF source",
      trashed: true,
      accessState: "trashed",
    });
  });

  test("a native Google Sheet with no head revision is still complete evidence", async () => {
    respondWith(NATIVE_SHEET);
    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toMatchObject({
      headRevisionId: null,
      modifiedTime: "2026-07-15T12:00:00.000Z",
      version: "58",
      accessState: "accessible",
    });
  });

  test("a 200 with no provider id does not borrow the requested id", async () => {
    const { id: _dropped, ...withoutId } = NATIVE_SHEET;
    respondWith(withoutId);

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.id).toBeNull();
    expect(result.requestedFileId).toBe("sheet-1");
    expect(result.accessState).toBe("unknown");
  });

  test("a 200 with no trash state does not become not-trashed", async () => {
    const { trashed: _dropped, ...withoutTrash } = NATIVE_SHEET;
    respondWith(withoutTrash);

    const result = await getGoogleDriveFileMetadata("token", "sheet-1");
    expect(result.trashed).toBeNull();
    expect(result.accessState).toBe("unknown");
  });

  test("a 200 whose body is not a JSON object fails closed", async () => {
    globalThis.fetch = mock(async () => new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toMatchObject({
      id: null,
      trashed: null,
      accessState: "unknown",
    });

    respondWith([NATIVE_SHEET]);
    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toMatchObject({
      accessState: "unknown",
    });
  });
});

describe("getCsfSheetSourceLiveEvidence", () => {
  test("accepts a native Sheet with no head revision and proves it on its version", async () => {
    respondWith(NATIVE_SHEET);

    const evidence = await getCsfSheetSourceLiveEvidence("token", "sheet-1");
    expect(evidence).toMatchObject({
      status: "ok",
      requestedFileId: "sheet-1",
      providerFileId: "sheet-1",
      mimeType: GOOGLE_SHEETS_MIME_TYPE,
      modifiedTime: "2026-07-15T12:00:00.000Z",
      headRevisionId: null,
      version: "58",
    });
    // The freshness coordinate is not the modification time under another name.
    // While it was, the two could never disagree, so an edit landing inside one
    // timestamp granule of the preview was undetectable.
    expect(evidence.status === "ok" && evidence.version).not.toBe(
      evidence.status === "ok" ? evidence.modifiedTime : null,
    );
  });

  test("keeps a head revision as a diagnostic without treating it as freshness", async () => {
    respondWith({ ...NATIVE_SHEET, headRevisionId: "revision-7" });

    const evidence = await getCsfSheetSourceLiveEvidence("token", "sheet-1");
    expect(evidence).toMatchObject({
      status: "ok",
      version: "58",
      headRevisionId: "revision-7",
    });
  });

  test("refuses a Sheet whose version is missing or malformed", async () => {
    const { version: _dropped, ...withoutVersion } = NATIVE_SHEET;
    respondWith(withoutVersion);
    await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
      status: "refused",
      reason: "unknown",
    });

    respondWith({ ...NATIVE_SHEET, version: "-1" });
    await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
      status: "refused",
      reason: "unknown",
    });
  });

  test("a display-name rename stays benign", async () => {
    respondWith({ ...NATIVE_SHEET, name: "CSF responses (renamed)" });

    const evidence = await getCsfSheetSourceLiveEvidence("token", "sheet-1");
    expect(evidence.status).toBe("ok");
    expect(evidence.status === "ok" && evidence.name).toBe("CSF responses (renamed)");
  });

  test("refuses when the provider answers about a different file", async () => {
    respondWith({ ...NATIVE_SHEET, id: "some-other-sheet" });

    // Refused at ACQUISITION now, so the wrapper never sees an `accessible`
    // metadata object it has to catch. `unknown` rather than `identity_mismatch`
    // is the point: the read did not succeed, so nothing downstream is handed a
    // metadata object whose `accessState` claims it did.
    await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
      status: "refused",
      reason: "unknown",
    });
  });

  test("refuses a file whose MIME drifted away from Google Sheets", async () => {
    for (const mimeType of [
      "application/vnd.google-apps.document",
      "application/pdf",
    ]) {
      respondWith({ ...NATIVE_SHEET, mimeType });

      await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
        status: "refused",
        reason: "unknown",
      });
    }
  });

  /**
   * The wrapper's own identity and MIME refusals are NOT removed.
   *
   * They are now unreachable through this reader, because the acquisition
   * refuses first -- but they are the second statement of the same rule for any
   * caller that ever hands the wrapper a metadata object from elsewhere, and
   * deleting them would make that path fail open. Asserted on the source,
   * because behaviour can no longer reach them.
   */
  test("the wrapper keeps its own independent identity and MIME refusals", () => {
    const source = readFileSync(join(import.meta.dir, "google-sheets.ts"), "utf8");
    const wrapper = source.slice(
      source.indexOf("export async function getCsfSheetSourceLiveEvidence"),
      source.indexOf("const GOOGLE_SHEETS_MAX_COLUMN_INDEX"),
    );
    expect(wrapper).toContain("metadata.id !== metadata.requestedFileId");
    expect(wrapper).toContain('reason: "identity_mismatch"');
    expect(wrapper).toContain("metadata.mimeType !== GOOGLE_SHEETS_MIME_TYPE");
    expect(wrapper).toContain('reason: "mime_mismatch"');
  });

  test.each([
    ["missing provider id", { id: undefined }, "unknown"],
    ["missing trash state", { trashed: undefined }, "unknown"],
    ["malformed modified time", { modifiedTime: "yesterday" }, "unknown"],
    ["trashed file", { trashed: true }, "trashed"],
  ] as const)("refuses on %s", async (_label, override, reason) => {
    respondWith({ ...NATIVE_SHEET, ...override });
    await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
      status: "refused",
      reason,
    });
  });

  test.each([
    [401, "reconnect_required"],
    [403, "reconnect_required"],
    [404, "not_found"],
    [500, "unknown"],
  ] as const)("refuses HTTP %i as %s", async (status, reason) => {
    globalThis.fetch = mock(async () => new Response("detail", { status })) as unknown as typeof fetch;
    await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
      status: "refused",
      reason,
    });
  });

  test("a missing modified time is invalid even beside a usable version", async () => {
    // Both coordinates are required. `modifiedTime` orders the file against the
    // source row's own recorded evidence; `version` catches a change that
    // happened inside one second of it. Neither substitutes for the other.
    const { modifiedTime: _dropped, ...withoutModified } = NATIVE_SHEET;
    respondWith(withoutModified);

    await expect(getCsfSheetSourceLiveEvidence("token", "sheet-1")).resolves.toMatchObject({
      status: "refused",
      reason: "unknown",
    });
  });
});
