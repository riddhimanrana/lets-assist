import { createHash } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Shared Postgres-backed metering for AI features, over the service-role-only
 * public.consume_api_rate_limit RPC (20260712011038). Identifiers are always
 * sha256-hashed before becoming bucket keys, so raw user ids, IPs, and
 * project ids never appear in api_rate_limits.
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

export type AiQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
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

  const row = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    !Number.isSafeInteger(row.remaining) ||
    row.remaining < 0 ||
    typeof row.reset_at !== "string" ||
    !Number.isFinite(Date.parse(row.reset_at))
  ) {
    throw new Error("Rate-limit check returned an invalid response");
  }

  return row;
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
