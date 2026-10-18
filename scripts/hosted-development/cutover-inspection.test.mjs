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
  assert.deepEqual(f.state.writes, []);
  for (const phase of ["complete", "recover"])
    assert.throws(() =>
      validateReceipt(result, { ...f.config, phase, prepareRun: f.config.run }),
    );
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
