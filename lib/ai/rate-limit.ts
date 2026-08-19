import { createHash } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Shared Postgres-backed metering for AI features. Existing callers use the
 * service-role-only public.consume_api_rate_limit RPC (20260712011038);
 * expensive replay-sensitive work can use public.consume_ai_quota
 * (20260813010000) to charge every dimension and write one durable receipt in
 * the same transaction. Identifiers are always sha256-hashed before becoming
 * bucket keys, so raw user ids, IPs, and project ids never appear in storage.
 *
 * Buckets are consumed in order and short-circuit on the first denial, which
 * preserves the original parse-project semantics: a user hitting their own
 * cap does not burn shared IP quota.
 */

type RateLimitRow = {
  allowed: boolean;
  remaining: number;
  reset_at: string;
};

type AtomicRateLimitRow = RateLimitRow & {
  replayed: boolean;
};

export type AiQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

export type AtomicAiQuotaResult = AiQuotaResult & {
  replayed: boolean;
  recovered: boolean;
};

export type AiQuotaBucket = {
  /** Key segment, e.g. "user" | "ip" | "project". */
  scope: string;
  /** Raw identifier; hashed before use. */
  identifier: string;
  limit: number;
};

export function hashRateLimitIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildAiQuotaKey(
  feature: string,
  scope: string,
  identifier: string,
): string {
  return `ai:${feature}:${scope}:${hashRateLimitIdentifier(identifier)}`;
}

function parseRateLimitRow(
  data: unknown,
  options: { requireReplayFlag: true },
): AtomicRateLimitRow;
function parseRateLimitRow(
  data: unknown,
  options?: { requireReplayFlag?: false },
): RateLimitRow;
function parseRateLimitRow(
  data: unknown,
  options: { requireReplayFlag?: boolean } = {},
): RateLimitRow | AtomicRateLimitRow {
  const row = (
    Array.isArray(data) ? data[0] : data
  ) as Partial<AtomicRateLimitRow> | null;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    !Number.isSafeInteger(row.remaining) ||
    (row.remaining ?? -1) < 0 ||
    typeof row.reset_at !== "string" ||
    !Number.isFinite(Date.parse(row.reset_at)) ||
    (options.requireReplayFlag && typeof row.replayed !== "boolean")
  ) {
    throw new Error("Rate-limit check returned an invalid response");
  }

  return row as RateLimitRow | AtomicRateLimitRow;
}

async function consumeRateLimitBucket(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitRow> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw new Error(`Rate-limit check failed: ${error.message}`);
  }

  return parseRateLimitRow(data);
}

export async function consumeAiQuota(options: {
  feature: string;
  windowSeconds: number;
  buckets: AiQuotaBucket[];
}): Promise<AiQuotaResult> {
  const { feature, windowSeconds, buckets } = options;
  if (buckets.length === 0) {
    throw new Error("consumeAiQuota requires at least one bucket");
  }

  let remaining = Number.POSITIVE_INFINITY;
  let resetAt = new Date(0).toISOString();

  for (const bucket of buckets) {
    const row = await consumeRateLimitBucket(
      buildAiQuotaKey(feature, bucket.scope, bucket.identifier),
      bucket.limit,
      windowSeconds,
    );

    if (!row.allowed) {
      return { allowed: false, remaining: 0, resetAt: row.reset_at };
    }

    remaining = Math.min(remaining, row.remaining);
    if (new Date(row.reset_at).getTime() > new Date(resetAt).getTime()) {
      resetAt = row.reset_at;
    }
  }

  return { allowed: true, remaining, resetAt };
}

export async function consumeAiQuotaAtomically(options: {
  feature: string;
  windowSeconds: number;
  buckets: AiQuotaBucket[];
  requestKey: string;
  requestFingerprint: string;
}): Promise<AtomicAiQuotaResult> {
  const { feature, windowSeconds, buckets, requestKey, requestFingerprint } =
    options;
  if (buckets.length === 0) {
    throw new Error("consumeAiQuotaAtomically requires at least one bucket");
  }
  if (
    !/^[a-f0-9]{64}$/.test(requestKey) ||
    !/^[a-f0-9]{64}$/.test(requestFingerprint)
  ) {
    throw new Error("Atomic AI quota requires hashed request identity");
  }

  const args = {
    p_request_key: requestKey,
    p_request_fingerprint: requestFingerprint,
    p_buckets: buckets.map((bucket) => ({
      key: buildAiQuotaKey(feature, bucket.scope, bucket.identifier),
      limit: bucket.limit,
    })),
    p_window_seconds: windowSeconds,
  };
  const admin = getAdminClient();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await admin.rpc("consume_ai_quota", args);
      if (error) {
        if (attempt === 0) continue;
        throw new Error("Atomic rate-limit check failed");
      }

      const row = parseRateLimitRow(data, { requireReplayFlag: true });
      return {
        allowed: row.allowed,
        remaining: row.remaining,
        resetAt: row.reset_at,
        replayed: row.replayed,
        recovered: attempt > 0 && row.replayed,
      };
    } catch (error) {
      if (attempt === 0) continue;
      if (
        error instanceof Error &&
        error.message === "Rate-limit check returned an invalid response"
      ) {
        throw error;
      }
      throw new Error("Atomic rate-limit check failed");
    }
  }

  throw new Error("Atomic rate-limit check failed");
}
