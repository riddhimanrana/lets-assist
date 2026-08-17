-- Real-session import/merge races cannot live inside a rollback-only fixture:
-- dblink workers must observe the committed synthetic setup. These namespaced
-- rows remain only in the disposable isolated replay database.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(12);

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

-- Three source/target duplicate pairs: central row commit, reconciliation,
-- and meeting attendance.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, preferred_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email
) VALUES
  ('fe400000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Central', 'Race', 'Source', 'central.race@local.test', 'central', 'race', 'central.race@local.test'),
  ('fe400000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'Central', 'Race', 'Target', 'central.race@local.test', 'central', 'race', 'central.race@local.test'),
  ('fe400000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'Reconcile', 'Race', 'Source', 'reconcile.race@local.test', 'reconcile', 'race', 'reconcile.race@local.test'),
  ('fe400000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001', 'Reconcile', 'Race', 'Target', 'reconcile.race@local.test', 'reconcile', 'race', 'reconcile.race@local.test'),
  ('fe400000-0000-4000-8000-000000000005', 'fe100000-0000-4000-8000-000000000001', 'Meeting', 'Race', 'Source', 'meeting.race@local.test', 'meeting', 'race', 'meeting.race@local.test'),
  ('fe400000-0000-4000-8000-000000000006', 'fe100000-0000-4000-8000-000000000001', 'Meeting', 'Race', 'Target', 'meeting.race@local.test', 'meeting', 'race', 'meeting.race@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000002', 'fe300000-0000-4000-8000-000000000001', 'archived'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000003', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000004', 'fe300000-0000-4000-8000-000000000001', 'archived'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000005', 'fe300000-0000-4000-8000-000000000001', 'active'),
  ('fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000006', 'fe300000-0000-4000-8000-000000000001', 'archived');

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider, sync_status,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type,
  uploaded_file_path, settings
) VALUES (
  'fe500000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'student_roster', 'Central race source',
  'fe300000-0000-4000-8000-000000000001',
  'uploaded_xlsx', 'not_synced', 'accessible', false,
  'Central race roster.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'fe100000-0000-4000-8000-000000000001/fe500000-0000-4000-8000-000000000001/1.xlsx',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'stagedUpload', true,
    'stagingObjectId', 'fe510000-0000-4000-8000-000000000001',
    'stagingGeneration', 1,
    'stagingContentHash', repeat('5', 64),
    'stagingByteLength', 2048,
    'stagingReadyAt', '2044-08-01T00:00:00Z',
    'evidenceRevision', repeat('5', 64)
  )
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, sync_status, settings
) VALUES
  ('fe500000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'student_roster', 'Reconcile race source', 'uploaded_xlsx', 'not_synced', '{"sourceKind":"student_roster"}'),
  ('fe500000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'meeting_attendance', 'Meeting race source', 'google_sheets', 'not_synced', '{"sourceKind":"meeting_attendance"}');

INSERT INTO plugin_data.csf_sheet_import_staging_objects (
  id, organization_id, source_id, generation, status, bucket, object_path,
  file_extension, content_hash, byte_length, upload_expires_at, ready_at,
  ready_expires_at
) VALUES (
  'fe510000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe500000-0000-4000-8000-000000000001',
  1, 'ready', 'csf-private',
  'fe100000-0000-4000-8000-000000000001/fe500000-0000-4000-8000-000000000001/1.xlsx',
  'xlsx', repeat('5', 64), 2048,
  '2044-08-01T01:00:00Z', '2044-08-01T00:00:00Z', '2044-08-01T01:00:00Z'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata, mapping_snapshot, mapping_version,
  source_content_hash, snapshot_hash, snapshot_row_count,
  snapshot_contract_version
) VALUES (
  'fe600000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe500000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'fe510000-0000-4000-8000-000000000001',
  'Central race roster.xlsx', 'Roster', 'Roster!A1:E2', '2044-08-01T00:00:00Z',
  jsonb_build_object(
    'id', 'fe510000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'name', 'Central race roster.xlsx',
    'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'headRevisionId', repeat('5', 64),
    'stagingGeneration', 1,
    'readyAt', '2044-08-01T00:00:00Z',
    'accessState', 'accessible',
    'trashed', false
  ),
  jsonb_build_object(
    'version', 1,
    'sourceType', 'student_roster',
    'sourceFileId', 'fe510000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'tabs', jsonb_build_array(
      jsonb_build_object(
        'tabName', 'Roster', 'range', 'Roster!A1:E2', 'headerRow', 1
      )
    )
  ),
  1, repeat('5', 64), repeat('2', 64), 1,
  'csf-normalized-import/v1'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type
) VALUES
  ('fe600000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000002', 'fe000000-0000-4000-8000-000000000001', 'preview', 'completed', 'student_roster'),
  ('fe600000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000003', 'fe000000-0000-4000-8000-000000000001', 'preview', 'completed', 'meeting_attendance');

-- The central row is ordinary preview input. Claim, begin, and commit below own
-- every lifecycle field; this fixture never fabricates an attempt or outcome.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name, row_number,
  source_range, row_hash, matched_profile_id, import_status, normalized_data
) VALUES (
  'fe800000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe600000-0000-4000-8000-000000000001',
  'fe500000-0000-4000-8000-000000000001',
  'fe300000-0000-4000-8000-000000000001',
  'Roster', 2, 'Roster!A1:E2', repeat('a', 64),
  'fe400000-0000-4000-8000-000000000001',
  'pending',
  jsonb_build_object(
    'commitPayload', jsonb_build_object(
      'version', 'csf-commit-payload/v1',
      'sourceType', 'student_roster',
      'identity', jsonb_build_object(
        'firstName', 'Central', 'lastName', 'Race',
        'normalizedFirstName', 'central', 'normalizedLastName', 'race'
      ),
      'canonicalEmails', jsonb_build_object(
        'schoolEmail', 'central.race@local.test',
        'normalizedSchoolEmail', 'central.race@local.test'
      )
    )
  )
);

-- Reconciliation starts unmatched. Meeting starts as a mutable live
-- reference, so merge must rewrite it to the canonical profile atomically.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status,
  correlation_id
) VALUES
  ('fe800000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000003', 'fe500000-0000-4000-8000-000000000002', NULL, 'Roster', 3, '{"Name":"Reconcile Race"}', '{}', repeat('d', 64), NULL, 'ambiguous', 'fea00000-0000-4000-8000-000000000002'),
  ('fe800000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000004', 'fe500000-0000-4000-8000-000000000003', 'fe200000-0000-4000-8000-000000000001', 'Responses', 2, '{"Name":"Meeting Race"}', '{}', repeat('e', 64), 'fe400000-0000-4000-8000-000000000005', 'pending', 'fea00000-0000-4000-8000-000000000003');

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_claim_import_commit_attempt(
      'fe100000-0000-4000-8000-000000000001',
      'fe600000-0000-4000-8000-000000000001',
      'fe000000-0000-4000-8000-000000000001',
      300,
      (plugin_data.csf_issue_uploaded_source_evidence(
        'fe100000-0000-4000-8000-000000000001',
        'fe000000-0000-4000-8000-000000000001',
        'fe500000-0000-4000-8000-000000000001',
        'fe600000-0000-4000-8000-000000000001'
      ) ->> 'evidenceToken')::uuid
    )
  $$,
  'the central race obtains its logical commit, attempt, and frozen row through the supported claim lifecycle'
);

-- Test-local orchestration only: begin and commit remain the production RPCs.
-- The pause holds begin's transaction locks long enough for the merge worker to
-- obtain the identity lock and wait on the import row on the current broken
-- ordering. The nested exception reports a deadlock as evidence while allowing
-- the outer transaction to release begin's locks normally.
CREATE FUNCTION plugin_data.csf_test_begin_then_commit_race()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_attempt_id uuid;
  v_state text;
BEGIN
  SELECT attempt.id
  INTO v_attempt_id
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  JOIN plugin_data.csf_sheet_import_jobs AS commit_job
    ON commit_job.id = attempt.commit_job_id
  WHERE commit_job.preview_job_id = 'fe600000-0000-4000-8000-000000000001'
    AND attempt.status = 'running';

  PERFORM plugin_data.csf_begin_import_row_for_attempt(
    'fe100000-0000-4000-8000-000000000001',
    v_attempt_id,
    'fe800000-0000-4000-8000-000000000001'
  );
  PERFORM pg_catalog.pg_sleep(0.5);

  BEGIN
    PERFORM plugin_data.csf_commit_import_row_for_attempt(
      'fe100000-0000-4000-8000-000000000001',
      v_attempt_id,
      'fe800000-0000-4000-8000-000000000001'
    );
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RETURN v_state;
  END;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_test_begin_then_commit_race()
  FROM PUBLIC, anon, authenticated, service_role;

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
  'central_merge_worker',
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
CREATE TEMP TABLE import_merge_race_results (
  label text PRIMARY KEY,
  payload text NOT NULL
) ON COMMIT PRESERVE ROWS;

-- The worker records intent through begin and holds those real transaction locks.
-- The merge worker then obtains the identity lock and blocks on that import row.
-- On the broken ordering, commit asks for identity only after begin owns the row,
-- completing a real deadlock cycle. With one identity-first order, merge waits at
-- the common first lock and both operations complete.
SELECT extensions.dblink_send_query(
  'central_race_worker',
  $$SELECT plugin_data.csf_test_begin_then_commit_race()$$
);
SELECT pg_catalog.pg_sleep(0.15);
SELECT extensions.is(
  extensions.dblink_is_busy('central_race_worker'),
  1,
  'the real begin/commit worker remains active while holding begin-intent locks'
);

SELECT extensions.dblink_send_query(
  'central_merge_worker',
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
SELECT pg_catalog.pg_sleep(0.15);
SELECT extensions.ok(
  extensions.dblink_is_busy('central_race_worker') = 1
    AND extensions.dblink_is_busy('central_merge_worker') = 1,
  'real begin/commit and profile merge observably overlap in separate sessions'
);

INSERT INTO import_merge_race_results (label, payload)
SELECT 'central_commit', payload
FROM extensions.dblink_get_result('central_race_worker', false) AS result(payload text);
SELECT extensions.dblink_disconnect('central_race_worker');

INSERT INTO import_merge_race_results (label, payload)
SELECT 'central_merge', payload
FROM extensions.dblink_get_result('central_merge_worker', false) AS result(payload text);
SELECT extensions.dblink_disconnect('central_merge_worker');

SELECT extensions.ok(
  (SELECT payload FROM import_merge_race_results WHERE label = 'central_commit') = 'ok'
    AND (
      SELECT payload::jsonb ->> 'targetProfileId'
      FROM import_merge_race_results
      WHERE label = 'central_merge'
    ) = 'fe400000-0000-4000-8000-000000000002',
  'the supported lifecycle commit and merge finish without 40P01 and preserve the canonical target'
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

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE id = ANY (ARRAY[
      'fe400000-0000-4000-8000-000000000001'::uuid,
      'fe400000-0000-4000-8000-000000000003'::uuid,
      'fe400000-0000-4000-8000-000000000005'::uuid
    ])
      AND record_status = 'merged'
      AND merged_into_profile_id IS NOT NULL
  ),
  3,
  'all three source records are durable merge tombstones'
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
            'fe400000-0000-4000-8000-000000000005'::uuid
          ])
          OR import_row.commit_target_profile_id = ANY (ARRAY[
            'fe400000-0000-4000-8000-000000000001'::uuid,
            'fe400000-0000-4000-8000-000000000003'::uuid,
            'fe400000-0000-4000-8000-000000000005'::uuid
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
      SELECT attendance.id
      FROM plugin_data.csf_meeting_attendance AS attendance
      WHERE attendance.organization_id = 'fe100000-0000-4000-8000-000000000001'
        AND attendance.profile_id = ANY (ARRAY[
          'fe400000-0000-4000-8000-000000000001'::uuid,
          'fe400000-0000-4000-8000-000000000003'::uuid,
          'fe400000-0000-4000-8000-000000000005'::uuid
        ])
      UNION ALL
      SELECT submission.id
      FROM plugin_data.csf_point_submissions AS submission
      WHERE submission.organization_id = 'fe100000-0000-4000-8000-000000000001'
        AND submission.profile_id = ANY (ARRAY[
          'fe400000-0000-4000-8000-000000000001'::uuid,
          'fe400000-0000-4000-8000-000000000003'::uuid,
          'fe400000-0000-4000-8000-000000000005'::uuid
        ])
    ) AS live_source_reference
  ),
  0,
  'zero live references remain on merged sources'
);

DROP FUNCTION plugin_data.csf_test_begin_then_commit_race();
DROP FUNCTION plugin_data.csf_test_capture_import_merge_race(text);

SELECT * FROM extensions.finish();
