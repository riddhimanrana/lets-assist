import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-682.json"));
const after = JSON.parse(read("./final-schema-683.json"));
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 683);

test("homonym contact edits change only the audited profile function", () => {
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_upsert_profile(p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid, p_request jsonb)",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
  );
});

test("the forward controller applies the homonym fix once", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 682),
  );
  assert.match(
    prepared.query,
    /'20260929031000','csf_existing_homonym_profile_edits'/u,
  );
  assert.doesNotMatch(
    prepareMigration(repository, readFileSync, versions).query,
    /'20260929031000','csf_existing_homonym_profile_edits'/u,
  );
});
