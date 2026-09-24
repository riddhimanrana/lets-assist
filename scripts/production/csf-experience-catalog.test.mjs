import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const read = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const before = read("./final-schema-668.json");
const after = read("./final-schema-671.json");
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 671);
const name = (identity) => identity.split("(")[0];

test("experience release changes only reviewed activity, feedback and revision objects", () => {
  const old = new Map(before.objects.map((row) => [row.identity, row.digest]));
  const changed = after.objects
    .filter(
      (row) => old.has(row.identity) && old.get(row.identity) !== row.digest,
    )
    .map((row) => name(row.identity))
    .sort();
  assert.deepEqual(changed, [
    "function:plugin_data.csf_edit_activity_layout",
    "function:plugin_data.csf_enqueue_stale_submission_proof_cleanup",
    "function:plugin_data.csf_profile_merge_reference_plan",
    "function:public.enqueue_project_feedback_requests",
    "function:public.submit_project_feedback_from_request",
    "relation:plugin_data.csf_activity_sections",
    "relation:plugin_data.csf_opportunities",
    "relation:plugin_data.csf_point_submissions",
    "relation:plugin_data.csf_submission_files",
    "relation:public.feedback",
    "relation:public.notification_settings",
    "relation:public.project_feedback_requests",
  ]);
  assert.equal(
    before.objects.filter(
      (row) => !after.objects.some((next) => next.identity === row.identity),
    ).length,
    0,
  );
  assert.deepEqual(
    after.objects
      .filter((row) => !old.has(row.identity))
      .map((row) => name(row.identity))
      .sort(),
    [
      "function:app_private.save_platform_experience_feedback",
      "function:plugin_data.csf_activity_automatic_week",
      "function:plugin_data.csf_activity_catalog_changed",
      "function:plugin_data.csf_begin_submission_edit",
      "function:plugin_data.csf_cleanup_deleted_submission_edit",
      "function:plugin_data.csf_commit_submission_edit",
      "function:plugin_data.csf_consume_experience_prompt",
      "function:plugin_data.csf_increment_submission_revision",
      "function:plugin_data.csf_profile_merge_reference_plan_experience_base",
      "function:plugin_data.csf_refresh_activity_catalog",
      "function:plugin_data.csf_review_point_submission_revision_request",
      "function:plugin_data.csf_save_experience_feedback",
      "function:plugin_data.csf_validate_submission_edit",
      "function:public.save_platform_experience_from_request",
      "relation:app_private.platform_feedback_rollout",
      "relation:plugin_data.csf_experience_prompts",
      "relation:plugin_data.csf_submission_edit_requests",
    ],
  );
  assert.equal(versions.at(-1), "20260924034956");
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    finalSchemaCatalog(after, versions),
  );
});

test("forward transaction pins the three experience migrations and keeps guards", () => {
  const { query } = prepareMigration(repository);
  for (const version of ["20260924033800", "20260924034832", "20260924034956"])
    assert.ok(query.includes(`'${version}'`));
  assert.match(query, /p_expected_revision bigint/u);
  assert.match(query, /feedback_experience_identity/u);
  assert.match(query, /platform_feedback_rollout/u);
  assert.match(query, /superseded_at/u);
});
