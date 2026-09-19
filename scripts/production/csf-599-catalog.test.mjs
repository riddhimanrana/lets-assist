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
const ledger = fullLedger.slice(0, 599);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260918183000_csf_scoped_application_import_preview";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("599 appends only the reviewed scoped application import", () => {
  assert.equal(fullLedger.length, 604);
  assert.equal(ledger.length, 599);
  assert.equal(ledger.at(-1), "20260918183000");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 598));
  const current = acceptedCatalogQuery(source, ledger);
  assert.ok(current.includes(previous.trim().replace(/;$/u, "")));
  assert.doesNotMatch(previous, /csf_scoped_application_imports/u);
  assert.match(current, /csf_scoped_application_imports/u);
  assert.match(current, /expected_profile_id/u);
  assert.match(current, /expected_resolved_at/u);
  assert.match(current, /a452eea82e258fe4351689c79d7acc93/u);
  assert.match(current, /csf_purge_import_recovery/u);
  assert.match(current, /0c6beec791717f8028b9b5ffa0211b04/u);
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, 598), "20990101000000"]),
    /explicit release review/u,
  );
});
