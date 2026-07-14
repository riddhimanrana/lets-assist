import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency, readPositiveInteger } from "./map-with-concurrency";

test("mapWithConcurrency caps active work and preserves result order", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([4, 3, 2, 1], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 10;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [40, 30, 20, 10]);
});

test("mapWithConcurrency rejects invalid limits", async () => {
  await assert.rejects(
    () => mapWithConcurrency([1], 0, async (value) => value),
    /positive integer/u,
  );
});

test("readPositiveInteger falls back for missing and invalid values", () => {
  assert.equal(readPositiveInteger("5", 3), 5);
  assert.equal(readPositiveInteger("500", 3, 10), 10);
  assert.equal(readPositiveInteger("0", 3), 3);
  assert.equal(readPositiveInteger("not-a-number", 3), 3);
  assert.equal(readPositiveInteger(undefined, 3), 3);
});
