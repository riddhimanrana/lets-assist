import "server-only";
import { randomUUID } from "node:crypto";
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

const TIMEOUT_MS = 1_500;
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

// Call only after authentication, auth-probe return, and the worker enable check.
export async function observeWorkerRun<T extends Response>(
  worker: ObservedWorker,
  operation: () => Promise<T>,
  classify: (status: number, body: unknown) => WorkerObservation = (
    status,
    body,
  ) => classifyWorkerResponse(worker, status, body),
  dependencies?: WorkerObservationDependencies,
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
  async function finish(outcome: WorkerOutcome) {
    if (!recorded) return;
    try {
      await deps.write("finish_worker_run_receipt", {
        ...identity,
        p_result: {
          ...validateWorkerOutcome(outcome),
          durationMs: Math.min(
            600_000,
            Math.max(0, Math.round(deps.now() - started)),
          ),
        },
      });
    } catch {
      unavailable("finish");
    }
  }
  let response: T;
  try {
    response = await operation();
  } catch (error) {
    await finish(failedWorkerOutcome("unhandled_error"));
    throw error;
  }
  let outcome: WorkerOutcome;
  try {
    outcome = validateWorkerOutcome(
      classify(response.status, await boundedResponseJson(response)),
    );
  } catch {
    outcome = failedWorkerOutcome("invalid_response");
  }
  await finish(outcome);
  return response;
}
