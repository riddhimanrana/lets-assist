import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expectedVersions, productionRef } from "./app-release-checks.mjs";
import {
  maintenanceConnectionReceipt,
  productionMaintenanceConfig,
} from "./maintenance-preflight.mjs";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = join(cwd, "scripts/production/maintenance-preflight.mjs");
const password = "fictional-transport-password";
function connection(username = "postgres", pooler = false) {
  const url = new URL(
    pooler
      ? "postgresql://aws-0-us-west-1.pooler.supabase.com:6543/postgres"
      : `postgresql://db.${productionRef}.supabase.co:5432/postgres`,
  );
  url.username = username;
  url.password = password;
  url.searchParams.set("sslmode", "require");
  return url.href;
}
const environment = (extra = {}) => ({
  EXPECTED_SUPABASE_PROJECT_REF: productionRef,
  PRODUCTION_BOOTSTRAP_DATABASE_URL: connection(),
  ...extra,
});

test("bootstrap fallback is fixed-target owner authority, never a restricted-login claim", () => {
  for (const url of [
    connection(),
    connection(`postgres.${productionRef}`, true),
  ]) {
    const config = productionMaintenanceConfig(
      environment({
        PRODUCTION_BOOTSTRAP_DATABASE_URL: url,
      }),
    );
    assert.equal(config.databaseUrl, url);
    assert.deepEqual(maintenanceConnectionReceipt(config), {
      connectionSource: "production-bootstrap-database-url",
      databaseAuthority: "owner",
      transactionPolicy: "read-only",
    });
  }
  assert.throws(
    () =>
      productionMaintenanceConfig(
        environment({
          PRODUCTION_BOOTSTRAP_DATABASE_URL: connection("fictional_reader"),
        }),
      ),
    /reviewed owner/u,
  );
});

test("configured transport takes precedence and its authority is not inferred from the secret name", () => {
  for (const [username, authority] of [
    ["fictional_reader", "configured-role-unverified"],
    ["postgres", "owner"],
  ]) {
    const url = connection(username);
    const config = productionMaintenanceConfig(
      environment({ PRODUCTION_READONLY_URL: url }),
    );
    assert.equal(config.databaseUrl, url);
    assert.equal(
      maintenanceConnectionReceipt(config).connectionSource,
      "production-readonly-url",
    );
    assert.equal(
      maintenanceConnectionReceipt(config).databaseAuthority,
      authority,
    );
  }
  assert.throws(
    () =>
      productionMaintenanceConfig(
        environment({ PRODUCTION_READONLY_URL: "invalid" }),
      ),
    /Invalid Production/u,
  );
});

// Invoke the actual CLI and its child transport. The synthetic psql executable
// inspects the real argv/environment/stdin; it does not prove a provider session.
function withTransport(mode, run) {
  const root = mkdtempSync(join(tmpdir(), "lets-assist-preflight-transport-"));
  chmodSync(root, 0o700);
  const log = join(root, "calls.jsonl");
  const psql = join(root, "psql");
  const ledger =
    mode === "target-success"
      ? expectedVersions(cwd)
      : expectedVersions(cwd).slice(0, 687);
  const receipts = [
    "PASS Q1: no active pg_cron schedules.",
    "PASS Q2: no pg_cron execution is still running.",
    "PASS Q3: the PostgREST maintenance flag is configured. Hook and fresh API verification are separate requirements.",
  ].join("\n");
  writeFileSync(
    psql,
    String.raw`#!${process.execPath}
const fs = require('node:fs');
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  argv: process.argv.slice(2),
  keys: Object.keys(process.env).sort(),
  options: process.env.PGOPTIONS,
  username: process.env.PGUSER,
  sslmode: process.env.PGSSLMODE,
  explicitReadOnly: /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/.test(sql),
  safeSearchPath: /SET LOCAL search_path TO (public, extensions|pg_catalog);/.test(sql),
  readOnlyCheck: sql.includes("current_setting('transaction_read_only') = 'on'"),
  boundedStatement: /SET LOCAL statement_timeout = '(15s|20s|120s)';/.test(sql),
  boundedLock: /SET LOCAL lock_timeout = '5s';/.test(sql),
  ending: sql.trim().endsWith('COMMIT;'),
  callerSqlAbsent: !sql.includes('ARBITRARY_CALLER_SQL')
}) + '\n', {mode: 0o600});
const mode = ${JSON.stringify(mode)};
if (mode === 'private-error') {
  process.stderr.write('FICTIONAL PRIVATE ROW ' + process.env.PGPASSWORD);
  process.exit(1);
}
if (mode === 'bad-receipt') { process.stdout.write('PRIVATE_ROW_NOT_A_RECEIPT'); process.exit(0); }
if (sql.includes('SELECT coalesce(json_agg(version::text ORDER BY version)'))
  process.stdout.write(${JSON.stringify(JSON.stringify(ledger))});
else if (sql.includes("SELECT 'maintenance-preflight-verified'"))
  process.stdout.write('maintenance-preflight-verified');
else process.stdout.write(${JSON.stringify(receipts)});
`,
    { mode: 0o700 },
  );
  const invoke = (modeArg, extra = {}, args = []) =>
    spawnSync(process.execPath, [entry, modeArg, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...environment(),
        PATH: `${root}:${process.env.PATH}`,
        PGOPTIONS: "-c default_transaction_read_only=off -c role=attacker",
        PGSERVICE: "attacker",
        PSQLRC: "attacker",
        ARBITRARY_CALLER_SQL:
          "COMMIT; CREATE TABLE ARBITRARY_CALLER_SQL(id int);",
        ...extra,
      },
    });
  const calls = () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    } catch {
      return [];
    }
  };
  try {
    // CI runs this suite under Bun, whose --check executes this script. Node's
    // syntax-only mode must not start the synthetic database transport.
    const syntax = spawnSync("node", ["--check", psql], {
      encoding: "utf8",
    });
    assert.equal(syntax.status, 0, syntax.stderr);
    assert.equal(calls().length, 0, "Syntax validation executed psql");
    run(invoke, calls);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("before and quiescence CLI execute only fixed SQL with bounded read-only defaults and secret-free argv", () => {
  withTransport("success", (invoke, calls) => {
    for (const mode of ["before", "quiescence"]) {
      const result = invoke(mode);
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.databaseAuthority, "owner");
      assert.equal(receipt.transaction, "read-only");
      assert.ok(!result.stdout.includes(password));
    }
    assert.equal(calls().length, 3);
    for (const call of calls()) {
      assert.deepEqual(call.argv, [
        "-X",
        "-q",
        "-t",
        "-A",
        "-v",
        "ON_ERROR_STOP=1",
      ]);
      assert.ok(!call.argv.join(" ").includes(password));
      assert.equal(
        call.options,
        "-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=120000 -c lock_timeout=5000",
      );
      assert.deepEqual(call.keys, [
        "LANG",
        "PATH",
        "PGCONNECT_TIMEOUT",
        "PGDATABASE",
        "PGHOST",
        "PGOPTIONS",
        "PGPASSWORD",
        "PGPORT",
        "PGSSLMODE",
        "PGUSER",
      ]);
      assert.equal(call.sslmode, "require");
      for (const key of [
        "explicitReadOnly",
        "safeSearchPath",
        "boundedStatement",
        "boundedLock",
        "ending",
        "callerSqlAbsent",
      ])
        assert.equal(call[key], true, key);
    }
    assert.equal(calls()[1].readOnlyCheck, true);
    assert.equal(calls()[2].readOnlyCheck, true);
  });
});

test("binding-only mode proves no connectivity and refuses arbitrary modes or extra SQL arguments", () => {
  withTransport("success", (invoke, calls) => {
    const result = invoke("credentials");
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.binding, "validated");
    assert.equal(receipt.transaction, undefined);
    for (const mode of ["sql", "bootstrap", "write", "resume"])
      assert.notEqual(invoke(mode).status, 0);
    assert.notEqual(
      invoke("before", {}, [
        "COMMIT; CREATE TABLE ARBITRARY_CALLER_SQL(id int);",
      ]).status,
      0,
    );
    assert.equal(calls().length, 0);
  });
});

test("target mode accepts only the entire reviewed ledger and honors the preferred connection", () => {
  withTransport("target-success", (invoke, calls) => {
    const result = invoke("target", {
      PRODUCTION_READONLY_URL: connection("fictional_reader"),
    });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.mode, "target");
    assert.equal(receipt.migrations, expectedVersions(cwd).length);
    assert.equal(receipt.connectionSource, "production-readonly-url");
    assert.equal(receipt.databaseAuthority, "configured-role-unverified");
    assert.equal(calls().length, 2);
    assert.ok(calls().every((call) => call.username === "fictional_reader"));
  });
  withTransport("success", (invoke, calls) => {
    assert.notEqual(invoke("target").status, 0);
    assert.equal(calls().length, 1);
  });
});

test("bad and missing bindings fail before psql, including an invalid preferred URL with a valid fallback", () => {
  withTransport("success", (invoke, calls) => {
    for (const extra of [
      { PRODUCTION_BOOTSTRAP_DATABASE_URL: "" },
      { PRODUCTION_READONLY_URL: " " },
      { EXPECTED_SUPABASE_PROJECT_REF: "other" },
      {
        PRODUCTION_BOOTSTRAP_DATABASE_URL: connection().replace(
          productionRef,
          "aaaaaaaaaaaaaaaaaaaa",
        ),
      },
      {
        PRODUCTION_BOOTSTRAP_DATABASE_URL: connection().replace(
          "require",
          "disable",
        ),
      },
      {
        PRODUCTION_BOOTSTRAP_DATABASE_URL: `${connection()}&options=-c%20role%3Dother`,
      },
      { PRODUCTION_BOOTSTRAP_DATABASE_URL: connection("fictional_reader") },
      { PRODUCTION_BOOTSTRAP_DATABASE_URL: connection("postgres", true) },
      {
        PRODUCTION_BOOTSTRAP_DATABASE_URL: connection().replace(
          password,
          "%00",
        ),
      },
      {
        PRODUCTION_BOOTSTRAP_DATABASE_URL: connection().replace(
          password,
          "%ZZ",
        ),
      },
    ]) {
      const result = invoke("quiescence", extra);
      assert.notEqual(result.status, 0);
      assert.ok(!result.stderr.includes(password));
      assert.equal(result.stdout, "");
    }
    assert.equal(calls().length, 0);
  });
});

test("raw psql failures and unexpected receipts are suppressed and remain fatal", () => {
  for (const behavior of ["private-error", "bad-receipt"])
    withTransport(behavior, (invoke) => {
      for (const mode of ["before", "quiescence"]) {
        const result = invoke(mode);
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, "");
        for (const value of [
          password,
          "FICTIONAL PRIVATE ROW",
          "PRIVATE_ROW_NOT_A_RECEIPT",
        ])
          assert.ok(!result.stderr.includes(value));
      }
    });
});

test("every protected schema preflight binding supplies the fallback and keeps credentials out of shell argv", () => {
  const workflow = readFileSync(
    join(cwd, ".github/workflows/deploy-schema.yml"),
    "utf8",
  );
  for (const name of [
    "Require Production recovery credentials",
    "Run read-only Production cutover preflight",
    "Verify Production quiescence receipt and database posture",
    "Recheck Production maintenance preflight before schema push",
    "Run full post-push Production cutover preflight",
  ]) {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.ok(start >= 0, name);
    const next = workflow.indexOf("\n      - ", start + 1);
    const step = workflow.slice(start, next < 0 ? undefined : next);
    for (const binding of [
      "EXPECTED_SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_ID }}",
      "PRODUCTION_READONLY_URL: ${{ secrets.PRODUCTION_READONLY_URL }}",
      "PRODUCTION_BOOTSTRAP_DATABASE_URL: ${{ secrets.PRODUCTION_BOOTSTRAP_DATABASE_URL }}",
    ])
      assert.ok(step.includes(binding), `${name}: ${binding}`);
    assert.ok(
      step.includes("node scripts/production/maintenance-preflight.mjs "),
    );
    assert.ok(!step.includes("psql"));
    assert.ok(!step.includes("GITHUB_ENV"));
  }
  assert.ok(
    workflow.includes(
      'expected_capture_receipt="recovery-capture-verified:${GITHUB_SHA}:${RECOVERY_CAPTURE_SHA256}"',
    ),
  );
  assert.ok(
    workflow.includes(
      'expected_writer_receipt="external-writers-stopped:${GITHUB_SHA}"',
    ),
  );
  assert.ok(
    workflow.includes(
      'expected_write_block_receipt="application-writes-blocked:${GITHUB_SHA}"',
    ),
  );
});
