import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { sheetDeferredNoteDefinitions } from "./sheet-deferred-note-catalog.mjs";
import { sheetToggleDefinitions } from "./sheet-toggle-catalog.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const fixture = historicalReleaseTestFixture();
const cwd = fixture.cwd;
after(fixture.dispose);
const versions = expectedVersions(cwd).slice(0, 518);
const source = readFileSync(
  "scripts/production/verify-csf-target-schema.sql",
  "utf8",
);
test("494 pins only state transition and review function changes", () => {
  assert.equal(versions.length, 518);
  const changed = sheetToggleDefinitions.filter(
    (row, i) =>
      JSON.stringify(row) !== JSON.stringify(sheetDeferredNoteDefinitions[i]),
  );
  assert.equal(changed.length, 2);
  const current = acceptedCatalogQuery(source, versions.slice(0, 498));
  for (const [signature, digest, body] of sheetToggleDefinitions) {
    assert.ok(current.includes(signature));
    assert.ok(current.includes(digest));
    assert.ok(current.includes(body));
  }
  for (const row of changed)
    assert.ok(
      !acceptedCatalogQuery(source, versions.slice(0, 493)).includes(row[1]),
    );
});
test("493 advances through observation invalidation and the current release tail", () => {
  const result = prepareMigration(cwd, undefined, versions.slice(0, 493));
  assert.equal(
    (
      result.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    expectedVersions(cwd).length - 493,
  );
  assert.ok(result.query.includes("enabled IS DISTINCT FROM p_enabled"));
  assert.ok(result.query.includes("IF NOT d.enabled OR d.observation_state"));
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
      "csf_opportunities_retired_cohort_write_guard",
      "csf_cohort_terms_retired_cohort_write_guard",
      "csf_guard_retired_class_post",
      "csf_guard_retired_shared_term_update",
      "csf_announcement_attachment_cleanup",
      "csf_reconcile_attachment_restore_cleanup",
    ],
  );
  assert.ok(result.query.includes("AND version = '1.2.32'"));
});
