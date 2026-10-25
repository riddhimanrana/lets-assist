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

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

// The email recovery inventory of an hours pass. It blocks unless the ledger
// was counted and holds nothing pending or held, and every delivery this pass
// selected was accepted and settled. Accepted work alone is healthy.
function recoveryBlocked(recovery: unknown): boolean {
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery))
    return true;
  const value = recovery as Record<string, unknown>;
  if (value.counted !== true) return true;
  // A counted ledger gives both numbers. Null means it was not counted.
  if (value.pending !== 0 || value.held !== 0) return true;
  if (
    !isCount(value.deliveries) ||
    !isCount(value.accepted) ||
    value.deliveries !== value.accepted
  )
    return true;
  return value.partial !== 0 || value.settlementUnconfirmed !== 0;
}

// A blocked pass may still be recorded, but it can never report a healthy
// heartbeat. Anything unreadable counts as blocked.
function readHeartbeatBlocked(worker: ObservedWorker, body: unknown): boolean {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return true;
    const value = body as Record<string, unknown>;
    if (value.enabled === false || value.configurationBlocked === true)
      return true;
    if (
      worker === "organization-calendar-sync" ||
      worker === "organization-sheet-sync"
    ) {
      // Each field is optional, but one that is present must say the pass
      // counted its whole queue and left no due organization behind.
      if (
        Object.hasOwn(value, "deferredOrganizations") &&
        (!Number.isInteger(value.deferredOrganizations) ||
          value.deferredOrganizations !== 0)
      )
        return true;
      if (
        Object.hasOwn(value, "discoveryCounted") &&
        value.discoveryCounted !== true
      )
        return true;
      if (
        Object.hasOwn(value, "discoveryIncomplete") &&
        value.discoveryIncomplete !== false
      )
        return true;
    }
    if (worker !== "auto-publish-hours") return false;
    if (value.approvalStatus !== "approved" || value.discoveryCounted !== true)
      return true;
    if (recoveryBlocked(value.recovery)) return true;
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
