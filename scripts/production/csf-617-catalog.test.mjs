import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const ledger = expectedVersions(cwd).slice(0, 617);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919203000_csf_batch_sheet_sync_observation";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("617 pins bounded, service-only Sheet observation batch wrappers", () => {
  assert.equal(ledger.length, 617);
  assert.equal(ledger.at(-1), "20260919203000");
  assert.deepEqual(approvedMigrations.at(-3), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 616));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /csf_sheet_sync_destination_snapshots/u);
  assert.match(current, /csf_sheet_sync_destination_snapshots/u);
  assert.match(current, /csf_record_sheet_sync_changes/u);
  assert.match(current, /p_destination_lease_token/u);
  assert.match(current, /NOT BETWEEN 1 AND 100/u);
});

test("617 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.at(-3)[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
