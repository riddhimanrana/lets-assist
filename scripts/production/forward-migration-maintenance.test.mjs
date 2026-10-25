import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  applyForwardMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import { historicalOnlineReleaseTestFixture } from "./forward-migration-online-fixture.mjs";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";

const fixture = historicalReleaseTestFixture();
after(fixture.dispose);
const config = {
  cwd: fixture.cwd,
  projectRef: "fotdmeakexgrkronxlof",
  token: "synthetic-test-token",
};
const target = prepareMigration(fixture.cwd).versions;
const rows = (versions) => versions.map((version) => ({ version }));

function transport(ledger, { fail = false, badCatalog = false } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      const readOnly =
        url.endsWith("/read-only") ||
        body.read_only ||
        body.query.startsWith("BEGIN READ ONLY;\n");
      calls.push({ readOnly, query: body.query });
      if (fail) throw new Error("Synthetic ledger read failure");
      const value = body.query.startsWith("SELECT version::text")
        ? ledger
        : body.query.includes("csf_target_schema_verified")
          ? [{ csf_target_schema_verified: badCatalog ? 0 : 1 }]
          : [{ valid: true }];
      return { ok: true, json: async () => value };
    },
  };
}

for (const [count, label] of [
  [687, "mixed audit tail"],
  [699, "credential and project contracts"],
  [700, "project contract after credentials"],
  [701, "project contract alone"],
]) {
  test(`online controller refuses ${label} before any mutation`, async () => {
    const t = transport(rows(target.slice(0, count)));
    await assert.rejects(
      applyForwardMigrations(config, t.fetch),
      /maintenance cutover/u,
    );
    assert.equal(t.calls.length, 1);
    assert.ok(t.calls.every((call) => call.readOnly));
  });
}

test("already applied contracts still reconcile without mutation", async () => {
  const t = transport(rows(target));
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, []);
  assert.equal(result.catalog, "verified");
  assert.equal(result.workers, "disabled");
  assert.ok(
    t.calls.some((call) => call.query.includes("csf_target_schema_verified")),
  );
  assert.ok(t.calls.every((call) => call.readOnly));
});

test("already applied contracts cannot hide catalog drift", async () => {
  const t = transport(rows(target), { badCatalog: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.ok(t.calls.every((call) => call.readOnly));
});

test("unavailable or malformed applied ledgers never permit a mutation", async () => {
  for (const [ledger, fail] of [
    [null, false],
    [[{}], false],
    [rows([...target, "20990101000000"]), false],
    [rows(target), true],
  ]) {
    const t = transport(ledger, { fail });
    await assert.rejects(applyForwardMigrations(config, t.fetch));
    assert.equal(t.calls.length, 1);
    assert.ok(t.calls.every((call) => call.readOnly));
  }
});

test("credential contraction alone requires maintenance even before the project-column release", async () => {
  const prior = await historicalOnlineReleaseTestFixture("20261007220000");
  try {
    const t = transport(rows(target.slice(0, 699)));
    await assert.rejects(
      prior.controller.applyForwardMigrations(
        { ...config, cwd: prior.cwd },
        t.fetch,
      ),
      /maintenance cutover/u,
    );
    assert.equal(t.calls.length, 1);
    assert.ok(t.calls.every((call) => call.readOnly));
  } finally {
    prior.dispose();
  }
});
