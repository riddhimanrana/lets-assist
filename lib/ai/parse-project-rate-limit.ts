import { createHash } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  PARSE_PROJECT_IP_LIMIT,
  PARSE_PROJECT_RATE_LIMIT_WINDOW_SECONDS,
  PARSE_PROJECT_USER_LIMIT,
} from "@/lib/ai/parse-project-rate-limit-config";

type RateLimitRow = {
  allowed: boolean;
  remaining: number;
  reset_at: string;
};

export type ParseProjectQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

function hashRateLimitIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function consumeRateLimitBucket(
  key: string,
  limit: number,
): Promise<RateLimitRow> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: PARSE_PROJECT_RATE_LIMIT_WINDOW_SECONDS,
  });

  if (error) {
    throw new Error(`Rate-limit check failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null;
  if (!row || typeof row.allowed !== "boolean") {
    throw new Error("Rate-limit check returned an invalid response");
  }

  return row;
}

export async function consumeParseProjectQuota(
  userId: string,
  requestIp: string,
): Promise<ParseProjectQuotaResult> {
  const userBucket = await consumeRateLimitBucket(
    `ai:parse-project:user:${hashRateLimitIdentifier(userId)}`,
    PARSE_PROJECT_USER_LIMIT,
  );

  if (!userBucket.allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: userBucket.reset_at,
    };
  }

  const ipBucket = await consumeRateLimitBucket(
    `ai:parse-project:ip:${hashRateLimitIdentifier(requestIp)}`,
    PARSE_PROJECT_IP_LIMIT,
  );

  return {
    allowed: ipBucket.allowed,
    remaining: Math.min(userBucket.remaining, ipBucket.remaining),
    resetAt:
      new Date(userBucket.reset_at).getTime() >
      new Date(ipBucket.reset_at).getTime()
        ? userBucket.reset_at
        : ipBucket.reset_at,
  };
}
