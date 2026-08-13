import { beforeEach, describe, expect, mock, test } from "bun:test";

type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcResponse =
  | { data: unknown; error: unknown }
  | { throws: Error }
  | Record<string, unknown>;

const rpcCalls: RpcCall[] = [];
let rpcResponses: RpcResponse[] = [];

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const next = rpcResponses.shift();
      if (!next) throw new Error("unexpected rpc call");
      if ("throws" in next) throw next.throws;
      if ("data" in next && "error" in next) return next;
      return { data: [next], error: null };
    },
  }),
}));

const { buildAiQuotaKey, consumeAiQuota, hashRateLimitIdentifier } =
  await import("./rate-limit");
const { consumeParseProjectQuota } = await import("./parse-project-rate-limit");
const {
  ANALYZE_WAIVER_IP_LIMIT,
  ANALYZE_WAIVER_RATE_LIMIT_WINDOW_SECONDS,
  ANALYZE_WAIVER_USER_LIMIT,
  buildAnalyzeWaiverQuotaIdentity,
  consumeAnalyzeWaiverQuota,
} = await import("./analyze-waiver-rate-limit");

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResponses = [];
});

describe("buildAiQuotaKey", () => {
  test("hashes the identifier and stays under the RPC's 200-char key cap", () => {
    const key = buildAiQuotaKey("paper-signup-scan", "project", "some-uuid");
    expect(key).toBe(
      `ai:paper-signup-scan:project:${hashRateLimitIdentifier("some-uuid")}`,
    );
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key).not.toContain("some-uuid");
  });
});

describe("consumeAiQuota", () => {
  test("a denied first bucket short-circuits without consuming later buckets", async () => {
    rpcResponses = [
      { allowed: false, remaining: 0, reset_at: "2026-08-11T01:00:00Z" },
    ];

    const result = await consumeAiQuota({
      feature: "paper-signup-scan",
      windowSeconds: 3600,
      buckets: [
        { scope: "user", identifier: "u1", limit: 6 },
        { scope: "ip", identifier: "1.2.3.4", limit: 20 },
      ],
    });

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: "2026-08-11T01:00:00Z",
    });
    expect(rpcCalls).toHaveLength(1);
  });

  test("an allowed run reports the tightest remaining and the latest reset", async () => {
    rpcResponses = [
      { allowed: true, remaining: 5, reset_at: "2026-08-11T01:00:00Z" },
      { allowed: true, remaining: 12, reset_at: "2026-08-11T02:00:00Z" },
      { allowed: true, remaining: 2, reset_at: "2026-08-11T00:30:00Z" },
    ];

    const result = await consumeAiQuota({
      feature: "paper-signup-scan",
      windowSeconds: 3600,
      buckets: [
        { scope: "user", identifier: "u1", limit: 6 },
        { scope: "ip", identifier: "1.2.3.4", limit: 20 },
        { scope: "project", identifier: "p1", limit: 10 },
      ],
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 2,
      resetAt: "2026-08-11T02:00:00Z",
    });
    expect(rpcCalls.map((call) => call.args.p_window_seconds)).toEqual([
      3600, 3600, 3600,
    ]);
  });

  test("requires at least one bucket", async () => {
    await expect(
      consumeAiQuota({ feature: "x", windowSeconds: 60, buckets: [] }),
    ).rejects.toThrow("at least one bucket");
  });

  test("fails closed on malformed database receipts", async () => {
    for (const response of [
      { allowed: false, remaining: 0, reset_at: "not-a-timestamp" },
      { allowed: true, remaining: -1, reset_at: "2026-08-11T01:00:00Z" },
      { allowed: "true", remaining: 1, reset_at: "2026-08-11T01:00:00Z" },
    ]) {
      rpcResponses = [response];
      await expect(
        consumeAiQuota({
          feature: "receipt-validation",
          windowSeconds: 60,
          buckets: [{ scope: "user", identifier: "u1", limit: 1 }],
        }),
      ).rejects.toThrow("invalid response");
    }
  });
});

describe("consumeParseProjectQuota compatibility", () => {
  test("keeps the original key format and result shape", async () => {
    rpcResponses = [
      { allowed: true, remaining: 19, reset_at: "2026-08-11T01:00:00Z" },
      { allowed: true, remaining: 59, reset_at: "2026-08-11T01:05:00Z" },
    ];

    const result = await consumeParseProjectQuota("user-1", "203.0.113.7");

    expect(rpcCalls[0].args.p_key).toBe(
      `ai:parse-project:user:${hashRateLimitIdentifier("user-1")}`,
    );
    expect(rpcCalls[1].args.p_key).toBe(
      `ai:parse-project:ip:${hashRateLimitIdentifier("203.0.113.7")}`,
    );
    expect(rpcCalls[0].args.p_limit).toBe(20);
    expect(rpcCalls[1].args.p_limit).toBe(60);
    expect(result).toEqual({
      allowed: true,
      remaining: 19,
      resetAt: "2026-08-11T01:05:00Z",
    });
  });
});

describe("consumeAnalyzeWaiverQuota", () => {
  test("binds exact replays to user, idempotency key, and content digest", () => {
    const headers = new Headers({
      "idempotency-key": "request-1",
      "x-waiver-content-sha256": "a".repeat(64),
    });

    const first = buildAnalyzeWaiverQuotaIdentity("user-1", headers);
    const replay = buildAnalyzeWaiverQuotaIdentity("user-1", headers);
    const differentUser = buildAnalyzeWaiverQuotaIdentity("user-2", headers);
    const differentContent = buildAnalyzeWaiverQuotaIdentity(
      "user-1",
      new Headers({
        "idempotency-key": "request-1",
        "x-waiver-content-sha256": "b".repeat(64),
      }),
    );

    expect(replay).toEqual(first);
    expect(differentUser.requestKey).not.toBe(first.requestKey);
    expect(differentContent.requestKey).toBe(first.requestKey);
    expect(differentContent.requestFingerprint).not.toBe(
      first.requestFingerprint,
    );
    expect(first.expectedContentDigest).toBe("a".repeat(64));
  });

  test("meters user and IP in one atomic idempotent RPC", async () => {
    rpcResponses = [
      {
        allowed: true,
        remaining: 9,
        reset_at: "2026-08-11T01:00:00Z",
        replayed: false,
      },
    ];

    const result = await consumeAnalyzeWaiverQuota({
      userId: "waiver-user-1",
      requestIp: "203.0.113.9",
      requestKey: "b".repeat(64),
      requestFingerprint: "c".repeat(64),
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      fn: "consume_ai_quota",
      args: {
        p_request_key: "b".repeat(64),
        p_request_fingerprint: "c".repeat(64),
        p_buckets: [
          {
            key: `ai:analyze-waiver:user:${hashRateLimitIdentifier("waiver-user-1")}`,
            limit: ANALYZE_WAIVER_USER_LIMIT,
          },
          {
            key: `ai:analyze-waiver:ip:${hashRateLimitIdentifier("203.0.113.9")}`,
            limit: ANALYZE_WAIVER_IP_LIMIT,
          },
        ],
        p_window_seconds: ANALYZE_WAIVER_RATE_LIMIT_WINDOW_SECONDS,
      },
    });
    expect(result).toEqual({
      allowed: true,
      remaining: 9,
      resetAt: "2026-08-11T01:00:00Z",
      replayed: false,
      recovered: false,
    });
  });

  test("omits the IP dimension instead of sharing an unknown bucket", async () => {
    rpcResponses = [
      {
        allowed: true,
        remaining: 9,
        reset_at: "2026-08-11T01:00:00Z",
        replayed: false,
      },
    ];

    await consumeAnalyzeWaiverQuota({
      userId: "waiver-user-1",
      requestIp: null,
      requestKey: "d".repeat(64),
      requestFingerprint: "e".repeat(64),
    });

    expect(rpcCalls[0].args.p_buckets).toEqual([
      {
        key: `ai:analyze-waiver:user:${hashRateLimitIdentifier("waiver-user-1")}`,
        limit: ANALYZE_WAIVER_USER_LIMIT,
      },
    ]);
  });

  test("retries an unknown RPC outcome with the exact same request identity", async () => {
    rpcResponses = [
      { data: null, error: { message: "response lost" } },
      {
        allowed: true,
        remaining: 8,
        reset_at: "2026-08-11T01:00:00Z",
        replayed: true,
      },
    ];

    const result = await consumeAnalyzeWaiverQuota({
      userId: "waiver-user-1",
      requestIp: "203.0.113.9",
      requestKey: "f".repeat(64),
      requestFingerprint: "0".repeat(64),
    });

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0]).toEqual(rpcCalls[1]);
    expect(result.replayed).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.remaining).toBe(8);
  });
});
