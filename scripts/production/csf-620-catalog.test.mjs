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
const migrationName = "20260919230000_csf_storage_generation_fence";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("620 fences restored images and cancels unfinished teardown leases", () => {
  assert.equal(ledger.length, 620);
  assert.equal(ledger.at(-1), "20260919230000");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 619));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /p_request_id::text/u);
  assert.match(current, /p_request_id::text/u);
  assert.match(current, /target_type IS DISTINCT FROM/u);
  assert.match(current, /restore_request_id::text/u);
  assert.match(current, /csf_attachment_restore_preparations/u);
});

test("620 refuses an unreviewed ledger or changed migration bytes", () => {
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
