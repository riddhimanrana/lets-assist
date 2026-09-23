import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import {
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import { topLevelDataWrites } from "./migration-data-writes.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const repository = new URL("../../", import.meta.url).pathname;
const before = JSON.parse(read("./final-schema-664.json"));
const after = JSON.parse(read("./final-schema-665.json"));
const versions = expectedVersions(repository).slice(0, 665);
const name = "20260923033020_csf_point_exception_requests";

test("point exceptions extend existing submission and credit models", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  const added = after.objects.filter((row) => !previous.has(row.identity));
  assert.equal(after.objects.length, before.objects.length + 11);
  assert.equal(added.length, 11);
  assert.ok(
    added.every((row) => row.identity.startsWith("function:plugin_data.csf_")),
  );
  const changed = after.objects.filter(
    (row) =>
      previous.has(row.identity) && previous.get(row.identity) !== row.digest,
  );
  assert.deepEqual(
    changed.map((row) => row.identity),
    [
      "function:plugin_data.csf_finalize_point_submission_proof(p_organization_id uuid, p_submission_id uuid, p_file_id uuid, p_upload_token uuid, p_actor_user_id uuid)",
      "function:plugin_data.csf_point_submission_receipt_state(p_organization_id uuid, p_submission_id uuid)",
      "function:plugin_data.csf_resubmit_point_submission(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_correlation_id uuid)",
      "function:plugin_data.csf_resubmit_point_submission_request_v2(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_request_id uuid, p_earning_selection jsonb)",
      "function:plugin_data.csf_review_point_submission_v2(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid)",
      "relation:plugin_data.csf_credit_records",
      "relation:plugin_data.csf_point_submissions",
    ],
  );
  assert.ok(
    before.objects.every((row) =>
      after.objects.some((candidate) => candidate.identity === row.identity),
    ),
  );
});

test("the accepted point exception catalog binds the complete 665 ledger", () => {
  assert.equal(versions.length, 665);
  assert.equal(versions.at(-1), "20260923033020");
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 664)));
});

test("the exception migration has approved bytes and does not backfill credits", () => {
  const sql = read(`../../supabase/migrations/${name}.sql`);
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
});

test("an accepted 664 ledger receives only the point exception migration", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 664),
  );
  assert.equal(prepared.prefix.length, 664);
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    expectedVersions(repository).length - 664,
  );
  assert.ok(
    prepared.query.includes("csf_review_point_exception_appeal_request"),
  );
});
