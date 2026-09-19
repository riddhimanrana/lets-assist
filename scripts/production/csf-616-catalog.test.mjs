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
const ledger = expectedVersions(cwd).slice(0, 616);
const migrationName =
  "20260919200000_csf_application_source_connection_evidence";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("616 pins the reviewed application-source connection evidence", () => {
  assert.equal(ledger.length, 616);
  assert.equal(ledger.at(-1), "20260919200000");
  assert.deepEqual(approvedMigrations.at(-4), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 615));
  const current = acceptedCatalogQuery(source, ledger);
  assert.match(previous, /f0aaa289ceda518c32ef0ea8468493ba/u);
  assert.doesNotMatch(current, /f0aaa289ceda518c32ef0ea8468493ba/u);
  assert.match(current, /05e5ea595dab2906d065d51c13748d3b/u);
  assert.equal(current.length, previous.length);
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, 615), "20990101000000"]),
    /explicit release review/u,
  );
});
