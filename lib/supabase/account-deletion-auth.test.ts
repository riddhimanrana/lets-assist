import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("real auth helper denies pending accounts and limits the resume bypass to fresh MFA", () => {
  // Isolate module mocks so this auth fixture cannot affect other test files.
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    let pending = false, rpcError = null, rpcCalls = 0, freshCalls = 0;
    const user = { id: "fd900000-0000-4000-8000-000000000001", email: "synthetic@local.test" };
    mock.module("./lib/supabase/server", () => ({ createClient: async () => ({
      rpc: async () => { rpcCalls++; return { data: pending, error: rpcError }; },
      auth: {
        getClaims: async () => ({ data: { claims: { sub: user.id } }, error: null }),
        getUser: async () => { freshCalls++; return { data: { user }, error: null }; },
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }),
          listFactors: async () => ({ data: { all: [] }, error: null }),
        },
      },
    }) }));
    const { getAuthUser } = await import("./lib/supabase/auth-helpers");
    assert.equal((await getAuthUser()).user?.id, user.id);
    pending = true;
    assert.equal((await getAuthUser()).user, null);
    assert.equal((await getAuthUser({ allowAccountDeletion: true })).user, null);
    const callsBeforeResume = rpcCalls;
    assert.equal((await getAuthUser({ sensitive: true, checkMfa: true, allowAccountDeletion: true })).user?.id, user.id);
    assert.equal(freshCalls, 1);
    assert.equal(rpcCalls, callsBeforeResume);
    pending = false; rpcError = { message: "unavailable" };
    assert.equal((await getAuthUser()).user, null);
  `;
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
