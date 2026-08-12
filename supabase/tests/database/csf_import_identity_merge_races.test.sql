-- Real-session import/merge races cannot live inside a rollback-only fixture:
-- dblink workers must observe the committed synthetic setup. These namespaced
-- rows remain only in the disposable isolated replay database.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(14);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'fe000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'import-merge-race-officer@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'fe100000-0000-4000-8000-000000000001',
  'CSF Import Merge Races',
  'csf-import-merge-races',
  'school',
  '983341'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'fe100000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'fe200000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'FALL-2044', 'Fall 2044', '2044-2045', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'fe300000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  2045,
  'Class of 2045'
);

INSERT INTO plugin_data.csf_cohort_terms (
  organization_id, cohort_id, term_id, grade_level, status
) VALUES (
  'fe100000-0000-4000-8000-000000000001',
  'fe300000-0000-4000-8000-000000000001',
  'fe200000-0000-4000-8000-000000000001',
  12,
  'active'
);

-- Four source/target duplicate pairs: central row commit, reconciliation,
-- meeting attendance, and partner audit.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, preferred_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email
) VALUES
  ('fe400000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Central', 'Race', 'Source', 'central.race@local.test', 'central', 'race', 'central.race@local.test'),
  ('fe400000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'Central', 'Race', 'Target', 'central.race@local.test', 'central', 'race', 'central.race@local.test'),
  ('fe400000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'Reconcile', 'Race', 'Source', 'reconcile.race@local.test', 'reconcile', 'race', 'reconcile.race@local.test'),
  ('fe400000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001', 'Reconcile', 'Race', 'Target', 'reconcile.race@local.test', 'reconcile', 'race', 'reconcile.race@local.test'),
  ('fe400000-0000-4000-8000-000000000005', 'fe100000-0000-4000-8000-000000000001', 'Meeting', 'Race', 'Source', 'meeting.race@local.test', 'meeting', 'race', 'meeting.race@local.test'),
  ('fe400000-0000-4000-8000-000000000006', 'fe100000-0000-4000-8000-000000000001', 'Meeting', 'Race', 'Target', 'meeting.race@local.test', 'meeting', 'race', 'meeting.race@local.test'),
  ('fe400000-0000-4000-8000-000000000007', 'fe100000-0000-4000-8000-000000000001', 'Partner', 'Race', 'Source', 'partner.race@local.test', 'partner', 'race', 'partner.race@local.test'),
  ('fe400000-0000-4000-8000-000000000008', 'fe100000-0000-4000-8000-000000000001', 'Partner', 'Race', 'Target', 'partner.race@local.test', 'partner', 'race', 'partner.race@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000002', 'fe300000-0000-4000-8000-000000000001', 'archived'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000003', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000004', 'fe300000-0000-4000-8000-000000000001', 'archived'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000005', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000006', 'fe300000-0000-4000-8000-000000000001', 'archived'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000007', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000008', 'fe300000-0000-4000-8000-000000000001', 'archived');

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, sync_status, settings
) VALUES
  ('fe500000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'student_roster', 'Central race source', 'uploaded_xlsx', 'not_synced', '{"sourceKind":"student_roster"}'),
  ('fe500000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'student_roster', 'Reconcile race source', 'uploaded_xlsx', 'not_synced', '{"sourceKind":"student_roster"}'),
  ('fe500000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'meeting_attendance', 'Meeting race source', 'google_sheets', 'not_synced', '{"sourceKind":"meeting_attendance"}');

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  preview_job_id, commit_actor_user_id, commit_actor_snapshot
) VALUES
  ('fe600000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'preview', 'completed', 'student_roster', NULL, NULL, NULL),
  ('fe600000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'commit', 'running', 'student_roster', 'fe600000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', '{"claimedBy":"fe000000-0000-4000-8000-000000000001"}'),
  ('fe600000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000002', 'fe000000-0000-4000-8000-000000000001', 'preview', 'completed', 'student_roster', NULL, NULL, NULL),
  ('fe600000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000003', 'fe000000-0000-4000-8000-000000000001', 'preview', 'completed', 'meeting_attendance', NULL, NULL, NULL);

INSERT INTO plugin_data.csf_sheet_import_commit_attempts (
  id, organization_id, commit_job_id, attempt_number, correlation_id,
  actor_user_id, actor_snapshot, status, lease_expires_at
) VALUES (
  'fe700000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe600000-0000-4000-8000-000000000002',
  1,
  'fea00000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000001',
  '{"claimedBy":"fe000000-0000-4000-8000-000000000001"}',
  'running',
  now() + interval '1 hour'
);

UPDATE plugin_data.csf_sheet_import_jobs
SET active_commit_attempt_id = 'fe700000-0000-4000-8000-000000000001'
WHERE id = 'fe600000-0000-4000-8000-000000000002';

-- The central fixture is immutable successful evidence. Calling the row commit is
-- therefore a real idempotent replay, while merge is allowed to retain its
-- historical source reference.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  row_hash, matched_profile_id, import_status, commit_attempt_id,
  commit_frozen_at, commit_frozen_by_job_id, commit_frozen_row_hash,
  commit_frozen_source_id, commit_frozen_source_revision,
  commit_frozen_payload_hash, commit_frozen_actor_user_id,
  commit_frozen_actor_snapshot, commit_target_profile_id,
  commit_resolution_snapshot, commit_outcome_state,
  commit_outcome_code, commit_outcome_correlation_id
) VALUES (
  'fe800000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe600000-0000-4000-8000-000000000001',
  'fe500000-0000-4000-8000-000000000001',
  'fe300000-0000-4000-8000-000000000001',
  'Roster', 2, repeat('a', 64),
  'fe400000-0000-4000-8000-000000000001',
  'updated',
  'fe700000-0000-4000-8000-000000000001',
  now(),
  'fe600000-0000-4000-8000-000000000002',
  repeat('a', 64),
  'fe500000-0000-4000-8000-000000000001',
  repeat('b', 64),
  repeat('c', 64),
  'fe000000-0000-4000-8000-000000000001',
  '{"claimedBy":"fe000000-0000-4000-8000-000000000001"}',
  'fe400000-0000-4000-8000-000000000001',
  '{"basis":"matched_profile"}',
  'succeeded',
  'updated',
  'fea00000-0000-4000-8000-000000000001'
);

-- Reconciliation starts unmatched. Meeting and partner start as mutable live
-- references, so merge must rewrite both to the canonical profile atomically.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status,
  correlation_id
) VALUES
  ('fe800000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000003', 'fe500000-0000-4000-8000-000000000002', NULL, 'Roster', 3, '{"Name":"Reconcile Race"}', '{}', repeat('d', 64), NULL, 'ambiguous', 'fea00000-0000-4000-8000-000000000002'),
  ('fe800000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000004', 'fe500000-0000-4000-8000-000000000003', 'fe200000-0000-4000-8000-000000000001', 'Responses', 2, '{"Name":"Meeting Race"}', '{}', repeat('e', 64), 'fe400000-0000-4000-8000-000000000005', 'pending', 'fea00000-0000-4000-8000-000000000003');

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, approved_point_types
) VALUES (
  'fe900000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'Synthetic Import Race Club',
  ARRAY['non_drive']::text[]
);

INSERT INTO plugin_data.csf_partner_submission_batches (
  id, organization_id, partner_club_id, term_id, title, source, status,
  submitted_by, summary
) VALUES (
  'fe910000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe900000-0000-4000-8000-000000000001',
  'fe200000-0000-4000-8000-000000000001',
  'Synthetic import/merge race batch',
  'sheet',
  'needs_verification',
  'fe000000-0000-4000-8000-000000000001',
  '{}'
);

INSERT INTO plugin_data.csf_partner_submission_rows (
  id, organization_id, batch_id, profile_id, matched_status,
  raw_data, normalized_data, claimed_points, point_type
) VALUES (
  'fe920000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe910000-0000-4000-8000-000000000001',
  'fe400000-0000-4000-8000-000000000007',
  'matched',
  '{"Name":"Partner Race"}',
  '{"source":{"rowHash":"partner-race"}}',
  2,
  'non_drive'
);

-- The three merge-first races intentionally exercise post-lock revalidation.
-- Returning SQLSTATE lets dblink report the expected refusal as a row instead of
-- aborting the test session; 40P01 would expose a lock-order deadlock.
CREATE FUNCTION plugin_data.csf_test_capture_import_merge_race(p_operation text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text;
BEGIN
  CASE p_operation
    WHEN 'reconcile' THEN
      PERFORM plugin_data.csf_reconcile_sheet_import_row(
        'fe100000-0000-4000-8000-000000000001',
        'fe800000-0000-4000-8000-000000000002',
        'fe400000-0000-4000-8000-000000000003',
        'match',
        'Synthetic reconciliation queued behind profile merge.',
        'fe000000-0000-4000-8000-000000000001',
        'fea00000-0000-4000-8000-000000000002'
      );
    WHEN 'meeting' THEN
      PERFORM plugin_data.csf_commit_meeting_attendance_import(
        'fe100000-0000-4000-8000-000000000001',
        'fe600000-0000-4000-8000-000000000004',
        'fe000000-0000-4000-8000-000000000001',
        'Synthetic meeting commit queued behind profile merge.',
        'fea00000-0000-4000-8000-000000000003',
        NULL
      );
    WHEN 'partner' THEN
      PERFORM plugin_data.csf_commit_partner_audit_import(
        'fe100000-0000-4000-8000-000000000001',
        'fe910000-0000-4000-8000-000000000001',
        'approved',
        'fe000000-0000-4000-8000-000000000001',
        'Synthetic partner commit queued behind profile merge.',
        'fea00000-0000-4000-8000-000000000004',
        NULL
      );
    ELSE
      RAISE EXCEPTION 'Unknown test operation.';
  END CASE;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  RETURN v_state;
END;
$$;

SELECT extensions.dblink_connect(
  'central_race_worker',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_connect(
  'reconcile_race_worker',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_connect(
  'meeting_race_worker',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_connect(
  'partner_race_worker',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

CREATE TEMP TABLE import_merge_race_results (
  label text PRIMARY KEY,
  payload text NOT NULL
) ON COMMIT PRESERVE ROWS;

-- Central commit first, then merge: the row wrapper owns identity before its
-- attempt/import/profile locks, so merge waits at the common first lock.
BEGIN;

INSERT INTO import_merge_race_results (label, payload)
SELECT 'central_replay', plugin_data.csf_commit_import_row_for_attempt(
  'fe100000-0000-4000-8000-000000000001',
  'fe700000-0000-4000-8000-000000000001',
  'fe800000-0000-4000-8000-000000000001'
)::text;

SELECT extensions.ok(
  ((SELECT payload FROM import_merge_race_results WHERE label = 'central_replay')::jsonb ->> 'replayed')::boolean,
  'the central row commit reaches its idempotent replay while retaining identity-first locks'
);

SELECT extensions.dblink_send_query(
  'central_race_worker',
  $query$
  SELECT plugin_data.csf_merge_profiles(
    'fe100000-0000-4000-8000-000000000001'::uuid,
    'fe400000-0000-4000-8000-000000000001'::uuid,
    'fe400000-0000-4000-8000-000000000002'::uuid,
    'Synthetic central commit versus merge race.',
    'fe000000-0000-4000-8000-000000000001'::uuid,
    'feb00000-0000-4000-8000-000000000001'::uuid
  )::text
  $query$
);
SELECT pg_catalog.pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('central_race_worker'),
  1,
  'profile merge serializes behind the central row commit'
);

COMMIT;

INSERT INTO import_merge_race_results (label, payload)
SELECT 'central_merge', payload
FROM extensions.dblink_get_result('central_race_worker', false) AS result(payload text);
SELECT extensions.dblink_disconnect('central_race_worker');
SELECT extensions.is(
  (SELECT payload::jsonb ->> 'targetProfileId' FROM import_merge_race_results WHERE label = 'central_merge'),
  'fe400000-0000-4000-8000-000000000002',
  'central row commit and merge finish without a lock-order deadlock'
);

-- Merge first, then reconciliation: the queued decision must re-read the source
-- as a tombstone and refuse rather than restoring it as a live match.
BEGIN;
SELECT plugin_data.csf_merge_profiles(
  'fe100000-0000-4000-8000-000000000001',
  'fe400000-0000-4000-8000-000000000003',
  'fe400000-0000-4000-8000-000000000004',
  'Synthetic reconciliation versus merge race.',
  'fe000000-0000-4000-8000-000000000001',
  'feb00000-0000-4000-8000-000000000002'
);
SELECT extensions.dblink_send_query(
  'reconcile_race_worker',
  $$SELECT plugin_data.csf_test_capture_import_merge_race('reconcile')$$
);
SELECT pg_catalog.pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('reconcile_race_worker'),
  1,
  'reconciliation serializes behind profile merge'
);
COMMIT;

INSERT INTO import_merge_race_results (label, payload)
SELECT 'reconcile', payload
FROM extensions.dblink_get_result('reconcile_race_worker', false) AS result(payload text);
SELECT extensions.dblink_disconnect('reconcile_race_worker');
SELECT extensions.ok(
  (SELECT payload NOT LIKE '%40P01%' FROM import_merge_race_results WHERE label = 'reconcile'),
  'queued reconciliation finishes without a deadlock'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'fe800000-0000-4000-8000-000000000002'
      AND matched_profile_id = 'fe400000-0000-4000-8000-000000000003'
  ),
  'queued reconciliation cannot rematch the row to a merged tombstone'
);

-- Meeting commit waits for merge; once released, it reads the canonical profile
-- rewritten by merge rather than recreating attendance for the source tombstone.
BEGIN;
SELECT plugin_data.csf_merge_profiles(
  'fe100000-0000-4000-8000-000000000001',
  'fe400000-0000-4000-8000-000000000005',
  'fe400000-0000-4000-8000-000000000006',
  'Synthetic meeting commit versus merge race.',
  'fe000000-0000-4000-8000-000000000001',
  'feb00000-0000-4000-8000-000000000003'
);
SELECT extensions.dblink_send_query(
  'meeting_race_worker',
  $$SELECT plugin_data.csf_test_capture_import_merge_race('meeting')$$
);
SELECT pg_catalog.pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('meeting_race_worker'),
  1,
  'meeting attendance commit serializes behind profile merge'
);
COMMIT;

INSERT INTO import_merge_race_results (label, payload)
SELECT 'meeting', payload
FROM extensions.dblink_get_result('meeting_race_worker', false) AS result(payload text);
SELECT extensions.dblink_disconnect('meeting_race_worker');
SELECT extensions.ok(
  (SELECT payload NOT LIKE '%40P01%' FROM import_merge_race_results WHERE label = 'meeting'),
  'queued meeting attendance commit finishes without a deadlock'
);
SELECT extensions.is(
  (SELECT matched_profile_id FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'fe800000-0000-4000-8000-000000000003'),
  'fe400000-0000-4000-8000-000000000006'::uuid,
  'meeting import ownership remains on the active canonical profile'
);

-- Partner commit has the same common first lock and must consume the partner row
-- only after merge has atomically moved its profile ownership.
BEGIN;
SELECT plugin_data.csf_merge_profiles(
  'fe100000-0000-4000-8000-000000000001',
  'fe400000-0000-4000-8000-000000000007',
  'fe400000-0000-4000-8000-000000000008',
  'Synthetic partner commit versus merge race.',
  'fe000000-0000-4000-8000-000000000001',
  'feb00000-0000-4000-8000-000000000004'
);
SELECT extensions.dblink_send_query(
  'partner_race_worker',
  $$SELECT plugin_data.csf_test_capture_import_merge_race('partner')$$
);
SELECT pg_catalog.pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('partner_race_worker'),
  1,
  'partner audit commit serializes behind profile merge'
);
COMMIT;

INSERT INTO import_merge_race_results (label, payload)
SELECT 'partner', payload
FROM extensions.dblink_get_result('partner_race_worker', false) AS result(payload text);
SELECT extensions.dblink_disconnect('partner_race_worker');
SELECT extensions.ok(
  (SELECT payload NOT LIKE '%40P01%' FROM import_merge_race_results WHERE label = 'partner'),
  'queued partner audit commit finishes without a deadlock'
);
SELECT extensions.is(
  (SELECT profile_id FROM plugin_data.csf_partner_submission_rows
   WHERE id = 'fe920000-0000-4000-8000-000000000001'),
  'fe400000-0000-4000-8000-000000000008'::uuid,
  'partner import ownership remains on the active canonical profile'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE id = ANY (ARRAY[
      'fe400000-0000-4000-8000-000000000001'::uuid,
      'fe400000-0000-4000-8000-000000000003'::uuid,
      'fe400000-0000-4000-8000-000000000005'::uuid,
      'fe400000-0000-4000-8000-000000000007'::uuid
    ])
      AND record_status = 'merged'
      AND merged_into_profile_id IS NOT NULL
  ),
  4,
  'all four source records are durable merge tombstones'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM (
      SELECT import_row.id
      FROM plugin_data.csf_sheet_import_rows AS import_row
      WHERE import_row.organization_id = 'fe100000-0000-4000-8000-000000000001'
        AND (
          import_row.matched_profile_id = ANY (ARRAY[
            'fe400000-0000-4000-8000-000000000001'::uuid,
            'fe400000-0000-4000-8000-000000000003'::uuid,
            'fe400000-0000-4000-8000-000000000005'::uuid,
            'fe400000-0000-4000-8000-000000000007'::uuid
          ])
          OR import_row.commit_target_profile_id = ANY (ARRAY[
            'fe400000-0000-4000-8000-000000000001'::uuid,
            'fe400000-0000-4000-8000-000000000003'::uuid,
            'fe400000-0000-4000-8000-000000000005'::uuid,
            'fe400000-0000-4000-8000-000000000007'::uuid
          ])
        )
        AND plugin_data.csf_profile_merge_import_row_disposition(
          import_row.commit_frozen_at,
          import_row.commit_target_profile_id,
          import_row.matched_profile_id,
          import_row.commit_attempt_id,
          import_row.commit_retry_count,
          import_row.commit_outcome_state,
          import_row.import_status,
          import_row.commit_outcome_resolution
        ) <> 'immutable_history'
      UNION ALL
      SELECT partner_row.id
      FROM plugin_data.csf_partner_submission_rows AS partner_row
      WHERE partner_row.organization_id = 'fe100000-0000-4000-8000-000000000001'
        AND partner_row.profile_id = ANY (ARRAY[
          'fe400000-0000-4000-8000-000000000001'::uuid,
          'fe400000-0000-4000-8000-000000000003'::uuid,
          'fe400000-0000-4000-8000-000000000005'::uuid,
          'fe400000-0000-4000-8000-000000000007'::uuid
        ])
      UNION ALL
      SELECT attendance.id
      FROM plugin_data.csf_meeting_attendance AS attendance
      WHERE attendance.organization_id = 'fe100000-0000-4000-8000-000000000001'
        AND attendance.profile_id = ANY (ARRAY[
          'fe400000-0000-4000-8000-000000000001'::uuid,
          'fe400000-0000-4000-8000-000000000003'::uuid,
          'fe400000-0000-4000-8000-000000000005'::uuid,
          'fe400000-0000-4000-8000-000000000007'::uuid
        ])
      UNION ALL
      SELECT submission.id
      FROM plugin_data.csf_point_submissions AS submission
      WHERE submission.organization_id = 'fe100000-0000-4000-8000-000000000001'
        AND submission.profile_id = ANY (ARRAY[
          'fe400000-0000-4000-8000-000000000001'::uuid,
          'fe400000-0000-4000-8000-000000000003'::uuid,
          'fe400000-0000-4000-8000-000000000005'::uuid,
          'fe400000-0000-4000-8000-000000000007'::uuid
        ])
    ) AS live_source_reference
  ),
  0,
  'zero live references remain on merged sources'
);

DROP FUNCTION plugin_data.csf_test_capture_import_merge_race(text);

SELECT * FROM extensions.finish();
