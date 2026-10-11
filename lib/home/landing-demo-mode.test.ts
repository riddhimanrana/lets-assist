import { beforeEach, expect, mock, test } from "bun:test";

let data: unknown = false;
let error: unknown = null;
let rejected = false;
let calls: string[] = [];
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string) => {
      calls.push(name);
      if (rejected) throw new Error("private backend context");
      return { data, error };
    },
  }),
}));
const { readLandingDemoMode } = await import("./landing-demo-mode");
beforeEach(() => {
  data = false;
  error = null;
  rejected = false;
  calls = [];
});

test("reads only the public display boolean through a server-only service RPC", async () => {
  expect(await readLandingDemoMode()).toEqual({ enabled: false });
  data = true;
  expect(await readLandingDemoMode()).toEqual({ enabled: true });
  expect(calls).toEqual(["get_landing_demo_mode", "get_landing_demo_mode"]);
});
test("errors, missing schema and malformed values fail closed without exposing backend details", async () => {
  for (const value of [null, undefined, "true", 1, [], { enabled: true }]) {
    data = value;
    expect(await readLandingDemoMode()).toEqual({
      enabled: null,
      error: "Unable to load landing page mode.",
    });
  }
  data = true;
  error = { code: "42501", message: "private backend context" };
  expect((await readLandingDemoMode()).enabled).toBeNull();
  error = null;
  rejected = true;
  expect(JSON.stringify(await readLandingDemoMode())).not.toContain(
    "private backend context",
  );
});
