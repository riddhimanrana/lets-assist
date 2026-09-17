import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptedCatalogQuery,
  acceptedFingerprints565,
} from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
import {
  prohibitedDataWrites,
  topLevelDataWrites,
  unreviewedDataWrites,
} from "./migration-data-writes.mjs";

// Pin the integrated extensions separately from the original fingerprint swaps.

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const ledger = expectedVersions(cwd);
const EXTENSIONS = [
  "20260917070000_csf_class_join_review_only_onboarding",
  "20260917080000_csf_detailed_publication_notices",
  "20260917090000_csf_officer_application_editor_and_note_visibility",
  "20260917100000_csf_graduated_cohort_retention",
  "20260917110000_csf_historical_attendance_correction",
  "20260917130000_csf_officer_course_corrections",
  "20260917140000_csf_import_personal_notice_suppression",
  "20260917150000_csf_course_retention_coverage",
  "20260917160000_csf_notice_campaign_dispatch_identity",
  "20260917170000_csf_retention_and_attendance_release_guards",
  "20260917180000_csf_unreconcile_sheet_import_row",
  "20260917190000_csf_member_reminder_visibility",
  "20260917200000_csf_unreconcile_retry_receipt",
  "20260917210000_csf_member_report_term_scope",
  "20260917220000_csf_member_report_quota_serialization",
  "20260917230000_csf_profile_activity_authority_retry_guards",
  "20260918000000_csf_notice_sender_and_context",
  "20260918010000_csf_semester_ledger_write_receipts",
  "20260918011000_csf_semester_ledger_identity_lifecycle",
  "20260918012000_csf_semester_ledger_reconciliation_and_merge_fence",
  "20260918013000_csf_semester_ledger_claim_identity_and_trigger_grants",
  "20260918014000_csf_semester_ledger_link_revocation_fence",
  "20260918015000_csf_semester_ledger_merge_claim_fence",
  "20260918016000_csf_semester_ledger_authority_fences",
  "20260918020000_csf_directory_dues_lookup_index",
  "20260918030000_csf_attendance_response_window",
  "20260918040000_csf_retired_cohort_visibility",
  "20260918050000_retire_duplicate_attendance_cron_jobs",
  "20260918060000_project_status_schedule_validation",
  "20260918070000_csf_missing_tenant_lookup_indexes",
  "20260918080000_csf_class_publication_email_audience",
  "20260918090000_project_status_schedule_review_fixes",
  "20260918100000_project_status_schedule_nonempty_windows",
  "20260918110000_csf_retired_cohort_operational_fence",
  "20260918120000_csf_retired_join_code_backfill",
  "20260918130000_csf_meeting_window_edit_authority",
  "20260918140000_csf_retired_cohort_mutation_fence",
  "20260918150000_csf_retired_directory_projection",
];

test("the release is the 557 decisions baseline plus the reviewed integrated extensions", () => {
  assert.equal(ledger.length, 557 + EXTENSIONS.length);
  assert.deepEqual(
    ledger.slice(557),
    EXTENSIONS.map((name) => name.slice(0, 14)),
  );
  // 1200 header provenance is still with the source lane and must not appear.
  assert.ok(!ledger.includes("20260917120000"));
  for (const name of EXTENSIONS) {
    assert.ok(
      approvedMigrations.some(([entry]) => entry === name),
      `${name} is not in the approved migration tail`,
    );
  }
});

test("each fingerprint the extensions move is measured, or named as unmeasured", () => {
  const baseline = acceptedCatalogQuery(source, ledger.slice(0, 557));
  for (const entry of acceptedFingerprints565) {
    if (!entry.before) continue;
    assert.equal(
      baseline.split(entry.before).length - 1,
      entry.occurrences,
      `${entry.object}: the 557 catalog does not pin it ${entry.occurrences} time(s)`,
    );
    if (entry.after)
      assert.ok(
        !baseline.includes(entry.after),
        `${entry.object}: the replacement predates its migration`,
      );
  }

  // Every mover is measured now: the final capture supplied the two the T
  // replay missed and the two relation digests the systematic diff found.
  assert.deepEqual(
    acceptedFingerprints565.filter((entry) => !entry.after || !entry.before),
    [],
  );
});

test("the 565 catalog refuses to pin what was never measured", () => {
  const unmeasured = acceptedFingerprints565.filter(
    (entry) => !entry.after || !entry.before,
  );
  if (unmeasured.length) {
    assert.throws(
      () => acceptedCatalogQuery(source, ledger),
      /moved but were never measured/u,
      "an unmeasured drift must fail closed, not delegate",
    );
    return;
  }
  // Once every value is supplied the swap has to be complete and exact.
  const current = acceptedCatalogQuery(source, ledger.slice(0, 568));
  const baseline = acceptedCatalogQuery(source, ledger.slice(0, 557));
  for (const entry of acceptedFingerprints565) {
    assert.ok(!current.includes(entry.before), `${entry.object} survived`);
    assert.equal(
      current.split(entry.after).length - 1,
      entry.occurrences,
      `${entry.object} was not swapped everywhere`,
    );
  }
  assert.equal(current.length, baseline.length);
});

test("a ledger the catalog has never reviewed still fails closed", () => {
  const altered = [...ledger];
  altered[558] = "20990101000000";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
  assert.throws(
    () => acceptedCatalogQuery(source, ledger.slice(0, 560)),
    /explicit release review/u,
  );
});

test("every data write a migration carries is on the reviewed allowlist", () => {
  const found = [];
  for (const name of EXTENSIONS) {
    const sql = readFileSync(`${cwd}supabase/migrations/${name}.sql`, "utf8");
    assert.deepEqual(
      unreviewedDataWrites(sql),
      [],
      `${name} carries a data write nobody reviewed`,
    );
    assert.deepEqual(
      prohibitedDataWrites(sql),
      [],
      `${name} writes to a table migrations may never write`,
    );
    for (const write of topLevelDataWrites(sql)) found.push(write.table);
  }
  // The whole reviewed set, including the static retention metadata seed and
  // the projection of previously committed retired-cohort receipts.
  assert.deepEqual(found.sort(), [
    "plugin_data.csf_admin_audit_events",
    "plugin_data.csf_class_join_codes",
    "plugin_data.csf_cohorts",
    "plugin_data.csf_retention_identity_inventory",
    "plugin_data.csf_retention_identity_inventory",
    "plugin_data.csf_retention_reference_policy",
    "plugin_data.csf_retention_reference_policy",
    "plugin_data.csf_retention_reference_policy",
    "plugin_data.csf_role_permissions",
  ]);
});

test("the allowlist refuses a write it did not review", () => {
  // Same table and operation, different statement. The statement hash is what
  // makes the entry a review rather than a category permit.
  assert.deepEqual(
    unreviewedDataWrites(
      "INSERT INTO plugin_data.csf_role_permissions (organization_id) SELECT id FROM x;",
    ).map((write) => write.table),
    ["plugin_data.csf_role_permissions"],
  );
  // Installation state and the student's own record stay refused outright.
  for (const table of [
    "public.organization_plugin_installs",
    "plugin_data.csf_term_applications",
    "plugin_data.csf_profiles",
    "plugin_data.csf_point_submissions",
  ]) {
    const sql = `UPDATE ${table} SET status = 'x';`;
    assert.deepEqual(
      prohibitedDataWrites(sql).map((write) => write.table),
      [table],
    );
    assert.deepEqual(
      unreviewedDataWrites(sql).map((w) => w.table),
      [table],
    );
  }
});

test("a write cannot hide inside a dollar-quoted block", () => {
  const hidden =
    "DO $guard$ BEGIN INSERT INTO plugin_data.csf_profiles VALUES (1); END $guard$;";
  assert.deepEqual(
    prohibitedDataWrites(hidden).map((write) => write.table),
    ["plugin_data.csf_profiles"],
  );
  // The same statement at the top level is also caught.
  assert.equal(
    topLevelDataWrites("INSERT INTO plugin_data.csf_profiles VALUES (1);")
      .length,
    1,
  );
});

test("the shipped migration bytes are the bytes the replay measured", () => {
  const names = readdirSync(`${cwd}supabase/migrations`)
    .filter((entry) => /^\d{14}_.+\.sql$/u.test(entry))
    .sort();
  assert.equal(names.length, ledger.length);
  // Every migration, not a sample: the manifest and the tree have to agree in
  // both directions, so neither an edited file nor a stale manifest entry can
  // pass.
  assert.deepEqual(names, Object.keys(migrationDigests).sort());

  const drifted = [];
  for (const name of names) {
    const actual = createHash("sha256")
      .update(readFileSync(`${cwd}supabase/migrations/${name}`, "utf8"))
      .digest("hex");
    if (migrationDigests[name] !== actual) drifted.push(name);
  }
  // The catalog digests were read off a stack built from exactly these files,
  // so any drift means the pins describe a schema nobody replayed.
  assert.deepEqual(drifted, []);
  assert.ok(
    Object.values(migrationDigests).every((digest) =>
      /^[0-9a-f]{64}$/u.test(digest),
    ),
  );
});
