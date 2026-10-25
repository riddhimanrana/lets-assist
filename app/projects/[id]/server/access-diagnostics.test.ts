import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const mockClient = `
  let failure;
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: failure }),
    maybeSingle: async () => ({ data: null, error: failure }),
  };
  const client = {
    from: (table) => { assert.equal(table, "projects"); return query; },
  };
`;

const sdkClient = `
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  let rows = [];
  let failure;
  let transportFailure = false;
  const requests = [];
  const client = new PostgrestClient("http://127.0.0.1:1/rest/v1", {
    retry: false,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "http://127.0.0.1:1");
      assert.equal(url.pathname, "/rest/v1/projects");
      assert.equal(url.searchParams.get("id"), "eq.fictional-project");
      assert.equal(init.method, "GET");
      requests.push(url.pathname);
      if (transportFailure) throw new TypeError("private@example.test synthetic-token");
      if (failure) return Response.json(failure, { status: 403 });
      const singular = new Headers(init.headers).get("Accept") === "application/vnd.pgrst.object+json";
      if (singular && rows.length !== 1) return Response.json({
        code: "PGRST116", details: "Results contain " + rows.length + " rows",
        message: "Cannot coerce result to single object", hint: null,
      }, { status: 406 });
      return Response.json(singular ? rows[0] : rows);
    },
  });
`;

function runProbe(assertions: string, clientSource = mockClient) {
  const result = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      "--eval",
      `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      mock.module("server-only", () => ({}));
      ${clientSource}
      mock.module("./lib/supabase/server", () => ({ createClient: async () => client }));
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

test("an absent visible project returns null without an operational diagnostic", () => {
  runProbe(
    `
    assert.deepEqual(await getProject("fictional-project"), { project: null });
    assert.deepEqual(calls, []);
    assert.equal(requests.length, 1);
    rows = [{ id: "fictional-project", title: "Fictional cleanup", visibility: "public", workflow_status: "published" }];
    assert.deepEqual(await getProject("fictional-project"), { project: rows[0] });
    assert.deepEqual(calls, []);
    assert.equal(requests.length, 2);
  `,
    sdkClient,
  );
});

test("SDK query failures and invalid cardinality retain private-safe diagnostics", () => {
  runProbe(
    `
    failure = { code: "42501", message: "private@example.test", details: "synthetic-token", hint: "private data" };
    assert.deepEqual(await getProject("fictional-project"), { error: "Failed to fetch project" });
    assert.deepEqual(calls.pop(), ["Error fetching project:", { error_code: "42501" }]);
    failure = undefined;
    rows = [{ id: "fictional-project" }, { id: "unexpected-project" }];
    assert.deepEqual(await getProject("fictional-project"), { error: "Failed to fetch project" });
    assert.deepEqual(calls.pop(), ["Error fetching project:", { error_code: "PGRST116" }]);
    transportFailure = true;
    assert.deepEqual(await getProject("fictional-project"), { error: "Failed to fetch project" });
    assert.deepEqual(calls.pop(), ["Error fetching project:", {}]);
    assert.equal(requests.length, 3);
    assert.deepEqual(calls, []);
  `,
    sdkClient,
  );
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
