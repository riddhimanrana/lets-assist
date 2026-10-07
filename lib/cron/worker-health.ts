import {
  verifyWorkerMonitoringPolicy as verifyMonitoringEvidence,
  requireWorkerActivationMonitoring as requireActivationEvidence,
} from "./worker-monitoring-policy.mjs";
import { z } from "zod";
import {
  observedWorkers,
  validateWorkerOutcome,
  type ObservedWorker,
  type WorkerEnvironment,
} from "./worker-outcome";

const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(1_000_000);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
export const workerMonitoringPolicySchema = z
  .object({
    worker: z.enum(observedWorkers),
    environment: z.enum(["development", "production"]),
    sourceSha: sha,
    scheduler: z.enum(["vercel", "github-actions"]),
    scheduleEnabled: z.boolean(),
    expectedEverySeconds: z.number().int().min(30).max(604_800),
    staleAfterSeconds: z.number().int().min(60).max(1_209_600),
    maxRunSeconds: z.number().int().min(1).max(600),
    verifiedAt: timestamp,
    validUntil: timestamp,
    changeRecord: z
      .string()
      .regex(
        /^https:\/\/github\.com\/riddhimanrana\/lets-assist\/(?:issues|pull)\/[1-9][0-9]*$/u,
      ),
    reviewedBy: z.string().regex(/^[a-zA-Z0-9_-]{1,39}$/u),
    alerting: z
      .object({
        owner: z.string().regex(/^[a-zA-Z0-9_-]{1,39}$/u),
        destination: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
        missedRunTestedAt: timestamp,
        validUntil: timestamp,
      })
      .strict(),
  })
  .strict();
export type WorkerMonitoringPolicy = z.infer<
  typeof workerMonitoringPolicySchema
>;
export type WorkerScope = {
  worker: ObservedWorker;
  environment: WorkerEnvironment;
  sourceSha: string;
};

export function verifyWorkerMonitoringPolicy(
  input: unknown,
  scope: WorkerScope,
  now = Date.now(),
) {
  const policy = workerMonitoringPolicySchema.parse(input);
  verifyMonitoringEvidence(policy, scope, now);
  return policy;
}

export function requireWorkerActivationMonitoring(
  input: unknown,
  scope: WorkerScope,
  now = Date.now(),
) {
  const policy = verifyWorkerMonitoringPolicy(input, scope, now);
  requireActivationEvidence(policy, scope, now);
  return policy;
}

const receiptSchema = z
  .object({
    run_id: z.uuid(),
    worker_key: z.enum(observedWorkers),
    environment: z.enum(["local", "development", "production"]),
    source_sha: sha.nullable(),
    started_at: timestamp,
    finished_at: timestamp.nullable(),
    outcome: z.enum(["started", "no_run", "processed", "partial", "failed"]),
    code: z.enum([
      "started",
      "empty_queue",
      "completed",
      "partial_work",
      "worker_failed",
      "invalid_response",
      "unhandled_error",
    ]),
    duration_ms: z.number().int().min(0).max(600_000),
    attempted: count,
    completed: count,
    failed: count,
    pending: count,
    refused: count,
    faults: count,
    deadline_reached: z.boolean(),
  })
  .strict();

export function evaluateWorkerHealth(
  input: unknown,
  policyInput: unknown,
  scope: WorkerScope,
  now = Date.now(),
) {
  const problem = (outcome: "no_run" | "failed" | "stale", code: string) => ({
    ...scope,
    outcome,
    code,
    actionRequired: true,
    monitoringReady: false,
    latest: null,
  });
  let policy: WorkerMonitoringPolicy;
  try {
    policy = verifyWorkerMonitoringPolicy(policyInput, scope, now);
  } catch {
    return problem("no_run", "cadence_or_alerting_unverified");
  }
  if (!policy.scheduleEnabled)
    return { ...problem("no_run", "verified_paused"), actionRequired: false };
  const parsed = z.array(receiptSchema).max(20).safeParse(input);
  if (!parsed.success) return problem("failed", "invalid_receipt_evidence");
  const receipts = parsed.data;
  if (
    receipts.some(
      (receipt) =>
        receipt.worker_key !== scope.worker ||
        receipt.environment !== scope.environment,
    )
  )
    return problem("failed", "receipt_scope_mismatch");
  receipts.sort(
    (left, right) => Date.parse(right.started_at) - Date.parse(left.started_at),
  );
  const latest = receipts[0];
  if (!latest) return problem("no_run", "no_execution_receipt");
  try {
    if (latest.outcome === "started") {
      if (latest.finished_at !== null || latest.code !== "started")
        throw new Error("Invalid start receipt");
    } else {
      if (!latest.finished_at) throw new Error("Missing finish receipt");
      validateWorkerOutcome({
        outcome: latest.outcome,
        code: latest.code as Exclude<typeof latest.code, "started">,
        attempted: latest.attempted,
        completed: latest.completed,
        failed: latest.failed,
        pending: latest.pending,
        refused: latest.refused,
        faults: latest.faults,
        deadlineReached: latest.deadline_reached,
      });
    }
  } catch {
    return problem("failed", "invalid_receipt_evidence");
  }
  if (latest.source_sha !== scope.sourceSha)
    return problem("failed", "deployment_mismatch");
  const age = now - Date.parse(latest.started_at);
  if (
    age < 0 ||
    (latest.finished_at &&
      Date.parse(latest.finished_at) < Date.parse(latest.started_at)) ||
    (latest.finished_at && Date.parse(latest.finished_at) > now)
  )
    return problem("failed", "invalid_receipt_clock");
  if (age > policy.staleAfterSeconds * 1000)
    return {
      ...problem("stale", "missed_schedule"),
      monitoringReady: true,
      latest,
    };
  if (latest.outcome === "started")
    return {
      ...scope,
      outcome: age > policy.maxRunSeconds * 1000 ? "stale" : "running",
      code:
        age > policy.maxRunSeconds * 1000 ? "unfinished_run" : "in_progress",
      actionRequired: age > policy.maxRunSeconds * 1000,
      monitoringReady: true,
      latest,
    };
  if (!latest.finished_at) return problem("failed", "missing_finish_receipt");
  return {
    ...scope,
    outcome: latest.outcome,
    code: latest.code,
    actionRequired: latest.outcome === "partial" || latest.outcome === "failed",
    monitoringReady: true,
    latest,
  };
}
