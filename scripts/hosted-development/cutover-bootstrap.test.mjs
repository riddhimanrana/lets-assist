import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { maintenanceTarget } from "../production/maintenance-preflight.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import { bootstrapPlan } from "./cutover-bootstrap.mjs";
import { controllerFixture } from "./cutover.fixture.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";

function bootstrapFixture(t) {
  const fixture = controllerFixture("bootstrap");
  const directory = mkdtempSync(resolve(tmpdir(), "development-bootstrap-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const migrations = resolve(directory, "supabase/migrations");
  mkdirSync(migrations, { recursive: true });
  for (const name of readdirSync("supabase/migrations")
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
    .sort()
    .slice(0, 688))
    copyFileSync(
      resolve("supabase/migrations", name),
      resolve(migrations, name),
    );
  writeFileSync(
    resolve(migrations, "20990101000000_unapproved_future.sql"),
    "SELECT 'never-apply-future';\n",
  );
  fixture.config = { ...fixture.config, cwd: directory };
  return fixture;
}

test("bootstrap installs only its accepted prefix despite an unapproved future suffix", async (t) => {
  const f = bootstrapFixture(t);
  assert.throws(() => maintenanceTarget(f.config.cwd));
  const result = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(result.phase, "bootstrapped");
  assert.equal(result.schema.count, 688);
  assert.equal(
    result.targetDigest,
    ledgerDigest(bootstrapPlan(f.config.cwd).after),
  );
  assert.equal(result.schema.changed, true);
  assert.equal(f.state.blocked, false);
  assert.equal(f.state.writes.length, 2);
  assert.equal(f.state.writes[0].kind, "cron-pause");
  assert.equal(f.state.writes[1].kind, "bootstrap");
  assert.doesNotMatch(
    f.state.writes[1].sql,
    /never-apply-future|20990101000000/u,
  );
});

test("already installed bootstrap still proves the legacy barrier and read availability", async (t) => {
  const f = bootstrapFixture(t);
  f.state.bootstrapped = true;
  const observed = [];
  const result = await runDevelopmentCutover(f.config, {
    ...f.dependencies,
    query: (url, sql) => {
      observed.push(sql);
      return f.query(url, sql);
    },
  });
  assert.equal(result.schema.changed, false);
  assert.deepEqual(
    f.state.writes.map((entry) => entry.kind),
    ["cron-pause"],
  );
  assert.ok(
    observed.some((sql) =>
      sql.includes("development-bootstrap-transactions-settled"),
    ),
  );
});

for (const alreadyApplied of [false, true])
  test(`bootstrap barrier failure stays unproven after ${alreadyApplied ? "earlier" : "current"} installation`, async (t) => {
    const f = bootstrapFixture(t);
    f.state.bootstrapped = alreadyApplied;
    let httpCalls = 0;
    await assert.rejects(
      runDevelopmentCutover(f.config, {
        ...f.dependencies,
        query: (url, sql) =>
          sql.includes("development-bootstrap-transactions-settled")
            ? "unproven"
            : f.query(url, sql),
        fetcher: async (...args) => {
          httpCalls += 1;
          return f.fetcher(...args);
        },
      }),
      /legacy request barrier/u,
    );
    assert.equal(f.state.records.at(-1).phase, "bootstrap-unproven");
    assert.equal(httpCalls, 0);
    assert.ok(
      f.state.writes.every((entry) =>
        ["cron-pause", "bootstrap"].includes(entry.kind),
      ),
    );
    assert.equal(f.state.writes.length, alreadyApplied ? 1 : 2);
  });

test("unknown bootstrap response never retries mutation or claims readiness", async (t) => {
  const f = bootstrapFixture(t);
  await assert.rejects(
    runDevelopmentCutover(f.config, {
      ...f.dependencies,
      query: (url, sql) => {
        const result = f.query(url, sql);
        if (sql.includes("request-fence-bootstrap-applied"))
          throw new Error("Unknown local result");
        return result;
      },
    }),
    /Unknown local result/u,
  );
  assert.equal(f.state.writes.length, 2);
  assert.equal(f.state.records.at(-1).phase, "bootstrap-unproven");
  assert.equal(f.state.blocked, false);
});

test("bootstrap refuses a changed candidate before any SQL or provider mutation", async (t) => {
  const f = bootstrapFixture(t);
  f.state.apiChanges.set("/pulls/867", (pr) => ({
    ...pr,
    head: { ...pr.head, sha: "e".repeat(40) },
  }));
  await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
  assert.deepEqual(f.state.writes, []);
});

test("unknown cron pause result stops before installing the request fence", async (t) => {
  const f = bootstrapFixture(t);
  await assert.rejects(
    runDevelopmentCutover(f.config, {
      ...f.dependencies,
      query: (url, sql) => {
        const result = f.query(url, sql);
        return sql.includes("SELECT 'development-bootstrap-cron-paused'")
          ? "unproven"
          : result;
      },
    }),
    /cron shutdown is unproven/u,
  );
  assert.deepEqual(
    f.state.writes.map((entry) => entry.kind),
    ["cron-pause"],
  );
  assert.equal(f.state.bootstrapped, false);
  assert.equal(f.state.records.at(-1).phase, "bootstrap-unproven");
});

test("cron pause refuses a different ledger before any mutation", async (t) => {
  const f = bootstrapFixture(t);
  await assert.rejects(
    runDevelopmentCutover(f.config, {
      ...f.dependencies,
      query: (url, sql) =>
        sql.includes("json_agg(version::text")
          ? JSON.stringify(["20260929051500"])
          : f.query(url, sql),
    }),
    /exact bootstrap baseline/u,
  );
  assert.deepEqual(f.state.writes, []);
});
