import { expect, test } from "bun:test";
import {
  classifyWorkerResponse,
  validateWorkerOutcome,
} from "./worker-outcome";

// The recovery claim always carries its counted ledger inventory. A recovery
// override below states only the selected batch, so the inventory defaults to
// counted with nothing pending or held.
const countedLedger = { counted: true, pending: 0, held: 0 };
function pass(overrides: Record<string, unknown> = {}) {
  const body = passWithout(overrides);
  return {
    ...body,
    recovery: { ...countedLedger, ...(body.recovery as object) },
  };
}
function passWithout(overrides: Record<string, unknown> = {}) {
  return {
    approvalStatus: "approved",
    discoveryCounted: true,
    heldSessions: {
      historical: 0,
      oversized: 0,
      invalidAttendance: 0,
      missingCreator: 0,
      invalidSchedule: 0,
    },
    processedSessions: 0,
    successfulSessions: 0,
    pendingSessions: 0,
    results: [],
    recovery: {
      deliveries: 0,
      accepted: 0,
      partial: 0,
      settlementUnconfirmed: 0,
    },
    ...overrides,
  };
}
test("only an approved counted empty queue is an authoritative empty hours pass", () => {
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, pass()),
  ).toMatchObject({ outcome: "no_run", code: "empty_queue" });
  const unapproved: Record<string, unknown> = pass({
    approvalStatus: "approval_required",
    discoveryCounted: false,
    heldSessions: null,
    pendingSessions: undefined,
  });
  delete unapproved.pendingSessions;
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, unapproved).outcome,
  ).toBe("partial");
});
test("committed pending mail is partial even when no new session was published", () => {
  const result = classifyWorkerResponse(
    "auto-publish-hours",
    200,
    pass({
      recovery: {
        deliveries: 1,
        accepted: 0,
        partial: 1,
        settlementUnconfirmed: 0,
      },
    }),
  );
  expect(result.outcome).toBe("partial");
  expect(validateWorkerOutcome(result) === result).toBe(true);
});
test("durably accepted recovery can complete work without inventing a new session", () => {
  const result = classifyWorkerResponse(
    "auto-publish-hours",
    200,
    pass({
      recovery: {
        deliveries: 1,
        accepted: 1,
        partial: 0,
        settlementUnconfirmed: 0,
      },
    }),
  );
  expect(result).toMatchObject({ outcome: "processed", completed: 1 });
});
test("held historical or invalid-schedule work never produces a green empty result", () => {
  for (const category of [
    "historical",
    "oversized",
    "invalidAttendance",
    "missingCreator",
    "invalidSchedule",
  ]) {
    const body = pass();
    expect(
      classifyWorkerResponse(
        "auto-publish-hours",
        200,
        pass({
          heldSessions: { ...body.heldSessions, [category]: 1 },
        }),
      ).outcome,
    ).toBe("partial");
  }
});
test("unconfirmed settlement remains partial rather than confirmed delivery", () => {
  expect(
    classifyWorkerResponse(
      "auto-publish-hours",
      200,
      pass({
        processedSessions: 1,
        successfulSessions: 1,
        results: [{ success: true, errors: [] }],
        recovery: {
          deliveries: 1,
          accepted: 0,
          partial: 1,
          settlementUnconfirmed: 1,
        },
      }),
    ).outcome,
  ).toBe("partial");
});
test("inconsistent recovery acceptance arithmetic is rejected", () => {
  expect(
    classifyWorkerResponse(
      "auto-publish-hours",
      200,
      pass({
        recovery: {
          deliveries: 1,
          accepted: 2,
          partial: 0,
          settlementUnconfirmed: 0,
        },
      }),
    ).code,
  ).toBe("invalid_response");
});
test("a full accepted batch with one delivery still due is not a completed pass", () => {
  const result = classifyWorkerResponse(
    "auto-publish-hours",
    200,
    pass({
      recovery: {
        pending: 1,
        deliveries: 25,
        accepted: 25,
        partial: 0,
        settlementUnconfirmed: 0,
      },
    }),
  );
  expect(result).toMatchObject({
    outcome: "partial",
    completed: 25,
    pending: 1,
  });
  expect(validateWorkerOutcome(result) === result).toBe(true);
});
test("a held delivery, or a ledger that was not counted, blocks an empty pass", () => {
  const emptyBatch = {
    deliveries: 0,
    accepted: 0,
    partial: 0,
    settlementUnconfirmed: 0,
  };
  expect(
    classifyWorkerResponse(
      "auto-publish-hours",
      200,
      pass({ recovery: { ...emptyBatch, held: 1 } }),
    ),
  ).toMatchObject({ outcome: "partial", refused: 1, pending: 0 });
  expect(
    classifyWorkerResponse(
      "auto-publish-hours",
      200,
      pass({
        recovery: { ...emptyBatch, counted: false, pending: null, held: null },
      }),
    ),
  ).toMatchObject({ outcome: "partial", refused: 1, pending: 0 });
  // The inventory is required. A batch without it is not read as zero.
  expect(
    classifyWorkerResponse("auto-publish-hours", 200, passWithout()).code,
  ).toBe("invalid_response");
});
