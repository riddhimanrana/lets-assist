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
const ledger = fullLedger.slice(0, 619);
const migrationName =
  "20260919220000_csf_attendance_cutoff_exclusive_readiness";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("619 requires every non-blocking attendance error to be a reviewed cutoff error", () => {
  assert.equal(ledger.length, 619);
  assert.equal(ledger.at(-1), "20260919220000");
  assert.deepEqual(approvedMigrations.at(-3), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 618));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /cardinality\(import_row\.errors\) > 0/u);
  assert.match(current, /cardinality\(import_row\.errors\) > 0/u);
  assert.match(current, /unnest\(import_row\.errors\)/u);
  assert.match(current, /row_error\.message IS NULL/u);
  assert.match(current, /row_error\.message NOT IN/u);
});

test("619 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.at(-3)[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
