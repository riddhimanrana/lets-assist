import "server-only";
import { isCsfWorkerEnabled } from "@/lib/cron/csf-worker-controls";

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { readPositiveInteger } from "@/lib/async/map-with-concurrency";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { logWarn } from "@/lib/logger";
import {
  createCsfProviderStartLimiter,
  runCsfDispatchWorker,
  CSF_COMMUNICATION_WORKER_MAX_CONCURRENCY,
  type CsfPluginRpc,
  type CsfWorkerAttemptReport,
} from "@/services/csf-communications-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The bounded, server-only invocation path for the CSF dispatch worker.
 *
 * Before this route `runCsfDispatchWorker` had no caller outside its own tests:
 * the durable ledger could queue work and nothing would ever pick it up. This is
 * the seam, and it is deliberately the narrowest one that can exist.
 *
 * WHAT THIS ROUTE ACCEPTS FROM ITS CALLER: a bearer token. That is the entire
 * input surface.
 *
 * It accepts no message payload, no recipient address, no subject, no body, no
 * sender, and no campaign content of any kind. The organizations it will work on
 * are DERIVED SERVER-SIDE from the ledger's own queue, never named by the
 * request, so a caller holding the token still cannot point the worker at an
 * organization that has no queued work -- or at one it invented. Everything that
 * is actually mailed comes from rows the ledger already hashed.
 *
 * RE-ENTRY AND CONCURRENCY are the ledger's contract, not this route's. Two
 * overlapping invocations both call csf_claim_communication_dispatch_batch(),
 * which leases attempts under a partial unique index; the loser claims nothing
 * rather than double-sending. This route therefore needs no lock of its own, and
 * deliberately does not invent one.
 */

/** Bounded work per invocation. A cron tick is not a place to drain a queue. */
const MAX_BATCH_SIZE = 125;
const MAX_ORGANIZATIONS_PER_RUN = 10;
const MAX_MAINTENANCE_CAMPAIGNS_PER_PASS = 50;
/** Normal work ceiling. An already-started worker gets only the bounded drain below. */
const RUN_DEADLINE_MS = 45_000;
/**
 * Supabase transport must stop before the platform's 60 second route ceiling.
 * The work deadline stays shorter so an already-started authorization or
 * settlement RPC gets one finite drain window after provider cancellation.
 */
const MAX_TRANSPORT_DEADLINE_MS = 50_000;
const MAX_POST_WORK_DRAIN_MS = 5_000;
const LEASE_SECONDS = 120;
/**
 * The smallest provider budget worth starting a pass with.
 *
 * The abort signal is armed here but the send does not happen here: the worker
 * still has to claim a batch and authorize the attempt, which is two database
 * round trips. Starting a pass with a budget smaller than those round trips
 * take means arming a signal that is guaranteed to fire before the send, and
 * `sendEmail` reports that as a pre-send cancellation -- correct, but it still
 * consumed a claim and a lease for no reason. Requiring a real window keeps the
 * attempt queued for the next tick instead.
 *
 * It is a ceiling on the floor, not a fixed floor: a deliberately small
 * configured deadline must still do work rather than turn the route into a
 * no-op, so the requirement never exceeds a quarter of the configured budget.
 */
const MAX_MIN_PROVIDER_WINDOW_MS = 2_000;

function minimumProviderWindowMs(runDeadlineMs: number): number {
  return Math.min(
    MAX_MIN_PROVIDER_WINDOW_MS,
    Math.max(1, Math.floor(runDeadlineMs / 4)),
  );
}

class RunDeadlineExceeded extends Error {
  constructor() {
    super("csf_communications_run_deadline_exceeded");
    this.name = "RunDeadlineExceeded";
  }
}

function configuredRunDeadlineMs(): number {
  return readPositiveInteger(
    process.env.CSF_COMMUNICATIONS_WORKER_DEADLINE_MS,
    RUN_DEADLINE_MS,
    RUN_DEADLINE_MS,
  );
}

function postWorkDrainMs(runDeadlineMs: number): number {
  return Math.min(
    MAX_POST_WORK_DRAIN_MS,
    Math.max(1, Math.floor(runDeadlineMs / 4)),
  );
}

/**
 * Keep Supabase's own per-request signal while adding the route-wide hard stop.
 * `global.fetch` is used by every request from this client, including PostgREST
 * RPCs, so authorization and settlement cannot survive the transport ceiling.
 */
function createAbortableTransportFetch(
  hardTransportSignal: AbortSignal,
): typeof fetch {
  const nativeFetch = globalThis.fetch;

  return ((input, init) => {
    const requestSignal = input instanceof Request ? input.signal : undefined;
    const signals = [
      hardTransportSignal,
      requestSignal,
      init?.signal ?? undefined,
    ].filter((signal): signal is AbortSignal => signal !== undefined);

    return nativeFetch(input, {
      ...init,
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    });
  }) as typeof fetch;
}

/**
 * Bound one already-started operation to the selected wall-clock deadline.
 *
 * A provider request also receives an AbortSignal before this outer race. If a
 * database transport ignores the race, its continuation cannot create a second
 * send; the one-attempt lease and provider idempotency coordinate remain fixed.
 */
async function beforeDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
): Promise<T> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new RunDeadlineExceeded();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new RunDeadlineExceeded()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * `Authorization: Bearer <secret>`, and nothing else.
 *
 * The previous reader was `authHeader.replace("Bearer ", "")`, which is not a
 * grammar at all -- `replace` with a string pattern removes the FIRST occurrence
 * if present and otherwise returns the input untouched. So a header consisting of
 * the bare secret with no scheme authenticated, and so did `"xBearer <secret>"`,
 * `"Bearer Bearer <secret>"` (one prefix consumed, the other left as part of the
 * token only if it happened to match), and any variant whose stray prefix
 * survived into a value that still compared equal.
 *
 * One anchored pattern instead. `[\x21-\x7E]+` is one run of printable ASCII with
 * no space, so the token cannot carry padding, an embedded space, a newline, a
 * tab, a NUL, or any control byte; `^`/`$` without the `m` flag anchor to the
 * whole string in JavaScript, so a trailing newline is rejected rather than
 * tolerated. `Bearer` is matched case-sensitively and followed by exactly one
 * ASCII space.
 */
const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;

function extractBearerSecret(header: string | null): string | null {
  if (typeof header !== "string") return null;
  const match = BEARER_GRAMMAR.exec(header);
  return match ? match[1] : null;
}

/**
 * Compare two secrets without leaking WHERE they diverge.
 *
 * Length is compared first and in the clear: `timingSafeEqual` throws on unequal
 * lengths, and the length of a configured secret is not the part worth hiding.
 * What matters is that two same-length candidates take the same time, so an
 * attacker cannot recover the secret byte by byte.
 */
function secretsMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(request: NextRequest): boolean {
  const presented = extractBearerSecret(request.headers.get("authorization"));
  if (presented === null) return false;

  // Read at request time, not at module load. A secret rotated or injected after
  // the module was first evaluated must take effect, and a module-level capture
  // silently keeps serving the stale value.
  const allowedTokens = [
    process.env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN,
    process.env.CRON_TOKEN ?? process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value));

  // NO SECRET CONFIGURED MEANS NO ACCESS. Falling open here would make a
  // forgotten environment variable a public send endpoint.
  if (allowedTokens.length === 0) return false;

  // reduce, not some: `some` short-circuits, so the number of comparisons would
  // depend on which secret matched.
  return allowedTokens.reduce(
    (matched, candidate) => secretsMatch(candidate, presented) || matched,
    false,
  );
}

function pluginClient(hardTransportSignal: AbortSignal): CsfPluginRpc {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error("supabase_admin_credentials_unavailable");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "plugin_data" },
    global: { fetch: createAbortableTransportFetch(hardTransportSignal) },
  }) as unknown as CsfPluginRpc;
}

type OutcomeTally = Record<CsfWorkerAttemptReport["status"], number>;

function emptyTally(): OutcomeTally {
  return {
    sent: 0,
    refused: 0,
    failed: 0,
    retryable: 0,
    unknown: 0,
    authorization_lost: 0,
  };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control":
        "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}

function boundedCount(value: unknown, maximum: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : 0;
}

function organizationScope(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const ids = (value as { organizationIds?: unknown }).organizationIds;
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(ids.filter((id): id is string => typeof id === "string")),
  ].slice(0, MAX_ORGANIZATIONS_PER_RUN);
}

async function maintainCampaigns(plugin: CsfPluginRpc, deadlineAt: number) {
  try {
    const result = await beforeDeadline(
      plugin.rpc("csf_maintain_communication_campaigns", {
        p_max_campaigns: MAX_MAINTENANCE_CAMPAIGNS_PER_PASS,
      }),
      deadlineAt,
    );
    if (result.error || !result.data || typeof result.data !== "object") {
      return { checked: 0, terminalized: 0, faults: 1 };
    }

    const report = result.data as Record<string, unknown>;
    return {
      checked: boundedCount(report.checked, MAX_MAINTENANCE_CAMPAIGNS_PER_PASS),
      terminalized: boundedCount(
        report.terminalized,
        MAX_MAINTENANCE_CAMPAIGNS_PER_PASS,
      ),
      faults: boundedCount(report.faults, MAX_MAINTENANCE_CAMPAIGNS_PER_PASS),
    };
  } catch (error) {
    if (error instanceof RunDeadlineExceeded) throw error;
    return { checked: 0, terminalized: 0, faults: 1 };
  }
}

type OperationalAlertSnapshot = {
  communicationBacklogOlderThanFiveMinutes: number;
  unresolvedImportBatches: number;
  blockedImportCommits: number;
};

async function readOperationalAlerts(
  plugin: CsfPluginRpc,
  deadlineAt: number,
): Promise<OperationalAlertSnapshot | null> {
  if (process.env.CSF_OPERATIONAL_ALERTS_ENABLED !== "true") return null;
  try {
    const result = await beforeDeadline(
      plugin.rpc("csf_get_worker_alert_snapshot", {}),
      deadlineAt,
    );
    if (result.error || !result.data || typeof result.data !== "object") {
      return null;
    }
    const snapshot = result.data as Record<string, unknown>;
    return {
      communicationBacklogOlderThanFiveMinutes: boundedCount(
        snapshot.communicationBacklogOlderThanFiveMinutes,
        Number.MAX_SAFE_INTEGER,
      ),
      unresolvedImportBatches: boundedCount(
        snapshot.unresolvedImportBatches,
        Number.MAX_SAFE_INTEGER,
      ),
      blockedImportCommits: boundedCount(
        snapshot.blockedImportCommits,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    // NOTHING HAS HAPPENED YET. No client is built, no organization is read, and
    // no provider call is made on this path.
    return json({ error: "Unauthorized" }, 401);
  }

  const probe = cronAuthShapeProbe("csf-communications-dispatch", request);
  if (probe) return probe;

  // Exact opt-in. A missing flag is disabled just like an empty, malformed, or
  // explicitly false flag. This matters because merely checking for `false`
  // turns an omitted deployment variable into permission to send real email.
  if (!(await isCsfWorkerEnabled("communications"))) {
    return json({
      enabled: false,
      organizationsQueued: 0,
      organizationsProcessed: 0,
      claimed: 0,
      outcomes: emptyTally(),
      campaignsChecked: 0,
      campaignsTerminalized: 0,
      faults: 0,
      deadlineReached: false,
    });
  }

  const startedAt = Date.now();
  const runDeadlineMs = configuredRunDeadlineMs();
  const deadlineAt = startedAt + runDeadlineMs;
  const settlementReserveMs = postWorkDrainMs(runDeadlineMs);
  const transportDeadlineMs = Math.min(
    MAX_TRANSPORT_DEADLINE_MS,
    runDeadlineMs + settlementReserveMs,
  );
  const transportDeadlineAt = startedAt + transportDeadlineMs;
  const hardTransportSignal = AbortSignal.timeout(transportDeadlineMs);
  const minProviderWindowMs = minimumProviderWindowMs(runDeadlineMs);
  const batchSize = Math.min(
    readPositiveInteger(
      process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE,
      25,
      MAX_BATCH_SIZE,
    ),
    MAX_BATCH_SIZE,
  );

  let plugin: ReturnType<typeof pluginClient>;
  try {
    plugin = pluginClient(hardTransportSignal);
  } catch {
    return json({ error: "Worker transport unavailable" }, 503);
  }

  const workerId = `csf-dispatch-${startedAt.toString(36)}`;
  const waitForProviderStart = createCsfProviderStartLimiter();
  const tally = emptyTally();
  let claimed = 0;
  let organizationsProcessed = 0;
  let faults = 0;
  let deadlineReached = false;
  let campaignsChecked = 0;
  let campaignsTerminalized = 0;

  // Recover an earlier lost finalizer response before claiming more work. The
  // database owns both the terminalization predicate and the fair cursor; this
  // route receives aggregate counts only.
  try {
    const maintenanceBefore = await maintainCampaigns(plugin, deadlineAt);
    campaignsChecked += maintenanceBefore.checked;
    campaignsTerminalized += maintenanceBefore.terminalized;
    faults += maintenanceBefore.faults;
  } catch (error) {
    if (error instanceof RunDeadlineExceeded) deadlineReached = true;
    else faults += 1;
  }

  const queuedOrganizationIds = new Set<string>();
  const processedOrganizationIds = new Set<string>();
  /**
   * Tenants this invocation already found empty.
   *
   * The allocator's eligibility snapshot can name a tenant whose queue drained,
   * or whose only "work" was an expired lease that the claim itself reaped. That
   * is not a reason to end the invocation -- the acknowledgement already rotated
   * the durable cursor, so the next scope call returns a DIFFERENT tenant
   * whenever another eligible one exists. Ending the run instead meant one
   * drained chapter withheld service from every other chapter until the next
   * tick.
   *
   * The set is what keeps that from becoming a spin: the allocator returns the
   * same tenant only when it is the sole eligible one, and seeing it a second
   * time ends the loop exactly as before.
   */
  const exhaustedOrganizationIds = new Set<string>();
  let workerPasses = 0;

  // Reserve ONE tenant coordinate immediately before processing it. Marking ten
  // tenants selected at once made the nine that did not fit before the deadline
  // look equally recent and could starve them forever behind the first UUID. A
  // reservation does not advance fairness: the exact coordinate is acknowledged
  // only after this route proves that provider and settlement time remains. The
  // acknowledgement is its own short transaction, before any campaign lock, so a
  // claim-time fault rotates on the next tick without creating a lock inversion.
  while (
    !deadlineReached &&
    claimed < batchSize &&
    workerPasses < batchSize &&
    processedOrganizationIds.size < MAX_ORGANIZATIONS_PER_RUN
  ) {
    if (deadlineAt - Date.now() <= settlementReserveMs) {
      // Do not advance a durable tenant cursor when there is already too little
      // time to authorize a provider request and settle its outcome.
      deadlineReached = true;
      break;
    }

    let scopeResult: Awaited<ReturnType<CsfPluginRpc["rpc"]>>;
    try {
      scopeResult = await beforeDeadline(
        plugin.rpc("csf_claim_communication_scheduler_scope", {
          p_max_organizations: 1,
        }),
        deadlineAt,
      );
    } catch (error) {
      if (error instanceof RunDeadlineExceeded) {
        deadlineReached = true;
        break;
      }
      return json({ error: "Campaign scope unavailable" }, 503);
    }

    if (scopeResult.error) {
      // Bounded: the database's own message can name rows and addresses.
      return json({ error: "Campaign scope unavailable" }, 503);
    }

    const [organizationId] = organizationScope(scopeResult.data);
    if (!organizationId) break;
    if (exhaustedOrganizationIds.has(organizationId)) {
      // The allocator came back to a tenant this invocation already found empty,
      // which means it is the only eligible one left. There is nothing more to do
      // this tick.
      break;
    }
    const reservationId =
      scopeResult.data && typeof scopeResult.data === "object"
        ? (scopeResult.data as { reservationId?: unknown }).reservationId
        : null;
    if (typeof reservationId !== "string" || reservationId.length === 0) {
      return json({ error: "Campaign scope unavailable" }, 503);
    }
    queuedOrganizationIds.add(organizationId);

    if (deadlineAt - Date.now() <= settlementReserveMs + minProviderWindowMs) {
      // Acknowledgement advances durable tenant fairness. Do not move a tenant
      // to the back of the scheduler when the route can already prove there is
      // no usable provider window for the worker pass it would acknowledge.
      deadlineReached = true;
      break;
    }

    let acknowledgement: Awaited<ReturnType<CsfPluginRpc["rpc"]>>;
    try {
      acknowledgement = await beforeDeadline(
        plugin.rpc("csf_acknowledge_communication_scheduler_scope", {
          p_organization_id: organizationId,
          p_reservation_id: reservationId,
        }),
        deadlineAt - settlementReserveMs - minProviderWindowMs,
      );
    } catch (error) {
      if (error instanceof RunDeadlineExceeded) deadlineReached = true;
      else faults += 1;
      break;
    }

    const acknowledged =
      !acknowledgement.error &&
      acknowledgement.data &&
      typeof acknowledgement.data === "object" &&
      (acknowledgement.data as { acknowledged?: unknown }).acknowledged ===
        true;
    if (!acknowledged) {
      faults += 1;
      break;
    }

    workerPasses += 1;
    const providerTimeMs = deadlineAt - Date.now() - settlementReserveMs;
    if (providerTimeMs < minProviderWindowMs) {
      deadlineReached = true;
      break;
    }
    const providerAbortController = new AbortController();
    const providerAbortTimer = setTimeout(
      () => providerAbortController.abort(),
      providerTimeMs,
    );
    const workerPromise = runCsfDispatchWorker(plugin, {
      organizationId,
      workerId,
      batchSize: 1,
      leaseSeconds: LEASE_SECONDS,
      providerSignal: providerAbortController.signal,
      concurrency: CSF_COMMUNICATION_WORKER_MAX_CONCURRENCY,
      waitForProviderStart,
    });

    try {
      // One claim per pass is what lets the absolute deadline be honest. A
      // malformed RPC that returns more than requested is rejected by the worker
      // before any send; no large leased batch can keep running behind this race.
      const report = await beforeDeadline(workerPromise, deadlineAt);

      claimed += report.claimed;
      processedOrganizationIds.add(organizationId);
      organizationsProcessed = processedOrganizationIds.size;
      for (const attempt of report.attempts) {
        tally[attempt.status] += 1;
      }
      if (report.claimed === 0) {
        // The allocator's eligibility snapshot may have named an expired lease
        // that this claim just reaped or work another concurrent worker won.
        // Remember the tenant so this invocation cannot spin on it, then move on
        // to the next one rather than abandoning every other chapter's queue.
        exhaustedOrganizationIds.add(organizationId);
        continue;
      }
    } catch (error) {
      if (error instanceof RunDeadlineExceeded) {
        providerAbortController.abort();
        try {
          const drainedReport = await beforeDeadline(
            workerPromise,
            transportDeadlineAt,
          );
          claimed += drainedReport.claimed;
          processedOrganizationIds.add(organizationId);
          organizationsProcessed = processedOrganizationIds.size;
          for (const attempt of drainedReport.attempts) {
            tally[attempt.status] += 1;
          }
        } catch {
          faults += 1;
          processedOrganizationIds.add(organizationId);
          organizationsProcessed = processedOrganizationIds.size;
        }
        deadlineReached = true;
        break;
      }
      // A bounded worker fault intentionally ends this invocation, and must not
      // leak the ledger's diagnostics. Attempts this worker had leased stay
      // leased and are reaped as unknown_outcome -- honest, and never re-sent.
      // The maintenance pass below still runs: an earlier claim in this batch
      // may already have settled before a later one failed.
      faults += 1;
      processedOrganizationIds.add(organizationId);
      organizationsProcessed = processedOrganizationIds.size;
      break;
    } finally {
      clearTimeout(providerAbortTimer);
    }
  }

  // V122: attempt settlement is not campaign aggregation. Run maintenance again
  // after the bounded worker pass so campaigns settled in this invocation leave
  // Sending immediately. If the deadline was consumed, the next tick begins with
  // this same durable maintenance step; no campaign identity has to survive in
  // application memory.
  if (!deadlineReached) {
    try {
      const maintenanceAfter = await maintainCampaigns(plugin, deadlineAt);
      campaignsChecked += maintenanceAfter.checked;
      campaignsTerminalized += maintenanceAfter.terminalized;
      faults += maintenanceAfter.faults;
    } catch (error) {
      if (error instanceof RunDeadlineExceeded) deadlineReached = true;
      else faults += 1;
    }
  }

  const operationalAlerts = await readOperationalAlerts(plugin, deadlineAt);
  if (
    operationalAlerts &&
    Object.values(operationalAlerts).some((count) => count > 0)
  ) {
    logWarn("CSF worker alert threshold reached", {
      alert_code: "csf_worker_backlog",
      ...operationalAlerts,
    });
  }

  // AGGREGATES ONLY. No attempt identity, no campaign identity, no recipient
  // address, no subject, no provider message id, and no provider error text.
  return json({
    enabled: true,
    organizationsQueued: queuedOrganizationIds.size,
    organizationsProcessed,
    claimed,
    outcomes: tally,
    campaignsChecked,
    campaignsTerminalized,
    faults,
    deadlineReached,
    batchSize,
    durationMs: Date.now() - startedAt,
    operationalAlerts,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
