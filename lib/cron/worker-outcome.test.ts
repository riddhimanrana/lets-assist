import { expect, test } from "bun:test";
import {
  classifyWorkerResponse,
  validateWorkerOutcome,
  failedWorkerOutcome,
} from "./worker-outcome";
const csf = {
  claimed: 0,
  outcomes: {
    sent: 0,
    failed: 0,
    unknown: 0,
    retryable: 0,
    refused: 0,
    authorization_lost: 0,
  },
  faults: 0,
  deadlineReached: false,
};
test("auth probes, disabled checks and status reads cannot become execution receipts", () => {
  for (const body of [
    { mode: "auth-shape-v1", dispatched: false },
    { enabled: false },
    { message: "ok", timestamp: "2040-01-01" },
  ]) {
    const result = classifyWorkerResponse(
      "csf-communications-dispatch",
      200,
      body,
    );
    expect(["auth_probe", "disabled", "status_only"]).toContain(result.code);
    expect(() => validateWorkerOutcome(result)).toThrow();
  }
});
test("empty, completed, partial, refused, deadline and failed passes remain distinct", () => {
  expect(
    classifyWorkerResponse("csf-communications-dispatch", 200, csf).outcome,
  ).toBe("no_run");
  const cases = [
    [{ sent: 1 }, "processed"],
    [{ sent: 1, failed: 1 }, "partial"],
    [{ failed: 1 }, "failed"],
    [{ unknown: 1 }, "failed"],
    [{ retryable: 1 }, "partial"],
    [{ refused: 1 }, "partial"],
    [{ authorization_lost: 1 }, "partial"],
  ] as const;
  for (const [outcomes, result] of cases)
    expect(
      classifyWorkerResponse("csf-communications-dispatch", 200, {
        ...csf,
        claimed: 2,
        outcomes: { ...csf.outcomes, ...outcomes },
      }).outcome,
    ).toBe(result);
  expect(
    classifyWorkerResponse("csf-communications-dispatch", 200, {
      ...csf,
      deadlineReached: true,
    }).outcome,
  ).toBe("partial");
  expect(
    classifyWorkerResponse("csf-communications-dispatch", 200, {
      ...csf,
      faults: 1,
    }).outcome,
  ).toBe("failed");
});
test("cancellation job completion cannot hide delivery and recovery faults", () => {
  const body = {
    jobsClaimed: 1,
    jobsCompleted: 1,
    jobsFailed: 0,
    jobsNeedingReview: 0,
    jobsReleased: 0,
    failedExhaustedJobs: 0,
    reapedUnknownDeliveries: 0,
    outcomes: { failed: 0, retryable: 0, unknown: 0 },
    notifications: { failed: 0, retryable: 0 },
    deadlineReached: false,
  };
  expect(
    classifyWorkerResponse("project-cancellations", 200, body).outcome,
  ).toBe("processed");
  expect(
    classifyWorkerResponse("project-cancellations", 200, {
      ...body,
      reapedUnknownDeliveries: 1,
    }).outcome,
  ).toBe("partial");
});
test("bad counts, bad shapes and error responses fail closed without copying raw fields", () => {
  for (const claimed of [-1, 1.5, 1_000_001, "2", null])
    expect(
      classifyWorkerResponse("csf-communications-dispatch", 200, {
        ...csf,
        claimed,
      }).code,
    ).toBe("invalid_response");
  expect(
    classifyWorkerResponse("data-exports", 200, { processed: 1 }).code,
  ).toBe("invalid_response");
  expect(
    classifyWorkerResponse("csf-communications-dispatch", 500, {
      error: "synthetic sensitive text",
    }),
  ).toEqual(failedWorkerOutcome("worker_failed"));
});
test("receipt validator refuses unknown fields and misleading success", () => {
  const empty = classifyWorkerResponse("csf-communications-dispatch", 200, csf);
  expect(() =>
    validateWorkerOutcome({ ...empty, unexpected: "no" } as never),
  ).toThrow();
  expect(() =>
    validateWorkerOutcome({ ...empty, completed: 1 } as never),
  ).toThrow();
  expect(() =>
    validateWorkerOutcome({
      ...failedWorkerOutcome("worker_failed"),
      outcome: "processed",
      code: "completed",
    }),
  ).toThrow();
  expect(() =>
    validateWorkerOutcome({
      ...failedWorkerOutcome("worker_failed"),
      code: "completed",
    }),
  ).toThrow();
});
