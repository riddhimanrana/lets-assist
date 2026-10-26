import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  executeLinkedBootstrapQuery,
  linkedBootstrapConnection,
  prepareLinkedBootstrapConnection,
} from "./linked-bootstrap-transport.mjs";
import { productionRef } from "./app-release-checks.mjs";
import { maintenanceLedgerQuery } from "./maintenance-preflight.mjs";
import {
  bootstrapMutationSql,
  bootstrapPlan,
} from "./request-fence-bootstrap-plan.mjs";

const host = "aws-0-synthetic-region.pooler.supabase.com";
const primary = (overrides = {}) => ({
  database_type: "PRIMARY",
  db_host: host,
  db_user: `postgres.${productionRef}`,
  db_name: "postgres",
  db_port: 6543,
  pool_mode: "transaction",
  ...overrides,
});
const config = {
  accessToken: "synthetic-access-token",
  databasePassword: "synthetic-password:$@ /?%",
};
const connection = () => linkedBootstrapConnection([primary()]);

test("only fixed-project owner PRIMARY metadata is accepted; native session routing never reads a connection string", () => {
  const row = primary();
  Object.defineProperty(row, "connection_string", {
    get() {
      throw new Error("connection strings must not be read");
    },
  });
  assert.deepEqual(linkedBootstrapConnection([row]), {
    host,
    port: "5432",
    user: `postgres.${productionRef}`,
    database: "postgres",
    sslmode: "require",
  });
  assert.deepEqual(
    linkedBootstrapConnection([
      primary({ db_port: 5432, pool_mode: "session" }),
    ]),
    connection(),
  );
  assert.deepEqual(
    linkedBootstrapConnection([{ database_type: "REPLICA" }, row]),
    connection(),
  );
  for (const payload of [
    null,
    {},
    [],
    [row, row],
    [primary({ database_type: "REPLICA" })],
    ...[
      { db_user: "postgres.differentprojectrefab" },
      { db_user: `reader.${productionRef}` },
      { db_host: "evil.invalid" },
      { db_host: `${host}.evil.invalid` },
      { db_host: "db.fotdmeakexgrkronxlof.supabase.co" },
      { db_name: "other" },
      { db_port: "6543" },
      { db_port: 5432, pool_mode: "transaction" },
      { db_port: 6543, pool_mode: "session" },
      { pool_mode: "unknown" },
    ].map((overrides) => [primary(overrides)]),
  ]) {
    assert.throws(() => linkedBootstrapConnection(payload));
  }
});

test("routing uses one fixed official GET with the existing token, no credentials in the URL or response output", async () => {
  let calls = 0;
  const result = await prepareLinkedBootstrapConnection(
    config,
    async (url, options) => {
      calls++;
      assert.equal(
        url,
        `https://api.supabase.com/v1/projects/${productionRef}/config/database/pooler`,
      );
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.equal(
        options.headers.Authorization,
        `Bearer ${config.accessToken}`,
      );
      assert.ok(options.signal instanceof AbortSignal);
      assert.doesNotMatch(url, /synthetic-access-token|synthetic-password/u);
      return { status: 200, json: async () => [primary()] };
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, connection());
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-access-token|synthetic-password|connection_string/u,
  );
});

test("missing credentials and failed, redirected or malformed metadata stop without retry or fallback", async () => {
  for (const credentials of [
    { accessToken: "" },
    { databasePassword: "" },
    { databasePassword: "bad\nvalue" },
    { databasePassword: "bad\0value" },
  ]) {
    let calls = 0;
    await assert.rejects(
      prepareLinkedBootstrapConnection(
        { ...config, ...credentials },
        async () => {
          calls++;
        },
      ),
    );
    assert.equal(calls, 0);
  }
  for (const reply of [
    async () => {
      throw new Error("synthetic-access-token raw-provider-output");
    },
    ...[301, 401, 403, 429, 500].map((status) => async () => ({
      status,
      json: async () => {
        throw new Error("must not read rejected body");
      },
    })),
    async () => ({
      status: 200,
      json: async () => {
        throw new Error("synthetic-password raw-provider-output");
      },
    }),
    async () => ({ status: 200, json: async () => [] }),
    async () => ({
      status: 200,
      json: async () => ({ connection_string: "postgresql://hidden-password" }),
    }),
  ]) {
    let calls = 0;
    await assert.rejects(
      prepareLinkedBootstrapConnection(config, async (...args) => {
        calls++;
        return reply(...args);
      }),
      (error) =>
        !/synthetic-access-token|synthetic-password|raw-provider-output|postgresql/u.test(
          error.message,
        ),
    );
    assert.equal(calls, 1);
  }
});

test("psql receives the exact unchanged multi-statement SQL over stdin and only the restricted PG environment", () => {
  const plan = bootstrapPlan(resolve(import.meta.dirname, "../.."));
  for (const sql of [maintenanceLedgerQuery, bootstrapMutationSql(plan)]) {
    let calls = 0;
    const output = executeLinkedBootstrapQuery(
      connection(),
      sql,
      config.databasePassword,
      (command, args, options) => {
        calls++;
        assert.equal(command, "psql");
        assert.deepEqual(args, [
          "-X",
          "-q",
          "-t",
          "-A",
          "-v",
          "ON_ERROR_STOP=1",
        ]);
        assert.equal(options.input, sql);
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
        assert.equal(options.env.PGPASSWORD, config.databasePassword);
        assert.equal(options.env.PGHOST, host);
        assert.equal(options.env.PGPORT, "5432");
        assert.equal(options.env.PGUSER, `postgres.${productionRef}`);
        assert.equal(options.env.PGSSLMODE, "require");
        assert.equal(options.env.PGDATABASE, "postgres");
        assert.equal(options.env.PGCONNECT_TIMEOUT, "15");
        assert.equal(options.timeout, 150_000);
        assert.equal(options.maxBuffer, 1024 * 1024);
        assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
        assert.doesNotMatch(
          JSON.stringify(args),
          /synthetic-password|postgresql/u,
        );
        return "verified\n";
      },
    );
    assert.equal(output, "verified");
    assert.equal(calls, 1);
  }
});

test("bad psql bindings and failures never select another route, retry or expose credential/error output", () => {
  let calls = 0;
  for (const override of [
    { host: "evil.invalid" },
    { port: "6543" },
    { user: "reader" },
    { database: "other" },
    { sslmode: "disable" },
  ]) {
    assert.throws(() =>
      executeLinkedBootstrapQuery(
        { ...connection(), ...override },
        "SELECT 1;",
        config.databasePassword,
        () => {
          calls++;
        },
      ),
    );
  }
  assert.equal(calls, 0);
  assert.throws(
    () =>
      executeLinkedBootstrapQuery(
        connection(),
        "SELECT 1;",
        config.databasePassword,
        () => {
          calls++;
          throw new Error("postgresql://hidden-password raw-provider-output");
        },
      ),
    (error) =>
      !/hidden-password|raw-provider-output|postgresql/u.test(error.message),
  );
  assert.equal(calls, 1);
});

test("legacy configuration contributes only its TLS policy, never routing or credentials", async () => {
  const { productionTransportConfig } =
    await import("./linked-bootstrap-transport.mjs");
  for (const sslmode of ["require", "verify-ca", "verify-full"]) {
    const legacy = new URL("postgresql://ignored.invalid/ignored");
    legacy.username = "ignored";
    legacy.password = config.databasePassword;
    legacy.searchParams.set("sslmode", sslmode);
    const cfg = productionTransportConfig({
      SUPABASE_ACCESS_TOKEN: config.accessToken,
      SUPABASE_DB_PASSWORD: config.databasePassword,
      PRODUCTION_BOOTSTRAP_DATABASE_URL: legacy.href,
    });
    const linked = await prepareLinkedBootstrapConnection(cfg, async () => ({
      status: 200,
      json: async () => [primary()],
    }));
    assert.equal(linked.host, host);
    assert.equal(linked.sslmode, sslmode);
    executeLinkedBootstrapQuery(
      linked,
      "fixed-sql",
      cfg.databasePassword,
      (_cmd, _args, options) => {
        assert.equal(options.env.PGSSLMODE, sslmode);
        assert.equal(options.env.PGPASSWORD, config.databasePassword);
        return "verified";
      },
    );
  }
  for (const legacy of [
    "invalid",
    "postgresql://ignored/db?sslmode=disable",
    "postgresql://ignored/db?sslmode=verify-full&sslmode=require",
    "postgresql://ignored/db?sslmode=",
  ]) {
    assert.throws(() =>
      productionTransportConfig({
        SUPABASE_ACCESS_TOKEN: config.accessToken,
        SUPABASE_DB_PASSWORD: config.databasePassword,
        PRODUCTION_BOOTSTRAP_DATABASE_URL: legacy,
      }),
    );
  }
});

test("shared maintenance fallback enforces the existing read-only session policy and timeout", async () => {
  const {
    executeMaintenanceQuery,
    executeReadOnlyQuery,
    productionMaintenanceConfig,
    resolveMaintenanceConnection,
    verifyMaintenanceQuiescence,
  } = await import("./maintenance-preflight.mjs");
  const cfg = await resolveMaintenanceConnection(
    productionMaintenanceConfig({
      EXPECTED_SUPABASE_PROJECT_REF: productionRef,
      SUPABASE_ACCESS_TOKEN: config.accessToken,
      SUPABASE_DB_PASSWORD: config.databasePassword,
    }),
    async () => ({ status: 200, json: async () => [primary()] }),
  );
  executeReadOnlyQuery(
    cfg.databaseUrl,
    maintenanceLedgerQuery,
    (_cmd, _args, options) => {
      assert.equal(options.timeout, 150_000);
      assert.equal(
        options.env.PGOPTIONS,
        "-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=120000 -c lock_timeout=5000",
      );
      return "verified";
    },
  );
  verifyMaintenanceQuiescence(cfg, (connection, sql) =>
    executeReadOnlyQuery(connection, sql, (_cmd, _args, options) => {
      assert.equal(options.timeout, 30_000);
      assert.ok(
        options.env.PGOPTIONS.includes("default_transaction_read_only=on"),
      );
      return [
        "PASS Q1: no active pg_cron schedules.",
        "PASS Q2: no pg_cron execution is still running.",
        "PASS Q3: the PostgREST maintenance flag is configured. Hook and fresh API verification are separate requirements.",
      ].join("\n");
    }),
  );
  executeMaintenanceQuery(
    cfg.databaseUrl,
    "fixed-sql",
    (_cmd, _args, options) => {
      assert.equal(options.env.PGHOST, host);
      assert.equal(options.env.PGPASSWORD, config.databasePassword);
      assert.equal(options.env.PGOPTIONS, undefined);
      return "verified";
    },
  );
  assert.throws(() => verifyMaintenanceQuiescence(cfg, () => "wrong-receipt"));
});
