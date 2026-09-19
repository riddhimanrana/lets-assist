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
const ledger = fullLedger.slice(0, 609);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919145700_csf_storage_deletion_claim_boundary";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("610 fences Storage deletion claims and request-bound restoration", () => {
  assert.equal(fullLedger.length, 616);
  assert.equal(ledger.length, 609);
  assert.equal(ledger.at(-1), "20260919145700");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 608));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /csf_claim_storage_deletion_queue/u);
  assert.match(current, /csf_claim_storage_deletion_queue/u);
  assert.match(current, /csf_ack_storage_deletion_claim/u);
  assert.match(current, /csf_prepare_announcement_attachment_restore/u);
  assert.match(current, /csf_purge_storage_deletion_queue/u);
  assert.match(current, /restore_request_id/u);
});

test("610 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.find(([name]) => name === migrationName)?.[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
