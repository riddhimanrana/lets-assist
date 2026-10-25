import { failedWorkerOutcome, type WorkerOutcome } from "./worker-outcome";

function count(value: unknown, maximum: number) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  )
    throw new Error("Invalid export aggregate");
  return Number(value);
}

export function classifyDataExportResponse(
  status: number,
  body: unknown,
): WorkerOutcome {
  if (status < 200 || status >= 300)
    return failedWorkerOutcome("worker_failed");
  try {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid export aggregate");
    const value = body as Record<string, unknown>;
    if (value.ok !== true || typeof value.cleanupFailed !== "boolean")
      throw new Error("Invalid export aggregate");
    const attempted = count(value.processed, 5);
    const completed = count(value.completed, 5);
    const failed = count(value.failed, 5);
    const unaccepted = count(value.skipped, 5);
    const removed = count(value.removed, 10);
    if (
      completed + failed !== attempted ||
      unaccepted < failed ||
      unaccepted > attempted
    )
      throw new Error("Inconsistent export aggregate");
    // Archive completion and email acceptance are separate. Unconfirmed email
    // is a fault requiring review; it does not authorize an automatic resend.
    const faults = unaccepted - failed + Number(value.cleanupFailed);
    const hasFailure = failed > 0 || faults > 0;
    const outcome = hasFailure
      ? completed > 0 || removed > 0
        ? "partial"
        : "failed"
      : attempted > 0 || removed > 0
        ? "processed"
        : "no_run";
    return {
      outcome,
      code:
        outcome === "partial"
          ? "partial_work"
          : outcome === "failed"
            ? "worker_failed"
            : outcome === "processed"
              ? "completed"
              : "empty_queue",
      attempted,
      completed,
      failed,
      faults,
      pending: 0,
      refused: 0,
      deadlineReached: false,
    };
  } catch {
    return failedWorkerOutcome("invalid_response");
  }
}
