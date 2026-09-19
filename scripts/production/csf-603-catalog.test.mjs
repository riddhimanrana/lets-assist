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
const ledger = fullLedger.slice(0, 602);
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migrationName = "20260919020000_csf_post_image_attachments";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("603 pins private CSF post-image storage and mutation authority", () => {
  assert.equal(fullLedger.length, 616);
  assert.equal(ledger.length, 602);
  assert.equal(ledger.at(-1), "20260919020000");
  assert.deepEqual(
    approvedMigrations.find(([name]) => name === migrationName),
    [migrationName, createHash("sha256").update(migration).digest("hex")],
  );
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 601));
  const current = acceptedCatalogQuery(source, ledger);
  assert.match(previous, /317cf813aa3f7dfdedaa8a21ac872343/u);
  assert.doesNotMatch(current, /317cf813aa3f7dfdedaa8a21ac872343/u);
  assert.match(current, /fb4732ca4e5263b59a48b344b72c05a9/u);
  assert.doesNotMatch(previous, /csf_announcement_attachments/u);
  assert.match(current, /csf_announcement_attachments/u);
  assert.match(current, /csf_post_publication_requests/u);
  assert.match(current, /csf_replace_post_attachments/u);
  assert.match(current, /csf_begin_post_publication_request/u);
  assert.match(current, /csf_resolve_post_publication_completion/u);
  assert.match(current, /csf_post_attachments_ready_for_email/u);
  assert.match(current, /csf_actor_has_permission/u);
  assert.match(current, /post_attachments_replaced/u);
});
