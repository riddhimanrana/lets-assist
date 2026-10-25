import { beforeEach, describe, expect, test } from "bun:test";

import {
  createCalendarSyncTable,
  type CalendarSyncBatchAnswer,
} from "@/tests/support/organization-calendar-sync-table";

import {
  runOrganizationCalendarSyncQueue,
  type CalendarSyncQueueClient,
  type CalendarSyncQueueOptions,
} from "./calendar-sync-queue";

const START = Date.parse("2026-10-11T12:00:00.000Z");
const MINUTE = 60 * 1000;

/** A clock and timers that move only when the test moves them. */
function createClock() {
  let time = START;
  const timers: Array<{ at: number; fire: () => void; live: boolean }> = [];
  return {
    now: () => time,
    setTimer: (fire: () => void, delayMs: number) => {
      const timer = { at: time + delayMs, fire, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      time += ms;
      const due = timers
        .filter((timer) => timer.live && timer.at <= time)
        .sort((left, right) => left.at - right.at);
      for (const timer of due) {
        timer.live = false;
        timer.fire();
      }
    },
    liveTimers: () => timers.filter((timer) => timer.live).length,
  };
}
/** Lets every pending continuation run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const table = createCalendarSyncTable();
let clock = createClock();
let synced: string[] = [];
let signals: Record<string, AbortSignal> = {};
let sync: CalendarSyncQueueOptions["sync"];
let thrown: Array<[string, unknown]> = [];

const limits = {
  maxOrganizations: 25,
  concurrency: 3,
  runBudgetMs: 50_000,
  minimumStartBudgetMs: 5_000,
  organizationBudgetMs: 30_000,
  settleGraceMs: 2_000,
};
const run = (overrides: Partial<typeof limits> = {}) =>
  runOrganizationCalendarSyncQueue({
    supabase: table as unknown as CalendarSyncQueueClient,
    sync: (organizationId, options) => {
      synced.push(organizationId);
      signals[organizationId] = options.signal;
      return sync(organizationId, options);
    },
    limits: { ...limits, ...overrides },
    onThrown: (organizationId, error) => thrown.push([organizationId, error]),
    now: clock.now,
    setTimer: clock.setTimer,
  });
// Ids that differ only in their last digits, as ids created together do.
const organization = (index: number) =>
  `ca1e0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const organizations = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    organization(from + index),
  );
const dueRows = (count: number) =>
  organizations(1, count).map((organization_id) => ({
    organization_id,
    last_synced_at: null,
  }));
const UNREAD = {
  status: 500 as const,
  body: {
    processed: 0,
    results: [],
    // No number of waiting organizations is invented.
    deferredOrganizations: 0,
    discoveryCounted: false,
    discoveryIncomplete: true,
  },
};

beforeEach(() => {
  table.reset();
  clock = createClock();
  synced = [];
  signals = {};
  thrown = [];
  sync = async () => ({ success: true });
});

describe("discovery", () => {
  test("a confirmed empty queue is healthy and starts nothing", async () => {
    table.rows = [
      {
        organization_id: organization(1),
        last_synced_at: new Date(START - 10 * MINUTE).toISOString(),
      },
    ];

    expect(await run()).toEqual({
      status: 200,
      body: {
        processed: 0,
        results: [],
        deferredOrganizations: 0,
        discoveryCounted: true,
        discoveryIncomplete: false,
      },
    });
    expect(table.calls).toHaveLength(1);
    expect(synced).toEqual([]);
  });

  test("one bounded call, under the run's signal, asks for the run's own start time", async () => {
    table.rows = dueRows(3);

    await run();
    expect(table.calls).toEqual([
      {
        name: "claim_organization_calendar_sync_batch",
        limit: 25,
        runStartedAt: new Date(START).toISOString(),
        signal: expect.any(AbortSignal),
      },
    ]);

    for (const [maxOrganizations, limit] of [
      [200, 200],
      [5_000, 200],
      [1, 1],
      [0, 1],
      [-3, 1],
    ]) {
      table.calls = [];
      await run({ maxOrganizations });
      expect(table.calls.map((call) => call.limit)).toEqual([limit]);
    }
  });

  test("only enabled organizations that are due are counted and attempted", async () => {
    table.rows = [
      { organization_id: organization(1), last_synced_at: null },
      {
        organization_id: organization(2),
        last_synced_at: new Date(START - 60 * MINUTE).toISOString(),
      },
      {
        organization_id: organization(3),
        last_synced_at: new Date(START - 59 * MINUTE).toISOString(),
      },
      {
        organization_id: organization(4),
        last_synced_at: null,
        auto_sync: false,
      },
    ];

    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      processed: 2,
      deferredOrganizations: 0,
      discoveryCounted: true,
      discoveryIncomplete: false,
    });
    expect(synced).toEqual(organizations(1, 2));
  });

  test("due organizations past the cap are deferred by the exact count", async () => {
    table.rows = dueRows(40);

    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      processed: 25,
      deferredOrganizations: 15,
      discoveryCounted: true,
      discoveryIncomplete: false,
    });
    expect(synced).toEqual(organizations(1, 25));
  });

  test("30 clustered organizations that all keep failing are each reached within two runs of 25", async () => {
    table.rows = dueRows(30);
    // Nothing ever succeeds, so no organization ever leaves the queue.
    sync = async () => ({ success: false, error: "Fixture provider failure" });

    const first = await run();
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({
      processed: 25,
      deferredOrganizations: 5,
    });
    expect(synced).toEqual(organizations(1, 25));

    synced = [];
    const second = await run();
    expect(second.body).toMatchObject({
      processed: 25,
      deferredOrganizations: 5,
    });
    // The five left behind go first, then the queue wraps to its start.
    expect(synced).toEqual([...organizations(26, 30), ...organizations(1, 20)]);

    synced = [];
    await run();
    expect(synced).toEqual([...organizations(21, 30), ...organizations(1, 15)]);
  });

  test("two runs that overlap take turns at the queue instead of sharing its front", async () => {
    table.rows = dueRows(30);
    sync = async () => ({ success: false, error: "Fixture provider failure" });

    // The stand-in answers one call at a time, as the database lock does.
    const [first, second] = await Promise.all([run(), run()]);
    const attempted = (result: typeof first) =>
      result.body.results.map((entry) => entry.organizationId);
    expect(attempted(first)).toEqual(organizations(1, 25));
    expect(attempted(second)).toEqual([
      ...organizations(26, 30),
      ...organizations(1, 20),
    ]);
    expect(new Set([...attempted(first), ...attempted(second)]).size).toBe(30);
  });

  test.each(["error", "throw"] as const)(
    "a call that answers with %s is an unknown inventory, not an empty one",
    async (fault) => {
      table.rows = dueRows(3);
      table.fault = () => fault;

      const result = await run();
      expect(result).toEqual(UNREAD);
      expect(synced).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("private");
    },
  );

  const malformed: Array<
    [string, (computed: CalendarSyncBatchAnswer) => unknown]
  > = [
    ["nothing", () => null],
    ["a list", (computed) => [computed]],
    ["no count", ({ organization_ids }) => ({ organization_ids })],
    ["a null count", (computed) => ({ ...computed, due_count: null })],
    ["a negative count", (computed) => ({ ...computed, due_count: -1 })],
    ["a fractional count", (computed) => ({ ...computed, due_count: 2.5 })],
    ["a count as text", (computed) => ({ ...computed, due_count: "3" })],
    [
      "a count smaller than the batch",
      (computed) => ({ ...computed, due_count: 2 }),
    ],
    [
      "a count larger than a batch under the cap",
      (computed) => ({ ...computed, due_count: 4 }),
    ],
    ["no batch", ({ due_count }) => ({ due_count })],
    [
      "a batch that is not a list",
      (computed) => ({ ...computed, organization_ids: "none" }),
    ],
    [
      "an id that is not a UUID",
      (computed) => ({
        ...computed,
        organization_ids: [
          ...computed.organization_ids.slice(0, 2),
          "fictional-org",
        ],
      }),
    ],
    [
      "an id that is not text",
      (computed) => ({
        ...computed,
        organization_ids: [...computed.organization_ids.slice(0, 2), 7],
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
    "an answer with %s starts nothing",
    async (_name, answer) => {
      table.rows = dueRows(3);
      table.answer = answer;

      expect(await run()).toEqual(UNREAD);
      expect(synced).toEqual([]);
    },
  );

  test("a batch larger than the cap asked for starts nothing", async () => {
    table.rows = dueRows(30);
    table.answer = (computed) => ({
      due_count: 30,
      organization_ids: [...computed.organization_ids, organization(26)],
    });

    expect(await run()).toEqual(UNREAD);
    expect(synced).toEqual([]);
  });

  test("a call still in flight when the run's budget ends is an unknown inventory", async () => {
    table.rows = dueRows(3);
    table.fault = (call) => {
      // The run's budget ends while the call is in flight.
      clock.advance(50_000);
      return call.signal?.aborted ? "throw" : null;
    };

    expect(await run()).toEqual(UNREAD);
    expect(synced).toEqual([]);
    expect(clock.liveTimers()).toBe(0);
  });
});

describe("run and organization budgets", () => {
  test("no organization starts once the run is near its deadline", async () => {
    table.rows = dueRows(5);
    sync = async () => {
      clock.advance(23_000);
      return { success: true };
    };

    const result = await run({ concurrency: 1 });
    // The third would start with 4 seconds left, under the 5 second minimum.
    expect(synced).toHaveLength(2);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      processed: 2,
      deferredOrganizations: 3,
      discoveryCounted: true,
      discoveryIncomplete: false,
    });
    expect(result.body.results.every((entry) => entry.success)).toBe(true);
  });

  test("an organization past its budget is stopped, reported, and its slot is reused after a bounded wait", async () => {
    table.rows = dueRows(2);
    const [slow, next] = table.rows.map((row) => row.organization_id);
    sync = (organizationId) =>
      organizationId === slow
        ? new Promise(() => undefined)
        : Promise.resolve({ success: true });

    const pending = run({ concurrency: 1 });
    await settle();
    expect(synced).toEqual([slow]);
    expect(signals[slow].aborted).toBe(false);

    clock.advance(29_999);
    await settle();
    expect(signals[slow].aborted).toBe(false);
    clock.advance(1);
    await settle();
    // The deadline reaches the work itself, which is what stops new mutations.
    expect(signals[slow].aborted).toBe(true);
    // The slot is held for the grace, then given to the next organization.
    expect(synced).toEqual([slow]);
    clock.advance(2_000);

    const result = await pending;
    expect(synced).toEqual([slow, next]);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      processed: 2,
      deferredOrganizations: 0,
    });
    const [stopped, completed] = result.body.results;
    expect(stopped).toMatchObject({ organizationId: slow, success: false });
    // Stopping is not described as undoing anything already sent.
    expect(JSON.stringify(stopped)).not.toMatch(/rolled back|undone|revert/iu);
    expect(completed).toEqual({ organizationId: next, success: true });
    expect(clock.liveTimers()).toBe(0);
  });

  test("an organization started late gets only what is left of the run", async () => {
    table.rows = dueRows(2);
    const [first, second] = table.rows.map((row) => row.organization_id);
    sync = (organizationId) =>
      organizationId === first
        ? Promise.resolve().then(() => {
            clock.advance(25_000);
            return { success: true };
          })
        : new Promise(() => undefined);

    const pending = run({ concurrency: 1 });
    await settle();
    expect(synced).toEqual([first, second]);
    // Twenty-five seconds of the run are left, less than its own budget.
    clock.advance(24_999);
    await settle();
    expect(signals[second].aborted).toBe(false);
    clock.advance(1);
    await settle();
    expect(signals[second].aborted).toBe(true);
    clock.advance(2_000);

    const result = await pending;
    expect(result.body.results.map((entry) => entry.success)).toEqual([
      true,
      false,
    ]);
  });

  test("a thrown sync is one failed organization and the others still run", async () => {
    table.rows = dueRows(3);
    const failing = organization(2);
    sync = async (organizationId) => {
      if (organizationId === failing) throw new Error("Fixture failure");
      return { success: true, createdCount: 1 };
    };

    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body.processed).toBe(3);
    expect(result.body.deferredOrganizations).toBe(0);
    expect(result.body.results).toContainEqual({
      organizationId: failing,
      success: false,
      error: "Fixture failure",
    });
    expect(thrown.map(([organizationId]) => organizationId)).toEqual([failing]);
    expect(clock.liveTimers()).toBe(0);
  });

  test("deferred work is the exact due count less what was attempted, whatever those attempts did", async () => {
    table.rows = dueRows(40);
    sync = async (organizationId) => {
      // Each attempt takes 23 seconds, and the first one fails.
      clock.advance(23_000);
      return organizationId === organization(1)
        ? { success: false, error: "Fixture provider failure" }
        : { success: true };
    };

    const { status, body } = await run({ concurrency: 1 });
    expect(status).toBe(503);
    expect(body.processed).toBe(2);
    expect(body.results.map((entry) => entry.success)).toEqual([false, true]);
    // 40 were due and 2 were attempted: 23 past the cap and 15 never started.
    expect(body.deferredOrganizations).toBe(38);
    expect(body.discoveryCounted).toBe(true);
    expect(body.discoveryIncomplete).toBe(false);
  });
});
