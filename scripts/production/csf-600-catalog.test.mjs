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
const ledger = fullLedger.slice(0, 600);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260918235900_csf_scoped_import_actor_detachment";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("600 preserves scoped receipts when their actor account is deleted", () => {
  assert.equal(fullLedger.length, 612);
  assert.equal(ledger.length, 600);
  assert.equal(ledger.at(-1), "20260918235900");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 599));
  const current = acceptedCatalogQuery(source, ledger);
  assert.ok(current.includes(previous.trim().replace(/;$/u, "")));
  assert.doesNotMatch(previous, /confdeltype = 'n'/u);
  assert.match(current, /actor_user_id/u);
  assert.match(current, /NOT a\.attnotnull/u);
  assert.match(current, /confdeltype = 'n'/u);
});
