BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(32);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot reconcile CSF import rows'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot reconcile CSF import rows directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can reconcile CSF import rows'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot commit meeting attendance imports'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot commit meeting attendance imports directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can atomically commit meeting attendance imports'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_commit_partner_audit_import(uuid,uuid,text,uuid,text,uuid,uuid)') IS NULL,
  'the retired partner-club audit commit RPC no longer exists'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'd9000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'atomic-import-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'd9100000-0000-4000-8000-000000000001',
    'CSF Atomic Import Reconciliation',
    'csf-atomic-import-reconciliation',
    'school',
    '994001'
  ),
  (
    'd9100000-0000-4000-8000-000000000002',
    'CSF Atomic Import Isolation',
    'csf-atomic-import-isolation',
    'school',
    '994002'
  );

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'd9100000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'd9200000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'F30', 'Fall 2030', '2030-2031', 'fall'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  (
    'd9300000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'Meeting', 'Success', 'meeting', 'success'
  ),
  (
    'd9300000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'Meeting', 'Rollback', 'meeting', 'rollback'
  ),
  (
    'd9300000-0000-4000-8000-000000000005',
    'd9100000-0000-4000-8000-000000000001',
    'Resolved', 'Member', 'resolved', 'member'
  );

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date
) VALUES
  (
    'd9400000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'fall-kickoff', 'Fall kickoff', '2030-09-01'
  ),
  (
    'd9400000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'fall-closeout', 'Fall closeout', '2030-12-01'
  );

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES
  (
    'd9b00000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'fall-kickoff', 'Fall kickoff'
  ),
  (
    'd9b00000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'fall-closeout', 'Fall closeout'
  );

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date
) VALUES
  (
    'd9c00000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9b00000-0000-4000-8000-000000000001',
    'd9400000-0000-4000-8000-000000000001',
    '2030-09-01'
  ),
  (
    'd9c00000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9b00000-0000-4000-8000-000000000002',
    'd9400000-0000-4000-8000-000000000002',
    '2030-12-01'
  );

-- The partner source is Sheets-backed here, as the form-responses import
-- registers it; the partner batch pipeline it once fed was retired with the
-- 2026-08-17 partner-club simplification, but the source type itself is kept
-- for identity reconciliation of its rows.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path,
  drive_file_id, drive_mime_type, drive_modified_at, sync_status, settings
) VALUES
  (
    'd9500000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'meeting_attendance',
    'Atomic meeting success source',
    'google_sheets', 'atomic-meeting-success', NULL,
    'atomic-meeting-success', 'application/vnd.google-apps.spreadsheet',
    '2030-08-01T00:00:00Z', 'not_synced',
    '{"sourceKind":"meeting_attendance","meetingId":"d9400000-0000-4000-8000-000000000001"}'
  ),
  (
    'd9500000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'meeting_attendance',
    'Atomic meeting rollback source',
    'google_sheets', 'atomic-meeting-rollback', NULL,
    'atomic-meeting-rollback', 'application/vnd.google-apps.spreadsheet',
    '2030-08-02T00:00:00Z', 'not_synced',
    '{"sourceKind":"meeting_attendance","meetingId":"d9400000-0000-4000-8000-000000000002"}'
  ),
  (
    'd9500000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'partner_club_audit',
    'Atomic partner success source',
    'google_sheets', 'atomic-partner-success', NULL,
    'atomic-partner-success', 'application/vnd.google-apps.spreadsheet',
    '2030-08-03T00:00:00Z', 'not_synced',
    '{"sourceKind":"partner_club_audit"}'
  );

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  mapping_snapshot, mapping_version, correlation_id, summary, completed_at
) VALUES
  (
    'd9600000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9500000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'meeting_attendance',
    'atomic-meeting-success', 'Meeting Success', 'Responses', 'Responses!A1:C10',
    '{"version":1,"sourceType":"meeting_attendance"}', 1,
    'd9d00000-0000-4000-8000-000000000001', '{}', now()
  ),
  (
    'd9600000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9500000-0000-4000-8000-000000000002',
    'd9000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'meeting_attendance',
    'atomic-meeting-rollback', 'Meeting Rollback', 'Responses', 'Responses!A1:C10',
    '{"version":1,"sourceType":"meeting_attendance"}', 1,
    'd9d00000-0000-4000-8000-000000000002', '{}', now()
  ),
  (
    'd9600000-0000-4000-8000-000000000005',
    'd9100000-0000-4000-8000-000000000001',
    'd9500000-0000-4000-8000-000000000003',
    'd9000000-0000-4000-8000-000000000001',
    'preview', 'needs_resolution', 'partner_club_audit',
    'csf/fixture/partner-success.xlsx', 'Partner Resolution', 'Audit', 'used-range',
    '{"version":1,"sourceType":"partner_club_audit"}', 1,
    'd9d00000-0000-4000-8000-000000000005', '{}', now()
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status, correlation_id
) VALUES
  (
    'd9700000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000001',
    'd9500000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Meeting Success"}',
    '{"meetingId":"d9400000-0000-4000-8000-000000000001","submittedName":"Meeting Success","submittedEmail":"meeting.success@local.test","normalizedEmail":"meeting.success@local.test"}',
    'meeting-success-hash', NULL, 'ambiguous',
    'd9d00000-0000-4000-8000-000000000001'
  ),
  (
    'd9700000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000002',
    'd9500000-0000-4000-8000-000000000002',
    'd9200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Meeting Rollback"}',
    '{"meetingId":"d9400000-0000-4000-8000-000000000002","submittedName":"Meeting Rollback","submittedEmail":"meeting.rollback@local.test","normalizedEmail":"meeting.rollback@local.test"}',
    'meeting-rollback-hash', 'd9300000-0000-4000-8000-000000000002', 'pending',
    'd9d00000-0000-4000-8000-000000000002'
  ),
  (
    'd9700000-0000-4000-8000-000000000005',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000005',
    'd9500000-0000-4000-8000-000000000003',
    'd9200000-0000-4000-8000-000000000001',
    'Audit', 3, '{"Name":"Resolved Member"}',
    '{"source":{"rowHash":"partner-resolution-hash"}}',
    'partner-resolution-hash', NULL, 'ambiguous',
    'd9d00000-0000-4000-8000-000000000005'
  ),
  (
    'd9700000-0000-4000-8000-000000000006',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000005',
    'd9500000-0000-4000-8000-000000000003',
    'd9200000-0000-4000-8000-000000000001',
    'Audit', 4, '{"Name":"Skipped Record"}',
    '{"source":{"rowHash":"partner-skip-hash"}}',
    'partner-skip-hash', NULL, 'conflict',
    'd9d00000-0000-4000-8000-000000000006'
  );

SELECT extensions.lives_ok($$
  SELECT plugin_data.csf_reconcile_sheet_import_row(
    'd9100000-0000-4000-8000-000000000001',
    'd9700000-0000-4000-8000-000000000001',
    'd9300000-0000-4000-8000-000000000001',
    'match', 'Officer checked the fictional attendance record.',
    'd9000000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    '{"matchMethod":"officer_review","matchConfidence":0.95,"matchDetails":{"reviewed":true}}'::jsonb
  )
$$, 'attendance review accepts metadata without rewriting source evidence');
SELECT extensions.ok((SELECT
  NOT (normalized_data ? 'matchMethod') AND resolution_metadata->>'matchMethod' = 'officer_review'
  FROM plugin_data.csf_sheet_import_rows WHERE id = 'd9700000-0000-4000-8000-000000000001'),
  'attendance review keeps source and resolution evidence separate');

-- The source-evidence receipts the two succeeding or write-reaching commits spend,
-- written exactly as `csf_refresh_sheet_source_evidence` writes them: the same canonical
-- metadata digest recomputed from the receipt's own coordinates, the same
-- `evidenceRevision`/`evidenceDigest` pair on the source, the same generation.
-- `csf_consume_sheet_source_evidence` re-derives all three, so a receipt that did not
-- describe itself would be refused rather than accepted.
WITH minted AS (
  SELECT *
  FROM (VALUES
    ('d9600000-0000-4000-8000-000000000001'::uuid, 'd9e00000-0000-4000-8000-000000000001'::uuid),
    ('d9600000-0000-4000-8000-000000000002'::uuid, 'd9e00000-0000-4000-8000-000000000002'::uuid)
  ) AS pair(preview_job_id, nonce)
),
coordinate AS (
  SELECT
    minted.preview_job_id,
    minted.nonce,
    job.organization_id,
    job.source_id,
    source.spreadsheet_id AS provider_file_id,
    source.drive_modified_at AS modified_time,
    encode(
      sha256(convert_to(
        plugin_data.csf_canonical_json(jsonb_build_object(
          'fileId', source.spreadsheet_id,
          'mimeType', 'application/vnd.google-apps.spreadsheet',
          'modifiedTime', to_char(
            source.drive_modified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'version', '5',
          'trashed', false
        )),
        'UTF8'
      )),
      'hex'
    ) AS metadata_digest
  FROM minted
  JOIN plugin_data.csf_sheet_import_jobs AS job ON job.id = minted.preview_job_id
  JOIN plugin_data.csf_sheet_sources AS source ON source.id = job.source_id
),
refreshed AS (
  UPDATE plugin_data.csf_sheet_sources AS source
  SET evidence_generation = 1,
      evidence_refreshed_at = now(),
      settings = source.settings || jsonb_build_object(
        'evidenceRevision', '5',
        'evidenceDigest', coordinate.metadata_digest
      )
  FROM coordinate
  WHERE source.id = coordinate.source_id
  RETURNING source.id
)
INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
  organization_id, source_id, actor_user_id, preview_job_id, provider, nonce,
  evidence_generation, metadata_digest, provider_file_id, provider_version,
  mime_type, modified_time, access_checked_at, expires_at
)
SELECT
  coordinate.organization_id, coordinate.source_id,
  'd9000000-0000-4000-8000-000000000001', coordinate.preview_job_id,
  'google_sheets', coordinate.nonce, 1, coordinate.metadata_digest,
  coordinate.provider_file_id, '5',
  'application/vnd.google-apps.spreadsheet', coordinate.modified_time,
  now(), now() + interval '10 minutes'
FROM coordinate;

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9600000-0000-4000-8000-000000000001',
      'd9000000-0000-4000-8000-000000000001',
      'Verified the synthetic attendance preview.',
      'd9d00000-0000-4000-8000-000000000001',
      'd9e00000-0000-4000-8000-000000000001'
    )
  $$,
  'a reconciled meeting-attendance preview commits atomically'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE organization_id = 'd9100000-0000-4000-8000-000000000001'
     AND source_row_id = 'd9700000-0000-4000-8000-000000000001'),
  1,
  'meeting commit creates one normalized attendance record'
);
SELECT extensions.ok((SELECT match_confidence = 0.95
  AND match_details->>'matchMethod' = 'officer_review'
  AND match_details->>'reviewed' = 'true'
  FROM plugin_data.csf_meeting_attendance
  WHERE source_row_id = 'd9700000-0000-4000-8000-000000000001'),
  'attendance commit retains the officer resolution provenance');
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'd9700000-0000-4000-8000-000000000001'),
  'created',
  'meeting commit records the immutable row outcome'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'd9400000-0000-4000-8000-000000000001'
     AND action = 'term_meeting.attendance_commit'),
  1,
  'meeting commit writes one audit event in the same transaction'
);
SELECT extensions.ok(
  (
    SELECT correlation_id = 'd9d00000-0000-4000-8000-000000000001'
      AND source_type = 'sheet_import'
      AND reason_code = 'meeting_attendance_committed'
      AND after_data->>'reason' = 'Verified the synthetic attendance preview.'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'd9400000-0000-4000-8000-000000000001'
      AND action = 'term_meeting.attendance_commit'
  ),
  'meeting audit preserves explicit correlation, source, and reason'
);
SELECT extensions.ok(
  (
    plugin_data.csf_commit_meeting_attendance_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9600000-0000-4000-8000-000000000001',
      'd9000000-0000-4000-8000-000000000001',
      'Verified the synthetic attendance preview.',
      'd9d00000-0000-4000-8000-000000000001', NULL
    )->>'idempotent'
  )::boolean,
  'repeating the same meeting commit returns an idempotent result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE organization_id = 'd9100000-0000-4000-8000-000000000001'
     AND mode = 'commit'
     AND source_type = 'meeting_attendance'
     AND summary->>'previewJobId' = 'd9600000-0000-4000-8000-000000000001'),
  1,
  'repeated meeting commits do not duplicate commit jobs'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_reconcile_sheet_import_row(
      'd9100000-0000-4000-8000-000000000001',
      'd9700000-0000-4000-8000-000000000005',
      'd9300000-0000-4000-8000-000000000005',
      'match',
      'Matched the sanitized row to the verified member.',
      'd9000000-0000-4000-8000-000000000001',
      'd9d00000-0000-4000-8000-000000000005'
    )
  $$,
  'an officer match decision updates the import row atomically'
);
SELECT extensions.ok(
  (
    SELECT import_status = 'pending'
      AND resolution_status = 'resolved'
      AND matched_profile_id = 'd9300000-0000-4000-8000-000000000005'
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'd9700000-0000-4000-8000-000000000005'
  ),
  'the reconciled import row is ready for commit with explicit resolution metadata'
);
SELECT extensions.ok(
  (
    SELECT correlation_id = 'd9d00000-0000-4000-8000-000000000005'
      AND reason_code = 'matched_existing_profile'
      AND after_data->>'reason' = 'Matched the sanitized row to the verified member.'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'd9700000-0000-4000-8000-000000000005'
      AND action = 'sheets.row_match_resolved'
  ),
  'the match decision writes correlated, reasoned audit history'
);
SELECT extensions.ok(
  (
    plugin_data.csf_reconcile_sheet_import_row(
      'd9100000-0000-4000-8000-000000000001',
      'd9700000-0000-4000-8000-000000000005',
      'd9300000-0000-4000-8000-000000000005',
      'match',
      'Matched the sanitized row to the verified member.',
      'd9000000-0000-4000-8000-000000000001',
      'd9d00000-0000-4000-8000-000000000005'
    )->>'idempotent'
  )::boolean,
  'repeating the same row decision is idempotent'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_reconcile_sheet_import_row(
      'd9100000-0000-4000-8000-000000000001',
      'd9700000-0000-4000-8000-000000000006',
      NULL,
      'skip',
      'The sanitized row is not a valid member record.',
      'd9000000-0000-4000-8000-000000000001',
      'd9d00000-0000-4000-8000-000000000006'
    )
  $$,
  'an officer skip decision updates the import row atomically'
);
SELECT extensions.ok(
  (
    SELECT import_status = 'skipped'
      AND resolution_status = 'ignored'
      AND resolution_reason_code = 'officer_skipped'
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'd9700000-0000-4000-8000-000000000006'
  ),
  'the skipped import row preserves explicit resolution metadata'
);
SELECT extensions.ok(
  (
    SELECT correlation_id = 'd9d00000-0000-4000-8000-000000000006'
      AND reason_code = 'officer_skipped'
      AND after_data->>'reason' = 'The sanitized row is not a valid member record.'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'd9700000-0000-4000-8000-000000000006'
      AND action = 'sheets.row_skipped'
  ),
  'the skip decision writes correlated, reasoned audit history'
);
SELECT extensions.ok(
  (
    plugin_data.csf_reconcile_sheet_import_row(
      'd9100000-0000-4000-8000-000000000001',
      'd9700000-0000-4000-8000-000000000006',
      NULL,
      'skip',
      'The sanitized row is not a valid member record.',
      'd9000000-0000-4000-8000-000000000001',
      'd9d00000-0000-4000-8000-000000000006'
    )->>'idempotent'
  )::boolean,
  'repeating the same skip decision is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'd9100000-0000-4000-8000-000000000002',
      'd9600000-0000-4000-8000-000000000002',
      'd9000000-0000-4000-8000-000000000001',
      'Attempted cross-organization commit.',
      'd9d00000-0000-4000-8000-000000000002', NULL
    )
  $$,
  'P0001',
  'Choose a meeting-attendance preview.',
  'organization scope blocks a preview from another tenant'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9600000-0000-4000-8000-000000000002',
      'd9000000-0000-4000-8000-000000000001',
      '',
      'd9d00000-0000-4000-8000-000000000002', NULL
    )
  $$,
  'P0001',
  'A meeting-attendance commit reason is required.',
  'meeting commits require an explicit reason'
);

CREATE FUNCTION pg_temp.fail_atomic_csf_import_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.target_id = 'd9400000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'synthetic audit failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fail_atomic_csf_import_audit
BEFORE INSERT ON plugin_data.csf_admin_audit_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_atomic_csf_import_audit();

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9600000-0000-4000-8000-000000000002',
      'd9000000-0000-4000-8000-000000000001',
      'This transaction must roll back at the audit boundary.',
      'd9d00000-0000-4000-8000-000000000002',
      'd9e00000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'synthetic audit failure',
  'an audit failure aborts the full meeting-attendance commit'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE source_row_id = 'd9700000-0000-4000-8000-000000000002'),
  0,
  'rolled-back meeting commit leaves no attendance row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE organization_id = 'd9100000-0000-4000-8000-000000000001'
     AND mode = 'commit'
     AND source_type = 'meeting_attendance'
     AND summary->>'previewJobId' = 'd9600000-0000-4000-8000-000000000002'),
  0,
  'rolled-back meeting commit leaves no orphan commit job'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'd9700000-0000-4000-8000-000000000002'),
  'pending',
  'rolled-back meeting commit leaves its preview row unchanged'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'd9400000-0000-4000-8000-000000000002'),
  0,
  'the failed atomic commit leaves no partial audit records'
);

DROP TRIGGER fail_atomic_csf_import_audit ON plugin_data.csf_admin_audit_events;

SELECT * FROM extensions.finish();
ROLLBACK;
