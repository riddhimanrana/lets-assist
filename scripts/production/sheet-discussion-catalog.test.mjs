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
  assert.equal(versions.length, 487);
  const current = acceptedCatalogQuery(source, versions);
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
test("486 requires only the new forward discussion migration", () => {
  const prepared = prepareMigration(cwd, undefined, versions.slice(0, 486));
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    1,
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
