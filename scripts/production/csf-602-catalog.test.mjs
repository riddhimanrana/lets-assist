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
const ledger = fullLedger.slice(0, 601);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919010000_csf_scoped_request_id_batch_fence";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("602 fences scoped request IDs before deriving import records", () => {
  assert.equal(fullLedger.length, 619);
  assert.equal(ledger.length, 601);
  assert.equal(ledger.at(-1), "20260919010000");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 600));
  const current = acceptedCatalogQuery(source, ledger);
  assert.match(previous, /a452eea82e258fe4351689c79d7acc93/u);
  assert.doesNotMatch(current, /a452eea82e258fe4351689c79d7acc93/u);
  assert.match(current, /42874a1ae35c55cd10b8f6ddd68d2835/u);
  assert.doesNotMatch(previous, /This request ID already belongs/u);
  assert.match(current, /csf_import_approval_batch:/u);
  assert.match(current, /This request ID already belongs/u);
  assert.match(current, /INSERT INTO plugin_data\.csf_sheet_import_jobs/u);
  assert.doesNotMatch(current, /pg_catalog\.position/u);
  assert.match(current, /pg_catalog\.strpos\(p\.prosrc/u);
});
