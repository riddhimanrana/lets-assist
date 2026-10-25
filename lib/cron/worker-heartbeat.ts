import "server-only";
import { safeConsole } from "@/lib/safe-console";
import {
  validateWorkerOutcome,
  type ObservedWorker,
  type WorkerEnvironment,
  type WorkerOutcome,
} from "./worker-outcome";

const MAX_TIMEOUT_MS = 1_500;
// Only these workers own an application heartbeat, each with its own
// dedicated destination. There is no shared or fallback destination.
const HEARTBEAT_ENV: Partial<Record<ObservedWorker, string>> = {
  "auto-publish-hours": "BETTERSTACK_AUTO_PUBLISH_HEARTBEAT_URL",
  "organization-calendar-sync": "BETTERSTACK_CALENDAR_SYNC_HEARTBEAT_URL",
  "organization-sheet-sync": "BETTERSTACK_SHEET_SYNC_HEARTBEAT_URL",
};
// The whole value must match. Userinfo, another port, a query, a fragment and
// an encoded path all fail, so the request can only reach a heartbeat path.
const HEARTBEAT_URL =
  /^https:\/\/(incidents\.betterstack\.com|uptime\.betterstack\.com|betteruptime\.com)(?::443)?\/api\/v1\/heartbeat\/([A-Za-z0-9-]{16,128})\/?$/u;

export type WorkerHeartbeatOwner = "vercel_cron" | "manual";
export const workerHeartbeatStatuses = [
  "not_sent",
  "work_completed",
  "scheduler_completed_empty",
  "failed_signaled",
  "delivery_failed",
  "configuration_invalid",
] as const;
export type WorkerHeartbeatStatus = (typeof workerHeartbeatStatuses)[number];
export type WorkerHeartbeatInput = {
  worker: ObservedWorker;
  environment: WorkerEnvironment;
  owner?: WorkerHeartbeatOwner;
  outcome: WorkerOutcome;
  responseOk: boolean;
  committed: boolean;
  blocked?: boolean;
};
export type WorkerHeartbeatDependencies = {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  unavailable: (code: "delivery_failed" | "configuration_invalid") => void;
  timeoutMs?: number;
};

// Ownership routing, not authentication. The route has already verified the
// caller. A scheduled Vercel run owns the ping here, and every other caller
// (such as the workflow fallback) keeps its own.
export function workerHeartbeatOwner(request: {
  method: string;
  headers: { get(name: string): string | null };
}): WorkerHeartbeatOwner {
  return request.method === "GET" &&
    request.headers.get("user-agent") === "vercel-cron/1.0"
    ? "vercel_cron"
    : "manual";
}

function productionDependencies(
  worker: ObservedWorker,
): WorkerHeartbeatDependencies {
  return {
    env: process.env,
    fetch: globalThis.fetch,
    unavailable(code) {
      safeConsole.warn("Worker heartbeat unavailable", {
        outcome: "failed",
        worker,
        heartbeat_status: code,
      });
    },
  };
}

type HeartbeatSignal = {
  status: "work_completed" | "scheduler_completed_empty" | "failed_signaled";
  fail: boolean;
};

// A healthy or empty pass reaches the success endpoint only when the response
// was also healthy and nothing held the worker back. Failed and partial work
// only ever reaches the failure endpoint.
function heartbeatSignal(input: WorkerHeartbeatInput): HeartbeatSignal | null {
  let outcome: WorkerOutcome;
  try {
    outcome = validateWorkerOutcome(input.outcome);
  } catch {
    return null;
  }
  if (outcome.outcome === "failed" || outcome.outcome === "partial")
    return { status: "failed_signaled", fail: true };
  if (input.responseOk !== true || Boolean(input.blocked)) return null;
  const unfinished =
    outcome.failed ||
    outcome.pending ||
    outcome.refused ||
    outcome.faults ||
    outcome.deadlineReached;
  if (unfinished) return null;
  if (
    outcome.outcome === "processed" &&
    outcome.code === "completed" &&
    outcome.completed > 0 &&
    outcome.attempted === outcome.completed
  )
    return { status: "work_completed", fail: false };
  // The scheduler ran and found nothing to do. This is not provider evidence.
  if (
    outcome.outcome === "no_run" &&
    outcome.code === "empty_queue" &&
    outcome.attempted === 0 &&
    outcome.completed === 0
  )
    return { status: "scheduler_completed_empty", fail: false };
  return null;
}

function heartbeatDestination(value: unknown, fail: boolean): string | null {
  if (typeof value !== "string") return null;
  const match = HEARTBEAT_URL.exec(value);
  if (!match) return null;
  return `https://${match[1]}/api/v1/heartbeat/${match[2]}${fail ? "/fail" : ""}`;
}

function releaseBody(response: Response) {
  try {
    const cancelled = response.body?.cancel();
    if (cancelled) void Promise.resolve(cancelled).catch(() => {});
  } catch {
    /* The body is never read, so a failed release changes nothing. */
  }
}

// One attempt, no retries. Only a 2xx status confirms delivery.
async function deliver(
  url: string,
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // One deadline. It aborts the request's own signal before it reports the
    // failure, and it also bounds a fetch that ignores that signal.
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, timeoutMs);
    });
    const delivered = Promise.resolve()
      .then(() =>
        fetcher(url, {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        }),
      )
      .then((response) => {
        // Also runs for a response that arrives after the deadline.
        releaseBody(response);
        return (
          response.redirected !== true &&
          response.status >= 200 &&
          response.status < 300
        );
      })
      .catch(() => false);
    return await Promise.race([delivered, expired]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function reportWorkerHeartbeat(
  input: WorkerHeartbeatInput,
  dependencies?: WorkerHeartbeatDependencies,
): Promise<WorkerHeartbeatStatus> {
  // Every gate passes before a destination is looked up.
  if (
    input.environment !== "production" ||
    input.owner !== "vercel_cron" ||
    input.committed !== true ||
    typeof input.worker !== "string" ||
    !Object.hasOwn(HEARTBEAT_ENV, input.worker)
  )
    return "not_sent";
  const signal = heartbeatSignal(input);
  if (!signal) return "not_sent";

  const deps = dependencies ?? productionDependencies(input.worker);
  function unavailable(code: "delivery_failed" | "configuration_invalid") {
    try {
      deps.unavailable(code);
    } catch {
      /* Reporting failure cannot change a heartbeat result. */
    }
  }
  let url: string | null = null;
  try {
    url = heartbeatDestination(
      deps.env[HEARTBEAT_ENV[input.worker]!],
      signal.fail,
    );
  } catch {
    url = null;
  }
  if (!url) {
    unavailable("configuration_invalid");
    return "configuration_invalid";
  }
  const timeoutMs =
    typeof deps.timeoutMs === "number" &&
    Number.isFinite(deps.timeoutMs) &&
    deps.timeoutMs > 0
      ? Math.min(deps.timeoutMs, MAX_TIMEOUT_MS)
      : MAX_TIMEOUT_MS;
  if (!(await deliver(url, deps.fetch, timeoutMs))) {
    unavailable("delivery_failed");
    return "delivery_failed";
  }
  return signal.status;
}
