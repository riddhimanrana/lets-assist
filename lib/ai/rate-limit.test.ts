import { beforeEach, describe, expect, mock, test } from "bun:test";

type RpcCall = { key: string; limit: number; windowSeconds: number };

const rpcCalls: RpcCall[] = [];
let rpcResponses: Array<{ allowed: boolean; remaining: number; reset_at: string }> =
  [];

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (
      _fn: string,
      args: { p_key: string; p_limit: number; p_window_seconds: number },
    ) => {
      rpcCalls.push({
        key: args.p_key,
        limit: args.p_limit,
        windowSeconds: args.p_window_seconds,
      });
      const next = rpcResponses.shift();
      if (!next) throw new Error("unexpected rpc call");
      return { data: [next], error: null };
    },
  }),
}));

const { buildAiQuotaKey, consumeAiQuota, hashRateLimitIdentifier } =
  await import("./rate-limit");
const { consumeParseProjectQuota } = await import("./parse-project-rate-limit");

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
    expect(rpcCalls.map((call) => call.windowSeconds)).toEqual([
      3600, 3600, 3600,
    ]);
  });

  test("requires at least one bucket", async () => {
    await expect(
      consumeAiQuota({ feature: "x", windowSeconds: 60, buckets: [] }),
    ).rejects.toThrow("at least one bucket");
  });
});

describe("consumeParseProjectQuota compatibility", () => {
  test("keeps the original key format and result shape", async () => {
    rpcResponses = [
      { allowed: true, remaining: 19, reset_at: "2026-08-11T01:00:00Z" },
      { allowed: true, remaining: 59, reset_at: "2026-08-11T01:05:00Z" },
    ];

    const result = await consumeParseProjectQuota("user-1", "203.0.113.7");

    expect(rpcCalls[0].key).toBe(
      `ai:parse-project:user:${hashRateLimitIdentifier("user-1")}`,
    );
    expect(rpcCalls[1].key).toBe(
      `ai:parse-project:ip:${hashRateLimitIdentifier("203.0.113.7")}`,
    );
    expect(rpcCalls[0].limit).toBe(20);
    expect(rpcCalls[1].limit).toBe(60);
    expect(result).toEqual({
      allowed: true,
      remaining: 19,
      resetAt: "2026-08-11T01:05:00Z",
    });
  });
});
