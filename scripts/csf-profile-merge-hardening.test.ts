import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const migration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260812010529_csf_profile_merge_cohort_consolidation.sql",
  ),
  "utf8",
);
const teardownMigration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260823211000_drop_csf_onboarding_links.sql",
  ),
  "utf8",
);
const referenceTest = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_profile_merge_reference_completeness.test.sql",
  ),
  "utf8",
);
const concurrencyTest = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_identity_mutation_locking.test.sql",
  ),
  "utf8",
);
const browserTest = readFileSync(
  join(repositoryRoot, "tests/e2e/csf/identity-safety.spec.ts"),
  "utf8",
);

describe("CSF profile-merge hardening source contract", () => {
  test("catalogs every current profile FK and the candidate array", () => {
    const references = [
      "csf_profiles.merged_into_profile_id",
      "csf_profile_accounts.profile_id",
      "csf_profile_cohort_memberships.profile_id",
      "csf_term_applications.profile_id",
      "csf_application_files.profile_id",
      "csf_staff_positions.profile_id",
      "csf_profile_restrictions.profile_id",
      "csf_point_submissions.profile_id",
      "csf_submission_files.profile_id",
      "csf_credit_records.profile_id",
      "csf_meeting_attendance.profile_id",
      "csf_sheet_import_rows.matched_profile_id",
      "csf_sheet_import_rows.commit_target_profile_id",
      "csf_profile_link_requests.matched_profile_id",
      "csf_profile_link_requests.candidate_profile_ids",
      "csf_profile_merge_reviews.source_profile_id",
      "csf_profile_merge_reviews.target_profile_id",
      "csf_profile_activity_events.profile_id",
      "csf_admin_audit_events.actor_profile_id",
      "csf_opportunity_signups.profile_id",
      "csf_term_memberships.profile_id",
      "csf_point_appeals.profile_id",
      "csf_dues_records.profile_id",
      "csf_application_correction_requests.profile_id",
      "csf_term_membership_outcomes.profile_id",
      "csf_communication_recipient_snapshots.profile_id",
      "csf_communication_broadcast_preferences.profile_id",
    ];

    for (const reference of references) {
      expect(migration).toContain(`plugin_data.${reference}`);
      expect(referenceTest).toContain(reference);
    }
  });

  test("the onboarding-link teardown removed its reference arm from the plan", () => {
    // 20260823211000 recreates csf_profile_merge_reference_plan and
    // csf_merge_profiles without the retired onboarding-link surface.
    expect(teardownMigration).toContain(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_reference_plan",
    );
    expect(teardownMigration).toContain(
      "DROP TABLE plugin_data.csf_onboarding_links",
    );
    expect(teardownMigration).toContain(
      "Onboarding-link teardown left function(s) behind",
    );
    expect(teardownMigration).not.toContain(
      "csf_onboarding_links.recipient_profile_id",
    );
    expect(teardownMigration).not.toContain("directInvitations");
    expect(referenceTest).not.toContain("csf_onboarding_links");
  });

  test("uses every profile-key uniqueness predicate in preview and a live-reference postcondition", () => {
    expect(migration).toContain("active_point_submission_collision");
    expect(migration).toContain(
      "status NOT IN ('rejected', 'duplicate', 'withdrawn')",
    );
    expect(migration).toContain("active_staff_assignment_collision");
    expect(migration).toContain("source_row.status = 'active'");
    expect(migration).toContain("open_point_appeal_collision");
    expect(migration).toContain(
      "source_row.status IN ('submitted', 'under_review')",
    );
    expect(migration).toContain("v_live_source_references <> 0");
    expect(migration).toContain("zeroLiveSourceReferences");
    expect(referenceTest).toContain("Source rejected claim");
    expect(referenceTest).toContain("Target withdrawn claim");
    expect(referenceTest).toContain("active staff-assignment collision");
    expect(referenceTest).toContain("open point-appeal collision");
  });

  test("classifies import targets once and rewrites only unfrozen live matches", () => {
    expect(migration).toContain("csf_profile_merge_import_row_disposition");
    expect(migration).toContain("THEN 'immutable_history'");
    expect(migration).toContain("THEN 'live_rewrite'");
    expect(migration).toContain("ELSE 'preflight_blocker'");
    expect(migration).toContain("outstanding_import_commit_target");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles_identity_base",
    );
    expect(migration).toContain(
      "UPDATE plugin_data.csf_sheet_import_rows AS import_row",
    );
    expect(migration).toContain("= 'live_rewrite';");
    expect(migration).toContain("<> 'immutable_history'");
    expect(migration).toContain("'importRowLiveMatches'");
    expect(migration).toContain("'preflightBlockedReferences'");
  });

  test("covers settled, retryable, frozen, in-flight, and unknown import rows behaviorally", () => {
    for (const state of [
      "'succeeded'",
      "'failed'",
      "'frozen'",
      "'in_flight'",
      "'unknown'",
      "'historical_unknown'",
      "'terminally_skipped'",
    ]) {
      expect(referenceTest).toContain(state);
    }

    expect(referenceTest).toContain(
      "settled success and terminal-skip evidence do not block",
    );
    expect(referenceTest).toContain(
      "only the live match moves; settled matched and frozen targets remain",
    );
    expect(referenceTest).toContain(
      "execution rechecks and refuses the same failed/frozen import blocker",
    );
    expect(referenceTest).toContain(
      "execution rechecks and refuses the same in-flight import blocker",
    );
    expect(referenceTest).toContain(
      "execution rechecks and refuses the same unknown import blocker",
    );
    expect(referenceTest).toContain("SELECT extensions.plan(48)");
  });

  test("has one organization-first lock hierarchy and no global table locks", () => {
    expect(migration).toContain("csf_lock_identity_mutation");
    expect(migration).toContain("plugin_data.csf_upsert_profile:");
    expect(migration).not.toContain("LOCK TABLE");
    expect(concurrencyTest).toContain("dblink_send_query");
    expect(concurrencyTest).toContain("same-organization atomic profile edit");
    expect(concurrencyTest).toContain("cross-organization profile edit");
    expect(migration).toContain(
      "RENAME TO csf_claim_import_commit_attempt_identity_base",
    );
    expect(migration).toContain(
      "ORDER BY import_row.job_id, import_row.sheet_tab_name",
    );
  });

  test("keeps internal wrappers private and public signatures service-only", () => {
    for (const internalName of [
      "csf_merge_profiles_request_identity_base",
      "csf_submit_profile_link_request_identity_base",
      "csf_confirm_profile_claim_identity_base",
      "csf_decline_profile_claim_identity_base",
      "csf_import_class_history_row_identity_base",
      "csf_import_class_history_row_v2_identity_base",
      "csf_import_student_roster_row_identity_base",
      "csf_import_application_response_row_identity_base",
      "csf_claim_import_commit_attempt_identity_base",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION plugin_data.${internalName}`,
      );
      expect(migration).toContain(
        "FROM PUBLIC, anon, authenticated, service_role",
      );
    }

    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)",
    );
  });

  test("the visible suite includes both refusal and successful merge journeys", () => {
    expect(browserTest).toContain(
      "a merge with conflicting identity evidence is previewed and refused",
    );
    expect(browserTest).toContain(
      "a corroborated duplicate completes a valid visible merge",
    );
    expect(browserTest).toContain("zeroLiveSourceReferences");
  });
});
