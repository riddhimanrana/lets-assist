import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { sheetDeferredNoteDefinitions } from "./sheet-deferred-note-catalog.mjs";
import { sheetToggleDefinitions } from "./sheet-toggle-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const versions = expectedVersions(process.cwd()).slice(0, 518);
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);
test("494 pins only state transition and review function changes", () => {
  assert.equal(versions.length, 518);
  const changed = sheetToggleDefinitions.filter(
    (row, i) =>
      JSON.stringify(row) !== JSON.stringify(sheetDeferredNoteDefinitions[i]),
  );
  assert.equal(changed.length, 2);
  const current = acceptedCatalogQuery(source, versions.slice(0, 498));
  for (const [signature, digest, body] of sheetToggleDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  for (const row of changed)
    assert.ok(
      !acceptedCatalogQuery(source, versions.slice(0, 493)).includes(row[1]),
    );
});
test("493 advances through observation invalidation and the current release tail", () => {
  const result = prepareMigration(
    process.cwd(),
    undefined,
    versions.slice(0, 493),
  );
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    31,
  );
  assert.ok(result.query.includes("enabled IS DISTINCT FROM p_enabled"));
  assert.ok(result.query.includes("IF NOT d.enabled OR d.observation_state"));
  assert.deepEqual(
    Array.from(
      new Set(
        Array.from(
          result.query.matchAll(/CREATE TRIGGER ([a-z_]+)/gu),
          (match) => match[1],
        ),
      ),
    ),
    [
      "csf_announcements_publication_notifications",
      "csf_activities_publication_notifications",
      "csf_term_applications_new_intake_guard",
    ],
  );
  assert.ok(result.query.includes("AND version = '1.2.32'"));
});
