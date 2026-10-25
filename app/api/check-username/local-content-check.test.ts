import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("public username checks bound input before local work or database lookup", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      mock.module("server-only", () => ({}));
      let clients = 0, uniquenessCalls = 0, lookups = 0, outboundCalls = 0;
      mock.module("./app/account/profile/actions", () => ({
        checkUsernameUnique: async () => { uniquenessCalls++; return { available: true }; },
      }));
      mock.module("./lib/supabase/server", () => ({ createClient: async () => {
        clients++;
        return {
          auth: { getUser: async () => ({ data: { user: null }, error: null }) },
          from: () => ({ select: () => ({ eq: (_key, value) => {
            assert.ok(value.length >= 3 && value.length <= 32); lookups++;
            return { maybeSingle: async () => ({ data: null, error: null }) };
          } }) }),
        };
      } }));
      globalThis.fetch = async () => { outboundCalls++; throw new Error("External request refused."); };
      const { GET } = await import("./app/api/check-username/route");
      const { checkUsernameAvailability } = await import("./components/onboarding/onboarding-actions");
      for (const username of ["ab", "a".repeat(33), "invalid!name"]) {
        const response = await GET(new Request("http://127.0.0.1/api/check-username?username=" + encodeURIComponent(username)));
        assert.equal((await response.json()).available, false);
        assert.equal((await checkUsernameAvailability(username)).available, false);
      }
      assert.equal(clients, 0); assert.equal(uniquenessCalls, 0);
      for (const username of ["ordinary_name", "a".repeat(32)]) {
        const response = await GET(new Request("http://127.0.0.1/api/check-username?username=" + username));
        assert.equal((await response.json()).available, true);
        assert.equal((await checkUsernameAvailability(username)).available, true);
      }
      const flagged = await GET(new Request("http://127.0.0.1/api/check-username?username=shit123"));
      assert.equal((await flagged.json()).available, false);
      assert.equal(uniquenessCalls, 2); assert.equal(lookups, 2); assert.equal(outboundCalls, 0);
      `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  expect(result.status).toBe(0);
});
