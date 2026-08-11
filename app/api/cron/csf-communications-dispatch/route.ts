import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { readPositiveInteger } from "@/lib/async/map-with-concurrency";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import {
  runCsfDispatchWorker,
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
const MAX_BATCH_SIZE = 50;
const MAX_ORGANIZATIONS_PER_RUN = 10;
const MAX_CAMPAIGNS_PER_ORGANIZATION_RUN = 50;
const MAX_OPEN_CAMPAIGNS_PER_RUN =
  MAX_ORGANIZATIONS_PER_RUN * MAX_CAMPAIGNS_PER_ORGANIZATION_RUN;
/** Wall-clock bound, checked between organizations so a run always terminates. */
const RUN_DEADLINE_MS = 45_000;
const LEASE_SECONDS = 120;

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

function pluginClient(): CsfPluginRpc & {
  from: ReturnType<typeof createClient>["from"];
} {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error("supabase_admin_credentials_unavailable");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "plugin_data" },
  }) as unknown as CsfPluginRpc & {
    from: ReturnType<typeof createClient>["from"];
  };
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
  if (process.env.CSF_COMMUNICATIONS_WORKER_ENABLED !== "true") {
    return json({
      enabled: false,
      organizationsQueued: 0,
      organizationsProcessed: 0,
      claimed: 0,
      outcomes: emptyTally(),
      faults: 0,
      deadlineReached: false,
    });
  }

  const startedAt = Date.now();
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
    plugin = pluginClient();
  } catch {
    return json({ error: "Worker transport unavailable" }, 503);
  }

  // DURABLE DISCOVERY, DERIVED SERVER-SIDE AND NEVER SUPPLIED BY THE CALLER.
  //
  // A queued-attempt scan loses the tenant as soon as its last attempt settles,
  // and it never sees an organization whose only work is an expired processing
  // lease. Both are exactly the states this route must recover: the claim RPC
  // reaps expired leases, while the campaign finalizer is safely repeatable after
  // a lost response or a process death between settlement and aggregation.
  //
  // The campaign remains queued/sending until the locked database aggregate says
  // otherwise, so it is the durable retry coordinate. service_role holds SELECT
  // only on this table; all mutations remain behind the two purpose-built RPCs.
  const { data: openRows, error: scopeError } = await plugin
    .from("csf_communication_campaigns")
    .select("id, organization_id")
    .in("status", ["queued", "sending"])
    .order("updated_at", { ascending: true })
    .limit(MAX_OPEN_CAMPAIGNS_PER_RUN);

  if (scopeError) {
    // Bounded: the database's own message can name rows and addresses.
    return json({ error: "Campaign scope unavailable" }, 503);
  }

  const openCampaignIdsByOrganization = new Map<string, string[]>();
  for (const row of openRows ?? []) {
    const candidate = row as {
      id?: unknown;
      organization_id?: unknown;
    };
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.organization_id !== "string"
    ) {
      continue;
    }

    const campaignIds =
      openCampaignIdsByOrganization.get(candidate.organization_id) ?? [];
    if (
      campaignIds.length < MAX_CAMPAIGNS_PER_ORGANIZATION_RUN &&
      !campaignIds.includes(candidate.id)
    ) {
      campaignIds.push(candidate.id);
      openCampaignIdsByOrganization.set(candidate.organization_id, campaignIds);
    }
  }

  const organizationIds = [...openCampaignIdsByOrganization.keys()].slice(
    0,
    MAX_ORGANIZATIONS_PER_RUN,
  );

  const workerId = `csf-dispatch-${startedAt.toString(36)}`;
  const tally = emptyTally();
  let claimed = 0;
  let organizationsProcessed = 0;
  let faults = 0;
  let deadlineReached = false;

  for (const organizationId of organizationIds) {
    if (Date.now() - startedAt >= RUN_DEADLINE_MS) {
      // The remaining organizations keep their durable queued/sending campaign
      // coordinates and are picked up by the next tick. Nothing is lost, because
      // nothing was claimed for them.
      deadlineReached = true;
      break;
    }

    try {
      const report = await runCsfDispatchWorker(plugin, {
        organizationId,
        workerId,
        batchSize,
        leaseSeconds: LEASE_SECONDS,
      });

      claimed += report.claimed;
      organizationsProcessed += 1;
      for (const attempt of report.attempts) {
        tally[attempt.status] += 1;
      }
    } catch {
      // A bounded worker fault for one organization must not abandon the rest,
      // and must not leak the ledger's diagnostics. Attempts this worker had
      // leased stay leased and are reaped as unknown_outcome -- honest, and
      // never re-sent. The finalization pass below still runs: an earlier claim
      // in this batch may already have settled before a later one failed.
      faults += 1;
    }

    // V122: settling the last attempt is not itself the campaign aggregate. The
    // ledger owns that decision because it must inspect every attempt and delivery
    // under the campaign lock. Check every durable open campaign discovered for
    // this organization even when the worker claimed nothing or faulted halfway.
    // A live/retry/unknown result is a truthful no-op; a wholly settled campaign
    // leaves Sending now. A failed or lost finalizer response is retried on the
    // next invocation because the campaign itself remains durably open.
    for (const campaignId of openCampaignIdsByOrganization.get(
      organizationId,
    ) ?? []) {
      if (Date.now() - startedAt >= RUN_DEADLINE_MS) {
        deadlineReached = true;
        break;
      }

      try {
        const terminalization = await plugin.rpc(
          "csf_finalize_communication_campaign",
          {
            p_organization_id: organizationId,
            p_campaign_id: campaignId,
          },
        );

        if (terminalization.error) {
          // The sends and settlements above already happened and remain counted.
          // Record a bounded operational fault without leaking the database's
          // message or pretending the provider work failed.
          faults += 1;
        }
      } catch {
        // A rejected transport promise is the same bounded operational fault as
        // an RPC error result. The open campaign remains the retry coordinate.
        faults += 1;
      }
    }
  }

  // AGGREGATES ONLY. No attempt identity, no campaign identity, no recipient
  // address, no subject, no provider message id, and no provider error text.
  return json({
    enabled: true,
    organizationsQueued: organizationIds.length,
    organizationsProcessed,
    claimed,
    outcomes: tally,
    faults,
    deadlineReached,
    batchSize,
    durationMs: Date.now() - startedAt,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
