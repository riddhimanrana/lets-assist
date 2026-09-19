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
const ledger = fullLedger.slice(0, 604);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919095826_atomic_csf_post_attachment_update";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("605 pins the atomic CSF post and attachment update", () => {
  assert.equal(fullLedger.length, 616);
  assert.equal(ledger.length, 604);
  assert.equal(ledger.at(-1), "20260919095826");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 603));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /csf_update_post_with_attachments/u);
  assert.match(current, /csf_update_post_with_attachments/u);
  assert.match(current, /csf_mutate_post/u);
  assert.match(current, /csf_replace_post_attachments/u);
  assert.match(current, /service_role/u);
});

test("605 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.find(([name]) => name === migrationName)[1],
    "4d75516543a45dbc621321732570629ce5a23fa75220c6bc2dda126e7db0cf9f",
  );
});
