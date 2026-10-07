import { expect, mock, test } from "bun:test";
import { loadCalendarSourcePages } from "./calendar-source-pages";
test("reads beyond the API cap using stable keyset pages", async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
  }));
  const fetcher = mock(async (after: string | null, size: number) => ({
    data: rows.filter((row) => after === null || row.id > after).slice(0, size),
    error: null,
  }));
  expect(await loadCalendarSourcePages(fetcher)).toEqual(rows);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test("later page errors refuse the partial snapshot", async () => {
  let calls = 0;
  await expect(
    loadCalendarSourcePages(async () =>
      ++calls === 1
        ? {
            data: Array.from({ length: 500 }, (_, i) => ({
              id: String(i).padStart(5, "0"),
            })),
            error: null,
          }
        : { data: null, error: {} },
    ),
  ).rejects.toThrow("complete calendar source");
});
test("non-advancing pages cannot loop or duplicate projections", async () => {
  await expect(
    loadCalendarSourcePages(async () => ({
      data: [{ id: "same" }, { id: "same" }],
      error: null,
    })),
  ).rejects.toThrow("did not advance");
});
test("oversized snapshots fail closed before reconciliation", async () => {
  let offset = 0;
  await expect(
    loadCalendarSourcePages(async (_after, size) => ({
      data: Array.from({ length: size }, () => ({
        id: String(offset++).padStart(6, "0"),
      })),
      error: null,
    })),
  ).rejects.toThrow("limit exceeded");
});
