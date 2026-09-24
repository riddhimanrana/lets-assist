import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";

const read = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const before = read("./final-schema-667.json");
const after = read("./final-schema-668.json");
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 668);

test("signed editor publication preserves the reviewed schema objects", () => {
  assert.deepEqual(after.objects, before.objects);
  assert.equal(versions.at(-1), "20260923202633");
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    finalSchemaCatalog(after, versions),
  );
});

test("the Production tail applies restoration and the signed release once", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 666),
  );
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    expectedVersions(repository).length - 666,
  );
  assert.match(
    prepared.query,
    /'20260923200000','csf_restore_closed_activity'/u,
  );
  assert.match(prepared.query, /'20260923202633','publish_dvhs_csf_1_2_77'/u);
  assert.match(prepared.query, /400af29c570bf3f1df6f6b5d05aee56e38ff1d07/u);
  assert.match(
    prepared.query,
    /Plugin catalog moved since this signed integration was prepared/u,
  );
  const replay = prepareMigration(repository, readFileSync, versions);
  assert.doesNotMatch(
    replay.query,
    /'20260923200000','csf_restore_closed_activity'|'20260923202633','publish_dvhs_csf_1_2_77'/u,
  );
});
