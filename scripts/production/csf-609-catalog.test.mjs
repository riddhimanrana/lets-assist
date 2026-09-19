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
const migrationName = "20260919143851_bind_csf_publication_recovery_to_receipt";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("609 binds publication recovery to request ownership and mutation receipt", () => {
  assert.equal(ledger.length, 608);
  assert.equal(ledger.at(-1), "20260919143851");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 607));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(
    previous,
    /v_mutation_receipt\.target_id IS DISTINCT FROM p_announcement_id/u,
  );
  assert.match(current, /v_request\.actor_user_id/u);
  assert.match(current, /post_mutation_request/u);
  assert.match(current, /v_mutation_receipt\.actor_user_id/u);
  assert.match(current, /v_mutation_receipt\.target_id/u);
});

test("609 refuses an unreviewed ledger or changed migration bytes", () => {
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
