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
  assert.equal(ledger.length, 602);
  assert.equal(ledger.at(-1), "20260919020000");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 601));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /csf_announcement_attachments/u);
  assert.match(current, /csf_announcement_attachments/u);
  assert.match(current, /csf_replace_post_attachments/u);
  assert.match(current, /csf_actor_has_permission/u);
  assert.match(current, /post_attachments_replaced/u);
});
