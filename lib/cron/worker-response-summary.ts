import {
  classifyWorkerResponse,
  failedWorkerOutcome,
  type ObservedWorker,
  type WorkerObservation,
} from "./worker-outcome";

const HELD_SESSION_COUNTS = [
  "historical",
  "oversized",
  "invalidAttendance",
  "missingCreator",
  "invalidSchedule",
] as const;

// A blocked pass may still be recorded, but it can never report a healthy
// heartbeat. Anything unreadable counts as blocked.
function readHeartbeatBlocked(worker: ObservedWorker, body: unknown): boolean {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return true;
    const value = body as Record<string, unknown>;
    if (value.enabled === false || value.configurationBlocked === true)
      return true;
    if (
      worker === "organization-sheet-sync" &&
      Object.hasOwn(value, "deferredOrganizations")
    ) {
      if (
        !Number.isInteger(value.deferredOrganizations) ||
        value.deferredOrganizations !== 0
      )
        return true;
    }
    if (worker !== "auto-publish-hours") return false;
    if (value.approvalStatus !== "approved" || value.discoveryCounted !== true)
      return true;
    const held = value.heldSessions;
    if (!held || typeof held !== "object" || Array.isArray(held)) return true;
    // Exactly the reviewed categories, each zero. A category this file does
    // not know about blocks, so a later one cannot pass as healthy.
    if (Reflect.ownKeys(held).length !== HELD_SESSION_COUNTS.length)
      return true;
    return HELD_SESSION_COUNTS.some(
      (key) =>
        !Object.hasOwn(held, key) ||
        !Number.isInteger((held as Record<string, unknown>)[key]) ||
        (held as Record<string, unknown>)[key] !== 0,
    );
  } catch {
    return true;
  }
}

// Capture only reviewed counters before a route serializes its business payload.
export function workerResponseSummary(worker: ObservedWorker) {
  let summary: WorkerObservation = failedWorkerOutcome("invalid_response");
  let captured = false;
  let blocked = true;
  return {
    capture(body: unknown) {
      summary = classifyWorkerResponse(worker, 200, body);
      blocked = readHeartbeatBlocked(worker, body);
      captured = true;
    },
    outcome: () => summary,
    captured: () => captured,
    heartbeatBlocked: () => blocked,
  };
}
