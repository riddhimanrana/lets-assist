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
const fullLedger = expectedVersions(cwd);
const ledger = fullLedger.slice(0, 620);
const migrationName = "20260919230000_csf_storage_generation_fence";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("620 fences restored images and cancels unfinished teardown leases", () => {
  assert.equal(ledger.length, 620);
  assert.equal(ledger.at(-1), "20260919230000");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 619));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /p_request_id::text/u);
  assert.match(current, /p_request_id::text/u);
  assert.match(current, /target_type IS DISTINCT FROM/u);
  assert.match(current, /restore_request_id::text/u);
  assert.match(current, /csf_attachment_restore_preparations/u);
});

test("620 replaces superseded Storage source checks without weakening earlier ledgers", () => {
  const claimBoundary = acceptedCatalogQuery(source, ledger.slice(0, 609));
  const twoPhaseTeardown = acceptedCatalogQuery(source, ledger.slice(0, 610));
  const leaseTakeover = acceptedCatalogQuery(source, ledger.slice(0, 613));
  const current = acceptedCatalogQuery(source, ledger);

  assert.match(
    claimBoundary,
    /v_request\.attachment_status IS DISTINCT FROM ''pending''/u,
  );
  assert.match(
    twoPhaseTeardown,
    /'''claimedQueueRows'', v_claimed_queue_rows/u,
  );
  assert.match(leaseTakeover, /Storage deletion claim lease expired\./u);

  assert.match(
    current,
    /v_request\.attachment_status IS DISTINCT FROM ''pending''/u,
  );
  assert.match(current, /'''claimedQueueRows'', v_claimed_queue_rows/u);
  assert.match(current, /Storage deletion claim lease expired\./u);
  assert.match(
    current,
    /DELETE FROM plugin_data\.csf_storage_deletion_queue'\) = 0/u,
  );
  assert.match(current, /'IF v_queue_rows > 0 THEN'\s+\) > 0/u);
  assert.match(current, /'FOR UPDATE OF queue SKIP LOCKED'/u);
  assert.doesNotMatch(current, /'FOR UPDATE SKIP LOCKED'/u);
  assert.match(current, /csf_validate_attachment_restore_preparation/u);
  assert.match(current, /restore_request_id::text/u);
  assert.match(current, /row_error\.message NOT IN/u);
});

test("620 refuses an unreviewed ledger or changed migration bytes", () => {
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
