import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
import { topLevelDataWrites } from "./migration-data-writes.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-674.json"));
const after = JSON.parse(read("./final-schema-675.json"));
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 675);

test("profile email audiences change only the reviewed selection and delivery functions", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_activity_email_audience_snapshot(p_organization_id uuid, p_actor_user_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity_id uuid)",
      "function:plugin_data.csf_preview_activity_email(p_organization_id uuid, p_actor_user_id uuid, p_term_id uuid, p_cohort_id uuid)",
      "function:plugin_data.csf_publication_email_recipient_allowed(p_organization_id uuid, p_snapshot_id uuid)",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
  );
});

test("the migration leaves existing contacts, decisions and frozen audiences unchanged", () => {
  const sql = read(
    "../../supabase/migrations/20260924095624_csf_activity_email_profile_audience.sql",
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  assert.equal(versions.at(-1), "20260924095624");
  assert.match(
    prepareMigration(repository, readFileSync, versions.slice(0, 674)).query,
    /'20260924095624','csf_activity_email_profile_audience'/u,
  );
  assert.doesNotMatch(
    prepareMigration(repository, readFileSync, versions).query,
    /'20260924095624','csf_activity_email_profile_audience'/u,
  );
});
