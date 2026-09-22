import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import {
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import { topLevelDataWrites } from "./migration-data-writes.mjs";

const repository = new URL("../../", import.meta.url).pathname;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-645.json"));
const after = JSON.parse(read("./final-schema-646.json"));
const versions = expectedVersions(repository).slice(0, 646);
const name = "20260922030507_csf_review_existing_account_ownership";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("ownership review adds one private function and preserves every existing schema object", () => {
  assert.equal(versions.at(-1), "20260922030507");
  assert.deepEqual(
    after.objects.filter(({ identity }) =>
      before.objects.some((row) => row.identity === identity),
    ),
    before.objects,
  );
  assert.deepEqual(
    after.objects
      .filter(
        ({ identity }) =>
          !before.objects.some((row) => row.identity === identity),
      )
      .map(({ identity }) => identity),
    [
      "function:plugin_data.csf_review_profile_account_ownership(p_organization_id uuid, p_profile_id uuid, p_actor_user_id uuid, p_account_email text, p_reason text, p_request_id uuid, p_account_id uuid, p_expected_user_id uuid)",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 645)));
});

test("the controller pins the review migration without upgrading any live account", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 645),
  );
  assert.equal(prepared.prefix.length, 645);
  assert.ok(
    prepared.query.includes(
      "'20260922030507','csf_review_existing_account_ownership'",
    ),
  );
});
