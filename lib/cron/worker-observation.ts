import "server-only";
import { randomUUID } from "node:crypto";
import { workerReceiptMaxDurationMs } from "./worker-keys.mjs";
import { getAdminClient } from "@/lib/supabase/admin";
import { safeConsole } from "@/lib/safe-console";
import {
  classifyWorkerResponse,
  failedWorkerOutcome,
  observedWorkers,
  validateWorkerOutcome,
  type ObservedWorker,
  type WorkerEnvironment,
  type WorkerObservation,
  type WorkerOutcome,
} from "./worker-outcome";
import {
  reportWorkerHeartbeat,
  workerHeartbeatStatuses,
  type WorkerHeartbeatInput,
  type WorkerHeartbeatOwner,
  type WorkerHeartbeatStatus,
} from "./worker-heartbeat";

const TIMEOUT_MS = 1_500;
const RECEIPT_HEADER = "x-lets-assist-worker-receipt";
const HEARTBEAT_HEADER = "x-lets-assist-worker-heartbeat";
type ReceiptWrite = (
  operation: "start_worker_run_receipt" | "finish_worker_run_receipt",
  parameters: Record<string, unknown>,
) => Promise<void>;
export type WorkerObservationDependencies = {
  write: ReceiptWrite;
  now: () => number;
  id: () => string;
  environment: WorkerEnvironment;
  sourceSha: string | null;
  unavailable: (phase: "start" | "finish") => void;
  reportHeartbeat?: (
    input: WorkerHeartbeatInput,
  ) => Promise<WorkerHeartbeatStatus>;
};
export type WorkerOutcomeSupplier = {
  outcome: () => WorkerObservation;
  captured?: () => boolean;
  heartbeatBlocked?: () => boolean;
};
export type WorkerObservationOptions = {
  heartbeatOwner?: WorkerHeartbeatOwner;
};

export function serverWorkerIdentity(env: Record<string, string | undefined>) {
  const environment: WorkerEnvironment =
    env.VERCEL_ENV === "production"
      ? "production"
      : env.VERCEL_ENV === "preview"
        ? "development"
        : "local";
  const candidate = env.LETS_ASSIST_BUILD_SHA ?? env.VERCEL_GIT_COMMIT_SHA;
  return {
    environment,
    sourceSha:
      candidate && /^[a-f0-9]{40}$/u.test(candidate) ? candidate : null,
  };
}

function productionDependencies(
  worker: ObservedWorker,
): WorkerObservationDependencies {
  return {
    ...serverWorkerIdentity(process.env),
    now: Date.now,
    id: randomUUID,
    async write(operation, parameters) {
      const { error } = await getAdminClient()
        .rpc(operation, parameters)
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
      if (error) throw new Error("worker_receipt_unavailable");
    },
    unavailable(phase) {
      safeConsole.warn("Worker monitoring receipt unavailable", {
        outcome: "failed",
        worker,
        receipt_phase: phase,
      });
    },
  };
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  const reader = response.clone().body?.getReader();
  if (!reader) throw new Error("Empty worker response");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 32_768) throw new Error("Oversized worker response");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Worker response read timed out")),
          TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

// An error response keeps captured counters only when they already report
// failed or partial work. A healthy or empty summary cannot stand in for it.
function suppliedOutcome(
  supplier: WorkerOutcomeSupplier,
  ok: boolean,
): WorkerObservation {
  if (ok) return supplier.outcome();
  if (!supplier.captured?.()) return failedWorkerOutcome("worker_failed");
  const captured = supplier.outcome();
  return captured.outcome === "failed" || captured.outcome === "partial"
    ? captured
    : failedWorkerOutcome("worker_failed");
}

// Fixed values only. A response with immutable headers is returned as it is.
function annotate(
  response: Response,
  committed: boolean,
  heartbeat: WorkerHeartbeatStatus,
) {
  try {
    response.headers.set(
      RECEIPT_HEADER,
      committed ? "committed" : "unavailable",
    );
    response.headers.set(HEARTBEAT_HEADER, heartbeat);
  } catch {
    /* Monitoring headers cannot change a worker response. */
  }
}

// Call only after authentication, auth-probe return, and the worker enable check.
// The dependencies are the fourth argument and the options are the fifth.
export async function observeWorkerRun<T extends Response>(
  worker: ObservedWorker,
  operation: () => Promise<T>,
  classify:
    | ((status: number, body: unknown) => WorkerObservation)
    | WorkerOutcomeSupplier = (status, body) =>
    classifyWorkerResponse(worker, status, body),
  dependencies?: WorkerObservationDependencies,
  options?: WorkerObservationOptions,
): Promise<T> {
  if (!observedWorkers.includes(worker))
    throw new Error("Unknown observed worker.");
  const deps = dependencies ?? productionDependencies(worker);
  const runId = deps.id();
  const started = deps.now();
  const identity = {
    p_run_id: runId,
    p_worker_key: worker,
    p_environment: deps.environment,
  };
  function unavailable(phase: "start" | "finish") {
    try {
      deps.unavailable(phase);
    } catch {
      /* Reporting failure cannot change a worker result. */
    }
  }
  let recorded = false;
  try {
    await deps.write("start_worker_run_receipt", {
      ...identity,
      p_source_sha: deps.sourceSha,
    });
    recorded = true;
  } catch {
    unavailable("start");
  }
  // True only when the finish write was acknowledged. That write raises unless
  // it updates exactly one started receipt, so no error means it committed.
  async function finish(outcome: WorkerOutcome): Promise<boolean> {
    if (!recorded) return false;
    try {
      await deps.write("finish_worker_run_receipt", {
        ...identity,
        p_result: {
          ...validateWorkerOutcome(outcome),
          durationMs: Math.min(
            workerReceiptMaxDurationMs,
            Math.max(0, Math.round(deps.now() - started)),
          ),
        },
      });
      return true;
    } catch {
      unavailable("finish");
      return false;
    }
  }
  // The reporter runs only after the finish write was acknowledged. A missing
  // start or an unacknowledged finish never reaches it.
  async function heartbeat(
    outcome: WorkerOutcome,
    responseOk: boolean,
    committed: boolean,
    blocked: boolean,
  ): Promise<WorkerHeartbeatStatus> {
    if (committed !== true) return "not_sent";
    try {
      const status = await (deps.reportHeartbeat ?? reportWorkerHeartbeat)({
        worker,
        environment: deps.environment,
        owner: options?.heartbeatOwner,
        outcome,
        responseOk,
        committed: true,
        blocked,
      });
      return workerHeartbeatStatuses.includes(status)
        ? status
        : "delivery_failed";
    } catch {
      try {
        safeConsole.warn("Worker heartbeat unavailable", {
          outcome: "failed",
          worker,
          heartbeat_status: "delivery_failed",
        });
      } catch {
        /* Reporting failure cannot change a worker result. */
      }
      return "delivery_failed";
    }
  }
  let response: T;
  try {
    response = await operation();
  } catch (error) {
    const failure = failedWorkerOutcome("unhandled_error");
    await heartbeat(failure, false, await finish(failure), false);
    throw error;
  }
  let outcome: WorkerOutcome;
  try {
    outcome = validateWorkerOutcome(
      typeof classify === "function"
        ? classify(response.status, await boundedResponseJson(response))
        : suppliedOutcome(classify, response.ok),
    );
  } catch {
    outcome = failedWorkerOutcome("invalid_response");
  }
  const committed = await finish(outcome);
  let blocked = false;
  if (typeof classify !== "function") {
    try {
      blocked = classify.heartbeatBlocked?.() ?? false;
    } catch {
      blocked = true;
    }
  }
  annotate(
    response,
    committed,
    await heartbeat(outcome, response.ok, committed, blocked),
  );
  return response;
}
