BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(32);

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
    )
  ),
  'every current FK appears in the canonical rewrite-or-history plan'
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
  'closure, outbound-audience, and frozen import-target references are deliberately retained as immutable history'
);
SELECT extensions.ok(
  (SELECT payload->'preflightBlockers' FROM merge_reference_plan)
    ? 'active_point_submission_claim_unique_key',
  'the catalog names the active point-claim unique index as a canonical blocker'
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
      audit.before_data::text !~* '(ari|bea|cam|dee|local\.test|@)'
      AND audit.after_data::text !~* '(ari|bea|cam|dee|local\.test|@)'
    )
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_reference_rewrites'
  ),
  'reference-rewrite audit receipts contain identifiers and counts, never names or addresses'
);

SELECT * FROM extensions.finish();

ROLLBACK;
