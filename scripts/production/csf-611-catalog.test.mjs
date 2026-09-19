import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const ledger = expectedVersions(cwd);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919155040_csf_two_phase_storage_teardown";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("611 requires organization-scoped claims and two-phase teardown", () => {
  assert.equal(ledger.length, 610);
  assert.equal(ledger.at(-1), "20260919155040");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 609));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(
    previous,
    /csf_claim_organization_storage_deletion_queue/u,
  );
  assert.match(current, /csf_claim_organization_storage_deletion_queue/u);
  assert.match(current, /cleanup_required/u);
  assert.match(current, /claimedQueueRows/u);
  assert.match(current, /csf_storage_deletion_queue_org_unclaimed_idx/u);
});

test("611 refuses an unreviewed ledger or changed migration bytes", () => {
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
