import { beforeEach, describe, expect, test } from "bun:test";

import { createSheetSyncTable } from "@/tests/support/organization-sheet-sync-table";

import {
  discoverDueSheetSyncs,
  isSheetSyncDue,
  sheetSyncIntervalMinutes,
  type SheetSyncQueueClient,
} from "./organization-sync-queue";

const START = Date.parse("2026-10-11T12:00:00.000Z");
const MINUTE = 60 * 1000;
const COLUMNS = "organization_id, sheet_id, created_by, updated_at, auto_sync";
const table = createSheetSyncTable();
const organization = (index: number) =>
  `5bee0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const minutesBefore = (minutes: number) =>
  new Date(START - minutes * MINUTE).toISOString();
const discover = (
  maxOrganizations = 25,
  signal = new AbortController().signal,
) =>
  discoverDueSheetSyncs({
    supabase: table as unknown as SheetSyncQueueClient,
    columns: COLUMNS,
    maxOrganizations,
    startedAt: START,
    signal,
  });
const selectedIds = async (maxOrganizations = 25) => {
  const found = await discover(maxOrganizations);
  if (found.status !== "selected") throw new Error(`Discovery ${found.status}`);
  return found.rows.map((row) => row.organization_id);
};

beforeEach(() => table.reset());

describe("when a sheet sync is due", () => {
  test("a sync is due once its own interval has passed", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(isSheetSyncDue(null, 1440, now)).toBe(true);
    expect(isSheetSyncDue("2026-01-01T00:00:00.000Z", 1440, now)).toBe(true);
    expect(isSheetSyncDue("2026-01-01T00:00:01.000Z", 1440, now)).toBe(false);
  });

  test("the saved interval has a 15 minute floor and falls back to a day", () => {
    expect(sheetSyncIntervalMinutes(60)).toBe(60);
    expect(sheetSyncIntervalMinutes(15)).toBe(15);
    expect(sheetSyncIntervalMinutes(5)).toBe(15);
    for (const invalid of [0, -30, null, undefined, Number.NaN, "60"]) {
      expect(sheetSyncIntervalMinutes(invalid)).toBe(1440);
    }
  });
});

describe("discovery", () => {
  test("more than 100 organizations that are not due cannot hide one that is", async () => {
    // 120 clustered ids synced ten minutes ago, then one that never synced.
    for (let index = 1; index <= 120; index += 1)
      table.add(organization(index), { last_synced_at: minutesBefore(10) });
    table.add(organization(121));

    const found = await discover();
    expect(found).toMatchObject({ status: "selected", dueCount: 1 });
    expect(await selectedIds()).toEqual([organization(121)]);
  });

  test("each organization's own interval decides, with the floor and the fallback", async () => {
    table.add(organization(1), {
      sync_interval_minutes: 60,
      last_synced_at: minutesBefore(59),
    });
    table.add(organization(2), {
      sync_interval_minutes: 60,
      last_synced_at: minutesBefore(60),
    });
    table.add(organization(3), {
      sync_interval_minutes: 5,
      last_synced_at: minutesBefore(10),
    });
    table.add(organization(4), {
      sync_interval_minutes: 5,
      last_synced_at: minutesBefore(15),
    });
    table.add(organization(5), {
      sync_interval_minutes: 0,
      last_synced_at: minutesBefore(120),
    });
    table.add(organization(6), {
      sync_interval_minutes: -30,
      last_synced_at: minutesBefore(1440),
    });
    table.add(organization(7), { auto_sync: false });

    expect(await selectedIds()).toEqual([
      organization(2),
      organization(4),
      organization(6),
    ]);
  });

  test("more than 100 due organizations are counted exactly and the batch holds the cap", async () => {
    for (let index = 1; index <= 130; index += 1)
      table.add(organization(index));

    const found = await discover();
    expect(found).toMatchObject({ status: "selected", dueCount: 130 });
    if (found.status !== "selected") throw new Error("Expected a batch");
    expect(found.rows).toHaveLength(25);
    expect(table.calls).toEqual([
      {
        name: "claim_organization_sheet_sync_batch",
        limit: 25,
        runStartedAt: new Date(START).toISOString(),
        signal: expect.any(AbortSignal),
      },
    ]);
    // The configurations are loaded by id, in one bounded request.
    expect(table.loads).toHaveLength(1);
    expect(table.loads[0].ids).toHaveLength(25);
    expect(table.loads[0].columns).toBe(COLUMNS);
    expect(table.loads[0].signal).toBeInstanceOf(AbortSignal);
  });

  test("the limit sent is the run's cap, held between 1 and 200", async () => {
    for (let index = 1; index <= 3; index += 1) table.add(organization(index));
    for (const [maxOrganizations, limit] of [
      [200, 200],
      [5_000, 200],
      [1, 1],
      [0, 1],
    ]) {
      table.calls = [];
      await discover(maxOrganizations);
      expect(table.calls.map((call) => call.limit)).toEqual([limit]);
    }
  });

  test("repeated passes that sync nothing still reach every due organization", async () => {
    for (let index = 1; index <= 60; index += 1) table.add(organization(index));
    const ids = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) =>
        organization(from + index),
      );

    // Nothing is ever stamped, as when every provider sync fails.
    expect(await selectedIds()).toEqual(ids(1, 25));
    expect(await selectedIds()).toEqual(ids(26, 50));
    expect(await selectedIds()).toEqual([...ids(51, 60), ...ids(1, 15)]);
  });

  test("two passes that overlap take turns, and the Calendar cursor is another cursor", async () => {
    for (let index = 1; index <= 30; index += 1) table.add(organization(index));
    table.cursors["organization-calendar-sync"] = organization(7);

    // The stand-in answers one call at a time, as the database lock does.
    const [first, second] = await Promise.all([selectedIds(), selectedIds()]);
    expect(first).toHaveLength(25);
    expect(second).toHaveLength(25);
    expect(first[0]).toBe(organization(1));
    expect(second[0]).toBe(organization(26));
    expect(new Set([...first, ...second]).size).toBe(30);
    expect(table.cursors).toEqual({
      "organization-calendar-sync": organization(7),
      "organization-sheet-sync": organization(20),
    });
  });

  test("a counted empty queue is selected with nothing to do and loads nothing", async () => {
    table.add(organization(1), { last_synced_at: minutesBefore(10) });

    expect(await discover()).toEqual({
      status: "selected",
      dueCount: 0,
      rows: [],
    });
    expect(table.loads).toHaveLength(0);
  });

  test.each(["error", "throw"] as const)(
    "a batch call that answers with %s is unread, not empty",
    async (fault) => {
      table.add(organization(1));
      table.fault = () => fault;

      const found = await discover();
      expect(found).toEqual({ status: "unread" });
      expect(JSON.stringify(found)).not.toContain("private");
      expect(table.loads).toHaveLength(0);
    },
  );

  test("a batch call under a signal that has ended is unread", async () => {
    table.add(organization(1));
    const ended = new AbortController();
    ended.abort();

    expect(await discover(25, ended.signal)).toEqual({ status: "unread" });
  });

  const malformed: Array<
    [
      string,
      (computed: { due_count: number; organization_ids: string[] }) => unknown,
    ]
  > = [
    ["nothing", () => null],
    ["a null count", (computed) => ({ ...computed, due_count: null })],
    ["a negative count", (computed) => ({ ...computed, due_count: -1 })],
    [
      "a count smaller than the batch",
      (computed) => ({ ...computed, due_count: 2 }),
    ],
    [
      "a count larger than a batch under the cap",
      (computed) => ({ ...computed, due_count: 4 }),
    ],
    [
      "an id that is not a UUID",
      (computed) => ({
        ...computed,
        organization_ids: [
          "fictional-org",
          ...computed.organization_ids.slice(1),
        ],
      }),
    ],
    [
      "a repeated id",
      (computed) => ({
        ...computed,
        organization_ids: [
          ...computed.organization_ids.slice(0, 2),
          computed.organization_ids[0],
        ],
      }),
    ],
  ];
  test.each(malformed)(
    "a batch answer with %s is unread",
    async (_name, answer) => {
      for (let index = 1; index <= 3; index += 1)
        table.add(organization(index));
      table.answer = answer;

      expect(await discover()).toEqual({ status: "unread" });
      expect(table.loads).toHaveLength(0);
    },
  );

  const unloaded: Array<
    [string, (rows: Record<string, unknown>[]) => unknown]
  > = [
    ["an error", () => "error"],
    ["a thrown request", () => "throw"],
    ["a selected configuration missing", (rows) => rows.slice(1)],
    [
      "a configuration nobody selected",
      (rows) => [
        ...rows.slice(1),
        { ...rows[0], organization_id: organization(99) },
      ],
    ],
    ["the same configuration twice", (rows) => [rows[1], ...rows.slice(1)]],
    ["an extra configuration", (rows) => [...rows, rows[0]]],
    ["a row that is not a configuration", (rows) => [null, ...rows.slice(1)]],
    [
      "a configuration without its owner",
      (rows) => [{ ...rows[0], created_by: null }, ...rows.slice(1)],
    ],
    [
      "a configuration without its revision",
      (rows) => [{ ...rows[0], updated_at: "" }, ...rows.slice(1)],
    ],
    [
      "a configuration without its spreadsheet",
      (rows) => [{ ...rows[0], sheet_id: undefined }, ...rows.slice(1)],
    ],
    [
      "a configuration that does not say whether it is enabled",
      (rows) => [{ ...rows[0], auto_sync: null }, ...rows.slice(1)],
    ],
    ["something that is not a list", () => ({ rows: [] })],
  ];
  test.each(unloaded)(
    "a configuration load that answers with %s keeps the count and attempts nothing",
    async (_name, respond) => {
      for (let index = 1; index <= 3; index += 1)
        table.add(organization(index));
      table.load = respond as typeof table.load;

      expect(await discover()).toEqual({ status: "unloaded", dueCount: 3 });
    },
  );
});
