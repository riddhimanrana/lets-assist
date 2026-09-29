import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after as afterTests } from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-677.json"));
const changed = JSON.parse(read("./final-schema-678.json"));
const published = JSON.parse(read("./final-schema-679.json"));
const latest = JSON.parse(read("./final-schema-680.json"));
const retryFix = JSON.parse(read("./final-schema-681.json"));
const queueLockOrder = JSON.parse(read("./final-schema-682.json"));
// Keep this historical release proof on its approved migration ledger.
const fixture = historicalReleaseTestFixture();
afterTests(fixture.dispose);
const repository = fixture.cwd;
const versions = expectedVersions(repository).slice(0, 682);

test("queued export release changes only the deletion and both queue functions", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    changed.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    changed.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_delete_member_point_submission_request(p_organization_id uuid, p_profile_id uuid, p_submission_id uuid, p_actor_user_id uuid, p_request_id uuid)",
      "function:plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id uuid, p_destination_id uuid, p_record_kind text, p_record_id uuid)",
      "function:plugin_data.csf_queue_sheet_sync_snapshot_internal(p_organization_id uuid, p_destination_id uuid, p_record_kind text, p_record_id uuid, p_snapshot jsonb)",
    ],
  );
  assert.deepEqual(published.objects, changed.objects);
  assert.deepEqual(latest.objects, changed.objects);
  assert.deepEqual(retryFix.objects, changed.objects);
  for (const [count, manifest] of [
    [678, changed],
    [679, published],
    [680, latest],
    [681, retryFix],
    [682, queueLockOrder],
  ]) {
    assert.equal(
      acceptedCatalogQuery("invalid predecessor", versions.slice(0, count)),
      csfSubmissionDeletionCatalog(
        finalSchemaCatalog(manifest, versions.slice(0, count)),
      ),
    );
  }
});

test("forward controller applies the exact fix and publication once", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 677),
  );
  assert.match(
    prepared.query,
    /'20260928025013','csf_unsubmit_unexported_sheet_claim'/u,
  );
  assert.match(prepared.query, /'20260928225322','publish_dvhs_csf_1_2_82'/u);
  assert.match(
    prepared.query,
    /Plugin catalog moved since this signed integration was prepared/u,
  );
  assert.match(prepared.query, /'20260928234812','publish_dvhs_csf_1_2_83'/u);
  assert.match(prepared.query, /'20260929001956','publish_dvhs_csf_1_2_84'/u);
  const retry = prepareMigration(repository, readFileSync, versions);
  assert.doesNotMatch(
    retry.query,
    /'20260929001956','publish_dvhs_csf_1_2_84'/u,
  );
  assert.doesNotMatch(
    retry.query,
    /'20260928234812','publish_dvhs_csf_1_2_83'/u,
  );
  assert.doesNotMatch(
    retry.query,
    /'20260928025013','csf_unsubmit_unexported_sheet_claim'/u,
  );
  assert.doesNotMatch(
    retry.query,
    /'20260928225322','publish_dvhs_csf_1_2_82'/u,
  );
});

test("nonblocking deletion fence changes only the two queue helpers", () => {
  const previous = new Map(
    retryFix.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    queueLockOrder.objects.map((row) => row.identity),
    retryFix.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    queueLockOrder.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id uuid, p_destination_id uuid, p_record_kind text, p_record_id uuid)",
      "function:plugin_data.csf_queue_sheet_sync_snapshot_internal(p_organization_id uuid, p_destination_id uuid, p_record_kind text, p_record_id uuid, p_snapshot jsonb)",
    ],
  );
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 681),
  );
  assert.match(
    prepared.query,
    /'20260929003720','csf_sheet_queue_deletion_lock_order'/u,
  );
  assert.doesNotMatch(
    prepareMigration(repository, readFileSync, versions).query,
    /'20260929003720','csf_sheet_queue_deletion_lock_order'/u,
  );
});
