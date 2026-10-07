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
const reviewed = expectedVersions(fixture.cwd).slice(0, 700);
const load = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const before = load("./final-schema-699.json");
const manifest = load("./final-schema-700.json");
const name = "20261007210000_service_only_google_oauth_credentials";
const filename = `${name}.sql`;
const path = resolve(fixture.cwd, "supabase/migrations", filename);
const sql = readFileSync(path, "utf8");
const catalog = (value, versions) =>
  accountDeletionStorageCatalog(
    csfSubmissionDeletionCatalog(finalSchemaCatalog(value, versions)),
  );

test("credential release accepts its exact ledger and preserves accepted 699", () => {
  assert.equal(reviewed.length, 700);
  assert.equal(reviewed.at(-1), "20261007210000");
  assert.equal(
    ledgerDigest(reviewed),
    "6f1bb9f49dbf47df4b2ea156d742db007193a9f6def073034084e0f6058fb01d",
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", reviewed),
    catalog(manifest, reviewed),
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", reviewed.slice(0, 699)),
    catalog(before, reviewed.slice(0, 699)),
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

test("credential release changes only the reviewed relation ACL and client grant catalog", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(manifest.objects.length, 1350);
  assert.deepEqual(
    manifest.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    manifest.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:app_private.client_relation_grant_catalog()",
      "relation:public.user_calendar_connections",
    ],
  );
});

test("forward controller pins credential SQL, emits it once and refuses modified bytes", () => {
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
    reviewed.slice(0, 699),
  );
  const complete = prepareMigration(fixture.cwd, readFileSync, reviewed);
  const write = "'20261007210000','service_only_google_oauth_credentials'";
  assert.ok(pending.query.includes(write));
  assert.ok(!complete.query.includes(write));
  assert.equal(pending.query.split(write).length - 1, 1);
  assert.throws(
    () =>
      prepareMigration(
        fixture.cwd,
        (candidate) =>
          readFileSync(candidate, "utf8") + (candidate === path ? "\n" : ""),
        reviewed.slice(0, 699),
      ),
    /Approved migration bytes changed/u,
  );
});

test("a migration beyond reviewed credential access refuses before provider calls", async () => {
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
