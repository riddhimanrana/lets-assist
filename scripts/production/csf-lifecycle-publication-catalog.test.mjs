import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
import {
  prohibitedDataWrites,
  unreviewedDataWrites,
} from "./migration-data-writes.mjs";
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-676.json"));
const after = JSON.parse(read("./final-schema-677.json"));
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 677);
test("signed lifecycle publication preserves the reviewed schema and install boundary", () => {
  assert.deepEqual(after.objects, before.objects);
  assert.equal(versions.at(-1), "20260926000900");
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
  );
  const sql = read(
    "../../supabase/migrations/20260926000900_publish_dvhs_csf_1_2_81.sql",
  );
  assert.deepEqual(prohibitedDataWrites(sql), []);
  assert.deepEqual(unreviewedDataWrites(sql), []);
});
test("lifecycle publication is applied once with its catalog fence", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 676),
  );
  assert.match(prepared.query, /'20260926000900','publish_dvhs_csf_1_2_81'/u);
  assert.match(
    prepared.query,
    /Plugin catalog moved since this signed integration was prepared/u,
  );
  const retry = prepareMigration(repository, readFileSync, versions);
  assert.doesNotMatch(
    retry.query,
    /'20260926000900','publish_dvhs_csf_1_2_81'/u,
  );
});
