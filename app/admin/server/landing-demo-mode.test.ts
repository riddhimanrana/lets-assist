import { beforeEach, expect, mock, test } from "bun:test";

const actorId = "00000000-0000-4000-8000-000000000001";
let user: Record<string, unknown> | null;
let calls: Array<{ name: string; args: unknown }> = [];
let authOptions: unknown[] = [];
let revalidated: string[] = [];
let tags: string[] = [];
let data: unknown = true;
let error: unknown = null;
let rejected = false;

mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options: unknown) => {
    authOptions.push(options);
    return { user };
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (rejected) throw new Error("private backend context");
      return { data, error };
    },
  }),
}));
mock.module("next/cache", () => ({
  revalidatePath: (path: string) => revalidated.push(path),
  updateTag: (tag: string) => tags.push(tag),
  unstable_cache: (fn: unknown) => fn,
}));

const { getLandingDemoModeForAdmin, setLandingDemoMode } =
  await import("./landing-demo-mode");
beforeEach(() => {
  user = { id: actorId, app_metadata: { role: "super_admin" } };
  calls = [];
  authOptions = [];
  revalidated = [];
  tags = [];
  data = true;
  error = null;
  rejected = false;
});

for (const [name, actor] of [
  ["anonymous", null],
  [
    "member or demoted actor",
    { id: actorId, app_metadata: { role: "member" } },
  ],
  ["organization admin", { id: actorId, app_metadata: { role: "admin" } }],
  [
    "editable role forgery",
    {
      id: actorId,
      user_metadata: { role: "super_admin", is_super_admin: true },
    },
  ],
] as const)
  test(`${name} cannot read admin control or write global mode`, async () => {
    user = actor;
    expect((await getLandingDemoModeForAdmin()).error).toBeDefined();
    expect((await setLandingDemoMode(true, false)).error).toBeDefined();
    expect(calls).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
    expect(authOptions).toEqual([
      { sensitive: true, checkMfa: true },
      { sensitive: true, checkMfa: true },
    ]);
  });

test("fresh admin and MFA checks bind write identity and stale-mode comparison", async () => {
  expect(await setLandingDemoMode(true, false)).toEqual({});
  expect(calls).toEqual([
    {
      name: "set_landing_demo_mode",
      args: { p_enabled: true, p_expected: false, p_actor_id: actorId },
    },
  ]);
  expect(authOptions).toEqual([{ sensitive: true, checkMfa: true }]);
  expect(revalidated).toEqual(["/", "/admin"]);
  expect(tags).toEqual(["landing-demo-mode"]);
});
test("admin reads current global boolean", async () => {
  expect(await getLandingDemoModeForAdmin()).toEqual({ enabled: true });
  expect(calls[0]?.name).toBe("get_landing_demo_mode");
});
test("stale, missing, errored and rejected saves cannot announce success or revalidate", async () => {
  for (const value of [false, null, "true", 1]) {
    data = value;
    expect((await setLandingDemoMode(true, false)).error).toBeDefined();
  }
  data = true;
  error = { message: "private backend context" };
  expect((await setLandingDemoMode(true, false)).error).not.toContain(
    "private",
  );
  rejected = true;
  expect((await setLandingDemoMode(false, true)).error).not.toContain(
    "private",
  );
  expect(revalidated).toHaveLength(0);
  expect(tags).toHaveLength(0);
});
test("both mode arguments require actual booleans", async () => {
  for (const value of ["true", 1, {}, null, undefined]) {
    expect(
      (await setLandingDemoMode(value as boolean, false)).error,
    ).toBeDefined();
    expect(
      (await setLandingDemoMode(true, value as boolean)).error,
    ).toBeDefined();
  }
  expect(calls).toHaveLength(0);
});
