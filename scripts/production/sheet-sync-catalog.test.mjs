import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  acceptedCatalogQuery,
  workerRelationSnapshotQuery,
} from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import {
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import {
  sheetSyncDefinitions,
  sheetSyncTables,
  sheetSyncTriggers,
  sheetSyncPosture,
} from "./sheet-sync-catalog.mjs";
const cwd = fileURLToPath(new URL("../../", import.meta.url));
const migrationName = "20260910232532_csf_sheet_sync_review_queue";
const sql = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = expectedVersions(cwd);

test("the sync catalog pins every new function body and execution role", () => {
  const bodies = [
    ...sql.matchAll(
      /CREATE FUNCTION plugin_data\.([a-z_]+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/gu,
    ),
  ];
  assert.equal(bodies.length, 29);
  assert.equal(sheetSyncDefinitions.length, bodies.length);
  for (const [, name, body] of bodies) {
    const entry = sheetSyncDefinitions.find(([signature]) =>
      signature.startsWith(`plugin_data.${name}(`),
    );
    assert.ok(entry, name);
    assert.equal(entry[2], createHash("md5").update(body).digest("hex"), name);
    assert.equal(
      entry[3],
      ![
        "csf_queue_changed_sheet_sync_record",
        "csf_guard_sheet_sync_test_file",
        "csf_guard_sheet_sync_export_snapshot",
        "csf_queue_cohort_sheet_sync_records",
        "csf_queue_sheet_sync_record_internal",
        "csf_queue_term_sheet_sync_records",
      ].includes(name),
      name,
    );
  }
});

test("the sync catalog covers each table and exact source-change trigger", () => {
  const tables = [...sql.matchAll(/CREATE TABLE plugin_data\.([a-z_]+)/gu)].map(
    (m) => m[1],
  );
  tables.push("csf_sheet_writeback_ledger");
  assert.deepEqual(sheetSyncTables.map(([name]) => name).sort(), tables.sort());
  const triggers = [
    ...sql.matchAll(
      /CREATE TRIGGER ([a-z_]+) (?:AFTER|BEFORE)[^;]+? ON plugin_data\.([a-z_]+)/gu,
    ),
  ].map((m) => `${m[2]}.${m[1]}`);
  assert.equal(triggers.length, 26);
  assert.deepEqual(
    sheetSyncTriggers.map(([table, name]) => `${table}.${name}`).sort(),
    triggers.sort(),
  );
  const posture = sheetSyncPosture(workerRelationSnapshotQuery);
  for (const check of [
    "actual.body_digest=expected.body_digest",
    "actual.service_execute=expected.service_execute",
    "t.tgenabled='O'",
    "t.tgqual IS NULL",
    "has_any_column_privilege",
    "'constraints'",
    "'policies'",
    "'rls'",
  ])
    assert.ok(posture.includes(check), check);
  assert.match(
    posture,
    /ORDER BY pg_get_indexdef\(i\.indexrelid\) COLLATE "C"/u,
  );
});

test("483 adds the sync posture without changing the preceding accepted catalog", () => {
  assert.equal(versions.length, 483);
  const previous = acceptedCatalogQuery(source, versions.slice(0, 482));
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "cca5785c038aefa92cbada410939cc293709c45186915c1815850d9f7cccf40f",
  );
  assert.ok(!previous.includes("csf_sheet_sync_destinations"));
  const current = acceptedCatalogQuery(source, versions);
  for (const [signature] of sheetSyncDefinitions)
    assert.ok(current.includes(signature), signature);
  assert.ok(current.includes("SELECT count(*)=10"));
  assert.ok(current.includes("SELECT count(*)=26"));
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [
        ...versions.slice(0, -1),
        "20260910232533",
      ]),
    /explicit release review/u,
  );
});

test("an existing 482 migration release applies only the approved sync migration", () => {
  const approved = approvedMigrations.find(([name]) => name === migrationName);
  assert.ok(approved);
  assert.equal(approved[1], createHash("sha256").update(sql).digest("hex"));
  const prepared = prepareMigration(cwd, undefined, versions.slice(0, 482));
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    1,
  );
  assert.ok(
    prepared.query.includes(
      "CREATE TABLE plugin_data.csf_sheet_sync_destinations",
    ),
  );
  assert.ok(
    !prepared.query.includes(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_hold_unproven_account_connections",
    ),
  );
});
