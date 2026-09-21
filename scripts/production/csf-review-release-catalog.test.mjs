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
import {
  prohibitedDataWrites,
  unreviewedWriteTables,
} from "./migration-data-writes.mjs";

const repository = new URL("../../", import.meta.url).pathname;
const ledger = expectedVersions(repository).slice(0, 631);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-628.json"));
const after = JSON.parse(read("./final-schema-631.json"));
const shortIdentity = (identity) => identity.split("(")[0];
const previous = new Map(
  before.objects.map((row) => [row.identity, row.digest]),
);
const added = after.objects.filter((row) => !previous.has(row.identity));
const changed = after.objects.filter(
  (row) =>
    previous.has(row.identity) && previous.get(row.identity) !== row.digest,
);

test("631 binds the exact hold, notification, and attendance ledger", () => {
  assert.equal(ledger.length, 631);
  assert.deepEqual(ledger.slice(-3), [
    "20260920180915",
    "20260920181255",
    "20260920181754",
  ]);
  assert.equal(after.inventory, before.inventory);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", ledger),
    finalSchemaCatalog(after, ledger),
  );
  assert.throws(
    () => acceptedCatalogQuery("", [...ledger, "20990101000000"]),
    /explicit release review/u,
  );
  assert.throws(() => finalSchemaCatalog(after, ledger.slice(0, 628)));
});

test("the inventory adds only the reviewed entrypoints and notification triggers", () => {
  assert.deepEqual(
    added.map((row) => shortIdentity(row.identity)),
    [
      "function:plugin_data.csf_count_cohort_term_applicants",
      "function:plugin_data.csf_invalidate_changed_decision_mapping",
      "function:plugin_data.csf_meeting_attendance_counts",
      "function:plugin_data.csf_meeting_preview_id",
      "function:plugin_data.csf_queue_account_connection_notice",
      "function:plugin_data.csf_queue_application_decision_notice",
      "function:plugin_data.csf_queue_class_access_notice",
      "function:plugin_data.csf_queue_organization_access_notice",
      "function:plugin_data.csf_release_reviewed_sheet_decisions",
      "function:plugin_data.csf_stage_automatic_sheet_decisions",
      "function:plugin_data.csf_transition_notice_recipient_allowed",
    ],
  );
  const next = new Set(after.objects.map((row) => row.identity));
  assert.deepEqual(
    before.objects.filter((row) => !next.has(row.identity)),
    [],
  );
});

test("existing permissions and definitions move only for the reviewed objects", () => {
  assert.deepEqual(
    changed.map((row) => shortIdentity(row.identity)),
    [
      "function:plugin_data.csf_authorize_publication_notification",
      "function:plugin_data.csf_campaign_platform_sender_identity",
      "function:plugin_data.csf_import_application_response_row_identity_base",
      "function:plugin_data.csf_import_preview_readiness",
      "function:plugin_data.csf_publication_email_recipient_allowed",
      "function:plugin_data.csf_record_personal_notification",
      "function:plugin_data.csf_release_sheet_application_decisions",
      "function:plugin_data.csf_sheet_application_decision_term_state",
      "function:plugin_data.csf_stage_sheet_application_decisions",
      "relation:plugin_data.csf_application_decision_mappings",
      "relation:plugin_data.csf_application_decision_releases",
      "relation:plugin_data.csf_application_decision_stages",
      "relation:plugin_data.csf_application_decision_sync_rows",
      "relation:plugin_data.csf_communication_campaigns",
      "relation:plugin_data.csf_profile_accounts",
      "relation:plugin_data.csf_profile_cohort_memberships",
      "relation:plugin_data.csf_term_applications",
      "relation:public.organization_members",
    ],
  );
});

test("the three migrations are byte-pinned and do not rewrite student records", () => {
  const names = [
    "20260920180915_csf_review_hold_and_explicit_release",
    "20260920181255_csf_durable_account_notices",
    "20260920181754_csf_attendance_reconciliation_counts",
  ];
  for (const name of names) {
    const sql = read(`../../supabase/migrations/${name}.sql`);
    assert.deepEqual(
      approvedMigrations.find(([entry]) => entry === name),
      [name, createHash("sha256").update(sql).digest("hex")],
    );
    assert.deepEqual(prohibitedDataWrites(sql), []);
    assert.deepEqual(unreviewedWriteTables(sql), []);
  }
  const prepared = prepareMigration(
    repository,
    readFileSync,
    ledger.slice(0, 628),
  );
  assert.equal(prepared.prefix.length, 628);
  assert.equal(prepared.versions.length, 638);
  assert.equal(prepared.versions.at(-1), "20260921020100");
  for (const name of names)
    assert.ok(
      prepared.query.includes(`'${name.slice(0, 14)}','${name.slice(15)}'`),
    );
  assert.ok(
    !prepared.query.includes(
      "'20260920080000','csf_attendance_existing_record_fast_path'",
    ),
  );
});
