import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const userId = "e7000000-0000-4000-8000-000000000001";
const contextId = "e7300000-0000-4000-8000-000000000001";
let signedIn = true;
let authError = false;
let authThrows = false;
let quotaMode = "allowed";
let rpcMode = "ok";
const writes: Array<{ name: string; args: Record<string, unknown> }> = [];
const quotas: Array<Record<string, unknown>> = [];
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => {
    if (authThrows) throw new Error("Synthetic auth outage");
    return {
      user: signedIn ? { id: userId } : null,
      error: authError ? new Error("Synthetic auth failure") : null,
    };
  },
}));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("@/lib/ai/parse-project-rate-limit-config", () => ({
  getRequestIp: () => "192.0.2.15",
}));
mock.module("@/lib/ai/rate-limit", () => ({
  consumeAiQuota: async (options: Record<string, unknown>) => {
    quotas.push(options);
    if (quotaMode === "throw") throw new Error("Synthetic quota failure");
    return { allowed: quotaMode === "allowed" };
  },
}));
mock.module("@/lib/safe-console", () => ({ safeConsole: { error: () => {} } }));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.push({ name, args });
      if (rpcMode === "throw") throw new Error("Synthetic write failure");
      return { error: rpcMode === "error" ? { code: "42501" } : null };
    },
  }),
}));
const { savePlatformExperience } = await import("./actions");
const rating = { contextKind: "volunteer_signup", contextId, rating: 4 };

beforeEach(() => {
  signedIn = true;
  authError = false;
  authThrows = false;
  quotaMode = "allowed";
  rpcMode = "ok";
  writes.length = 0;
  quotas.length = 0;
});

describe("signed-in platform ratings", () => {
  test("authentication outages fail closed without quota or writes", async () => {
    authThrows = true;
    expect((await savePlatformExperience(rating)).success).toBe(false);
    expect(quotas).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
  test("derives identity from the session and charges user and IP quota", async () => {
    expect(await savePlatformExperience(rating)).toEqual({ success: true });
    expect(writes).toEqual([
      {
        name: "save_platform_experience_for_user",
        args: {
          p_user_id: userId,
          p_context_kind: "volunteer_signup",
          p_context_id: contextId,
          p_rating: 4,
          p_comment: null,
          p_update_comment: false,
        },
      },
    ]);
    expect(quotas[0]).toEqual({
      feature: "platform-experience",
      windowSeconds: 3600,
      buckets: [
        { scope: "user", identifier: userId, limit: 20 },
        { scope: "ip", identifier: "192.0.2.15", limit: 60 },
      ],
    });
  });
  test("sends comments separately and trims them", async () => {
    expect(
      await savePlatformExperience({
        contextKind: "volunteer_signup",
        contextId,
        comment: "  Easy to use  ",
      }),
    ).toEqual({ success: true });
    expect(writes[0].args).toMatchObject({
      p_rating: null,
      p_comment: "Easy to use",
      p_update_comment: true,
    });
  });
  test("requires a session and a successful auth check", async () => {
    signedIn = false;
    expect((await savePlatformExperience(rating)).success).toBe(false);
    signedIn = true;
    authError = true;
    expect((await savePlatformExperience(rating)).success).toBe(false);
    expect(quotas).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
  test.each(["denied", "throw"])(
    "quota %s fails closed before writing",
    async (mode) => {
      quotaMode = mode;
      expect((await savePlatformExperience(rating)).success).toBe(false);
      expect(writes).toHaveLength(0);
    },
  );
  test("rejects forged identity, malformed contexts and mixed changes", async () => {
    for (const value of [
      null,
      [],
      { ...rating, userId },
      { ...rating, contextId: "invalid" },
      { ...rating, contextKind: "csf_term" },
      { ...rating, rating: 6 },
      { ...rating, rating: 1.2 },
      { ...rating, comment: "mixed" },
      { contextKind: "volunteer_hours", contextId, rating: 4 },
      { contextKind: "volunteer_signup", contextId, comment: "x".repeat(2001) },
    ]) {
      expect((await savePlatformExperience(value)).success).toBe(false);
    }
    expect(quotas).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
  test.each(["error", "throw"])(
    "database %s returns a safe refusal",
    async (mode) => {
      rpcMode = mode;
      expect(await savePlatformExperience(rating)).toEqual({
        success: false,
        error: "Could not save your feedback. Try again.",
      });
    },
  );
  test("accepts the account's own hours context", async () => {
    expect(
      await savePlatformExperience({
        contextKind: "volunteer_hours",
        contextId: userId,
        rating: 5,
      }),
    ).toEqual({ success: true });
  });
});
