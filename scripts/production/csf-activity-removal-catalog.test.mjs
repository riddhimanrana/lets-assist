import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-683.json"));
const after = JSON.parse(read("./final-schema-685.json"));
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 685);

test("activity removal and indexed contact checks change only reviewed objects", () => {
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
      "function:plugin_data.csf_delete_activity(p_organization_id uuid, p_activity_id uuid, p_actor_user_id uuid, p_request_id uuid)",
      "function:plugin_data.csf_upsert_profile(p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid, p_request jsonb)",
      "relation:plugin_data.csf_profiles",
      "relation:plugin_data.csf_term_applications",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
  );
});

test("the forward controller applies the activity removal once", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 683),
  );
  assert.match(
    prepared.query,
    /'20260929044000','csf_remove_activity_preserve_history'/u,
  );
  assert.doesNotMatch(
    prepareMigration(repository, readFileSync, versions).query,
    /'20260929044000','csf_remove_activity_preserve_history'/u,
  );
});

test("the signed 1.2.85 publication preserves the reviewed schema", () => {
  const published = JSON.parse(read("./final-schema-686.json"));
  const publishedVersions = expectedVersions(repository).slice(0, 686);
  assert.deepEqual(published.objects, after.objects);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", publishedVersions),
    csfSubmissionDeletionCatalog(
      finalSchemaCatalog(published, publishedVersions),
    ),
  );
});

test("removed activity review changes only the three existing eligibility paths", () => {
  const previous = JSON.parse(read("./final-schema-686.json"));
  const current = JSON.parse(read("./final-schema-687.json"));
  const currentVersions = expectedVersions(repository).slice(0, 687);
  assert.deepEqual(
    current.objects.map((row) => row.identity),
    previous.objects.map((row) => row.identity),
  );
  const digests = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    current.objects
      .filter((row) => digests.get(row.identity) !== row.digest)
      .map((row) => row.identity.split("(")[0]),
    [
      "function:plugin_data.csf_assert_point_submission_eligibility",
      "function:plugin_data.csf_assert_point_submission_row_eligibility",
      "function:plugin_data.csf_resubmit_point_submission",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", currentVersions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(current, currentVersions)),
  );
});
