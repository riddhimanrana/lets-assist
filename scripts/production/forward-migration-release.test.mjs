import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyForwardMigrations,
  approvedMigrations,
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
  badCatalog = false,
  enabledWorker = false,
  initialVersions = prepared.prefix,
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
          written && !rollback ? prepared.versions : initialVersions,
        );
        if (drift) result.pop();
      } else if (sql.includes("csf_target_schema_verified")) {
        result = [{ csf_target_schema_verified: badCatalog ? 0 : 1 }];
      } else {
        result = [
          {
            valid: !(
              (badAcl &&
                sql.includes("has_function_privilege('service_role'")) ||
              (enabledWorker &&
                sql.includes("WHERE workbook_refresh OR import_commit"))
            ),
          },
        ];
      }
      return { ok: true, json: async () => result };
    },
  };
}

test("approved bytes and exact versions share one transaction", () => {
  assert.equal(prepared.prefix.length, 468);
  assert.equal(prepared.versions.length, 481);
  assert.deepEqual(prepared.versions.slice(468), [
    "20260909090522",
    "20260909090944",
    "20260909161331",
    "20260909163547",
    "20260909171733",
    "20260909173201",
    "20260909193538",
    "20260909193835",
    "20260909231613",
    "20260910004059",
    "20260910043037",
    "20260910043106",
    "20260910045040",
  ]);
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
    /'20260909090522','csf_application_grade_preview_evidence'/u,
  );
  assert.match(
    prepared.query,
    /'20260909090944','csf_application_retry_match_recovery'/u,
  );
});

test("refuses modified approved SQL before any provider request", () => {
  for (const [name] of approvedMigrations) {
    const target = resolve(cwd, "supabase/migrations", `${name}.sql`);
    assert.throws(
      () =>
        prepareMigration(cwd, (path) => {
          const sql = readFileSync(path, "utf8");
          return path === target ? `${sql}\n` : sql;
        }),
      /bytes changed/u,
      name,
    );
    assert.ok(
      prepared.query.includes(`'${name.slice(0, 14)}','${name.slice(15)}'`),
    );
  }
});

test("performs one write and verifies ledger and permissions", async () => {
  const t = transport();
  const result = await applyForwardMigrations(config, t.fetch);
  assert.equal(result.migrations, 481);
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

test("enabled workers stop before migration and are rechecked under a lock", async () => {
  const t = transport({ enabledWorker: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /enabled CSF worker/u,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    0,
  );
  assert.match(
    prepared.query,
    /LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE/u,
  );
  assert.match(
    prepared.query,
    /Disable CSF workers before applying schema changes/u,
  );
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

test("a matching ledger cannot hide a changed schema catalog", async () => {
  const t = transport({ badCatalog: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
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

test("a reviewed partially applied tail writes only the remaining migrations", async () => {
  const initialVersions = prepared.versions.slice(0, 478);
  const t = transport({ initialVersions });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, [
    "20260910043037",
    "20260910043106",
    "20260910045040",
  ]);
  const writes = t.calls.filter((call) => call.url.endsWith("/database/query"));
  assert.equal(writes.length, 1);
  assert.ok(
    writes[0].sql.includes(
      "'20260910043037','csf_reported_application_contacts'",
    ),
  );
  assert.ok(
    !writes[0].sql.includes(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_set_review_period",
    ),
  );
  assert.ok(
    writes[0].sql.includes(
      `ARRAY[${initialVersions.map((version) => `'${version}'`).join(",")}]::text[]`,
    ),
  );
  assert.equal(
    (
      writes[0].sql.match(
        /INSERT INTO supabase_migrations.schema_migrations/g,
      ) ?? []
    ).length,
    3,
  );
});

test("an already applied tail verifies the catalog without resending SQL", async () => {
  const t = transport({ initialVersions: prepared.versions });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, []);
  assert.equal(result.responseLost, false);
  assert.equal(result.catalog, "verified");
  assert.ok(
    t.calls.some((call) => call.sql.includes("csf_target_schema_verified")),
  );
  assert.ok(t.calls.every((call) => call.url.endsWith("/read-only")));
});

test("an already applied tail still refuses catalog drift", async () => {
  const t = transport({ initialVersions: prepared.versions, badCatalog: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.ok(t.calls.every((call) => call.url.endsWith("/read-only")));
});

test("only exact reviewed prefixes may skip approved migrations", async () => {
  for (const initialVersions of [
    [...prepared.versions, "20990101000000"],
    prepared.versions.slice(0, 467),
    [...prepared.versions.slice(0, 476), "20990101000000"],
    [
      ...prepared.versions.slice(0, 475),
      prepared.versions[476],
      prepared.versions[475],
    ],
  ]) {
    const t = transport({ initialVersions });
    await assert.rejects(
      applyForwardMigrations(config, t.fetch),
      /sequence differs/u,
    );
    assert.equal(t.calls.length, 1);
  }
});
