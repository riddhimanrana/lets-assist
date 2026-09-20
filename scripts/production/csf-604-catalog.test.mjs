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
const ledger = fullLedger.slice(0, 603);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919091727_index_hot_uncovered_foreign_keys";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("604 pins the populated import foreign-key indexes", () => {
  assert.ok(fullLedger.length >= 621);
  assert.equal(ledger.length, 603);
  assert.equal(ledger.at(-1), "20260919091727");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 602));
  const current = acceptedCatalogQuery(source, ledger);
  assert.match(previous, /4f49d866eabadf1ead30d6ebe714af41/u);
  assert.doesNotMatch(current, /4f49d866eabadf1ead30d6ebe714af41/u);
  assert.match(current, /1d99ee16770ea80d937ea969577a77be/u);
  for (const name of [
    "csf_sheet_import_rows_resolved_by_fk_idx",
    "csf_import_row_batch_outcomes_import_row_org_fk_idx",
    "csf_auto_import_approval_rows_import_row_org_fk_idx",
  ]) {
    assert.doesNotMatch(previous, new RegExp(name, "u"));
    assert.match(current, new RegExp(name, "u"));
  }
});

test("604 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.find(([name]) => name === migrationName)[1],
    "b13b08f59979521d1064e984b64a42e99852e74d8025c38566f9672844db5c53",
  );
});
