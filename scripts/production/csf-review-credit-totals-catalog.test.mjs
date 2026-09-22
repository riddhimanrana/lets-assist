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
const before = JSON.parse(read("./final-schema-647.json"));
const after = JSON.parse(read("./final-schema-648.json"));
const versions = expectedVersions(repository).slice(0, 648);
const name = "20260922054000_csf_review_credit_totals";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("review credit totals add one private function and preserves every existing schema object", () => {
  assert.equal(versions.at(-1), "20260922054000");
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
      "function:plugin_data.csf_review_credit_totals(p_organization_id uuid, p_term_id uuid, p_profile_ids uuid[])",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 647)));
});

test("the controller pins the totals migration without changing any credits", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 647),
  );
  assert.equal(prepared.prefix.length, 647);
  assert.ok(
    prepared.query.includes("'20260922054000','csf_review_credit_totals'"),
  );
});
