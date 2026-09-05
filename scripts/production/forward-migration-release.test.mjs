import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyForwardMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";

const cwd = resolve(import.meta.dirname, "../..");
const config = {
  cwd,
  projectRef: "fotdmeakexgrkronxlof",
  token: "synthetic-test-token",
};
const prepared = prepareMigration(cwd);
const rows = (versions) => versions.map((version) => ({ version }));

function transport({
  lost = false,
  rollback = false,
  drift = false,
  badAcl = false,
} = {}) {
  const calls = [];
  let written = false;
  return {
    calls,
    fetch: async (url, options) => {
      const sql = JSON.parse(options.body).query;
      calls.push({ url, options, sql });
      assert.equal(options.redirect, "error");
      let result;
      if (url.endsWith("/database/query")) {
        written = true;
        if (lost) throw new Error("Synthetic response loss");
        result = [];
      } else if (sql.startsWith("SELECT version::text")) {
        result = rows(
          written && !rollback ? prepared.versions : prepared.prefix,
        );
        if (drift) result.pop();
      } else if (sql.includes("csf_target_schema_verified")) {
        result = [{ csf_target_schema_verified: 1 }];
      } else {
        result = [
          {
            valid: !(
              badAcl && sql.includes("has_function_privilege('service_role'")
            ),
          },
        ];
      }
      return { ok: true, json: async () => result };
    },
  };
}

test("approved bytes and exact versions share one transaction", () => {
  assert.equal(prepared.prefix.length, 444);
  assert.equal(prepared.versions.length, 446);
  assert.match(prepared.query, /^BEGIN;/u);
  assert.match(prepared.query, /COMMIT;$/u);
  assert.match(
    prepared.query,
    /LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE/u,
  );
  assert.match(prepared.query, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(
    prepared.query,
    /INSERT INTO supabase_migrations.schema_migrations\(version,name,statements\)/u,
  );
  assert.match(
    prepared.query,
    /'20260904010000','csf_self_confirmed_account_name_claims'/u,
  );
  assert.match(
    prepared.query,
    /'20260905003409','csf_release_worker_runtime_controls'/u,
  );
});

test("refuses modified approved SQL before any provider request", () => {
  assert.throws(
    () => prepareMigration(cwd, (path) => `${readFileSync(path, "utf8")}\n`),
    /bytes changed/u,
  );
});

test("performs one write and verifies ledger and permissions", async () => {
  const t = transport();
  const result = await applyForwardMigrations(config, t.fetch);
  assert.equal(result.migrations, 446);
  assert.equal(result.workers, "disabled");
  assert.equal(result.responseLost, false);
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
  assert.ok(
    t.calls.every((call) => new URL(call.url).hostname === "api.supabase.com"),
  );
  assert.ok(!JSON.stringify(result).includes(config.token));
});

test("settles a lost response through reads without resending SQL", async () => {
  const t = transport({ lost: true });
  assert.equal(
    (await applyForwardMigrations(config, t.fetch)).responseLost,
    true,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
});

test("a refused or rolled-back transaction remains unresolved without retry", async () => {
  const t = transport({ lost: true, rollback: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
});

test("ledger drift stops before mutation", async () => {
  const t = transport({ drift: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /sequence differs/u,
  );
  assert.equal(t.calls.length, 1);
});

test("wrong project refuses all provider access", async () => {
  const t = transport();
  await assert.rejects(
    applyForwardMigrations({ ...config, projectRef: "development" }, t.fetch),
    /binding/u,
  );
  assert.equal(t.calls.length, 0);
});

test("incorrect runtime ACL does not report completion", async () => {
  const t = transport({ badAcl: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
});

test("schema-only workflow has no build, import, backup, or worker mutation", () => {
  const workflow = readFileSync(
    resolve(cwd, ".github/workflows/deploy-forward-migrations.yml"),
    "utf8",
  );
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /production-schema-deployment/u);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/u);
  assert.match(workflow, /app-release-checks.mjs source/u);
  assert.doesNotMatch(
    workflow,
    /bun run build|vercel.*deploy|db (push|dump|reset)|csf_queue_import|set_csf_release_worker_control/u,
  );
});
