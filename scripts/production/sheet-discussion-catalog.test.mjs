import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import {
  sheetDiscussionDefinitions,
  sheetDiscussionTables,
} from "./sheet-discussion-catalog.mjs";
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
test("column extension pins reviewed definitions while preserving the prior catalog", () => {
  assert.equal(versions.length, 496);
  const current = acceptedCatalogQuery(source, versions.slice(0, 488));
  const previous = acceptedCatalogQuery(source, versions.slice(0, 486));
  assert.ok(!previous.includes("csf_configure_sheet_discussion_transport"));
  for (const [signature, digest, body] of sheetDiscussionDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  for (const [name, digest] of sheetDiscussionTables) {
    assert.ok(current.includes(name));
    assert.ok(current.includes(digest));
  }
  assert.equal(acceptedCatalogQuery(source, versions.slice(0, 483)), previous);
});
test("486 requires the discussion extension, publication, and reviewed recovery", () => {
  const prepared = prepareMigration(cwd, undefined, versions.slice(0, 486));
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    10,
  );
  assert.ok(prepared.query.includes("last_export_comments"));
  assert.ok(!prepared.query.includes("AND version = '1.2.27'"));
  const [name, digest] = approvedMigrations.at(-1);
  assert.equal(
    digest,
    createHash("sha256")
      .update(readFileSync(`supabase/migrations/${name}.sql`))
      .digest("hex"),
  );
});

test("488 publication preserves 487 schema fingerprints before the recovery upgrade", () => {
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 488)),
    acceptedCatalogQuery(source, versions.slice(0, 487)),
  );
  const prepared = prepareMigration(cwd, undefined, versions.slice(0, 487));
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    9,
  );
  assert.ok(prepared.query.includes("AND version = '1.2.28'"));
  assert.ok(!prepared.query.includes("ADD COLUMN discussion_transport"));
  assert.ok(!prepared.query.includes("AND version = '1.2.27'"));
});
