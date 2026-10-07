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
    case "auto-publish-hours": {
      result.attempted = count(value.processedSessions);
      result.completed = count(value.successfulSessions);
      result.failed = count(result.attempted - result.completed);
      result.pending = optionalCount(value, "pendingSessions");
      const sessions = array(value.results);
      if (sessions.length !== result.attempted)
        throw new Error("invalid_response");
      result.faults = sum(
        ...sessions.map((entry) => array(record(entry).errors).length),
      );
      return true;
    }
    case "generate-recurring-projects":
      result.attempted = count(value.processedProjects);
      result.faults = count(value.failedProjects);
      result.completed = result.attempted;
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
