import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { after as afterAll } from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
import { pointsFirstRolloutStates } from "./points-first-rollout-catalog.mjs";

const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const repository = new URL("../../", import.meta.url).pathname;
const currentVersions = expectedVersions(repository);
const versions = pointsFirstRolloutStates[0].versions;
const before = read("./final-schema-687.json");
const after = read("./final-schema-points-first-688.json");

// Retain the deployed hotfix's exact history without treating today's combined
// source as an online-migration release or replacing the fence-first catalog.
const fixture = mkdtempSync(resolve(tmpdir(), "csf-points-hotfix-history-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
mkdirSync(resolve(fixture, "supabase/migrations"), { recursive: true });
for (const name of readdirSync(resolve(repository, "supabase/migrations"))) {
  if (versions.includes(name.slice(0, 14)))
    symlinkSync(
      resolve(repository, "supabase/migrations", name),
      resolve(fixture, "supabase/migrations", name),
    );
}
for (const name of ["scripts", ".github"])
  symlinkSync(resolve(repository, name), resolve(fixture, name), "dir");
assert.equal(expectedVersions(fixture).length, 688);

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
  assert.notEqual(read("./final-schema-688.json").ledger, after.ledger);
});

test("the historical hotfix stays bounded and the combined target refuses online release", () => {
  const prepared = prepareMigration(
    fixture,
    readFileSync,
    versions.slice(0, 687),
  );
  assert.equal(prepared.prefix.length, 687);
  assert.match(
    prepared.query,
    /'20261013071100','csf_repeatable_pending_activity_claims'/u,
  );
  assert.doesNotMatch(
    prepareMigration(fixture, readFileSync, versions).query,
    /'20261013071100','csf_repeatable_pending_activity_claims'/u,
  );
  assert.throws(
    () => prepareMigration(repository, readFileSync, currentVersions),
    /not approved|maintenance cutover/u,
  );
});
