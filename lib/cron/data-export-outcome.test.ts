import { expect, test } from "bun:test";
import { classifyDataExportResponse } from "./data-export-outcome";
import { validateWorkerOutcome } from "./worker-outcome";
const empty = {
  ok: true,
  processed: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  removed: 0,
  cleanupFailed: false,
};
test("an empty pass and cleanup-only work remain distinguishable", () => {
  expect(classifyDataExportResponse(200, empty).outcome).toBe("no_run");
  const cleaned = classifyDataExportResponse(200, { ...empty, removed: 2 });
  expect(cleaned.outcome).toBe("processed");
  expect(cleaned.completed).toBe(0);
  expect(validateWorkerOutcome(cleaned)).toEqual(cleaned);
});
test("ready archives never hide unconfirmed or failed email", () => {
  const ready = { ...empty, processed: 1, completed: 1 };
  expect(classifyDataExportResponse(200, ready).outcome).toBe("processed");
  const uncertain = classifyDataExportResponse(200, { ...ready, skipped: 1 });
  expect(uncertain).toMatchObject({
    outcome: "partial",
    completed: 1,
    faults: 1,
    pending: 0,
  });
  expect(validateWorkerOutcome(uncertain)).toEqual(uncertain);
});
test("generation failures and cleanup faults remain actionable", () => {
  expect(
    classifyDataExportResponse(200, {
      ...empty,
      processed: 1,
      failed: 1,
      skipped: 1,
    }),
  ).toMatchObject({ outcome: "failed", failed: 1, faults: 0 });
  expect(
    classifyDataExportResponse(200, { ...empty, cleanupFailed: true }),
  ).toMatchObject({ outcome: "failed", faults: 1 });
  expect(
    classifyDataExportResponse(200, {
      ...empty,
      removed: 1,
      cleanupFailed: true,
    }),
  ).toMatchObject({ outcome: "partial", faults: 1 });
  expect(classifyDataExportResponse(503, empty).code).toBe("worker_failed");
});
test("missing, inconsistent, probe and out-of-budget results fail closed", () => {
  for (const invalid of [
    null,
    {},
    { mode: "auth-shape-v1", dispatched: false },
    { ...empty, processed: 1 },
    { ...empty, processed: 6, completed: 6 },
    { ...empty, skipped: 1 },
    { ...empty, removed: 11 },
    { ...empty, completed: -1 },
    { ...empty, cleanupFailed: "private" },
  ])
    expect(classifyDataExportResponse(200, invalid).code).toBe(
      "invalid_response",
    );
});
