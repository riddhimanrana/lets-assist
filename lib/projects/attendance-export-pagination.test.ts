import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceExportError } from "./attendance-export";
import {
  createExportReadBudget,
  readAllExportPages,
  readValidatedExportSnapshot,
} from "./attendance-export-pagination";

const status = (code: number) => (error: unknown) =>
  error instanceof AttendanceExportError && error.status === code;
const count = (value: number) => async () => ({ count: value, error: null });

for (const invalid of [
  null,
  -1,
  1.5,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`rejects invalid source count ${invalid} before reading pages`, async () => {
    let pages = 0;
    await assert.rejects(
      readAllExportPages(
        async () => {
          pages++;
          return { data: [], error: null };
        },
        async () => ({ count: invalid, error: null }),
      ),
      status(503),
    );
    assert.equal(pages, 0);
  });
}

for (const failedRead of [1, 2]) {
  test(`fails closed when source count read ${failedRead} fails`, async () => {
    let counts = 0;
    await assert.rejects(
      readAllExportPages(
        async () => ({ data: [], error: null }),
        async () => ({
          count: 0,
          error: ++counts === failedRead ? new Error("read failed") : null,
        }),
      ),
      status(503),
    );
  });
}

test("rejects source limits before downloading any rows", async () => {
  let pages = 0;
  await assert.rejects(
    readAllExportPages(
      async () => {
        pages++;
        return { data: [], error: null };
      },
      count(4),
      createExportReadBudget(3),
    ),
    status(413),
  );
  assert.equal(pages, 0);
});

test("shares a reservation budget across concurrent source reads", async () => {
  const budget = createExportReadBudget(3);
  let pages = 0;
  const read = () =>
    readAllExportPages(
      async (after) => {
        pages++;
        return { data: after ? [] : [{ id: "a" }, { id: "b" }], error: null };
      },
      count(2),
      budget,
    );
  const results = await Promise.allSettled([read(), read()]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && status(413)(rejected.reason));
  assert.equal(pages, 2);
});

for (const currentCount of [1, 3]) {
  test(`rejects insert/delete drift when final count is ${currentCount}`, async () => {
    let counts = 0;
    await assert.rejects(
      readAllExportPages(
        async (after) => ({
          data: after ? [] : [{ id: "b" }, { id: "c" }],
          error: null,
        }),
        async () => ({ count: ++counts === 1 ? 2 : currentCount, error: null }),
      ),
      status(409),
    );
  });
}

test("rejects a missing row even if counts misleadingly stay unchanged", async () => {
  await assert.rejects(
    readAllExportPages(
      async (after) => ({
        data: after ? [] : [{ id: "b" }],
        error: null,
      }),
      count(2),
    ),
    status(409),
  );
});

test("rejects inserted rows before retaining more than the reserved count", async () => {
  await assert.rejects(
    readAllExportPages(
      async () => ({
        data: [{ id: "b" }, { id: "c" }],
        error: null,
      }),
      count(1),
    ),
    status(409),
  );
});

for (const ids of [
  ["b", "b"],
  ["c", "b"],
]) {
  test(`rejects duplicate or unordered rows ${ids.join(",")}`, async () => {
    await assert.rejects(
      readAllExportPages(
        async () => ({
          data: ids.map((id) => ({ id })),
          error: null,
        }),
        count(2),
      ),
      status(409),
    );
  });
}

test("does not return partial rows after a later page fails", async () => {
  await assert.rejects(
    readAllExportPages(
      async (after) => ({
        data: after ? null : [{ id: "b" }],
        error: after ? new Error("failed") : null,
      }),
      count(2),
    ),
    status(503),
  );
});

test("each validation pass receives its own aggregate budget", async () => {
  let reads = 0;
  const result = await readValidatedExportSnapshot(async (budget) => {
    reads++;
    return readAllExportPages(
      async (after) => ({ data: after ? [] : [{ id: "a" }], error: null }),
      count(1),
      budget,
    );
  }, 1);
  assert.deepEqual(result, [{ id: "a" }]);
  assert.equal(reads, 2);
});
