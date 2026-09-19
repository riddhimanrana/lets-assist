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
const ledger = fullLedger.slice(0, 615);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName =
  "20260919190000_csf_attendance_window_exclusion_readiness";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("615 distinguishes deterministic attendance cutoff exclusions", () => {
  assert.equal(fullLedger.length, 619);
  assert.equal(ledger.length, 615);
  assert.equal(ledger.at(-1), "20260919190000");
  assert.deepEqual(approvedMigrations.at(-5), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 614));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /attendance_window_excluded/u);
  assert.match(current, /attendance_window_excluded/u);
  assert.match(current, /attendanceWindowExcluded/u);
  assert.match(current, /before attendance opened/u);
  assert.match(current, /after attendance closed/u);
});

test("615 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.at(-5)[1],
    createHash("sha256").update(migration).digest("hex"),
  );
});
