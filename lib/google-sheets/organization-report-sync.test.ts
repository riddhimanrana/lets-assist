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
let ownerAllowed = true;
let bindingActive = true;
let onTokenRead: () => void = () => undefined;
mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: async () => ({
    allowed: ownerAllowed,
  }),
}));
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  getGoogleOAuthConnectionForBinding: async () =>
    bindingActive
      ? {
          id: "fictional-connection",
          access_token: "fictional-encrypted-access",
          refresh_token: "fictional-encrypted-refresh",
          token_expires_at: "2040-01-01",
        }
      : null,
}));
let tokenReads = 0;
mock.module("@/services/calendar", () => ({
  getGoogleAccessTokenForSheetsForUser: async () => {
    tokenReads += 1;
    onTokenRead();
    return "fixture-token";
  },
  organizationSheetsGoogleBinding: (organizationId: string) => ({
    organizationId,
    purpose: "organization_sheets",
  }),
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
let replaceOwnerAtCompletion = false;
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
    select: () => query,
    maybeSingle: async () => {
      if (replaceOwnerAtCompletion && "last_synced_at" in payload)
        savedRow.created_by = "new-owner";
      const matches = filters.every(
        ([column, value]) => savedRow[column] === value,
      );
      if (matches) {
        updates.push(payload);
        Object.assign(savedRow, payload);
      }
      return {
        data: matches ? { organization_id: savedRow.organization_id } : null,
        error: "last_synced_at" in payload ? recordError : null,
      };
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

// A model of the two run RPCs, holding one run per organization the way the
// database does. `leased` stands in for an unexpired lease.
type ModelRun = {
  identity: string;
  state: "claimed" | "planned" | "completed" | "outcome_unknown";
  token: string | null;
  leased: boolean;
  runId: string;
  plan: Record<string, unknown> | null;
  rows: unknown[][] | null;
  done: number;
  inflight: { request_id: string; step: number } | null;
  /** What completion answered. A finished run keeps it, and its token. */
  receipt?: Record<string, unknown>;
};
let modelRun: ModelRun | null = null;
let rpcLog: Array<{ step: string; args: Record<string, unknown> }> = [];
/** "refuse" rolls the step back. "lose" applies it and drops the answer. */
let rpcFault: (step: string) => "refuse" | "lose" | null = () => null;
const REFUSED = { data: null, error: { code: "55000", message: "fixture" } };
const currentRow = () => ({ ...config(), ...savedRow });
const configIdentity = () => {
  const row = currentRow() as Record<string, unknown>;
  return JSON.stringify(
    [
      "sheet_id",
      "tab_name",
      "range_a1",
      "report_type",
      "layout_config",
      "created_by",
      "updated_at",
    ].map((column) => row[column]),
  );
};
const actorAuthorized = (args: Record<string, unknown>) =>
  ownerAllowed &&
  bindingActive &&
  currentRow().organization_id === args.p_organization &&
  currentRow().created_by === args.p_actor;

function claimRun(args: Record<string, unknown>) {
  const row = currentRow();
  if (
    !actorAuthorized(args) ||
    row.sheet_id !== args.p_sheet_id ||
    row.updated_at !== args.p_config_updated_at
  )
    return REFUSED;
  const run = modelRun;
  if (run?.state === "outcome_unknown")
    return { data: { status: "outcome_unknown" }, error: null };
  if (run?.leased) return { data: { status: "busy" }, error: null };
  if (run?.inflight) {
    run.state = "outcome_unknown";
    return { data: { status: "outcome_unknown" }, error: null };
  }
  const token = crypto.randomUUID();
  if (run?.state === "planned" && run.identity === configIdentity()) {
    Object.assign(run, { token, leased: true, done: 0 });
    return {
      data: {
        status: "resume",
        claim_token: token,
        run_id: run.runId,
        plan: run.plan,
        rows: run.rows,
      },
      error: null,
    };
  }
  modelRun = {
    identity: configIdentity(),
    state: "claimed",
    token,
    leased: true,
    runId: crypto.randomUUID(),
    plan: null,
    rows: null,
    done: 0,
    inflight: null,
  };
  return {
    data: { status: "claimed", claim_token: token, run_id: modelRun.runId },
    error: null,
  };
}

function advanceRun(args: Record<string, unknown>) {
  const step = String(args.p_step);
  const payload = args.p_payload as Record<string, unknown>;
  const run = modelRun;
  if (!run || run.token === null || run.token !== args.p_claim) return REFUSED;
  if (run.state === "completed") {
    // The finished claim reads its receipt back and can change nothing.
    if (step === "finalize") return { data: run.receipt, error: null };
    return step === "release"
      ? { data: { released: true, status: "completed" }, error: null }
      : REFUSED;
  }
  if (step === "acknowledge") {
    const open = run.inflight;
    if (
      run.state !== "planned" ||
      !open ||
      open.request_id !== payload.request_id ||
      open.step !== payload.step
    )
      return REFUSED;
    run.inflight = null;
    if (payload.outcome === "completed") run.done += 1;
    return {
      data: { acknowledged: true, ...open, outcome: payload.outcome },
      error: null,
    };
  }
  if (step === "release") {
    if (run.inflight) {
      Object.assign(run, { state: "outcome_unknown", leased: false });
      return {
        data: { released: false, status: "outcome_unknown" },
        error: null,
      };
    }
    Object.assign(run, { token: null, leased: false });
    return { data: { released: true }, error: null };
  }
  if (run.state === "outcome_unknown" || !run.leased || !actorAuthorized(args))
    return REFUSED;
  if (step === "finalize" && replaceOwnerAtCompletion)
    savedRow.created_by = "new-owner";
  if (run.identity !== configIdentity()) return REFUSED;
  const ranges = (run.plan?.ranges ?? []) as unknown[];
  if (step === "plan") {
    if (run.state !== "claimed") return REFUSED;
    const plan = payload.plan as Record<string, unknown>;
    Object.assign(run, {
      state: "planned",
      plan: structuredClone(plan),
      rows: structuredClone(payload.rows),
      done: 0,
    });
    return {
      data: {
        planned: true,
        run_id: run.runId,
        step_count: (plan.ranges as unknown[]).length,
      },
      error: null,
    };
  }
  if (step === "begin") {
    if (
      run.state !== "planned" ||
      run.inflight ||
      run.done >= ranges.length ||
      payload.step !== run.done
    )
      return REFUSED;
    run.inflight = { request_id: String(payload.request_id), step: run.done };
    return { data: { begun: true, ...run.inflight }, error: null };
  }
  if (step === "finalize") {
    if (run.state !== "planned" || run.inflight || run.done !== ranges.length)
      return REFUSED;
    if (recordError) return { data: null, error: recordError };
    const stamp = { last_synced_at: new Date().toISOString() };
    updates.push(stamp);
    Object.assign(savedRow, stamp);
    Object.assign(run, { state: "completed", rows: null, plan: null });
    run.leased = false;
    run.receipt = {
      completed: true,
      organization_id: args.p_organization,
      actor_user_id: args.p_actor,
      run_id: run.runId,
      sheet_id: currentRow().sheet_id,
      config_updated_at: currentRow().updated_at,
      ...stamp,
    };
    return { data: run.receipt, error: null };
  }
  return REFUSED;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const step =
    name === "claim_organization_sheet_sync_run"
      ? "claim"
      : String(args.p_step);
  rpcLog.push({ step, args });
  const fault = rpcFault(step);
  if (fault === "refuse") return REFUSED;
  const result = step === "claim" ? claimRun(args) : advanceRun(args);
  return fault === "lose"
    ? { data: null, error: { message: "fixture transport" } }
    : result;
}
const rpcSteps = () => rpcLog.map((call) => call.step);

const supabase = {
  rpc,
  from: (table: string) => ({
    select: () =>
      table === "organization_sheet_syncs"
        ? {
            eq: () => ({
              maybeSingle: async () => ({
                data: { ...config(), ...savedRow },
                error: null,
              }),
            }),
          }
        : countQuery(table),
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
  updated_at: "2026-10-11T00:00:00.000Z",
  ...overrides,
});

const run = (overrides: Record<string, unknown> = {}) => {
  Object.assign(savedRow, overrides);
  return runOrganizationSheetSync({
    supabase,
    config: config(overrides),
  });
};

const writes = () => calls.filter((call) => call.method === "PUT");
const writtenValues = () =>
  (writes()[0]?.body as { values: unknown[][] } | undefined)?.values;

beforeEach(() => {
  ownerAllowed = true;
  bindingActive = true;
  tokenReads = 0;
  onTokenRead = () => undefined;
  calls = [];
  updates = [];
  reportBuilds = 0;
  modelRun = null;
  rpcLog = [];
  rpcFault = () => null;
  savedRow = {
    organization_id: "org-1",
    sheet_id: "sheet-1",
    created_by: "owner-1",
    updated_at: "2026-10-11T00:00:00.000Z",
    auto_sync: true,
  };
  sourceCounts = { projects: 3, certificates: 40, project_signups: 12 };
  tabs = ["Member Hours"];
  volunteerCount = 2;
  recordError = null;
  replaceOwnerAtCompletion = false;
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

    // A later, shorter report clears stale cells only inside the saved range.
    // The sync cannot know how far an earlier report reached, so it never
    // clears cells below or beside the box, which may not be its own.
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
      savedRow.updated_at = "2026-10-11T00:00:00.000Z";
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

    expect(await run()).toMatchObject({ code: "configuration_changed" });
    expect(updates).toHaveLength(0);
    expect(savedRow.auto_sync).toBe(true);
  });

  test("a stale success does not stamp the sync time for a new owner", async () => {
    savedRow.created_by = "owner-2";

    expect(await run()).toMatchObject({
      success: false,
      code: "configuration_changed",
    });
    expect(writes()).toHaveLength(0);
    expect(savedRow.last_synced_at).toBeUndefined();
  });
  test.each(["owner", "connection", "destination", "layout", "unlink"])(
    "a %s change during report acquisition refuses the provider write",
    async (change) => {
      metadataResponse = () => {
        if (change === "owner") ownerAllowed = false;
        if (change === "connection") bindingActive = false;
        if (change === "destination") savedRow.sheet_id = "sheet-2";
        if (change === "layout")
          savedRow.updated_at = "2026-10-11T01:00:00.000Z";
        if (change === "unlink") savedRow.organization_id = "removed";
        return Response.json({
          spreadsheetId: "sheet-1",
          sheets: [{ properties: { title: "Member Hours" } }],
        });
      };
      expect(await run()).toMatchObject({ success: false });
      expect(writes()).toHaveLength(0);
      expect(updates).toHaveLength(0);
    },
  );
  test("a revocation after the write stops stale-cell clearing and completion", async () => {
    const mocked = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const response = await mocked(input as RequestInfo, init);
      if (init?.method === "PUT") ownerAllowed = false;
      return response;
    }) as typeof fetch;
    expect(await run({ range_a1: "A1:Z500" })).toMatchObject({
      success: false,
      code: "authorization_changed",
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
    expect(updates).toHaveLength(0);
  });
  test("a configuration change between the completion check and update cannot report success", async () => {
    replaceOwnerAtCompletion = true;
    expect(await run()).toMatchObject({
      success: false,
      code: "record_failed",
    });
    expect(savedRow.last_synced_at).toBeUndefined();
    expect(updates).toHaveLength(0);
  });
  test("each stale-cell clear needs its own fresh destination check", async () => {
    const mocked = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const response = await mocked(input as RequestInfo, init);
      if (init?.method === "POST") savedRow.sheet_id = "new-sheet";
      return response;
    }) as typeof fetch;
    expect(await run({ range_a1: "A1:Z500" })).toMatchObject({
      success: false,
      code: "configuration_changed",
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT", "POST"]);
    expect(updates).toHaveLength(0);
  });
});

describe("one durable run per organization", () => {
  /** Answers every mutation with one status, or throws for "transport". */
  const mutationsAnswer = (answer: number | "transport") => {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(input),
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      if (method === "GET") return metadataResponse();
      if (answer === "transport") throw new TypeError("fixture network");
      return new Response("{}", { status: answer });
    }) as typeof fetch;
  };

  test("the claim comes before any read, and the report is saved before the first mutation", async () => {
    const order: string[] = [];
    const recordingFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      order.push(init?.method ?? "GET");
      return recordingFetch(input as string, init);
    }) as typeof fetch;
    const recordingRpc = rpcFault;
    rpcFault = (step) => {
      order.push(step);
      return recordingRpc(step);
    };

    expect(await run({ range_a1: "A1:Z500" })).toEqual({ success: true });
    expect(order).toEqual([
      "claim",
      "GET",
      "plan",
      "begin",
      "PUT",
      "acknowledge",
      "begin",
      "POST",
      "acknowledge",
      "begin",
      "POST",
      "acknowledge",
      "finalize",
    ]);
    expect(modelRun).toMatchObject({ state: "completed", rows: null });
    // Token material never enters a run call.
    expect(JSON.stringify(rpcLog)).not.toContain("fixture-token");
    expect(JSON.stringify(rpcLog)).not.toContain("fictional-encrypted");
  });

  test("a known rejection keeps the saved report, and the retry replays exactly it", async () => {
    mutationsAnswer(429);
    expect(await run()).toMatchObject({ code: "sheets_rate_limited" });
    expect(modelRun).toMatchObject({ state: "planned", inflight: null });
    const saved = structuredClone(modelRun!.rows);

    // The source moves on, but the unresolved report is not rebuilt.
    volunteerCount = 5;
    mutationsAnswer(200);
    calls = [];
    expect(await run()).toEqual({ success: true });
    expect(reportBuilds).toBe(1);
    expect(writtenValues()).toEqual(saved!);
    expect(rpcSteps().filter((step) => step === "plan")).toHaveLength(1);

    // With that run finished, the next one builds the current report.
    calls = [];
    expect(await run()).toEqual({ success: true });
    expect(reportBuilds).toBe(2);
    expect(writtenValues()).toHaveLength(6);
  });

  test.each([500, 503, 409, "transport"] as const)(
    "a write answered with %s is an unknown outcome that blocks later runs",
    async (answer) => {
      mutationsAnswer(answer);
      expect(await run()).toMatchObject({
        success: false,
        code: "sync_outcome_unknown",
      });
      expect(modelRun).toMatchObject({ state: "outcome_unknown" });
      expect(modelRun!.inflight).not.toBeNull();
      expect(updates).toHaveLength(0);

      // A later run is refused before it reads or builds anything, even after
      // the provider recovers and even for a newly saved configuration.
      mutationsAnswer(200);
      calls = [];
      expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
      expect(
        await run({ sheet_id: "sheet-2", updated_at: "2026-10-11T02:00:00Z" }),
      ).toMatchObject({ code: "sync_outcome_unknown" });
      expect(calls).toHaveLength(0);
      expect(reportBuilds).toBe(1);
      expect(modelRun!.inflight).not.toBeNull();
      expect(savedRow.last_synced_at).toBeUndefined();
    },
  );

  test("an uncertain stale-cell clear blocks too, after the write was acknowledged", async () => {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return metadataResponse();
      return new Response("{}", { status: method === "PUT" ? 200 : 502 });
    }) as typeof fetch;

    expect(await run({ range_a1: "A1:Z500" })).toMatchObject({
      code: "sync_outcome_unknown",
    });
    expect(modelRun).toMatchObject({
      state: "outcome_unknown",
      done: 1,
      inflight: { step: 1 },
    });
  });

  test("an accepted write whose acknowledgement is not saved is unknown, not successful", async () => {
    rpcFault = (step) => (step === "acknowledge" ? "refuse" : null);

    expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
    expect(writes()).toHaveLength(1);
    expect(rpcSteps()).not.toContain("finalize");
    expect(updates).toHaveLength(0);

    rpcFault = () => null;
    calls = [];
    expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
    expect(calls).toHaveLength(0);
  });

  test("a deadline between the durable begin and the request records that nothing was sent", async () => {
    const controller = new AbortController();
    rpcFault = (step) => {
      if (step === "begin") controller.abort();
      return null;
    };

    const result = await runOrganizationSheetSync({
      supabase,
      config: config(),
      signal: controller.signal,
    });
    expect(result).toMatchObject({ code: "sheets_timeout" });
    expect(writes()).toHaveLength(0);
    expect(rpcSteps().slice(-2)).toEqual(["acknowledge", "release"]);
    expect(rpcLog[rpcLog.length - 2].args.p_payload).toMatchObject({
      outcome: "unsent",
    });
    expect(modelRun).toMatchObject({ state: "planned", inflight: null });

    // Nothing is uncertain, so the saved report is replayed.
    rpcFault = () => null;
    expect(await run()).toEqual({ success: true });
    expect(reportBuilds).toBe(1);
  });

  test("an expired lease with nothing in flight is taken over with the saved report", async () => {
    mutationsAnswer(429);
    // The worker stops without releasing its claim.
    rpcFault = (step) => (step === "release" ? "refuse" : null);
    expect(await run()).toMatchObject({ code: "sheets_rate_limited" });
    const saved = structuredClone(modelRun!.rows);
    rpcFault = () => null;
    mutationsAnswer(200);

    volunteerCount = 7;
    calls = [];
    expect(await run()).toMatchObject({ code: "sync_in_progress" });
    expect(calls).toHaveLength(0);

    modelRun!.leased = false;
    expect(await run()).toEqual({ success: true });
    expect(reportBuilds).toBe(1);
    expect(writtenValues()).toEqual(saved!);
  });

  test("an expired lease with a request in flight is never taken over", async () => {
    mutationsAnswer("transport");
    rpcFault = (step) => (step === "release" ? "refuse" : null);
    expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
    expect(modelRun).toMatchObject({ state: "planned", leased: true });
    rpcFault = () => null;
    mutationsAnswer(200);

    calls = [];
    expect(await run()).toMatchObject({ code: "sync_in_progress" });
    modelRun!.leased = false;
    expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
    expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
    expect(calls).toHaveLength(0);
    expect(modelRun).toMatchObject({ state: "outcome_unknown" });
    expect(modelRun!.inflight).not.toBeNull();
  });

  test("a new configuration replaces an unresolved report only when nothing is uncertain", async () => {
    mutationsAnswer(404);
    expect(await run()).toMatchObject({ code: "sheet_inaccessible" });
    // The permanent failure paused the configuration this run was claimed for.
    expect(updates).toEqual([expect.objectContaining({ auto_sync: false })]);
    expect(modelRun).toMatchObject({ state: "planned", inflight: null });

    mutationsAnswer(200);
    volunteerCount = 3;
    calls = [];
    const next = { sheet_id: "sheet-2", updated_at: "2026-10-11T03:00:00Z" };
    expect(await run(next)).toEqual({ success: true });
    expect(reportBuilds).toBe(2);
    expect(writtenValues()).toHaveLength(4);
    // Every request went to the new spreadsheet, none to the old one.
    expect(calls.every((call) => call.url.includes("/sheet-2"))).toBe(true);
  });

  test("a run whose claim is refused reads and writes nothing", async () => {
    rpcFault = (step) => (step === "claim" ? "refuse" : null);

    expect(await run()).toMatchObject({
      success: false,
      code: "authorization_changed",
    });
    expect(calls).toHaveLength(0);
    expect(reportBuilds).toBe(0);
    expect(rpcSteps()).toEqual(["claim"]);
  });

  test("a report that is not affirmatively saved is never written", async () => {
    rpcFault = (step) => (step === "plan" ? "lose" : null);

    expect(await run()).toMatchObject({ code: "report_unavailable" });
    expect(writes()).toHaveLength(0);
    expect(rpcSteps()).not.toContain("begin");
  });

  test("a completion whose answer was lost is confirmed without rebuilding or re-sending anything", async () => {
    let lost = 0;
    rpcFault = (step) => (step === "finalize" && lost++ === 0 ? "lose" : null);

    expect(await run({ range_a1: "A1:Z500" })).toEqual({ success: true });
    // The first finalize was saved. The second read its receipt back.
    expect(rpcSteps().filter((step) => step === "finalize")).toHaveLength(2);
    expect(rpcSteps().filter((step) => step === "plan")).toHaveLength(1);
    expect(reportBuilds).toBe(1);
    expect(calls.map((call) => call.method)).toEqual([
      "GET",
      "PUT",
      "POST",
      "POST",
    ]);
    expect(updates).toHaveLength(1);
    expect(rpcSteps()).not.toContain("release");
  });

  test("a completion that is never confirmed is reported as unconfirmed and keeps its proof", async () => {
    rpcFault = (step) => (step === "finalize" ? "lose" : null);

    const result = await run();
    expect(result).toMatchObject({ success: false, code: "record_failed" });
    expect(result).toHaveProperty(
      "error",
      expect.stringContaining("not confirmed"),
    );
    expect(rpcSteps().filter((step) => step === "finalize")).toHaveLength(3);
    expect(writes()).toHaveLength(1);
    // The release that follows cannot undo or erase the saved completion.
    expect(rpcSteps().slice(-1)).toEqual(["release"]);
    expect(modelRun).toMatchObject({ state: "completed", rows: null });
    expect(modelRun!.receipt).toMatchObject({ completed: true });
    expect(updates).toHaveLength(1);
  });

  test("the claim is taken before a token is prepared, and a caller without it prepares none", async () => {
    const order: string[] = [];
    onTokenRead = () => order.push("token");
    rpcFault = (step) => {
      order.push(step);
      return null;
    };
    expect(await run()).toEqual({ success: true });
    expect(order.slice(0, 2)).toEqual(["claim", "token"]);
    expect(tokenReads).toBe(1);

    // Refused: nothing is prepared and nothing is released.
    rpcFault = (step) => (step === "claim" ? "refuse" : null);
    expect(await run()).toMatchObject({ code: "authorization_changed" });
    expect(tokenReads).toBe(1);

    // Blocked by an uncertain mutation: the same.
    rpcFault = () => null;
    modelRun!.state = "outcome_unknown";
    expect(await run()).toMatchObject({ code: "sync_outcome_unknown" });
    expect(tokenReads).toBe(1);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  test("a claim refused because the configuration moved says so without preparing a token", async () => {
    savedRow.range_a1 = "B2:E9";
    savedRow.updated_at = "2026-10-11T05:00:00.000Z";

    expect(
      await runOrganizationSheetSync({ supabase, config: config() }),
    ).toMatchObject({ success: false, code: "configuration_changed" });
    expect(tokenReads).toBe(0);
    expect(calls).toHaveLength(0);
    expect(rpcSteps()).toEqual(["claim"]);
  });

  test("authority lost after the claim releases it before anything is read", async () => {
    // The binding is removed after the claim, while the token is being read.
    onTokenRead = () => {
      bindingActive = false;
    };

    expect(await run()).toMatchObject({
      success: false,
      code: "authorization_changed",
    });
    expect(calls).toHaveLength(0);
    expect(reportBuilds).toBe(0);
    expect(rpcSteps()).toEqual(["claim", "release"]);
  });
});

test("a concurrent authorized report waits instead of building and overwriting the in-flight report", async () => {
  let release!: () => void;
  let entered!: () => void;
  const inWrite = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writeCount = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (method === "GET") return metadataResponse();
    if (method === "PUT") {
      writeCount += 1;
      if (writeCount === 1) {
        entered();
        await held;
      }
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const first = run();
  await inWrite;
  volunteerCount = 4;
  const second = await run();
  release();
  expect(await first).toEqual({ success: true });
  expect(second.success).toBe(false);
  expect(reportBuilds).toBe(1);
  expect(writeCount).toBe(1);
});
