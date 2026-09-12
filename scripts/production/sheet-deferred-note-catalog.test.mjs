import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { sheetObservationDefinitions } from "./sheet-observation-catalog.mjs";
import { sheetDeferredNoteDefinitions } from "./sheet-deferred-note-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const versions = expectedVersions(process.cwd());
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);
test("493 changes only the profile snapshot function fingerprint", () => {
  assert.equal(versions.length, 498);
  const changed = sheetDeferredNoteDefinitions.filter(
    (row, i) =>
      JSON.stringify(row) !== JSON.stringify(sheetObservationDefinitions[i]),
  );
  assert.equal(changed.length, 1);
  assert.equal(
    changed[0][0],
    "plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)",
  );
  const current = acceptedCatalogQuery(source, versions.slice(0, 493));
  for (const [signature, digest, body] of sheetDeferredNoteDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 492)).includes(
      changed[0][1],
    ),
  );
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 492)),
    acceptedCatalogQuery(source, versions.slice(0, 491)),
  );
});
test("492 advances through profile note export deferral and the current release tail", () => {
  const result = prepareMigration(
    process.cwd(),
    undefined,
    versions.slice(0, 492),
  );
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    6,
  );
  assert.ok(
    result.query.includes("jsonb_build_object('comments','[]'::jsonb)"),
  );
  assert.ok(!result.query.includes("CREATE TRIGGER"));
  assert.ok(result.query.includes("AND version = '1.2.32'"));
});
