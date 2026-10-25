import { expect, test } from "bun:test";
import { loadScanCandidatePages } from "./scan-candidates";

test("candidate pagination preserves a full 5000-person printed roster", async () => {
  const rows = Array.from({ length: 5000 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const loaded = await loadScanCandidatePages(async (start, end) => {
    ranges.push([start, end]);
    return { data: rows.slice(start, end + 1), error: null };
  });
  expect(loaded).toEqual(rows);
  expect(ranges).toEqual([
    [0, 999],
    [1000, 1999],
    [2000, 2999],
    [3000, 3999],
    [4000, 4999],
    [5000, 5999],
  ]);
});

test("candidate overflow fails after bounded queries instead of returning an incomplete roster", async () => {
  let queries = 0;
  await expect(
    loadScanCandidatePages(async (start, end) => {
      queries++;
      return {
        data: Array.from(
          { length: end - start + 1 },
          (_, index) => start + index,
        ),
        error: null,
      };
    }),
  ).rejects.toThrow("candidate limit");
  expect(queries).toBe(11);
});

test("a failed later candidate page fails the scan instead of returning earlier identities", async () => {
  await expect(
    loadScanCandidatePages(async (start) =>
      start === 0
        ? {
            data: Array.from({ length: 1000 }, (_, index) => index),
            error: null,
          }
        : { data: null, error: { code: "fixture_failure" } },
    ),
  ).rejects.toThrow("fixture_failure");
});
