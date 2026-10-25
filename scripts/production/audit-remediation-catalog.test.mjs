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
const versions = expectedVersions(fixture.cwd);
const reviewed = versions.slice(0, 699);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-687.json"));
const manifest = JSON.parse(read("./final-schema-699.json"));
const tail = [
  "20261007034144_preserve_reference_scope_on_deletion",
  "20261007035204_bounded_project_occupancy",
  "20261007040314_durable_account_deletion",
  "20261007043000_organization_suppression_cascade",
  "20261007044000_project_schedule_health",
  "20261007045000_csf_sheet_scope_observation",
  "20261007050000_personal_calendar_sync_receipts",
  "20261007050200_organization_calendar_destination",
  "20261007050600_account_export_snapshot",
  "20261007051000_worker_run_health_receipts",
  "20261007052000_csf_decision_receipt_run_index",
  "20261007200000_dv_atomic_membership_application",
];

test("the reviewed audit schema accepts only its exact consolidated ledger", () => {
  assert.equal(reviewed.length, 699);
  assert.deepEqual(
    reviewed.slice(687),
    tail.map((name) => name.slice(0, 14)),
  );
  assert.equal(
    ledgerDigest(reviewed),
    "17f54215ffef892ef1c38eae12e19298e2595e6af813a3ada1cf684e056fc57c",
  );
  assert.equal(manifest.objects.length, 1350);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", reviewed),
    accountDeletionStorageCatalog(
      csfSubmissionDeletionCatalog(finalSchemaCatalog(manifest, reviewed)),
    ),
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", reviewed.slice(0, 687)),
    csfSubmissionDeletionCatalog(
      finalSchemaCatalog(before, reviewed.slice(0, 687)),
    ),
  );
  for (const changed of [
    [...reviewed, "20990101000000"],
    [...reviewed.slice(0, -1), "20990101000000"],
    [...reviewed.slice(0, 687), ...reviewed.slice(687).reverse()],
    reviewed.slice(0, -1),
  ])
    assert.throws(
      () => acceptedCatalogQuery("", changed),
      /explicit release review/u,
    );
});

test("new schema preserves existing objects and pins its new durable account and worker records", () => {
  const old = new Set(before.objects.map((row) => row.identity));
  const current = new Set(manifest.objects.map((row) => row.identity));
  assert.deepEqual(
    [...old].filter((identity) => !current.has(identity)),
    [],
  );
  assert.equal(current.size - old.size, 52);
  for (const identity of [
    "relation:app_private.account_deletion_operations",
    "relation:app_private.account_deletion_storage_objects",
    "relation:app_private.account_export_artifacts",
    "relation:app_private.personal_calendar_sync_receipts",
    "relation:app_private.organization_calendar_destinations",
    "relation:app_private.organization_calendar_event_receipts",
    "relation:app_private.worker_run_receipts",
    "relation:plugin_data.dv_sd_membership_write_receipts",
  ])
    assert.ok(current.has(identity), identity);
});

test("the forward controller applies the twelve exact audit migrations once", () => {
  const pending = prepareMigration(
    fixture.cwd,
    readFileSync,
    reviewed.slice(0, 687),
  );
  const complete = prepareMigration(fixture.cwd, readFileSync, reviewed);
  for (const name of tail) {
    const filename = `${name}.sql`;
    const path = resolve(fixture.cwd, "supabase/migrations", filename);
    const sql = readFileSync(path, "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    assert.deepEqual(
      approvedMigrations.find(([entry]) => entry === name),
      [name, digest],
    );
    assert.equal(migrationDigests[filename], digest);
    assert.deepEqual(prohibitedDataWrites(sql), [], filename);
    assert.deepEqual(unreviewedDataWrites(sql), [], filename);
    const ledgerWrite = `'${name.slice(0, 14)}','${name.slice(15)}'`;
    assert.ok(pending.query.includes(ledgerWrite), name);
    assert.ok(!complete.query.includes(ledgerWrite), name);
    assert.throws(
      () =>
        prepareMigration(
          fixture.cwd,
          (candidate) =>
            readFileSync(candidate, "utf8") + (candidate === path ? "\n" : ""),
          reviewed.slice(0, 687),
        ),
      /Approved migration bytes changed/u,
      name,
    );
  }
});

test("a future unreviewed migration refuses before any provider access", async () => {
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
