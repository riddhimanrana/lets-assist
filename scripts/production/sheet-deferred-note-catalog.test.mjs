import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { sheetObservationDefinitions } from "./sheet-observation-catalog.mjs";
import { sheetDeferredNoteDefinitions } from "./sheet-deferred-note-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const versions = expectedVersions(process.cwd()).slice(0, 518);
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);
test("493 changes only the profile snapshot function fingerprint", () => {
  assert.equal(versions.length, 518);
  const changed = sheetDeferredNoteDefinitions.filter(
    (row, i) =>
      JSON.stringify(row) !== JSON.stringify(sheetObservationDefinitions[i]),
  );
  assert.equal(changed.length, 1);
  assert.equal(
    changed[0][0],
    "plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)",
  );
  const current = acceptedCatalogQuery(source, versions.slice(0, 493));
  for (const [signature, digest, body] of sheetDeferredNoteDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 492)).includes(
      changed[0][1],
    ),
  );
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 492)),
    acceptedCatalogQuery(source, versions.slice(0, 491)),
  );
});
test("492 advances through profile note export deferral and the current release tail", () => {
  const result = prepareMigration(
    process.cwd(),
    undefined,
    versions.slice(0, 492),
  );
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    expectedVersions(process.cwd()).length - 492,
  );
  assert.ok(
    result.query.includes("jsonb_build_object('comments','[]'::jsonb)"),
  );
  assert.deepEqual(
    Array.from(
      new Set(
        Array.from(
          result.query.matchAll(/CREATE TRIGGER ([a-z_]+)/gu),
          (match) => match[1],
        ),
      ),
    ),
    [
      "csf_announcements_publication_notifications",
      "csf_activities_publication_notifications",
      "csf_term_applications_new_intake_guard",
      "csf_application_decision_sync_runs_immutable",
      "csf_application_decision_sync_sources_immutable",
      "csf_application_decision_sync_rows_immutable",
      "csf_application_decision_releases_immutable",
      "csf_sheet_writeback_review_mode_guard",
      "csf_decision_stage_profile_matches_application",
      "csf_point_submissions_personal_notifications",
      "csf_profiles_personal_notifications",
      "csf_communication_campaigns_notice_scope_guard",
      "csf_retention_runs_immutable",
      "csf_retention_preview_profiles_immutable",
      "csf_retention_profile_tombstones_immutable",
      "csf_retention_source_tombstones_immutable",
      "csf_profile_cohort_memberships_retention_guard",
      "csf_sheet_import_rows_retention_guard",
      "csf_application_course_corrections_immutable",
      "csf_application_course_entries_correction_guard",
      "csf_communication_campaigns_aa_platform_sender",
      "csf_sheet_semester_mapping_immutable",
      "csf_sheet_semester_write_immutable",
      "csf_semester_write_link_owner",
      "csf_workbook_link_unsettled_write",
      "csf_semester_write_destination_authority",
      "csf_semester_write_mapping_delete",
      "csf_semester_write_membership",
      "csf_membership_unsettled_semester_write",
      "csf_attendance_response_window_guard",
      "csf_cohorts_retired_status_guard",
      "csf_retention_retired_cohorts_status_projection",
    ],
  );
  assert.ok(result.query.includes("AND version = '1.2.32'"));
});
