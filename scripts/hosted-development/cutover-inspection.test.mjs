import assert from "node:assert/strict";
import test from "node:test";
import { cutoverConfig, validateReceipt } from "./cutover-authority.mjs";
import { controllerFixture, environment } from "./cutover.fixture.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";

test("inspection retains protected candidate authority without a writer attestation", () => {
  assert.equal(cutoverConfig(environment("inspect")).phase, "inspect");
  assert.throws(() =>
    cutoverConfig({
      ...environment("inspect"),
      EXTERNAL_WRITERS_CONFIRMATION: "claimed-hold",
    }),
  );
  assert.throws(() =>
    cutoverConfig({ ...environment("inspect"), CUTOVER_PREPARE_RUN_ID: "100" }),
  );
});

test("inspection reads the actual project and database with active jobs and no mutations", async () => {
  const f = controllerFixture("inspect");
  const result = await runDevelopmentCutover(f.config, {
    ...f.dependencies,
    vercel: (path, body, method) => {
      assert.equal(body, undefined);
      assert.equal(method, undefined);
      return f.vercel(path);
    },
    query: (url, sql) => {
      const connection = new URL(url);
      assert.equal(connection.hostname, "aws-0-us-west-1.pooler.supabase.com");
      assert.equal(connection.port, "5432");
      assert.equal(connection.username, "postgres.ocbuygudvarsuxijxhau");
      assert.equal(connection.password, "test-password");
      assert.match(
        sql,
        /^BEGIN(?: ISOLATION LEVEL REPEATABLE READ)? READ ONLY;/u,
      );
      return f.query(url, sql);
    },
    fetcher: (url, settings) => {
      assert.equal(settings.method, "GET");
      return f.fetcher(url, settings);
    },
  });
  assert.equal(result.phase, "inspected");
  assert.equal(result.readOnly, true);
  assert.equal(result.maintenanceReady, false);
  assert.equal(result.externalWriters, "not-attested");
  assert.equal(result.schema.posture.activeCron, 4);
  assert.equal(result.schema.databaseQuiescent, false);
  assert.equal(result.applicationWorkerPosture.controlMode, "database");
  assert.equal(result.applicationWorkerPosture.version, result.base);
  assert.equal(
    result.applicationWorkerPosture.workers.csfCommunications,
    false,
  );
  assert.deepEqual(f.state.writes, []);
  assert.doesNotMatch(
    JSON.stringify([result, f.state.records]),
    /test-password|postgres:\/\//u,
  );
  for (const phase of ["complete", "recover"])
    assert.throws(() =>
      validateReceipt(result, { ...f.config, phase, prepareRun: f.config.run }),
    );
});

test("inspection reports effective enabled/environment controls without claiming a hold or retaining arbitrary fields", async () => {
  const f = controllerFixture("inspect");
  const result = await runDevelopmentCutover(f.config, {
    ...f.dependencies,
    fetcher: async (url, settings) => {
      assert.equal(settings.method, "GET");
      const response = await f.fetcher(url, settings);
      if (!String(url).endsWith("/api/status?deep=0")) return response;
      assert.equal(
        settings.headers["x-vercel-protection-bypass"],
        f.config.bypass,
      );
      const body = await response.json();
      body.checks[0].details.csfControlMode = "environment";
      body.checks[0].details.organizationCalendarSync = true;
      body.checks[0].details.untrustedExtra = "fictional-secret-field";
      return Response.json(body);
    },
  });
  assert.equal(result.applicationWorkerPosture.controlMode, "environment");
  assert.equal(
    result.applicationWorkerPosture.workers.organizationCalendarSync,
    true,
  );
  assert.equal(Object.keys(result.applicationWorkerPosture.workers).length, 11);
  assert.equal(result.maintenanceReady, false);
  assert.equal(result.externalWriters, "not-attested");
  assert.doesNotMatch(
    JSON.stringify(f.state.records),
    /fictional-secret-field/u,
  );
  assert.deepEqual(f.state.writes, []);
});

for (const fault of [
  "wrong-source",
  "missing-flag",
  "untyped-flag",
  "redirect",
])
  test(`inspection refuses ${fault} rather than inventing effective worker posture`, async () => {
    const f = controllerFixture("inspect");
    await assert.rejects(
      runDevelopmentCutover(f.config, {
        ...f.dependencies,
        fetcher: async (url, settings) => {
          const response = await f.fetcher(url, settings);
          if (!String(url).endsWith("/api/status?deep=0")) return response;
          if (fault === "redirect") return new Response(null, { status: 302 });
          const body = await response.json();
          if (fault === "wrong-source") body.version = "f".repeat(40);
          if (fault === "missing-flag")
            delete body.checks[0].details.csfCommunications;
          if (fault === "untyped-flag")
            body.checks[0].details.csfCommunications = "false";
          return Response.json(body);
        },
      }),
      /worker status is unverified/u,
    );
    assert.equal(f.state.records.at(-1).phase, "inspection-stopped");
    assert.equal(f.state.records.at(-1).applicationWorkerPosture, undefined);
    assert.deepEqual(f.state.writes, []);
  });

test("failed inspection retains only sanitized diagnostic evidence", async () => {
  const f = controllerFixture("inspect");
  await assert.rejects(
    runDevelopmentCutover(f.config, {
      ...f.dependencies,
      vercel: async () => {
        throw new Error("fictional-provider-credential");
      },
    }),
  );
  const record = f.state.records.at(-1);
  assert.equal(record.phase, "inspection-stopped");
  assert.equal(record.readOnly, true);
  assert.doesNotMatch(JSON.stringify(record), /fictional-provider-credential/u);
  assert.deepEqual(f.state.writes, []);
});

test("inspection still refuses a missing required environment review", async () => {
  const f = controllerFixture("inspect");
  f.state.apiChanges.set("/actions/runs/100/approvals", () => []);
  await assert.rejects(
    runDevelopmentCutover(f.config, f.dependencies),
    /approved Development environment review/u,
  );
  assert.deepEqual(f.state.writes, []);
});

for (const key of ["inspectionLedger", "inspectionCatalog"])
  test(`inspection refuses changed ${key} inside the catalog snapshot`, async () => {
    const f = controllerFixture("inspect");
    await assert.rejects(
      runDevelopmentCutover(f.config, {
        ...f.dependencies,
        query: (url, sql) => {
          const value = f.query(url, sql);
          return sql.includes("'inspectionCatalog'")
            ? JSON.stringify({ ...JSON.parse(value), [key]: false })
            : value;
        },
      }),
      /accepted catalog/u,
    );
    assert.deepEqual(f.state.writes, []);
  });
