import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const ledger = expectedVersions(cwd).slice(0, 614);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919172947_csf_restore_preparation_lease";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("614 keeps cleanup durable through a bounded restore lease", () => {
  assert.equal(ledger.length, 614);
  assert.equal(ledger.at(-1), "20260919172947");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 613));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /active_lease_idx/u);
  assert.match(current, /lease_expires_at/u);
  assert.match(current, /active_lease_idx/u);
  assert.match(current, /already being prepared/u);
});

test("614 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.find(([name]) => name === migrationName)[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
