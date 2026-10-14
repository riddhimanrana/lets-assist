import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";

const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository);
const before = read("./final-schema-687.json");
const after = read("./final-schema-688.json");

test("repeatable pending claims change only the reviewed functions and claim index", () => {
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  const oldDigests = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => oldDigests.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_assert_activity_earning_award(p_organization_id uuid, p_profile_id uuid, p_opportunity_id uuid, p_submission_id uuid, p_points numeric, p_rules_snapshot jsonb, p_selection jsonb)",
      "function:plugin_data.csf_begin_point_submission_authority_base_20260810(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid)",
      "relation:plugin_data.csf_point_submissions",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
  );
});

test("Production forward controller selects just the hotfix from ledger 687", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 687),
  );
  assert.equal(prepared.prefix.length, 687);
  assert.match(
    prepared.query,
    /'20261013071100','csf_repeatable_pending_activity_claims'/u,
  );
  assert.doesNotMatch(
    prepareMigration(repository, readFileSync, versions).query,
    /'20261013071100','csf_repeatable_pending_activity_claims'/u,
  );
});
