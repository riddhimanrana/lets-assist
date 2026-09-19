import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const ledger = expectedVersions(cwd);
const migrationName = "20260919230001_publish_dvhs_csf_1_2_55";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("621 publishes DVHS CSF 1.2.55 without changing the reviewed schema", () => {
  assert.equal(ledger.length, 621);
  assert.equal(ledger.at(-1), "20260919230001");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  assert.equal(
    acceptedCatalogQuery(source, ledger),
    acceptedCatalogQuery(source, ledger.slice(0, 620)),
  );
});

test("621 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.at(-1)[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
