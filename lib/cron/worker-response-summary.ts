import {
  classifyWorkerResponse,
  failedWorkerOutcome,
  type ObservedWorker,
  type WorkerObservation,
} from "./worker-outcome";

// Capture only reviewed counters before a route serializes its business payload.
export function workerResponseSummary(worker: ObservedWorker) {
  let summary: WorkerObservation = failedWorkerOutcome("invalid_response");
  return {
    capture(body: unknown) {
      summary = classifyWorkerResponse(worker, 200, body);
    },
    outcome: () => summary,
  };
}
