import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import {
  sheetRecoveryDefinitions,
  sheetRecoveryTables,
} from "./sheet-recovery-catalog.mjs";
import {
  prepareMigration,
  approvedMigrations,
} from "./forward-migration-release.mjs";
const cwd = process.cwd();
const versions = expectedVersions(cwd);
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);
test("489 pins recovery definitions without changing the applied column catalog", () => {
  assert.equal(versions.length, 493);
  const current = acceptedCatalogQuery(source, versions.slice(0, 490));
  for (const [signature, digest, body] of sheetRecoveryDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  for (const [name, digest] of sheetRecoveryTables) {
    assert.ok(current.includes(name));
    assert.ok(current.includes(digest));
  }
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 488)),
    acceptedCatalogQuery(source, versions.slice(0, 487)),
  );
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 488)).includes(
      "csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text,text)",
    ),
  );
});
test("488 requires reviewed recovery and the signed application publication", () => {
  const result = prepareMigration(cwd, undefined, versions.slice(0, 488));
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    5,
  );
  assert.ok(result.query.includes("20260911195446"));
  assert.ok(!result.query.includes("AND version = '1.2.28'"));
  assert.ok(result.query.includes("AND version = '1.2.29'"));
  const [name, digest] = approvedMigrations.at(-1);
  assert.equal(
    digest,
    createHash("sha256")
      .update(readFileSync(`supabase/migrations/${name}.sql`))
      .digest("hex"),
  );
});

test("490 publication preserves 489 fingerprints and appends only signed publication bytes", () => {
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 490)),
    acceptedCatalogQuery(source, versions.slice(0, 489)),
  );
  const result = prepareMigration(cwd, undefined, versions.slice(0, 489));
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    4,
  );
  assert.ok(result.query.includes("AND version = '1.2.29'"));
  assert.ok(!result.query.includes("ADD COLUMN observation_generation"));
  assert.ok(!result.query.includes("AND version = '1.2.28'"));
});
