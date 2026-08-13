import { randomUUID } from "node:crypto";

import {
  consumeAiQuotaAtomically,
  hashRateLimitIdentifier,
} from "@/lib/ai/rate-limit";

export const ANALYZE_WAIVER_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
export const ANALYZE_WAIVER_USER_LIMIT = 10;
export const ANALYZE_WAIVER_IP_LIMIT = 30;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type AnalyzeWaiverQuotaIdentity = {
  requestKey: string;
  requestFingerprint: string;
  expectedContentDigest: string | null;
};

function hashScopedRequestIdentity(...parts: string[]) {
  return hashRateLimitIdentifier(parts.join("\0"));
}

export function buildAnalyzeWaiverQuotaIdentity(
  userId: string,
  headers: Headers,
): AnalyzeWaiverQuotaIdentity {
  const suppliedRequestKey = headers.get("idempotency-key")?.trim() ?? "";
  const suppliedContentDigest =
    headers.get("x-waiver-content-sha256")?.trim().toLowerCase() ?? "";
  const hasStableIdentity =
    IDEMPOTENCY_KEY_PATTERN.test(suppliedRequestKey) &&
    SHA256_PATTERN.test(suppliedContentDigest);
  const nonce = hasStableIdentity ? suppliedRequestKey : randomUUID();
  const expectedContentDigest = SHA256_PATTERN.test(suppliedContentDigest)
    ? suppliedContentDigest
    : null;

  return {
    requestKey: hashScopedRequestIdentity(
      "analyze-waiver",
      userId,
      "request",
      nonce,
    ),
    requestFingerprint: hashScopedRequestIdentity(
      "analyze-waiver",
      userId,
      "content",
      expectedContentDigest ?? nonce,
    ),
    expectedContentDigest,
  };
}

export function consumeAnalyzeWaiverQuota(options: {
  userId: string;
  requestIp: string | null;
  requestKey: string;
  requestFingerprint: string;
}) {
  const { userId, requestIp, requestKey, requestFingerprint } = options;
  return consumeAiQuotaAtomically({
    feature: "analyze-waiver",
    windowSeconds: ANALYZE_WAIVER_RATE_LIMIT_WINDOW_SECONDS,
    buckets: [
      {
        scope: "user",
        identifier: userId,
        limit: ANALYZE_WAIVER_USER_LIMIT,
      },
      ...(requestIp
        ? [
            {
              scope: "ip",
              identifier: requestIp,
              limit: ANALYZE_WAIVER_IP_LIMIT,
            },
          ]
        : []),
    ],
    requestKey,
    requestFingerprint,
  });
}
