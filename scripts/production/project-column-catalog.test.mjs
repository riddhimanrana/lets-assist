import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { finalSchemaCatalog, ledgerDigest } from "./final-schema-manifest.mjs";
import {
  applyForwardMigrations,
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import {
  prohibitedDataWrites,
  unreviewedDataWrites,
} from "./migration-data-writes.mjs";

const fixture = historicalReleaseTestFixture();
after(fixture.dispose);
const reviewed = expectedVersions(fixture.cwd).slice(0, 702);
const load = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const before = load("./final-schema-701.json");
const manifest = load("./final-schema-702.json");
const name = "20261007230000_project_client_read_columns";
const filename = `${name}.sql`;
const path = resolve(fixture.cwd, "supabase/migrations", filename);
const sql = readFileSync(path, "utf8");
const catalog = (value, versions) =>
  accountDeletionStorageCatalog(
    csfSubmissionDeletionCatalog(finalSchemaCatalog(value, versions)),
  );

test("project column release accepts its exact ledger and preserves accepted 701 and 700", () => {
  assert.equal(reviewed.length, 702);
  assert.equal(reviewed.at(-1), "20261007230000");
  assert.equal(
    ledgerDigest(reviewed),
    "5d7153b2a0a6b7eb11b4f0656df6c4552c4e781b19b3334cb13ca463b0e1d9f3",
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", reviewed),
    catalog(manifest, reviewed),
  );
  for (const count of [700, 701])
    assert.equal(
      acceptedCatalogQuery("invalid predecessor", reviewed.slice(0, count)),
      catalog(load(`./final-schema-${count}.json`), reviewed.slice(0, count)),
    );
  for (const changed of [
    [...reviewed, "20990101000000"],
    [...reviewed.slice(0, -1), "20990101000000"],
    [...reviewed.slice(0, -2), ...reviewed.slice(-2).reverse()],
  ])
    assert.throws(
      () => acceptedCatalogQuery("", changed),
      /explicit release review/u,
    );
});

test("project column release changes only the reviewed relation and grant-catalog fingerprints", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  const current = new Map(
    manifest.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(manifest.objects.length, 1351);
  assert.deepEqual([...current.keys()], [...previous.keys()]);
  assert.deepEqual(
    [...current.keys()].filter(
      (identity) => current.get(identity) !== previous.get(identity),
    ),
    [
      "function:app_private.client_relation_grant_catalog()",
      "relation:public.projects",
      "relation:public.projects_with_creator",
    ],
  );
});

test("forward controller pins project column SQL and refuses changed bytes", () => {
  const digest = createHash("sha256").update(sql).digest("hex");
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, digest],
  );
  assert.equal(migrationDigests[filename], digest);
  assert.deepEqual(prohibitedDataWrites(sql), []);
  assert.deepEqual(unreviewedDataWrites(sql), []);
  const pending = prepareMigration(
    fixture.cwd,
    readFileSync,
    reviewed.slice(0, 701),
  );
  const complete = prepareMigration(fixture.cwd, readFileSync, reviewed);
  const write = "'20261007230000','project_client_read_columns'";
  assert.ok(pending.query.includes(write));
  assert.ok(!complete.query.includes(write));
  assert.equal(pending.query.split(write).length - 1, 1);
  assert.throws(
    () =>
      prepareMigration(
        fixture.cwd,
        (candidate) =>
          readFileSync(candidate, "utf8") + (candidate === path ? "\n" : ""),
        reviewed.slice(0, 701),
      ),
    /Approved migration bytes changed/u,
  );
});

test("an unreviewed migration after 702 refuses before provider calls", async () => {
  const future = historicalReleaseTestFixture();
  try {
    writeFileSync(
      resolve(future.cwd, "supabase/migrations/20990101000000_unreviewed.sql"),
      "SELECT 1;\n",
    );
    let requests = 0;
    await assert.rejects(
      () =>
        applyForwardMigrations(
          {
            cwd: future.cwd,
            projectRef: "fotdmeakexgrkronxlof",
            token: "synthetic-token",
          },
          async () => {
            requests += 1;
            throw new Error("Unexpected provider access");
          },
        ),
      /migration tail is not approved/u,
    );
    assert.equal(requests, 0);
  } finally {
    future.dispose();
  }
});
