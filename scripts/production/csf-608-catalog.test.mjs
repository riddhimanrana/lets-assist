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
const migrationName = "20260919133902_bind_csf_post_publication_requests";
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}.sql`, import.meta.url),
  "utf8",
);

test("608 pins publication request binding before attachment changes", () => {
  assert.equal(ledger.length, 607);
  assert.equal(ledger.at(-1), "20260919133902");
  assert.deepEqual(approvedMigrations.at(-1), [
    migrationName,
    createHash("sha256").update(migration).digest("hex"),
  ]);

  const previous = acceptedCatalogQuery(source, ledger.slice(0, 606));
  const current = acceptedCatalogQuery(source, ledger);
  assert.doesNotMatch(previous, /v_request\.attachment_total_bytes/u);
  assert.match(current, /v_request\.actor_user_id/u);
  assert.match(current, /v_request\.announcement_id/u);
  assert.match(current, /v_request\.attachment_count/u);
  assert.match(current, /v_request\.attachment_total_bytes/u);
  assert.match(current, /requestFingerprint/u);
});

test("608 refuses an unreviewed ledger or changed migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(source, [...ledger.slice(0, -1), "20990101000000"]),
    /explicit release review/u,
  );
  assert.equal(
    approvedMigrations.at(-1)[1],
    "c96217505e6e97cbeb11ca639480e27526b6fbe132684af29624cd5b41078144",
  );
});
