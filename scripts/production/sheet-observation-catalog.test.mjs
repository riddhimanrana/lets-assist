import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import {
  sheetObservationDefinitions,
  sheetObservationTables,
} from "./sheet-observation-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const versions = expectedVersions(process.cwd());
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);
test("491 pins complete observation functions and holds the destination state", () => {
  assert.equal(versions.length, 502);
  const current = acceptedCatalogQuery(source, versions.slice(0, 492));
  for (const [signature, digest, body] of sheetObservationDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  for (const [name, digest] of sheetObservationTables) {
    assert.ok(current.includes(name));
    assert.ok(current.includes(digest));
  }
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 490)).includes(
      "csf_complete_sheet_sync_observation",
    ),
  );
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 490)),
    acceptedCatalogQuery(source, versions.slice(0, 489)),
  );
});
test("490 advances through the observation guard and signed publication", () => {
  const result = prepareMigration(
    process.cwd(),
    undefined,
    versions.slice(0, 490),
  );
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    12,
  );
  assert.ok(result.query.includes("ADD COLUMN observation_state"));
  assert.ok(!result.query.includes("ADD COLUMN observation_generation"));
  assert.ok(result.query.includes("AND version = '1.2.31'"));
});

test("492 preserves the observation catalog and appends only signed publication", () => {
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 492)),
    acceptedCatalogQuery(source, versions.slice(0, 491)),
  );
  const result = prepareMigration(
    process.cwd(),
    undefined,
    versions.slice(0, 491),
  );
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    11,
  );
  assert.ok(result.query.includes("AND version = '1.2.31'"));
  assert.ok(!result.query.includes("ADD COLUMN observation_state"));
  assert.ok(
    !result.query.includes("UPDATE public.organization_plugin_installs"),
  );
});
