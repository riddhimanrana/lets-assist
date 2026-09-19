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
const catalogLedger = ledger.slice(0, 612);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919161824_csf_post_publication_actor_detachment";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("612 detaches a deleted publication request actor", () => {
  assert.equal(catalogLedger.length, 612);
  assert.equal(catalogLedger.at(-1), "20260919161824");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const releaseOnly = acceptedCatalogQuery(source, catalogLedger.slice(0, 611));
  const current = acceptedCatalogQuery(source, catalogLedger);
  assert.doesNotMatch(
    releaseOnly,
    /csf_post_publication_requests_actor_user_id_fkey/u,
  );
  assert.match(current, /csf_post_publication_requests_actor_user_id_fkey/u);
  assert.match(current, /actor_constraint\.confdeltype = 'n'/u);
  assert.match(current, /NOT actor_column\.attnotnull/u);
});

test("612 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [
        ...catalogLedger.slice(0, -1),
        "20990101000000",
      ]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.find(([name]) => name === migrationName)[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
