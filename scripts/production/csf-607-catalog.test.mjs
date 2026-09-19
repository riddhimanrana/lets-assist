import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const fullLedger = expectedVersions(cwd);
const ledger = fullLedger.slice(0, 606);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName =
  "20260919114409_serialize_csf_atomic_post_attachment_update";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("607 pins the atomic post and attachment lock order", () => {
  assert.equal(ledger.length, 606);
  assert.equal(ledger.at(-1), "20260919114409");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 605));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /PERFORM pg_catalog\.pg_advisory_xact_lock\(/u);
  assert.match(current, /PERFORM pg_catalog\.pg_advisory_xact_lock\(/u);
  assert.match(current, /csf_staff_access_lock_key/u);
  assert.match(current, /csf_mutate_post/u);
});

test("607 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.find(([name]) => name === migrationName)[1],
    "6f9a3e5cc710bb4e0d4c2fdd46697f70e834de961897073c13d323f7b7d9ca78",
  );
});
