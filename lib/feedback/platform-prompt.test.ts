import { beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let data: unknown = true;
let failure = "none";
const reads: Array<Record<string, unknown>> = [];
mock.module("@/lib/safe-console", () => ({ safeConsole: { error: () => {} } }));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      reads.push({ name, ...args });
      if (failure === "throw") throw new Error("Synthetic read failure");
      return {
        data,
        error: failure === "error" ? { code: "unavailable" } : null,
      };
    },
  }),
}));
const { getPlatformRatingPromptState } = await import("./platform-prompt");
const context = {
  contextKind: "volunteer_hours" as const,
  contextId: "fictional-user",
};
beforeEach(() => {
  reads.length = 0;
  failure = "none";
  data = true;
});
test("anonymous viewers never trigger privileged prompt reads", async () => {
  expect(await getPlatformRatingPromptState(null, context)).toBe(false);
  expect(reads).toHaveLength(0);
});
test("passes explicit account and context to the eligibility transaction", async () => {
  expect(await getPlatformRatingPromptState("fictional-user", context)).toBe(
    true,
  );
  expect(reads).toEqual([
    {
      name: "get_platform_experience_prompt_state",
      p_user_id: "fictional-user",
      p_context_kind: "volunteer_hours",
      p_context_id: "fictional-user",
    },
  ]);
});
test.each([false, null, undefined, "true", {}, []])(
  "only literal true shows a prompt: %p",
  async (value) => {
    data = value;
    expect(await getPlatformRatingPromptState("fictional-user", context)).toBe(
      false,
    );
  },
);
test.each(["error", "throw"])(
  "read %s hides the optional prompt",
  async (mode) => {
    failure = mode;
    expect(await getPlatformRatingPromptState("fictional-user", context)).toBe(
      false,
    );
  },
);
