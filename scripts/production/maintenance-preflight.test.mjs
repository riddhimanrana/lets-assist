import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { expectedVersions, productionRef } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";
import { maintenanceDataChecks } from "./maintenance-preflight-checks.mjs";
import {
  executeMaintenanceQuery,
  maintenanceLedgerQuery,
  maintenanceCatalogQuery,
  maintenancePostureQuery,
  maintenanceTarget,
  maintenanceVerificationQuery,
  selectMaintenanceLedger,
  validateMaintenanceBinding,
  verifyMaintenancePreflight,
} from "./maintenance-preflight.mjs";

const fixture = historicalReleaseTestFixture();
after(fixture.dispose);
const target = expectedVersions(fixture.cwd);
const syntheticPassword = "test-password";
function withTestCredentials(address, username = "postgres") {
  const url = new URL(address);
  url.username = username;
  url.password = syntheticPassword;
  return url.href;
}
const databaseUrl = withTestCredentials(
  `postgresql://db.${productionRef}.supabase.co:5432/postgres?sslmode=require`,
);
const config = {
  cwd: fixture.cwd,
  mode: "before",
  projectRef: productionRef,
  databaseUrl,
};
const raw = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("target approval uses every migration byte and the accepted catalog", () => {
  assert.deepEqual(maintenanceTarget(fixture.cwd), target);
  assert.throws(() =>
    maintenanceTarget(fixture.cwd, (path) =>
      Buffer.concat([readFileSync(path), Buffer.from("\n")]),
    ),
  );
  const unknown = historicalReleaseTestFixture();
  try {
    writeFileSync(
      resolve(unknown.cwd, "supabase/migrations/20990101000000_unknown.sql"),
      "SELECT 1;\n",
    );
    let calls = 0;
    assert.throws(
      () =>
        verifyMaintenancePreflight({ ...config, cwd: unknown.cwd }, () => {
          calls++;
        }),
      /not reviewed/u,
    );
    assert.equal(calls, 0);
  } finally {
    unknown.dispose();
  }
});

test("before accepts only exact catalogued prefixes at or after the reviewed baseline", () => {
  for (const count of [687, 699, 700, 701, target.length]) {
    const versions = target.slice(0, count);
    assert.deepEqual(
      selectMaintenanceLedger(target, versions, "before"),
      versions,
    );
    assert.ok(
      maintenanceVerificationQuery(versions).includes(
        maintenanceCatalogQuery(versions).replace(/;$/u, ""),
      ),
    );
  }
  for (const applied of [
    target.slice(0, 686),
    target.slice(0, 688),
    target.slice(0, 698),
    [...target, "20990101000000"],
    [...target.slice(0, -1), target[0]],
    [...target].reverse(),
    null,
    {},
    ["bad"],
  ])
    assert.throws(() => selectMaintenanceLedger(target, applied, "before"));
});

test("target mode refuses a valid preceding catalog and requires the entire ledger", () => {
  for (const count of [687, 699, 700, 701])
    assert.throws(
      () => selectMaintenanceLedger(target, target.slice(0, count), "target"),
      /not fully applied/u,
    );
  assert.deepEqual(selectMaintenanceLedger(target, target, "target"), target);
  assert.throws(
    () => selectMaintenanceLedger(target, target, "resume"),
    /Invalid/u,
  );
});

test("catalog, repeated ledger and every posture check share a read-only snapshot", () => {
  const sql = maintenanceVerificationQuery(target);
  assert.match(sql, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/u);
  assert.match(sql, /SET LOCAL search_path TO public, extensions;/u);
  assert.match(sql, /SET LOCAL statement_timeout = '120s';/u);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/u);
  assert.ok(
    sql.indexOf("FROM supabase_migrations.schema_migrations") <
      sql.indexOf("WITH actual AS"),
  );
  assert.match(
    sql,
    /\\gset\n\\if :valid\n\\else\n {2}SELECT 1 \/ 0 AS maintenance_check_failed;/u,
  );
  assert.ok(sql.includes(maintenancePostureQuery));
  assert.ok(sql.endsWith("COMMIT;"));
  assert.equal((sql.match(/maintenance-preflight-verified/gu) ?? []).length, 1);
  for (const name of [
    "workbook_refresh",
    "import_commit",
    "communications",
    "scheduled_post_publisher",
    "publication_notifications",
  ])
    assert.ok(maintenancePostureQuery.includes(`${name} IS NOT FALSE`));
  for (const text of [
    "pgrst.app_settings.maintenance_write_block=on",
    "cron.job WHERE active",
    "cron.job_run_details WHERE status = 'running'",
    "lease_expires_at > now()",
  ])
    assert.ok(maintenancePostureQuery.includes(text));
});

test("maintenance changes only the single retention-state comparison and refuses anchor drift", () => {
  const runtime = acceptedCatalogQuery("", target);
  const maintenance = maintenanceCatalogQuery(target);
  assert.equal(
    maintenance,
    runtime.replace(
      "'username',username,'active',active,",
      "'username',username,'active',true,",
    ),
  );
  assert.equal(acceptedCatalogQuery("", target), runtime);
  assert.throws(
    () => maintenanceCatalogQuery(target, () => "SELECT 1;"),
    /needs review/u,
  );
  assert.throws(
    () => maintenanceCatalogQuery(target, () => runtime + runtime),
    /needs review/u,
  );
  assert.throws(
    () =>
      maintenanceCatalogQuery(target, () =>
        runtime.replace("'active',active", "'active',coalesce(active,false)"),
      ),
    /needs review/u,
  );
});

test("applicable historical data, index and collation blockers are retained without row output", () => {
  const historical = raw("../production-cutover-preflight.sql");
  assert.equal(maintenanceDataChecks.length, 12);
  for (const { name, query } of maintenanceDataChecks) {
    if (name === "control_plane") {
      const inner = query.slice(
        "SELECT csf_control_plane_pass AS valid FROM (".length,
        -") AS control_plane".length,
      );
      assert.ok(historical.includes(inner));
    } else
      assert.ok(historical.includes(query.replace(/AS valid/u, `AS ${name}`)));
    assert.ok(maintenanceVerificationQuery(target).includes(query));
  }
});

test("database binding refuses foreign hosts, projects, database names and connection overrides", () => {
  validateMaintenanceBinding(productionRef, databaseUrl);
  validateMaintenanceBinding(
    productionRef,
    withTestCredentials(
      "postgres://aws-0-us-west-1.pooler.supabase.com:6543/postgres",
      `postgres.${productionRef}`,
    ),
  );
  for (const url of [
    undefined,
    "not-url",
    databaseUrl.replace(productionRef, "aaaaaaaaaaaaaaaaaaaa"),
    databaseUrl.replace(".supabase.co", ".supabase.co.attacker.test"),
    databaseUrl.replace("/postgres?", "/other?"),
    databaseUrl.replace("5432", "1234"),
    `${databaseUrl}&host=attacker.test`,
    `${databaseUrl}&hostaddr=127.0.0.1`,
    `${databaseUrl}&user=other`,
    `${databaseUrl}&dbname=other`,
    `${databaseUrl}&service=other`,
    `${databaseUrl}&options=-c%20role%3Dother`,
    `${databaseUrl}&sslmode=disable`,
    databaseUrl.replace("require", "disable"),
    `${databaseUrl}#fragment`,
    withTestCredentials(
      "postgres://aws-0-us-west-1.pooler.supabase.com/postgres",
    ),
  ])
    assert.throws(
      () => validateMaintenanceBinding(productionRef, url),
      /Invalid Production/u,
    );
  assert.throws(() => validateMaintenanceBinding("other", databaseUrl));
});

test("process execution suppresses raw output and keeps credentials out of argv", () => {
  assert.equal(
    executeMaintenanceQuery(databaseUrl, "SELECT 1;", (file, args, options) => {
      assert.equal(file, "psql");
      assert.deepEqual(args, ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"]);
      assert.ok(!args.join(" ").includes(syntheticPassword));
      assert.equal(options.env.PGDATABASE, "postgres");
      assert.equal(options.env.PGHOST, `db.${productionRef}.supabase.co`);
      assert.equal(options.env.PGPORT, "5432");
      assert.equal(options.env.PGUSER, "postgres");
      assert.equal(options.env.PGPASSWORD, syntheticPassword);
      assert.equal(options.env.PGOPTIONS, undefined);
      assert.equal(options.env.PGSERVICE, undefined);
      assert.deepEqual(Object.keys(options.env).sort(), [
        "LANG",
        "PATH",
        "PGCONNECT_TIMEOUT",
        "PGDATABASE",
        "PGHOST",
        "PGPASSWORD",
        "PGPORT",
        "PGSSLMODE",
        "PGUSER",
      ]);
      assert.equal(options.env.PGSSLMODE, "require");
      assert.equal(options.timeout, 150_000);
      assert.equal(options.input, "SELECT 1;");
      return " 1\n";
    }),
    "1",
  );
  assert.throws(
    () =>
      executeMaintenanceQuery(databaseUrl, "SELECT 1;", () => {
        throw new Error(`${databaseUrl} PRIVATE ROW VALUES`);
      }),
    (error) =>
      error.message ===
      "Production maintenance preflight failed. Raw output was suppressed.",
  );
});

test("connection transport decodes credentials and honors reviewed TLS modes", () => {
  for (const sslmode of ["require", "verify-ca", "verify-full"]) {
    const url = new URL("postgresql://127.0.0.1:55722/postgres");
    url.username = "postgres.example";
    url.password = encodeURIComponent(`${syntheticPassword}:@/%`);
    url.searchParams.set("sslmode", sslmode);
    executeMaintenanceQuery(url.href, "SELECT 1;", (_, args, { env }) => {
      assert.equal(env.PGHOST, "127.0.0.1");
      assert.equal(env.PGPORT, "55722");
      assert.equal(env.PGDATABASE, "postgres");
      assert.equal(env.PGUSER, "postgres.example");
      assert.equal(env.PGPASSWORD, `${syntheticPassword}:@/%`);
      assert.equal(env.PGSSLMODE, sslmode);
      assert.ok(!args.join(" ").includes(syntheticPassword));
      return "1";
    });
  }
});

test("invalid connection transport configuration never starts psql", () => {
  const emptyPassword = new URL(databaseUrl);
  emptyPassword.password = "";
  for (const url of [
    "not a connection URL",
    emptyPassword.href,
    databaseUrl.replace("postgresql:", "https:"),
    databaseUrl.replace("/postgres?", "/other%2Fdb?"),
    databaseUrl.replace(syntheticPassword, "%00"),
    databaseUrl.replace(syntheticPassword, "%ZZ"),
    databaseUrl.replace("require", "disable"),
    `${databaseUrl}&sslmode=require`,
    `${databaseUrl}&host=elsewhere.test`,
    `${databaseUrl}&options=-c%20role%3Dother`,
    `${databaseUrl}#fragment`,
  ]) {
    let executions = 0;
    assert.throws(
      () => executeMaintenanceQuery(url, "SELECT 1;", () => executions++),
      /Raw output was suppressed/u,
    );
    assert.equal(executions, 0);
  }
});

test("successful verification returns only reviewed identity and safe posture", () => {
  const calls = [];
  const result = verifyMaintenancePreflight(config, (url, query) => {
    assert.equal(url, databaseUrl);
    calls.push(query);
    return calls.length === 1
      ? JSON.stringify(target.slice(0, 687))
      : "maintenance-preflight-verified";
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0], maintenanceLedgerQuery);
  assert.equal(result.migrations, 687);
  assert.equal(result.targetMigrations, target.length);
  assert.equal(result.writes, "configured-request-guard");
  assert.equal(result.workers, "disabled");
  assert.ok(!JSON.stringify(result).includes(syntheticPassword));
});

test("bad ledger fails before schema queries and failed catalog/posture cannot produce acceptance", () => {
  for (const response of [
    "invalid JSON",
    "null",
    "{}",
    JSON.stringify(target.slice(0, 688)),
    JSON.stringify([...target, "20990101000000"]),
  ]) {
    let calls = 0;
    assert.throws(() =>
      verifyMaintenancePreflight(config, () => {
        calls++;
        return response;
      }),
    );
    assert.equal(calls, 1);
  }
  for (const response of [
    "",
    "0",
    "1",
    "maintenance-preflight-verified\nPRIVATE ROW VALUES",
  ])
    assert.throws(
      () =>
        verifyMaintenancePreflight(config, (_, query) =>
          query === maintenanceLedgerQuery ? JSON.stringify(target) : response,
        ),
      /exact receipt/u,
    );
  let calls = 0;
  assert.throws(() =>
    verifyMaintenancePreflight({ ...config, mode: "unknown" }, () => {
      calls++;
    }),
  );
  assert.equal(calls, 0);
});
