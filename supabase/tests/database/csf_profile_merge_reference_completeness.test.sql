BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(49);

-- ---------------------------------------------------------------------------
-- Exact current-schema profile-reference catalog
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE expected_csf_profile_fk_references (
  reference text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_csf_profile_fk_references (reference) VALUES
  ('csf_profiles.merged_into_profile_id'),
  ('csf_profile_accounts.profile_id'),
  ('csf_profile_cohort_memberships.profile_id'),
  ('csf_term_applications.profile_id'),
  ('csf_application_files.profile_id'),
  ('csf_staff_positions.profile_id'),
  ('csf_profile_restrictions.profile_id'),
  ('csf_point_submissions.profile_id'),
  ('csf_submission_files.profile_id'),
  ('csf_credit_records.profile_id'),
  ('csf_meeting_attendance.profile_id'),
  ('csf_sheet_import_rows.matched_profile_id'),
  ('csf_sheet_import_rows.commit_target_profile_id'),
  ('csf_partner_submission_rows.profile_id'),
  ('csf_profile_link_requests.matched_profile_id'),
  ('csf_profile_merge_reviews.source_profile_id'),
  ('csf_profile_merge_reviews.target_profile_id'),
  ('csf_profile_activity_events.profile_id'),
  ('csf_admin_audit_events.actor_profile_id'),
  ('csf_opportunity_signups.profile_id'),
  ('csf_term_memberships.profile_id'),
  ('csf_point_appeals.profile_id'),
  ('csf_dues_records.profile_id'),
  ('csf_onboarding_links.recipient_profile_id'),
  ('csf_application_correction_requests.profile_id'),
  ('csf_term_membership_outcomes.profile_id'),
  ('csf_communication_recipient_snapshots.profile_id'),
  ('csf_partner_club_representatives.profile_id'),
  ('csf_communication_broadcast_preferences.profile_id');

CREATE TEMP VIEW actual_csf_profile_fk_references AS
SELECT DISTINCT
  child.relname || '.' || child_attribute.attname AS reference
FROM pg_catalog.pg_constraint AS constraint_row
JOIN pg_catalog.pg_class AS child
  ON child.oid = constraint_row.conrelid
JOIN pg_catalog.pg_namespace AS child_namespace
  ON child_namespace.oid = child.relnamespace
CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
  WITH ORDINALITY AS child_key(attnum, ordinal)
JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
  WITH ORDINALITY AS parent_key(attnum, ordinal)
  ON parent_key.ordinal = child_key.ordinal
JOIN pg_catalog.pg_attribute AS child_attribute
  ON child_attribute.attrelid = constraint_row.conrelid
 AND child_attribute.attnum = child_key.attnum
JOIN pg_catalog.pg_attribute AS parent_attribute
  ON parent_attribute.attrelid = constraint_row.confrelid
 AND parent_attribute.attnum = parent_key.attnum
WHERE constraint_row.contype = 'f'
  AND constraint_row.confrelid = 'plugin_data.csf_profiles'::regclass
  AND child_namespace.nspname = 'plugin_data'
  AND parent_attribute.attname = 'id';

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM actual_csf_profile_fk_references),
  29,
  'the exact current schema has twenty-nine logical FK columns that reference CSF profiles'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT reference FROM expected_csf_profile_fk_references
    EXCEPT
    SELECT reference FROM actual_csf_profile_fk_references
  ),
  'the reviewed inventory omits no current CSF profile FK'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT reference FROM actual_csf_profile_fk_references
    EXCEPT
    SELECT reference FROM expected_csf_profile_fk_references
  ),
  'the exact schema contains no unclassified CSF profile FK'
);

CREATE TEMP TABLE merge_reference_plan AS
SELECT plugin_data.csf_profile_merge_reference_plan(
  'fb100000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001'
) AS payload;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 'plugin_data.' || reference AS reference
    FROM expected_csf_profile_fk_references
    EXCEPT
    (
      SELECT entry->>'reference'
      FROM merge_reference_plan,
        LATERAL pg_catalog.jsonb_array_elements(
          payload->'sameTransactionRewrites'
        ) AS entry
      UNION
      SELECT entry->>'reference'
      FROM merge_reference_plan,
        LATERAL pg_catalog.jsonb_array_elements(
          payload->'immutableHistoryRetentions'
        ) AS entry
      UNION
      SELECT entry->>'reference'
      FROM merge_reference_plan,
        LATERAL pg_catalog.jsonb_array_elements(
          payload->'preflightBlockedReferences'
        ) AS entry
    )
  ),
  'every current FK appears in the canonical rewrite, history, or blocker plan'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM merge_reference_plan,
      LATERAL pg_catalog.jsonb_array_elements(
        payload->'sameTransactionRewrites'
      ) AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_profile_link_requests.candidate_profile_ids'
  ),
  'the canonical plan also inventories the non-FK candidate-profile array'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM merge_reference_plan,
      LATERAL pg_catalog.jsonb_array_elements(
        payload->'sameTransactionRewrites'
      ) AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_onboarding_links.recipient_profile_id'
      AND entry->>'scope' ~ 'open delivery, acceptance, expiry, and cancellation state is preserved'
  ),
  'direct invitations explicitly preserve open, accepted, expired, and cancelled delivery semantics while rebinding ownership'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM merge_reference_plan,
      LATERAL pg_catalog.jsonb_array_elements(
        payload->'immutableHistoryRetentions'
      ) AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_term_membership_outcomes.profile_id'
  )
  AND EXISTS (
    SELECT 1
    FROM merge_reference_plan,
      LATERAL pg_catalog.jsonb_array_elements(
        payload->'immutableHistoryRetentions'
      ) AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_communication_recipient_snapshots.profile_id'
  )
  AND EXISTS (
    SELECT 1
    FROM merge_reference_plan,
      LATERAL pg_catalog.jsonb_array_elements(
        payload->'immutableHistoryRetentions'
      ) AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_sheet_import_rows.commit_target_profile_id'
  ),
  'closure, outbound-audience, and settled frozen import-target references are deliberately retained as immutable history'
);
SELECT extensions.ok(
  (SELECT payload->'preflightBlockers' FROM merge_reference_plan)
    ? 'active_point_submission_claim_unique_key'
  AND (SELECT payload->'preflightBlockers' FROM merge_reference_plan)
    ? 'outstanding_import_commit_target',
  'the catalog names active point claims and outstanding import targets as canonical blockers'
);
SELECT extensions.ok(
  (SELECT payload->'preflightBlockers' FROM merge_reference_plan)
    ? 'active_staff_assignment_unique_key'
  AND (SELECT payload->'preflightBlockers' FROM merge_reference_plan)
    ? 'open_point_appeal_unique_key',
  'the catalog names every other partial unique index whose key includes rewritten profile ownership'
);

-- ---------------------------------------------------------------------------
-- Preview/execution agreement for the partial point-claim unique index
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'fb000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'point-merge-officer@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'CSF Point Merge Agreement', 'csf-point-merge-agreement', 'school', '983311'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'fb200000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'FALL-2040', 'Fall 2040', '2040-2041', 'fall', true
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, status
) VALUES
  ('fb400000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'Active collision', 'Synthetic active collision.', 'published'),
  ('fb400000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'Rejected source', 'Synthetic rejected source.', 'published'),
  ('fb400000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'Withdrawn target', 'Synthetic withdrawn target.', 'published'),
  ('fb400000-0000-4000-8000-000000000004', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'Terminal pair', 'Synthetic terminal pair.', 'published');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email
) VALUES
  ('fb300000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Ari', 'Stone', 'ari.stone@local.test', 'ari', 'stone', 'ari.stone@local.test'),
  ('fb300000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'Ari', 'Stone', 'ari.stone@local.test', 'ari', 'stone', 'ari.stone@local.test'),
  ('fb300000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001', 'Bea', 'North', 'bea.north@local.test', 'bea', 'north', 'bea.north@local.test'),
  ('fb300000-0000-4000-8000-000000000004', 'fb100000-0000-4000-8000-000000000001', 'Bea', 'North', 'bea.north@local.test', 'bea', 'north', 'bea.north@local.test'),
  ('fb300000-0000-4000-8000-000000000005', 'fb100000-0000-4000-8000-000000000001', 'Cam', 'Lake', 'cam.lake@local.test', 'cam', 'lake', 'cam.lake@local.test'),
  ('fb300000-0000-4000-8000-000000000006', 'fb100000-0000-4000-8000-000000000001', 'Cam', 'Lake', 'cam.lake@local.test', 'cam', 'lake', 'cam.lake@local.test'),
  ('fb300000-0000-4000-8000-000000000007', 'fb100000-0000-4000-8000-000000000001', 'Dee', 'Vale', 'dee.vale@local.test', 'dee', 'vale', 'dee.vale@local.test'),
  ('fb300000-0000-4000-8000-000000000008', 'fb100000-0000-4000-8000-000000000001', 'Dee', 'Vale', 'dee.vale@local.test', 'dee', 'vale', 'dee.vale@local.test'),
  ('fb300000-0000-4000-8000-000000000009', 'fb100000-0000-4000-8000-000000000001', 'Eli', 'Pine', 'eli.pine@local.test', 'eli', 'pine', 'eli.pine@local.test'),
  ('fb300000-0000-4000-8000-000000000010', 'fb100000-0000-4000-8000-000000000001', 'Eli', 'Pine', 'eli.pine@local.test', 'eli', 'pine', 'eli.pine@local.test'),
  ('fb300000-0000-4000-8000-000000000011', 'fb100000-0000-4000-8000-000000000001', 'Fox', 'Ridge', 'fox.ridge@local.test', 'fox', 'ridge', 'fox.ridge@local.test'),
  ('fb300000-0000-4000-8000-000000000012', 'fb100000-0000-4000-8000-000000000001', 'Fox', 'Ridge', 'fox.ridge@local.test', 'fox', 'ridge', 'fox.ridge@local.test');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email
) VALUES
  ('fb300000-0000-4000-8000-000000000013', 'fb100000-0000-4000-8000-000000000001', 'Gale', 'Reed', 'gale.reed@local.test', 'gale', 'reed', 'gale.reed@local.test'),
  ('fb300000-0000-4000-8000-000000000014', 'fb100000-0000-4000-8000-000000000001', 'Gale', 'Reed', 'gale.reed@local.test', 'gale', 'reed', 'gale.reed@local.test'),
  ('fb300000-0000-4000-8000-000000000015', 'fb100000-0000-4000-8000-000000000001', 'Hale', 'Moss', 'hale.moss@local.test', 'hale', 'moss', 'hale.moss@local.test'),
  ('fb300000-0000-4000-8000-000000000016', 'fb100000-0000-4000-8000-000000000001', 'Hale', 'Moss', 'hale.moss@local.test', 'hale', 'moss', 'hale.moss@local.test'),
  ('fb300000-0000-4000-8000-000000000017', 'fb100000-0000-4000-8000-000000000001', 'Ivo', 'Glen', 'ivo.glen@local.test', 'ivo', 'glen', 'ivo.glen@local.test'),
  ('fb300000-0000-4000-8000-000000000018', 'fb100000-0000-4000-8000-000000000001', 'Ivo', 'Glen', 'ivo.glen@local.test', 'ivo', 'glen', 'ivo.glen@local.test'),
  ('fb300000-0000-4000-8000-000000000019', 'fb100000-0000-4000-8000-000000000001', 'Jules', 'Fern', 'jules.fern@local.test', 'jules', 'fern', 'jules.fern@local.test'),
  ('fb300000-0000-4000-8000-000000000020', 'fb100000-0000-4000-8000-000000000001', 'Jules', 'Fern', 'jules.fern@local.test', 'jules', 'fern', 'jules.fern@local.test');

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, opportunity_id,
  source, description, claimed_points, status
) VALUES
  ('fb500000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000001', 'staff', 'Source submitted claim', 2, 'submitted'),
  ('fb500000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000001', 'staff', 'Target approved claim', 2, 'approved'),
  ('fb500000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000003', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000002', 'staff', 'Source rejected claim', 2, 'rejected'),
  ('fb500000-0000-4000-8000-000000000004', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000004', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000002', 'staff', 'Target submitted claim', 2, 'submitted'),
  ('fb500000-0000-4000-8000-000000000005', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000005', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000003', 'staff', 'Source active claim', 2, 'needs_action'),
  ('fb500000-0000-4000-8000-000000000006', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000006', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000003', 'staff', 'Target withdrawn claim', 2, 'withdrawn'),
  ('fb500000-0000-4000-8000-000000000007', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000007', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000004', 'staff', 'Source withdrawn claim', 2, 'withdrawn'),
  ('fb500000-0000-4000-8000-000000000008', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000008', 'fb200000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000004', 'staff', 'Target rejected claim', 2, 'rejected');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type
) VALUES (
  'fba00000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'merge-agreement-officer', 'Merge agreement officer', 'custom'
);
INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, profile_id, role_id, school_year, display_title, status
) VALUES
  ('fbb00000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000009', 'fba00000-0000-4000-8000-000000000001', '2040-2041', 'Source officer', 'active'),
  ('fbb00000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000010', 'fba00000-0000-4000-8000-000000000001', '2040-2041', 'Target officer', 'active');

INSERT INTO plugin_data.csf_point_appeals (
  id, organization_id, profile_id, term_id, submission_id,
  reason, requested_points, status, submitted_by
) VALUES
  ('fbc00000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000011', 'fb200000-0000-4000-8000-000000000001', 'fb500000-0000-4000-8000-000000000001', 'Synthetic source open appeal.', 2, 'submitted', 'fb000000-0000-4000-8000-000000000001'),
  ('fbc00000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000012', 'fb200000-0000-4000-8000-000000000001', 'fb500000-0000-4000-8000-000000000001', 'Synthetic target open appeal.', 2, 'under_review', 'fb000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Frozen import-target lifecycle agreement
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, settings
) VALUES (
  'fbd00000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'student_roster', 'Synthetic profile-merge import ledger',
  'uploaded_csv', '{}'::jsonb
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type
) VALUES (
  'fbe00000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'fbd00000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  preview_job_id, summary, started_at, commit_actor_user_id,
  commit_actor_snapshot
) VALUES (
  'fbe00000-0000-4000-8000-000000000002',
  'fb100000-0000-4000-8000-000000000001',
  'fbd00000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001',
  'commit', 'running', 'student_roster',
  'fbe00000-0000-4000-8000-000000000001',
  jsonb_build_object('previewJobId', 'fbe00000-0000-4000-8000-000000000001'),
  now(), 'fb000000-0000-4000-8000-000000000001',
  jsonb_build_object('fixture', 'profile_merge_import_states')
);

INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
  id, organization_id, commit_job_id, attempt_number, correlation_id,
  actor_user_id, actor_snapshot, status, lease_expires_at
) VALUES (
  'fbf00000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'fbe00000-0000-4000-8000-000000000002', 1,
  'fbf10000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001',
  jsonb_build_object('fixture', 'profile_merge_import_states'),
  'running', now() + interval '1 hour'
);

UPDATE plugin_data.csf_sheet_import_jobs
SET active_commit_attempt_id = 'fbf00000-0000-4000-8000-000000000001'
WHERE id = 'fbe00000-0000-4000-8000-000000000002';

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, sheet_tab_name, row_number,
  row_hash, matched_profile_id, import_status,
  commit_frozen_at, commit_frozen_by_job_id, commit_frozen_row_hash,
  commit_frozen_source_id, commit_frozen_payload_hash,
  commit_frozen_actor_user_id, commit_frozen_actor_snapshot,
  commit_target_profile_id, commit_resolution_snapshot,
  commit_intent_attempt_id, commit_intent_correlation_id,
  commit_intent_started_at, commit_attempt_id, commit_outcome_state,
  commit_outcome_code, commit_outcome_resolution,
  commit_outcome_resolved_by, commit_outcome_resolved_at,
  commit_outcome_unresolved, commit_outcome_note,
  commit_retry_count, commit_last_failed_attempt_id
) VALUES
  -- Mutable: never frozen and never started.
  (
    'fbd10000-0000-4000-8000-000000000001',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 1,
    repeat('1', 64), 'fb300000-0000-4000-8000-000000000013', 'pending',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, 'not_started', NULL, NULL, NULL, NULL,
    false, NULL, 0, NULL
  ),
  -- Immutable terminal success with the reviewed target and write lineage.
  (
    'fbd10000-0000-4000-8000-000000000002',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 2,
    repeat('2', 64), 'fb300000-0000-4000-8000-000000000013', 'updated',
    now(), 'fbe00000-0000-4000-8000-000000000002', repeat('2', 64),
    'fbd00000-0000-4000-8000-000000000001', repeat('a', 64),
    'fb000000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fb300000-0000-4000-8000-000000000013', '{}'::jsonb,
    'fbf00000-0000-4000-8000-000000000001',
    'fbf10000-0000-4000-8000-000000000001', now(),
    'fbf00000-0000-4000-8000-000000000001', 'succeeded',
    'row_updated', NULL, NULL, NULL, false, NULL, 0, NULL
  ),
  -- Immutable terminal skip after a deterministic failure was settled.
  (
    'fbd10000-0000-4000-8000-000000000003',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 3,
    repeat('3', 64), 'fb300000-0000-4000-8000-000000000013', 'skipped',
    now(), 'fbe00000-0000-4000-8000-000000000002', repeat('3', 64),
    'fbd00000-0000-4000-8000-000000000001', repeat('b', 64),
    'fb000000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fb300000-0000-4000-8000-000000000013', '{}'::jsonb,
    'fbf00000-0000-4000-8000-000000000001',
    'fbf10000-0000-4000-8000-000000000001', now(), NULL, 'failed',
    'row_commit_failed', 'terminally_skipped',
    'fb000000-0000-4000-8000-000000000001', now(),
    false, 'Synthetic terminal skip.', 1,
    'fbf00000-0000-4000-8000-000000000001'
  ),
  -- Retryable deterministic failure: the original frozen target must not move.
  (
    'fbd10000-0000-4000-8000-000000000004',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 4,
    repeat('4', 64), 'fb300000-0000-4000-8000-000000000015', 'error',
    now(), 'fbe00000-0000-4000-8000-000000000002', repeat('4', 64),
    'fbd00000-0000-4000-8000-000000000001', repeat('c', 64),
    'fb000000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fb300000-0000-4000-8000-000000000015', '{}'::jsonb,
    'fbf00000-0000-4000-8000-000000000001',
    'fbf10000-0000-4000-8000-000000000001', now(),
    'fbf00000-0000-4000-8000-000000000001', 'failed',
    'row_commit_failed', NULL, NULL, NULL, false,
    'Synthetic retryable failure.', 0, NULL
  ),
  -- Frozen but not attempted.
  (
    'fbd10000-0000-4000-8000-000000000005',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 5,
    repeat('5', 64), 'fb300000-0000-4000-8000-000000000015', 'pending',
    now(), 'fbe00000-0000-4000-8000-000000000002', repeat('5', 64),
    'fbd00000-0000-4000-8000-000000000001', repeat('d', 64),
    'fb000000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fb300000-0000-4000-8000-000000000015', '{}'::jsonb,
    NULL, NULL, NULL, NULL, 'frozen', NULL, NULL, NULL, NULL,
    false, NULL, 0, NULL
  ),
  -- A write may already be landing.
  (
    'fbd10000-0000-4000-8000-000000000006',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 6,
    repeat('6', 64), 'fb300000-0000-4000-8000-000000000017', 'pending',
    now(), 'fbe00000-0000-4000-8000-000000000002', repeat('6', 64),
    'fbd00000-0000-4000-8000-000000000001', repeat('e', 64),
    'fb000000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fb300000-0000-4000-8000-000000000017', '{}'::jsonb,
    'fbf00000-0000-4000-8000-000000000001',
    'fbf10000-0000-4000-8000-000000000001', now(), NULL, 'in_flight',
    NULL, NULL, NULL, NULL, false, NULL, 0, NULL
  ),
  -- Ambiguous current and pre-ledger outcomes both require review.
  (
    'fbd10000-0000-4000-8000-000000000007',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 7,
    repeat('7', 64), 'fb300000-0000-4000-8000-000000000019', 'pending',
    now(), 'fbe00000-0000-4000-8000-000000000002', repeat('7', 64),
    'fbd00000-0000-4000-8000-000000000001', repeat('f', 64),
    'fb000000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fb300000-0000-4000-8000-000000000019', '{}'::jsonb,
    'fbf00000-0000-4000-8000-000000000001',
    'fbf10000-0000-4000-8000-000000000001', now(), NULL, 'unknown',
    NULL, NULL, NULL, NULL, true, 'Synthetic ambiguous result.', 0, NULL
  ),
  (
    'fbd10000-0000-4000-8000-000000000008',
    'fb100000-0000-4000-8000-000000000001',
    'fbe00000-0000-4000-8000-000000000001',
    'fbd00000-0000-4000-8000-000000000001', 'Roster', 8,
    repeat('8', 64), 'fb300000-0000-4000-8000-000000000019', 'updated',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, 'historical_unknown', NULL, NULL, NULL, NULL,
    true, 'Synthetic pre-ledger review.', 0, NULL
  );

SELECT extensions.is(
  ARRAY[
    plugin_data.csf_profile_merge_import_row_disposition(
      NULL, NULL, 'fb300000-0000-4000-8000-000000000013',
      NULL, 0, 'not_started', 'pending', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000013',
      'fb300000-0000-4000-8000-000000000013',
      'fbf00000-0000-4000-8000-000000000001', 0,
      'succeeded', 'updated', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000014',
      'fb300000-0000-4000-8000-000000000013',
      'fbf00000-0000-4000-8000-000000000001', 0,
      'succeeded', 'updated', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000013',
      'fb300000-0000-4000-8000-000000000013',
      NULL, 1, 'failed', 'skipped', 'terminally_skipped'
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000015',
      'fb300000-0000-4000-8000-000000000015',
      NULL, 0, 'frozen', 'pending', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000015',
      'fb300000-0000-4000-8000-000000000015',
      'fbf00000-0000-4000-8000-000000000001', 0,
      'failed', 'error', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000017',
      'fb300000-0000-4000-8000-000000000017',
      NULL, 0, 'in_flight', 'pending', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      now(), 'fb300000-0000-4000-8000-000000000019',
      'fb300000-0000-4000-8000-000000000019',
      NULL, 0, 'unknown', 'pending', NULL
    ),
    plugin_data.csf_profile_merge_import_row_disposition(
      NULL, NULL, 'fb300000-0000-4000-8000-000000000019',
      NULL, 0, 'historical_unknown', 'updated', NULL
    )
  ],
  ARRAY[
    'live_rewrite', 'immutable_history', 'preflight_blocker',
    'immutable_history',
    'preflight_blocker', 'preflight_blocker', 'preflight_blocker',
    'preflight_blocker', 'preflight_blocker'
  ]::text[],
  'one fail-closed classifier owns every import-row merge disposition'
);

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000013',
    'fb300000-0000-4000-8000-000000000014'
  )->>'canMerge')::boolean,
  'settled success and terminal-skip evidence do not block a live-match merge'
);

WITH ready_plan AS (
  SELECT plugin_data.csf_profile_merge_reference_plan(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000013'
  ) AS payload
)
SELECT extensions.ok(
  (
    SELECT (entry->>'sourceCount')::integer = 1
    FROM ready_plan,
      LATERAL jsonb_array_elements(payload->'sameTransactionRewrites') AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_sheet_import_rows.matched_profile_id'
  )
  AND (
    SELECT (entry->>'sourceCount')::integer = 2
    FROM ready_plan,
      LATERAL jsonb_array_elements(payload->'immutableHistoryRetentions') AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_sheet_import_rows.matched_profile_id'
  )
  AND (
    SELECT (entry->>'sourceCount')::integer = 2
    FROM ready_plan,
      LATERAL jsonb_array_elements(payload->'immutableHistoryRetentions') AS entry
    WHERE entry->>'reference' =
      'plugin_data.csf_sheet_import_rows.commit_target_profile_id'
  )
  AND (
    SELECT pg_catalog.sum((entry->>'sourceCount')::integer) = 0
    FROM ready_plan,
      LATERAL jsonb_array_elements(payload->'preflightBlockedReferences') AS entry
    WHERE entry->>'reference' LIKE 'plugin_data.csf_sheet_import_rows.%'
  ),
  'the catalog counts one live rewrite, two retained matches, two retained targets, and no blocker'
);

SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000013',
    'fb300000-0000-4000-8000-000000000014',
    'Settled imports remain evidence while the live match moves.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000007'
  )->>'targetProfileId',
  'fb300000-0000-4000-8000-000000000014',
  'execution agrees with the ready preview without touching frozen evidence'
);

SELECT extensions.ok(
  (SELECT matched_profile_id = 'fb300000-0000-4000-8000-000000000014'
      AND commit_target_profile_id IS NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'fbd10000-0000-4000-8000-000000000001')
  AND (SELECT pg_catalog.bool_and(
      matched_profile_id = 'fb300000-0000-4000-8000-000000000013'
      AND commit_target_profile_id = 'fb300000-0000-4000-8000-000000000013'
    )
    FROM plugin_data.csf_sheet_import_rows
    WHERE id IN (
      'fbd10000-0000-4000-8000-000000000002',
      'fbd10000-0000-4000-8000-000000000003'
    ))
  AND (SELECT record_status = 'merged'
      AND merged_into_profile_id = 'fb300000-0000-4000-8000-000000000014'
    FROM plugin_data.csf_profiles
    WHERE id = 'fb300000-0000-4000-8000-000000000013'),
  'only the live match moves; settled matched and frozen targets remain on the source tombstone'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_merge_reviews AS review
    WHERE review.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND review.source_profile_id = 'fb300000-0000-4000-8000-000000000013'
      AND (review.evidence->'referenceRewriteCounts'->>'importRowLiveMatches')::integer = 1
      AND jsonb_path_exists(
        review.evidence,
        '$.retainedHistoryAfterMerge[*] ? (@.reference == "plugin_data.csf_sheet_import_rows.matched_profile_id" && @.sourceCount == 2)'
      )
      AND jsonb_path_exists(
        review.evidence,
        '$.retainedHistoryAfterMerge[*] ? (@.reference == "plugin_data.csf_sheet_import_rows.commit_target_profile_id" && @.sourceCount == 2)'
      )
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_reference_rewrites'
      AND audit.before_data->>'sourceProfileId' = 'fb300000-0000-4000-8000-000000000013'
      AND (audit.after_data->'referenceRewriteCounts'->>'importRowLiveMatches')::integer = 1
  ),
  'review and audit evidence record the exact live rewrite and retained-history counts'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000015',
    'fb300000-0000-4000-8000-000000000016'
  )->>'canMerge')::boolean,
  'preview blocks retryable failed and not-yet-attempted frozen targets'
);

SELECT extensions.ok(
  plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000015',
    'fb300000-0000-4000-8000-000000000016'
  )->'conflicts' @> '[{
    "type": "outstanding_import_commit_target",
    "rowCount": 2,
    "matchedProfileCount": 2,
    "frozenTargetCount": 2,
    "outcomeStates": ["failed", "frozen"],
    "importStatuses": ["error", "pending"]
  }]'::jsonb,
  'the failed/frozen blocker exposes exact bounded state counts without row identity'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000015',
    'fb300000-0000-4000-8000-000000000016',
    'Retryable import recovery must settle before identity consolidation.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000008'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'execution rechecks and refuses the same failed/frozen import blocker'
);

SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2
    FROM plugin_data.csf_sheet_import_rows
    WHERE id IN (
      'fbd10000-0000-4000-8000-000000000004',
      'fbd10000-0000-4000-8000-000000000005'
    )
      AND matched_profile_id = 'fb300000-0000-4000-8000-000000000015'
      AND commit_target_profile_id = 'fb300000-0000-4000-8000-000000000015')
  AND (SELECT record_status = 'active'
    FROM plugin_data.csf_profiles
    WHERE id = 'fb300000-0000-4000-8000-000000000015'),
  'blocked failed/frozen execution preserves targets, recovery state, and the active source'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000017',
    'fb300000-0000-4000-8000-000000000018'
  )->>'canMerge')::boolean,
  'preview blocks an in-flight frozen target whose write may be landing'
);

SELECT extensions.ok(
  plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000017',
    'fb300000-0000-4000-8000-000000000018'
  )->'conflicts' @> '[{
    "type": "outstanding_import_commit_target",
    "rowCount": 1,
    "matchedProfileCount": 1,
    "frozenTargetCount": 1,
    "outcomeStates": ["in_flight"],
    "importStatuses": ["pending"]
  }]'::jsonb,
  'the in-flight blocker reports the exact recovery state and reference counts'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000017',
    'fb300000-0000-4000-8000-000000000018',
    'An in-flight import must settle before identity consolidation.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000009'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'execution rechecks and refuses the same in-flight import blocker'
);

SELECT extensions.ok(
  (SELECT matched_profile_id = 'fb300000-0000-4000-8000-000000000017'
      AND commit_target_profile_id = 'fb300000-0000-4000-8000-000000000017'
      AND commit_outcome_state = 'in_flight'
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'fbd10000-0000-4000-8000-000000000006')
  AND (SELECT record_status = 'active'
    FROM plugin_data.csf_profiles
    WHERE id = 'fb300000-0000-4000-8000-000000000017'),
  'blocked in-flight execution cannot corrupt intent or recovery evidence'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000019',
    'fb300000-0000-4000-8000-000000000020'
  )->>'canMerge')::boolean
  AND plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000019',
    'fb300000-0000-4000-8000-000000000020'
  )->'conflicts' @> '[{
    "type": "outstanding_import_commit_target",
    "rowCount": 2,
    "matchedProfileCount": 2,
    "frozenTargetCount": 1,
    "outcomeStates": ["historical_unknown", "unknown"],
    "importStatuses": ["pending", "updated"]
  }]'::jsonb,
  'current and historical unknown outcomes remain review-blocked with exact counts'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000019',
    'fb300000-0000-4000-8000-000000000020',
    'Unknown import outcomes require review before identity consolidation.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000010'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'execution rechecks and refuses the same unknown import blocker'
);

SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2
    FROM plugin_data.csf_sheet_import_rows
    WHERE id IN (
      'fbd10000-0000-4000-8000-000000000007',
      'fbd10000-0000-4000-8000-000000000008'
    )
      AND matched_profile_id = 'fb300000-0000-4000-8000-000000000019'
      AND commit_outcome_unresolved)
  AND (SELECT record_status = 'active'
    FROM plugin_data.csf_profiles
    WHERE id = 'fb300000-0000-4000-8000-000000000019'),
  'blocked unknown execution preserves review state and the active source'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000009',
    'fb300000-0000-4000-8000-000000000010'
  )->>'canMerge')::boolean,
  'preview refuses duplicate active staff assignments covered by the partial index'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fb100000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000009',
      'fb300000-0000-4000-8000-000000000010'
    ),
    '$.conflicts[*] ? (@.type == "active_staff_assignment_collision" && @.schoolYear == "2040-2041")'
  ),
  'preview reports the exact active staff-assignment collision key'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000009',
    'fb300000-0000-4000-8000-000000000010',
    'Duplicate active staff assignments require officer reconciliation.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'execution rechecks and refuses the same active staff-assignment collision'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_staff_positions
    WHERE id IN ('fbb00000-0000-4000-8000-000000000001', 'fbb00000-0000-4000-8000-000000000002')
      AND status = 'active'
      AND profile_id IN ('fb300000-0000-4000-8000-000000000009', 'fb300000-0000-4000-8000-000000000010')),
  'the blocked staff execution changes neither assignment nor profile ownership'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000011',
    'fb300000-0000-4000-8000-000000000012'
  )->>'canMerge')::boolean,
  'preview refuses duplicate open appeals covered by the partial index'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fb100000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000011',
      'fb300000-0000-4000-8000-000000000012'
    ),
    '$.conflicts[*] ? (@.type == "open_point_appeal_collision" && @.sourceStatus == "submitted" && @.targetStatus == "under_review")'
  ),
  'preview reports the exact open-appeal statuses and collision key'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000011',
    'fb300000-0000-4000-8000-000000000012',
    'Duplicate open appeals require officer reconciliation.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'execution rechecks and refuses the same open point-appeal collision'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_point_appeals
    WHERE id IN ('fbc00000-0000-4000-8000-000000000001', 'fbc00000-0000-4000-8000-000000000002')
      AND profile_id IN ('fb300000-0000-4000-8000-000000000011', 'fb300000-0000-4000-8000-000000000012')),
  'the blocked appeal execution changes neither appeal nor profile ownership'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000002'
  )->>'canMerge')::boolean,
  'preview refuses two point rows covered by the active-claim partial index'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'fb100000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000002'
    ),
    '$.conflicts[*] ? (@.type == "active_point_submission_collision" && @.sourceStatus == "submitted" && @.targetStatus == "approved")'
  ),
  'preview reports the exact active statuses and collision key execution would violate'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000002',
    'Both active claims require officer reconciliation.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'execution rechecks under lock and refuses the same active point collision'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_profiles
    WHERE id IN ('fb300000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000002')
      AND record_status = 'active')
  AND (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000001', 'fb500000-0000-4000-8000-000000000002')
      AND profile_id IN ('fb300000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000002')),
  'the blocked execution changes neither profile nor point ownership'
);

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000003',
    'fb300000-0000-4000-8000-000000000004'
  )->>'canMerge')::boolean,
  'preview permits a rejected source row beside an active target claim'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000003',
    'fb300000-0000-4000-8000-000000000004',
    'Rejected evidence and the active claim belong to one student.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000002'
  )->>'targetProfileId',
  'fb300000-0000-4000-8000-000000000004',
  'execution agrees and merges the rejected-source fixture'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000003', 'fb500000-0000-4000-8000-000000000004')
      AND profile_id = 'fb300000-0000-4000-8000-000000000004')
  AND (SELECT pg_catalog.array_agg(status ORDER BY status) = ARRAY['rejected', 'submitted']::text[]
    FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000003', 'fb500000-0000-4000-8000-000000000004')),
  'rejected evidence moves without changing either point state'
);

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000005',
    'fb300000-0000-4000-8000-000000000006'
  )->>'canMerge')::boolean,
  'preview permits one active source claim beside a withdrawn target row'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000005',
    'fb300000-0000-4000-8000-000000000006',
    'The withdrawn row and active claim belong to one student.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000003'
  )->>'targetProfileId',
  'fb300000-0000-4000-8000-000000000006',
  'execution agrees and merges the withdrawn-target fixture'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000005', 'fb500000-0000-4000-8000-000000000006')
      AND profile_id = 'fb300000-0000-4000-8000-000000000006')
  AND (SELECT pg_catalog.array_agg(status ORDER BY status) = ARRAY['needs_action', 'withdrawn']::text[]
    FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000005', 'fb500000-0000-4000-8000-000000000006')),
  'withdrawn evidence and the active claim move without changing state'
);

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000007',
    'fb300000-0000-4000-8000-000000000008'
  )->>'canMerge')::boolean,
  'preview permits two terminal point rows excluded from the partial index'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'fb100000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000007',
    'fb300000-0000-4000-8000-000000000008',
    'Both terminal point records belong to the same student.',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000004'
  )->>'targetProfileId',
  'fb300000-0000-4000-8000-000000000008',
  'execution agrees and merges the terminal-point fixture'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000007', 'fb500000-0000-4000-8000-000000000008')
      AND profile_id = 'fb300000-0000-4000-8000-000000000008')
  AND (SELECT pg_catalog.array_agg(status ORDER BY status) = ARRAY['rejected', 'withdrawn']::text[]
    FROM plugin_data.csf_point_submissions
    WHERE id IN ('fb500000-0000-4000-8000-000000000007', 'fb500000-0000-4000-8000-000000000008')),
  'rejected and withdrawn rows both retain their terminal evidence states'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM plugin_data.csf_profile_merge_reviews AS review
    WHERE review.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND review.source_profile_id IN (
        'fb300000-0000-4000-8000-000000000003',
        'fb300000-0000-4000-8000-000000000005',
        'fb300000-0000-4000-8000-000000000007'
      )
      AND review.status = 'approved'
      AND (review.evidence->>'zeroLiveSourceReferences')::boolean
      AND review.evidence ? 'profileReferencePlan'
  ),
  3,
  'every successful point-state merge records the reference plan and zero-live-source proof'
);
SELECT extensions.ok(
  (
    SELECT pg_catalog.bool_and(
      audit.before_data::text !~* '("(ari|bea|cam|dee)"|local\.test|@)'
      AND audit.after_data::text !~* '("(ari|bea|cam|dee)"|local\.test|@)'
    )
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_reference_rewrites'
  ),
  'reference-rewrite audit receipts contain identifiers and counts, never names or addresses'
);

SELECT * FROM extensions.finish();

ROLLBACK;
