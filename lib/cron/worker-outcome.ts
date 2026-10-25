import { observedWorkers } from "./worker-keys.mjs";
export { observedWorkers } from "./worker-keys.mjs";
import {
  workerRecord as record,
  workerCount as count,
  workerSum as sum,
} from "./worker-aggregate";
import { readAdditionalWorkerCounts } from "./worker-additional-outcomes";
export type ObservedWorker = (typeof observedWorkers)[number];
export type WorkerEnvironment = "local" | "development" | "production";
export type WorkerOutcome = {
  outcome: "no_run" | "processed" | "partial" | "failed";
  code:
    | "empty_queue"
    | "completed"
    | "partial_work"
    | "worker_failed"
    | "invalid_response"
    | "unhandled_error";
  attempted: number;
  completed: number;
  failed: number;
  pending: number;
  refused: number;
  faults: number;
  deadlineReached: boolean;
};
export type WorkerObservation =
  | WorkerOutcome
  | { outcome: "auth_probe"; code: "auth_probe" }
  | { outcome: "no_run"; code: "disabled" | "status_only" };
export function failedWorkerOutcome(
  code: "worker_failed" | "invalid_response" | "unhandled_error",
): WorkerOutcome {
  return {
    outcome: "failed",
    code,
    attempted: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    refused: 0,
    faults: 1,
    deadlineReached: false,
  };
}
export function classifyWorkerResponse(
  worker: ObservedWorker,
  status: number,
  body: unknown,
): WorkerObservation {
  try {
    const value = record(body);
    if (value.mode === "auth-shape-v1" && value.dispatched === false)
      return { outcome: "auth_probe", code: "auth_probe" };
    if (status < 200 || status >= 300)
      return failedWorkerOutcome("worker_failed");
    if (value.enabled === false) return { outcome: "no_run", code: "disabled" };
    if (
      typeof value.message === "string" &&
      typeof value.timestamp === "string" &&
      !Object.hasOwn(value, "outcomes") &&
      !Object.hasOwn(value, "results")
    )
      return { outcome: "no_run", code: "status_only" };
    const result: WorkerOutcome = {
      outcome: "no_run",
      code: "empty_queue",
      attempted: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      refused: 0,
      faults: 0,
      deadlineReached: false,
    };
    const outcomes = [
      "csf-communications-dispatch",
      "project-cancellations",
    ].includes(worker)
      ? record(value.outcomes)
      : {};
    if (worker === "csf-communications-dispatch") {
      result.attempted = count(value.claimed);
      result.completed = count(outcomes.sent);
      result.failed = sum(outcomes.failed, outcomes.unknown);
      result.pending = count(outcomes.retryable);
      result.refused = sum(outcomes.refused, outcomes.authorization_lost);
      result.faults = count(value.faults);
    } else if (worker === "project-cancellations") {
      const notifications = record(value.notifications);
      result.attempted = count(value.jobsClaimed);
      result.completed = count(value.jobsCompleted);
      result.failed = sum(value.jobsFailed, value.jobsNeedingReview);
      result.pending = count(value.jobsReleased);
      result.faults = sum(
        value.failedExhaustedJobs,
        value.reapedUnknownDeliveries,
        outcomes.failed,
        outcomes.retryable,
        outcomes.unknown,
        notifications.failed,
        notifications.retryable,
      );
    } else if (!readAdditionalWorkerCounts(worker, value, result)) {
      // The export worker must supply its own reviewed aggregate classifier.
      return failedWorkerOutcome("invalid_response");
    }
    if (
      ["csf-communications-dispatch", "project-cancellations"].includes(worker)
    ) {
      if (typeof value.deadlineReached !== "boolean")
        return failedWorkerOutcome("invalid_response");
      result.deadlineReached = value.deadlineReached;
    }
    if (
      result.failed ||
      result.pending ||
      result.refused ||
      result.faults ||
      result.deadlineReached
    ) {
      result.outcome =
        result.completed > 0 ||
        result.pending > 0 ||
        result.refused > 0 ||
        result.deadlineReached
          ? "partial"
          : "failed";
      result.code =
        result.outcome === "partial" ? "partial_work" : "worker_failed";
    } else if (result.completed > 0) {
      result.outcome = "processed";
      result.code = "completed";
    } else if (result.attempted > 0) {
      result.outcome = "partial";
      result.code = "partial_work";
    }
    return result;
  } catch {
    return failedWorkerOutcome("invalid_response");
  }
}

export function validateWorkerOutcome(value: WorkerObservation): WorkerOutcome {
  if (!("deadlineReached" in value))
    throw new Error(
      "Only an enabled worker pass may finish an execution receipt.",
    );
  const exact = [
    "outcome",
    "code",
    "attempted",
    "completed",
    "failed",
    "pending",
    "refused",
    "faults",
    "deadlineReached",
  ];
  if (
    Object.keys(value).sort().join() !== exact.sort().join() ||
    !["no_run", "processed", "partial", "failed"].includes(value.outcome) ||
    ![
      "empty_queue",
      "completed",
      "partial_work",
      "worker_failed",
      "invalid_response",
      "unhandled_error",
    ].includes(value.code) ||
    typeof value.deadlineReached !== "boolean"
  )
    throw new Error("Invalid worker outcome.");
  for (const key of [
    "attempted",
    "completed",
    "failed",
    "pending",
    "refused",
    "faults",
  ] as const)
    count(value[key]);
  const validCode = {
    no_run: ["empty_queue"],
    processed: ["completed"],
    partial: ["partial_work"],
    failed: ["worker_failed", "invalid_response", "unhandled_error"],
  }[value.outcome].includes(value.code);
  if (!validCode) throw new Error("Worker outcome and code disagree.");
  if (
    value.outcome === "no_run" &&
    (value.attempted ||
      value.completed ||
      value.failed ||
      value.pending ||
      value.refused ||
      value.faults ||
      value.deadlineReached)
  )
    throw new Error("An empty pass cannot claim work.");
  if (
    value.outcome === "processed" &&
    (value.failed ||
      value.pending ||
      value.refused ||
      value.faults ||
      value.deadlineReached)
  )
    throw new Error("A completed pass cannot hide unfinished work.");
  return value;
}
