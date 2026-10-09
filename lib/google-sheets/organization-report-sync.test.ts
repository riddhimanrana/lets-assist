import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { buildReportSheetRows } from "@/lib/organization/report/rows";
import type {
  OrganizationReportData,
  ReportType,
} from "@/lib/organization/report/types";

mock.module("server-only", () => ({}));
mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));

let volunteerCount = 2;

const reportData = (): OrganizationReportData => ({
  metrics: {
    totalVolunteers: volunteerCount,
    registeredVolunteers: volunteerCount,
    anonymousVolunteers: 0,
    verifiedHours: 0,
    pendingHours: 0,
    totalHours: 0,
    totalProjects: 0,
  },
  volunteers: Array.from({ length: volunteerCount }, (_, index) => ({
    key: `user:${index}`,
    userId: String(index),
    // A name that looks like a number must stay text.
    name: index === 0 ? "2024" : `Volunteer ${index}`,
    email: `volunteer${index}@example.test`,
    source: "registered" as const,
    totalHours: 12.5,
    verifiedHours: 10,
    pendingHours: 2.5,
    eventsAttended: 3,
  })),
  monthlyHours: [],
  projects: [],
  updatedAt: "2026-01-03T00:00:00.000Z",
});

// The real report service reads the database. Here it hands the fixture to
// whichever row builder the sync chose, which is the part under test.
let reportBuilds = 0;
mock.module("@/lib/organization/report-service", () => ({
  buildOrganizationReportRowsForSync: async (
    _organizationId: string,
    reportType: ReportType,
    _dateRange?: unknown,
    buildRows?: (report: OrganizationReportData) => unknown[][],
  ) => {
    reportBuilds += 1;
    return {
      rows: buildRows
        ? buildRows(reportData())
        : buildReportSheetRows(reportData(), reportType),
    };
  },
}));

const { runOrganizationSheetSync } = await import("./organization-report-sync");

type Call = { url: string; method: string; body: unknown };

const originalFetch = globalThis.fetch;
let calls: Call[] = [];
let tabs = ["Member Hours"];
let metadataResponse: () => Response | Promise<Response>;
let updates: Array<Record<string, unknown>> = [];
let recordError: { message: string } | null = null;
// The row as the database holds it now, which may differ from the config a
// sync started with.
let savedRow: Record<string, unknown> = {};
let sourceCounts: Record<string, number | null> = {};

/** Applies an update only to a row that matches every filter, like Postgres. */
function updateQuery(payload: Record<string, unknown>) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    then: (resolve: (value: { error: unknown }) => void) => {
      if (filters.every(([column, value]) => savedRow[column] === value)) {
        updates.push(payload);
        Object.assign(savedRow, payload);
      }
      resolve({ error: "last_synced_at" in payload ? recordError : null });
    },
  };
  return query;
}

function countQuery(table: string) {
  const query = {
    eq: () => query,
    not: () => query,
    then: (resolve: (value: { count: number | null; error: null }) => void) =>
      resolve({ count: sourceCounts[table] ?? null, error: null }),
  };
  return query;
}

const supabase = {
  from: (table: string) => ({
    select: () => countQuery(table),
    update: updateQuery,
  }),
} as unknown as Parameters<typeof runOrganizationSheetSync>[0]["supabase"];

const config = (overrides: Record<string, unknown> = {}) => ({
  organization_id: "org-1",
  sheet_id: "sheet-1",
  tab_name: "Member Hours",
  range_a1: "A1",
  report_type: "member-hours",
  layout_config: null as unknown,
  created_by: "owner-1",
  ...overrides,
});

const run = (overrides: Record<string, unknown> = {}) =>
  runOrganizationSheetSync({
    supabase,
    config: config(overrides),
    accessToken: "fixture-token",
  });

const writes = () => calls.filter((call) => call.method === "PUT");
const writtenValues = () =>
  (writes()[0]?.body as { values: unknown[][] } | undefined)?.values;

beforeEach(() => {
  calls = [];
  updates = [];
  reportBuilds = 0;
  savedRow = {
    organization_id: "org-1",
    sheet_id: "sheet-1",
    created_by: "owner-1",
    auto_sync: true,
  };
  sourceCounts = { projects: 3, certificates: 40, project_signups: 12 };
  tabs = ["Member Hours"];
  volunteerCount = 2;
  recordError = null;
  metadataResponse = () =>
    Response.json({
      spreadsheetId: "sheet-1",
      properties: { title: "Fixture" },
      sheets: tabs.map((title, sheetId) => ({
        properties: { sheetId, title },
      })),
    });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (method === "GET") return metadataResponse();
    return new Response(null, { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the shared organization sheet sync", () => {
  test("writes the default layout when none is saved, and records the sync", async () => {
    expect(await run()).toEqual({ success: true });

    const values = writtenValues();
    expect(values?.[0]).toEqual([
      "Volunteer Name",
      "Email",
      "Total Hours",
      "Verified Hours",
      "Pending Hours",
      "Events Attended",
      "Last Activity",
      "Source",
    ]);
    expect(writes()[0].url).toMatch(/valueInputOption=RAW$/u);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0])).toEqual(["last_synced_at"]);
  });

  test("writes the saved layout, whether it is stored as an object or as text", async () => {
    const layout = {
      reportType: "member-hours",
      orientation: "horizontal",
      columns: [
        { key: "email", label: "Contact" },
        { key: "total_hours", label: "Hours" },
      ],
    };

    for (const saved of [layout, JSON.stringify(layout)]) {
      calls = [];
      expect(await run({ layout_config: saved })).toEqual({ success: true });
      expect(writtenValues()).toEqual([
        ["Contact", "Hours"],
        ["volunteer0@example.test", 12.5],
        ["volunteer1@example.test", 12.5],
      ]);
      expect(writes()[0].url).toContain(
        encodeURIComponent("'Member Hours'!A1:B3"),
      );
    }
  });

  test("falls back to the default layout when the saved one is for another report", async () => {
    const result = await run({
      layout_config: {
        reportType: "project-summary",
        orientation: "horizontal",
        columns: [{ key: "project_name", label: "Project" }],
      },
    });

    expect(result).toEqual({ success: true });
    expect(writtenValues()?.[0]?.[0]).toBe("Volunteer Name");
  });

  test("sends hours and counts as JSON numbers and keeps numeric-looking text as text", async () => {
    await run();

    expect(writtenValues()?.[1]).toEqual([
      "2024",
      "volunteer0@example.test",
      12.5,
      10,
      2.5,
      3,
      "",
      "Registered",
    ]);
  });

  test("names a missing tab, creates nothing, and turns automatic sync off", async () => {
    tabs = ["Renamed"];

    expect(await run()).toEqual({
      success: false,
      code: "tab_missing",
      error:
        'The tab "Member Hours" no longer exists in the spreadsheet. Pick a tab again in the sheet settings.',
    });
    // Only the metadata read happened: no tab was added and nothing written.
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    expect(updates).toHaveLength(1);
    expect(updates[0].auto_sync).toBe(false);
  });

  test("refuses to write past a bounded range", async () => {
    volunteerCount = 100;

    for (const [range, holds] of [
      ["A1:H21", 21],
      ["B2:D20", 19],
    ] as const) {
      const result = await run({ range_a1: range });
      expect(result).toMatchObject({ success: false, code: "range_too_small" });
      expect(result).toHaveProperty(
        "error",
        expect.stringContaining(`the selected range ${range} holds ${holds}.`),
      );
    }
    expect(await run({ range_a1: "A1:H21" })).toEqual({
      success: false,
      code: "range_too_small",
      error:
        "The report has 101 rows but the selected range A1:H21 holds 21. Widen the range or remove its end.",
    });
    expect(writes()).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test("a sync saved with the old default range A1:H20 still grows past row 20", async () => {
    volunteerCount = 100;

    expect(await run({ range_a1: "A1:H20" })).toEqual({ success: true });

    const [write] = writes();
    expect(writtenValues()).toHaveLength(101);
    expect(decodeURIComponent(write.url)).toContain("'Member Hours'!A1:");
    expect(decodeURIComponent(write.url)).toMatch(/!A1:[A-Z]+101(\?|$)/u);

    // A later, shorter report clears stale cells only inside the saved range,
    // as it always did. Nothing beside or below the old box is touched.
    volunteerCount = 2;
    calls = [];
    expect(await run({ range_a1: "A1:H20" })).toEqual({ success: true });
    expect(
      calls
        .filter((call) => call.url.includes(":clear"))
        .map((call) => decodeURIComponent(call.url).split("/values/")[1]),
    ).toEqual(["'Member Hours'!A4:H20:clear"]);

    // The stored value is not rewritten by a sync.
    expect(updates.some((update) => "range_a1" in update)).toBe(false);
  });

  test("an open start cell has no row limit", async () => {
    volunteerCount = 100;

    expect(await run({ range_a1: "A1" })).toEqual({ success: true });
    expect(writtenValues()).toHaveLength(101);
  });

  test("asks for the file to be chosen again when the owner cannot open it", async () => {
    for (const status of [403, 404]) {
      calls = [];
      updates = [];
      metadataResponse = () =>
        Response.json({ error: { status: "PERMISSION_DENIED" } }, { status });

      const result = await run();
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ code: "sheet_inaccessible" });
      expect(writes()).toHaveLength(0);
      expect(updates).toEqual([expect.objectContaining({ auto_sync: false })]);
    }
  });

  test("reports a timeout as temporary and leaves automatic sync on", async () => {
    metadataResponse = () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };

    expect(await run()).toEqual({
      success: false,
      code: "sheets_timeout",
      error:
        "Google Sheets did not respond in time. Try again in a few minutes.",
    });
    expect(updates).toHaveLength(0);
  });

  test("every Sheets request carries a timeout signal", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const recordingFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return recordingFetch(input as string, init);
    }) as typeof fetch;

    // A narrower layout leaves stale cells, so the clear requests run too.
    await run({ range_a1: "A1:H21" });

    expect(signals.length).toBeGreaterThan(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  test("says so when the write is refused or the sync time cannot be saved", async () => {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? metadataResponse()
        : new Response("{}", { status: 403 })) as typeof fetch;
    expect(await run()).toMatchObject({ code: "sheet_not_editable" });
    expect(updates).toHaveLength(0);

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? metadataResponse()
        : new Response(null, { status: 200 })) as typeof fetch;
    recordError = { message: "fixture" };
    expect(await run()).toMatchObject({ code: "record_failed" });
  });
});

describe("per-organization work bounds", () => {
  test("refuses an oversized organization before the report is built", async () => {
    for (const counts of [
      { projects: 10_001, certificates: 0, project_signups: 0 },
      { projects: 3, certificates: 60_000, project_signups: 40_001 },
    ]) {
      sourceCounts = counts;

      expect(await run()).toMatchObject({
        success: false,
        code: "report_too_large",
      });
    }
    expect(reportBuilds).toBe(0);
    expect(writes()).toHaveLength(0);
  });

  test("fails closed when the report size cannot be counted", async () => {
    sourceCounts = { projects: 3, certificates: null, project_signups: 1 };

    expect(await run()).toMatchObject({ code: "report_unavailable" });
    expect(reportBuilds).toBe(0);
  });

  test("still refuses a built report past the row cap", async () => {
    volunteerCount = 10_000;

    const result = await run();
    expect(result).toMatchObject({ success: false, code: "report_too_large" });
    expect(reportBuilds).toBe(1);
    expect(writes()).toHaveLength(0);
  });

  test("makes at most four Sheets requests for one sync", async () => {
    await run({ range_a1: "A1:Z500" });

    expect(calls.map((call) => call.method)).toEqual([
      "GET",
      "PUT",
      "POST",
      "POST",
    ]);
  });

  test("stops at the caller's deadline and passes it to every request", async () => {
    const controller = new AbortController();
    const seen: boolean[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen.push(init?.signal instanceof AbortSignal);
      controller.abort();
      init?.signal?.throwIfAborted();
      return metadataResponse();
    }) as typeof fetch;

    const result = await runOrganizationSheetSync({
      supabase,
      config: config(),
      accessToken: "fixture-token",
      signal: controller.signal,
    });

    expect(result).toMatchObject({ success: false, code: "sheets_timeout" });
    expect(seen).toEqual([true]);
    expect(updates).toHaveLength(0);
  });

  test("a sync stopped at its deadline after writing does not stamp the sync time", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return metadataResponse();
      // The deadline fires while the write is in flight.
      controller.abort();
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const result = await runOrganizationSheetSync({
      supabase,
      config: config(),
      accessToken: "fixture-token",
      signal: controller.signal,
    });

    expect(result).toMatchObject({ success: false, code: "sheets_timeout" });
    expect(updates).toHaveLength(0);
    expect(savedRow.last_synced_at).toBeUndefined();
  });

  test("refuses a Sheets request past the per-sync budget", async () => {
    const { inspectSpreadsheet } =
      await import("@/services/google-sheets-report");
    const budget = { remaining: 1 };

    expect((await inspectSpreadsheet("token", "sheet-1", { budget })).ok).toBe(
      true,
    );
    expect(await inspectSpreadsheet("token", "sheet-1", { budget })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("write-backs are scoped to the configuration that was synced", () => {
  test("a stale failure does not turn automatic sync off on a re-selected spreadsheet", async () => {
    // An admin picked another file while this sync was in flight.
    savedRow.sheet_id = "sheet-2";
    tabs = ["Renamed"];

    expect(await run()).toMatchObject({ code: "tab_missing" });
    expect(updates).toHaveLength(0);
    expect(savedRow.auto_sync).toBe(true);
  });

  test("a stale success does not stamp the sync time for a new owner", async () => {
    savedRow.created_by = "owner-2";

    await run();
    expect(savedRow.last_synced_at).toBeUndefined();
  });
});
