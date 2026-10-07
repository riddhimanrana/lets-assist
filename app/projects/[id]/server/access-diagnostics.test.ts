import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function runProbe(assertions: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      "--eval",
      `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      mock.module("server-only", () => ({}));
      let failure;
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: null, error: failure }),
      };
      mock.module("./lib/supabase/server", () => ({ createClient: async () => ({
        from: (table) => { assert.equal(table, "projects"); return query; },
      }) }));
      mock.module("./lib/supabase/auth-helpers", () => ({ getAuthUser: async () => ({ user: null }) }));
      mock.module("./lib/supabase/admin", () => ({ getAdminClient: () => { throw new Error("Unexpected admin query"); } }));
      mock.module("./app/projects/[id]/server/shared", () => ({ isMissingWaiverDisableEsignatureColumnError: () => false }));
      globalThis.fetch = async () => { throw new Error("Unexpected provider call"); };
      const calls = [];
      console.error = (...args) => calls.push(args);
      const { getProject } = await import("./app/projects/[id]/server/access");
      ${assertions}
      `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  expect(result.status).toBe(0);
}

test("project read failures retain reviewed codes and the generic public response", () => {
  runProbe(`
    for (const code of ["PGRST116", "42501"]) {
      failure = {
        code,
        message: "Synthetic Student private@example.test",
        details: "Bearer synthetic-private-token",
        hint: "https://private.local.test/project/secret",
        user_id: "11111111-1111-4111-8111-111111111111",
        response: { email: "private@example.test", password: "synthetic-secret" },
      };
      assert.deepEqual(await getProject("fictional-project"), { error: "Failed to fetch project" });
      assert.deepEqual(calls.at(-1), ["Error fetching project:", { error_code: code }]);
    }
    assert.equal(calls.length, 2);
  `);
});

test("project read diagnostics reject arbitrary codes without evaluating private getters", () => {
  runProbe(`
    let getterReads = 0;
    failure = { code: "private@example.test", message: "synthetic-secret" };
    Object.defineProperty(failure, "details", {
      enumerable: true,
      get: () => { getterReads++; return "synthetic-private-token"; },
    });
    assert.deepEqual(await getProject("fictional-project"), { error: "Failed to fetch project" });
    assert.deepEqual(calls, [["Error fetching project:", {}]]);
    assert.equal(getterReads, 0);
  `);
});
