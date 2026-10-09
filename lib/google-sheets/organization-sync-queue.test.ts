import { describe, expect, test } from "bun:test";

import {
  isSheetSyncDue,
  selectSheetSyncBatch,
} from "./organization-sync-queue";

describe("the organization sheet sync queue", () => {
  test("a sync is due once its own interval has passed", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(isSheetSyncDue(null, 1440, now)).toBe(true);
    expect(isSheetSyncDue("2026-01-01T00:00:00.000Z", 1440, now)).toBe(true);
    expect(isSheetSyncDue("2026-01-01T00:00:01.000Z", 1440, now)).toBe(false);
  });

  test("everything runs when the due list fits under the cap", () => {
    expect(selectSheetSyncBatch(["a", "b"], 3, 123_456)).toEqual(["a", "b"]);
  });

  test("the cap holds and the batch is a contiguous turn through the queue", () => {
    const rows = ["a", "b", "c", "d", "e"];
    const batch = selectSheetSyncBatch(rows, 2, 1_700_000_000_000);

    expect(batch).toHaveLength(2);
    expect(new Set(batch).size).toBe(2);
    const start = rows.indexOf(batch[0]);
    expect(batch[1]).toBe(rows[(start + 1) % rows.length]);
  });

  test("an organization stuck at the head is not in every run", () => {
    // "stuck" never succeeds, so it stays first in last-synced order.
    const rows = ["stuck", "b", "c", "d", "e", "f"];
    const twoHours = 2 * 60 * 60 * 1000;
    const runs = Array.from({ length: 24 }, (_, run) =>
      selectSheetSyncBatch(rows, 2, 1_700_000_000_000 + run * twoHours),
    );

    expect(runs.some((batch) => !batch.includes("stuck"))).toBe(true);
    // And every other organization gets a turn across those runs.
    for (const row of rows) {
      expect(runs.some((batch) => batch.includes(row))).toBe(true);
    }
  });
});
