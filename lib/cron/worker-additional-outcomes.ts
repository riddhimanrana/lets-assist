import type { ObservedWorker, WorkerOutcome } from "./worker-outcome";
import {
  workerArray as array,
  workerCount as count,
  workerRecord as record,
  workerSum as sum,
} from "./worker-aggregate";

function optionalCount(value: Record<string, unknown>, key: string) {
  return Object.hasOwn(value, key) ? count(value[key]) : 0;
}

function readWorkbookCounts(
  value: Record<string, unknown>,
  result: WorkerOutcome,
) {
  result.attempted = count(value.claimed);
  if (result.attempted > 1) throw new Error("invalid_response");
  result.refused = count(value.blocked);
  count(value.prepared);
  if (value.claimed === 1) {
    if (
      !["completed", "needs_reconnect", "blocked", "failed"].includes(
        String(value.status),
      )
    )
      throw new Error("invalid_response");
    result.completed = value.status === "completed" ? 1 : 0;
    if (value.status === "failed") result.failed = 1;
    else if (value.status !== "completed")
      result.refused = Math.max(result.refused, 1);
  }
  for (const key of ["applications", "workbookChecks"]) {
    if (!Object.hasOwn(value, key)) continue;
    const task = record(value[key]);
    const claimed = count(task.claimed);
    if (claimed > 1) throw new Error("invalid_response");
    result.attempted = sum(result.attempted, claimed);
    if (["prepared", "unchanged"].includes(String(task.status)))
      result.completed = sum(result.completed, claimed);
    else if (task.status === "queued")
      result.pending = sum(result.pending, count(task.queued));
    else if (["blocked", "needs_reconnect"].includes(String(task.status)))
      result.refused = sum(result.refused, Math.max(1, claimed));
    else if (["retryable", "unknown"].includes(String(task.status)))
      result.faults = sum(result.faults, 1);
    else if (task.status !== "idle") throw new Error("invalid_response");
  }
  if (Object.hasOwn(value, "automaticClassImports")) {
    const task = record(value.automaticClassImports);
    result.attempted = sum(result.attempted, task.checked);
    result.pending = sum(result.pending, task.queued);
    result.refused = sum(result.refused, task.needsAttention, task.blocked);
    result.faults = sum(result.faults, task.unknown);
  }
  if (Object.hasOwn(value, "sheetSync")) {
    const task = record(value.sheetSync);
    if (!["idle", "complete", "blocked"].includes(String(task.status)))
      throw new Error("invalid_response");
    result.attempted = sum(result.attempted, task.status === "idle" ? 0 : 1);
    result.completed = sum(
      result.completed,
      task.status === "complete" ? 1 : 0,
    );
    result.refused = sum(result.refused, task.status === "blocked" ? 1 : 0);
  }
}

const HELD_SESSION_KEYS = [
  "historical",
  "oversized",
  "invalidAttendance",
  "missingCreator",
  "invalidSchedule",
] as const;
const MAX_RECOVERY_DELIVERIES = 25;

// A successful session means its award transaction committed. It says nothing
// about email: delivery is counted only from recovery, and only acceptance the
// ledger recorded counts as completed. A pass is an authoritative empty queue
// only when publication was approved, discovery counted, nothing is held or
// pending, and the counted email ledger has nothing pending or held.
function readAutoPublishCounts(
  value: Record<string, unknown>,
  result: WorkerOutcome,
) {
  const approved = value.approvalStatus === "approved";
  if (
    (!approved && value.approvalStatus !== "approval_required") ||
    typeof value.discoveryCounted !== "boolean"
  )
    throw new Error("invalid_response");

  const processed = count(value.processedSessions);
  const successful = count(value.successfulSessions);
  const sessions = array(value.results);
  if (sessions.length !== processed) throw new Error("invalid_response");
  let succeeded = 0;
  let sessionFaults = 0;
  for (const entry of sessions) {
    const session = record(entry);
    if (typeof session.success !== "boolean")
      throw new Error("invalid_response");
    if (session.success) succeeded++;
    sessionFaults += array(session.errors).length;
  }
  if (succeeded !== successful) throw new Error("invalid_response");

  const recovery = record(value.recovery);
  const deliveries = count(recovery.deliveries);
  const accepted = count(recovery.accepted);
  const partial = count(recovery.partial);
  const unconfirmed = count(recovery.settlementUnconfirmed);
  if (
    typeof recovery.counted !== "boolean" ||
    deliveries > MAX_RECOVERY_DELIVERIES ||
    accepted + partial !== deliveries ||
    unconfirmed > partial
  )
    throw new Error("invalid_response");

  // A selected batch is at most 25 deliveries. The ledger inventory says what
  // remains behind it and what is held, so a full accepted batch cannot pass
  // for a drained queue.
  let pendingDeliveries = 0;
  let heldDeliveries = 0;
  let uncounted = 0;
  if (recovery.counted) {
    pendingDeliveries = count(recovery.pending);
    heldDeliveries = count(recovery.held);
  } else {
    if (
      deliveries !== 0 ||
      (recovery.pending ?? null) !== null ||
      (recovery.held ?? null) !== null
    )
      throw new Error("invalid_response");
    uncounted = 1;
  }

  let pendingSessions = 0;
  let refused = 0;
  if (approved && value.discoveryCounted) {
    const held = record(value.heldSessions);
    refused = sum(...HELD_SESSION_KEYS.map((key) => held[key]));
    pendingSessions = count(value.pendingSessions);
  } else {
    // Without approval, or when the claim was contended, nothing was
    // discovered. Any session, held, or pending count would be invented.
    if (
      (!approved && value.discoveryCounted) ||
      processed !== 0 ||
      (value.heldSessions ?? null) !== null ||
      (value.pendingSessions ?? null) !== null
    )
      throw new Error("invalid_response");
    refused = 1;
  }

  result.attempted = sum(processed, deliveries);
  result.completed = sum(successful, accepted);
  result.failed = processed - successful;
  result.pending = sum(pendingSessions, partial, pendingDeliveries);
  result.refused = sum(refused, heldDeliveries, uncounted);
  result.faults = sum(sessionFaults, unconfirmed);
}

// Inspect fixed numeric/boolean fields only. Identifiers and diagnostics never
// enter a receipt, even when the authenticated route returns detailed results.
export function readAdditionalWorkerCounts(
  worker: ObservedWorker,
  value: Record<string, unknown>,
  result: WorkerOutcome,
): boolean {
  switch (worker) {
    case "anonymous-cleanup":
    case "waiver-cleanup":
      result.completed = sum(value.deleted, value.storageDeleted);
      result.attempted = result.completed;
      return true;
    case "paper-scan-cleanup":
      result.completed = sum(value.purgedBatches, value.storageDeleted);
      result.attempted = result.completed;
      return true;
    case "public-image-cleanup":
      result.attempted = count(value.claimed);
      result.completed = sum(value.deleted, value.retained);
      result.pending = count(value.retryable);
      result.failed = count(value.failed);
      if (
        sum(result.completed, result.pending, result.failed) !==
        result.attempted
      )
        throw new Error("invalid_response");
      return true;
    case "csf-proof-cleanup": {
      if (value.ok !== true) throw new Error("invalid_response");
      const sweep = record(value.swept);
      result.completed = sum(
        value.deleted,
        value.enqueued,
        sweep.abandonedUploads,
        sweep.expiredClaims,
        sweep.readyDeadlinesPassed,
        sweep.settledRetirements,
      );
      result.failed = count(value.failed);
      result.attempted = sum(result.completed, result.pending, result.failed);
      return true;
    }
    case "ai-moderation": {
      if (value.success !== true) throw new Error("invalid_response");
      count(value.moderated);
      const scanned = Object.hasOwn(value, "scanned")
        ? record(value.scanned)
        : { projects: 0, reports: 0 };
      result.attempted = sum(scanned.projects, scanned.reports);
      if (count(value.moderated) > result.attempted)
        throw new Error("invalid_response");
      result.faults = Object.hasOwn(value, "warnings")
        ? array(value.warnings).length
        : 0;
      result.completed = result.faults
        ? count(value.moderated)
        : result.attempted;
      return true;
    }
    case "auto-publish-hours":
      readAutoPublishCounts(value, result);
      return true;
    case "generate-recurring-projects":
      result.attempted = count(value.checkedProjects);
      result.faults = count(value.failedProjects);
      result.completed = count(value.successfulProjects);
      result.failed = count(value.failedParents);
      if (
        sum(result.completed, result.failed) !== result.attempted ||
        count(value.processedProjects) > result.attempted
      )
        throw new Error("invalid_response");
      count(value.createdOccurrences);
      return true;
    case "organization-calendar-sync":
    case "organization-sheet-sync": {
      const rows = array(value.results);
      result.attempted = count(value.processed);
      if (rows.length !== result.attempted) throw new Error("invalid_response");
      for (const row of rows) {
        const success = record(row).success;
        if (typeof success !== "boolean") throw new Error("invalid_response");
        if (success) result.completed++;
        else result.failed++;
      }
      // Organizations that were due but not started are unfinished work,
      // even when nothing else ran. The field is absent only in responses
      // that predate it.
      result.pending = optionalCount(value, "deferredOrganizations");
      // Discovery that did not count, or stopped early, knows of no due
      // organizations. It is refused rather than given an invented count.
      for (const [flag, blocking] of [
        ["discoveryCounted", false],
        ["discoveryIncomplete", true],
      ] as const) {
        if (!Object.hasOwn(value, flag)) continue;
        if (typeof value[flag] !== "boolean")
          throw new Error("invalid_response");
        if (value[flag] === blocking) result.refused = 1;
      }
      return true;
    }
    case "paper-signup-notifications":
    case "project-feedback-followups": {
      const outcomes = record(value.outcomes);
      result.attempted = count(value.claimed);
      result.completed = sum(
        worker === "paper-signup-notifications"
          ? outcomes.accepted
          : outcomes.sent,
        outcomes.skipped,
      );
      result.failed = sum(outcomes.failed, outcomes.unknown);
      result.pending = count(outcomes.retryable);
      result.faults = count(value.reaped);
      if (worker === "project-feedback-followups") {
        if (typeof value.deadlineReached !== "boolean")
          throw new Error("invalid_response");
        result.deadlineReached = value.deadlineReached;
        count(value.projectsScanned);
        result.attempted = sum(result.attempted, value.enqueued);
        result.completed = sum(result.completed, value.enqueued);
      }
      return true;
    }
    case "csf-publication-notifications":
      result.attempted = count(value.claimed);
      result.completed = sum(value.delivered, value.skipped);
      result.pending = count(value.retryable);
      optionalCount(value, "emailQueued");
      optionalCount(value, "emailHeld");
      optionalCount(value, "emailSkipped");
      result.faults = optionalCount(value, "emailUnavailable");
      return true;
    case "csf-import-commit":
      result.attempted = sum(value.claimed, optionalCount(value, "reconciled"));
      result.completed = count(value.completed);
      result.refused = count(value.blocked);
      return true;
    case "csf-class-workbook-refresh":
      readWorkbookCounts(value, result);
      return true;
    default:
      return false;
  }
}
