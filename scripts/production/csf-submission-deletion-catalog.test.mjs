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
const before = JSON.parse(read("./final-schema-672.json"));
const after = JSON.parse(read("./final-schema-673.json"));
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 673);

test("member deletion changes only its reviewed schema objects", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  const current = new Map(
    after.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    [...previous.keys()].filter((key) => !current.has(key)),
    [],
  );
  assert.equal(current.size - previous.size, 9);
  assert.deepEqual(
    after.objects
      .filter(
        (row) =>
          previous.has(row.identity) &&
          previous.get(row.identity) !== row.digest,
      )
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_reject_audit_mutation()",
      "relation:plugin_data.csf_storage_deletion_queue",
    ],
  );
  assert.equal(versions.at(-1), "20260924075152");
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
  );
  assert.match(acceptedCatalogQuery("", versions), /t\.tgenabled='O'/u);
  assert.match(
    acceptedCatalogQuery("", versions),
    /pg_catalog\.pg_get_triggerdef/u,
  );
});

test("member deletion migration is retry safe and does not erase existing claims on deploy", () => {
  const sql = read(
    "../../supabase/migrations/20260924075152_csf_member_submission_deletion.sql",
  );
  assert.deepEqual(prohibitedDataWrites(sql), []);
  assert.deepEqual(unreviewedDataWrites(sql), []);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 672),
  );
  assert.match(
    prepared.query,
    /'20260924075152','csf_member_submission_deletion'/u,
  );
  assert.doesNotMatch(
    prepareMigration(repository, readFileSync, versions).query,
    /'20260924075152','csf_member_submission_deletion'/u,
  );
});
