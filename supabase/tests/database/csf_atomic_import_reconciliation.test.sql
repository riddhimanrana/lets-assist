BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(47);

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
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot commit meeting attendance imports'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot commit meeting attendance imports directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the server role can atomically commit meeting attendance imports'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_commit_partner_audit_import(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot commit partner-club audit imports'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_commit_partner_audit_import(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot commit partner-club audit imports directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_commit_partner_audit_import(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the server role can atomically commit partner-club audit imports'
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
    'd9300000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'Partner', 'Success', 'partner', 'success'
  ),
  (
    'd9300000-0000-4000-8000-000000000004',
    'd9100000-0000-4000-8000-000000000001',
    'Partner', 'Rollback', 'partner', 'rollback'
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

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, approved_point_types
) VALUES (
  'd9800000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'Synthetic Service Club',
  ARRAY['non_drive']::text[]
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path, sync_status, settings
) VALUES
  (
    'd9500000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'meeting_attendance',
    'Atomic meeting success source',
    'google_sheets', 'atomic-meeting-success', NULL, 'not_synced',
    '{"sourceKind":"meeting_attendance","meetingId":"d9400000-0000-4000-8000-000000000001"}'
  ),
  (
    'd9500000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'meeting_attendance',
    'Atomic meeting rollback source',
    'google_sheets', 'atomic-meeting-rollback', NULL, 'not_synced',
    '{"sourceKind":"meeting_attendance","meetingId":"d9400000-0000-4000-8000-000000000002"}'
  ),
  (
    'd9500000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'partner_club_audit',
    'Atomic partner success source',
    'uploaded_xlsx', NULL, 'csf/fixture/partner-success.xlsx', 'not_synced',
    '{"sourceKind":"partner_club_audit"}'
  ),
  (
    'd9500000-0000-4000-8000-000000000004',
    'd9100000-0000-4000-8000-000000000001',
    'partner_club_audit',
    'Atomic partner rollback source',
    'uploaded_xlsx', NULL, 'csf/fixture/partner-rollback.xlsx', 'not_synced',
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
    'd9600000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'd9500000-0000-4000-8000-000000000003',
    'd9000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'partner_club_audit',
    'csf/fixture/partner-success.xlsx', 'Partner Success', 'Audit', 'used-range',
    '{"version":1,"sourceType":"partner_club_audit"}', 1,
    'd9d00000-0000-4000-8000-000000000003', '{}', now()
  ),
  (
    'd9600000-0000-4000-8000-000000000004',
    'd9100000-0000-4000-8000-000000000001',
    'd9500000-0000-4000-8000-000000000004',
    'd9000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'partner_club_audit',
    'csf/fixture/partner-rollback.xlsx', 'Partner Rollback', 'Audit', 'used-range',
    '{"version":1,"sourceType":"partner_club_audit"}', 1,
    'd9d00000-0000-4000-8000-000000000004', '{}', now()
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

INSERT INTO plugin_data.csf_partner_submission_batches (
  id, organization_id, partner_club_id, term_id, title, source, source_url, status, submitted_by, summary
) VALUES
  (
    'd9900000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9800000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'Synthetic partner audit success', 'sheet', 'csf/fixture/partner-success.xlsx', 'needs_verification',
    'd9000000-0000-4000-8000-000000000001',
    '{"sheetImportPreviewJobId":"d9600000-0000-4000-8000-000000000003","sheetImportCorrelationId":"d9d00000-0000-4000-8000-000000000003"}'
  ),
  (
    'd9900000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9800000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'Synthetic partner audit rollback', 'sheet', 'csf/fixture/partner-rollback.xlsx', 'needs_verification',
    'd9000000-0000-4000-8000-000000000001',
    '{"sheetImportPreviewJobId":"d9600000-0000-4000-8000-000000000004","sheetImportCorrelationId":"d9d00000-0000-4000-8000-000000000004"}'
  ),
  (
    'd9900000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'd9800000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'Synthetic partner resolution', 'sheet', 'csf/fixture/partner-success.xlsx', 'needs_verification',
    'd9000000-0000-4000-8000-000000000001',
    '{"sheetImportPreviewJobId":"d9600000-0000-4000-8000-000000000005","sheetImportCorrelationId":"d9d00000-0000-4000-8000-000000000005"}'
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
    'meeting-success-hash', 'd9300000-0000-4000-8000-000000000001', 'pending',
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
    'd9700000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000003',
    'd9500000-0000-4000-8000-000000000003',
    'd9200000-0000-4000-8000-000000000001',
    'Audit', 2, '{"Name":"Partner Success"}',
    '{"partnerAuditBatchId":"d9900000-0000-4000-8000-000000000001","source":{"rowHash":"partner-success-hash"}}',
    'partner-success-hash', 'd9300000-0000-4000-8000-000000000003', 'pending',
    'd9d00000-0000-4000-8000-000000000003'
  ),
  (
    'd9700000-0000-4000-8000-000000000004',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000004',
    'd9500000-0000-4000-8000-000000000004',
    'd9200000-0000-4000-8000-000000000001',
    'Audit', 2, '{"Name":"Partner Rollback"}',
    '{"partnerAuditBatchId":"d9900000-0000-4000-8000-000000000002","source":{"rowHash":"partner-rollback-hash"}}',
    'partner-rollback-hash', 'd9300000-0000-4000-8000-000000000004', 'pending',
    'd9d00000-0000-4000-8000-000000000004'
  ),
  (
    'd9700000-0000-4000-8000-000000000005',
    'd9100000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000005',
    'd9500000-0000-4000-8000-000000000003',
    'd9200000-0000-4000-8000-000000000001',
    'Audit', 3, '{"Name":"Resolved Member"}',
    '{"partnerAuditBatchId":"d9900000-0000-4000-8000-000000000003","source":{"rowHash":"partner-resolution-hash"}}',
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
    '{"partnerAuditBatchId":"d9900000-0000-4000-8000-000000000003","source":{"rowHash":"partner-skip-hash"}}',
    'partner-skip-hash', NULL, 'conflict',
    'd9d00000-0000-4000-8000-000000000006'
  );

INSERT INTO plugin_data.csf_partner_submission_rows (
  id, organization_id, batch_id, profile_id, matched_status, raw_data, normalized_data,
  claimed_points, point_type
) VALUES
  (
    'd9a00000-0000-4000-8000-000000000001',
    'd9100000-0000-4000-8000-000000000001',
    'd9900000-0000-4000-8000-000000000001',
    'd9300000-0000-4000-8000-000000000003',
    'matched', '{"Name":"Partner Success"}',
    '{"source":{"rowHash":"partner-success-hash"}}', 2, 'non_drive'
  ),
  (
    'd9a00000-0000-4000-8000-000000000002',
    'd9100000-0000-4000-8000-000000000001',
    'd9900000-0000-4000-8000-000000000002',
    'd9300000-0000-4000-8000-000000000004',
    'matched', '{"Name":"Partner Rollback"}',
    '{"source":{"rowHash":"partner-rollback-hash"}}', 2, 'non_drive'
  ),
  (
    'd9a00000-0000-4000-8000-000000000003',
    'd9100000-0000-4000-8000-000000000001',
    'd9900000-0000-4000-8000-000000000003',
    NULL, 'ambiguous', '{"Name":"Resolved Member"}',
    '{"source":{"rowHash":"partner-resolution-hash"}}', 1, 'non_drive'
  ),
  (
    'd9a00000-0000-4000-8000-000000000004',
    'd9100000-0000-4000-8000-000000000001',
    'd9900000-0000-4000-8000-000000000003',
    NULL, 'unmatched', '{"Name":"Skipped Record"}',
    '{"source":{"rowHash":"partner-skip-hash"}}', 1, 'non_drive'
  );

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9600000-0000-4000-8000-000000000001',
      'd9000000-0000-4000-8000-000000000001',
      'Verified the synthetic attendance preview.',
      'd9d00000-0000-4000-8000-000000000001'
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
      'd9d00000-0000-4000-8000-000000000001'
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
    SELECT plugin_data.csf_commit_partner_audit_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9900000-0000-4000-8000-000000000001',
      'approved',
      'd9000000-0000-4000-8000-000000000001',
      'Approved the reconciled synthetic partner audit.',
      'd9d00000-0000-4000-8000-000000000003'
    )
  $$,
  'a reconciled partner-club audit commits atomically'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE organization_id = 'd9100000-0000-4000-8000-000000000001'
     AND description = 'Synthetic partner audit success partner club audit'),
  1,
  'partner commit creates one normalized point submission'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records AS credit
   JOIN plugin_data.csf_point_submissions AS submission ON submission.id = credit.submission_id
   WHERE submission.description = 'Synthetic partner audit success partner club audit'),
  1,
  'partner commit creates one linked credit record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events AS event
   WHERE event.source_ref->>'partnerAuditRowId' = 'd9a00000-0000-4000-8000-000000000001'),
  1,
  'partner commit creates one normalized member activity event'
);
SELECT extensions.ok(
  (SELECT generated_submission_id IS NOT NULL
   FROM plugin_data.csf_partner_submission_rows
   WHERE id = 'd9a00000-0000-4000-8000-000000000001'),
  'partner commit marks the source row with its generated submission'
);
SELECT extensions.ok(
  (
    SELECT correlation_id = 'd9d00000-0000-4000-8000-000000000003'
      AND source_type = 'sheet_import'
      AND reason_code = 'partner_audit_committed'
      AND after_data->>'reason' = 'Approved the reconciled synthetic partner audit.'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'd9900000-0000-4000-8000-000000000001'
      AND action = 'partner_audit.commit'
  ),
  'partner audit preserves explicit correlation, source, and reason'
);
SELECT extensions.ok(
  (
    plugin_data.csf_commit_partner_audit_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9900000-0000-4000-8000-000000000001',
      'approved',
      'd9000000-0000-4000-8000-000000000001',
      'Approved the reconciled synthetic partner audit.',
      'd9d00000-0000-4000-8000-000000000003'
    )->>'idempotent'
  )::boolean,
  'repeating the same partner-audit commit returns an idempotent result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE organization_id = 'd9100000-0000-4000-8000-000000000001'
     AND mode = 'commit'
     AND source_type = 'partner_club_audit'
     AND summary->>'previewJobId' = 'd9600000-0000-4000-8000-000000000003'),
  1,
  'repeated partner-audit commits do not duplicate commit jobs'
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
  'an officer match decision updates the import row and linked partner row atomically'
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
    SELECT matched_status = 'matched'
      AND profile_id = 'd9300000-0000-4000-8000-000000000005'
    FROM plugin_data.csf_partner_submission_rows
    WHERE id = 'd9a00000-0000-4000-8000-000000000003'
  ),
  'the linked partner row receives the same match decision'
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
  'an officer skip decision updates the import row and linked partner row atomically'
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
SELECT extensions.is(
  (SELECT matched_status FROM plugin_data.csf_partner_submission_rows
   WHERE id = 'd9a00000-0000-4000-8000-000000000004'),
  'rejected',
  'the linked partner row receives the same skip decision'
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
      'd9d00000-0000-4000-8000-000000000002'
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
      'd9d00000-0000-4000-8000-000000000002'
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
  IF NEW.target_id IN (
    'd9400000-0000-4000-8000-000000000002'::uuid,
    'd9900000-0000-4000-8000-000000000002'::uuid
  ) THEN
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
      'd9d00000-0000-4000-8000-000000000002'
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

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'd9100000-0000-4000-8000-000000000001',
      'd9900000-0000-4000-8000-000000000002',
      'approved',
      'd9000000-0000-4000-8000-000000000001',
      'This transaction must roll back at the audit boundary.',
      'd9d00000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'synthetic audit failure',
  'an audit failure aborts the full partner-audit commit'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic partner audit rollback partner club audit'),
  0,
  'rolled-back partner commit leaves no point submission'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records AS credit
   JOIN plugin_data.csf_point_submissions AS submission ON submission.id = credit.submission_id
   WHERE submission.description = 'Synthetic partner audit rollback partner club audit'),
  0,
  'rolled-back partner commit leaves no credit record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events
   WHERE source_ref->>'partnerAuditRowId' = 'd9a00000-0000-4000-8000-000000000002'),
  0,
  'rolled-back partner commit leaves no member activity event'
);
SELECT extensions.ok(
  (SELECT generated_submission_id IS NULL
   FROM plugin_data.csf_partner_submission_rows
   WHERE id = 'd9a00000-0000-4000-8000-000000000002'),
  'rolled-back partner commit leaves the source row uncommitted'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE organization_id = 'd9100000-0000-4000-8000-000000000001'
     AND mode = 'commit'
     AND source_type = 'partner_club_audit'
     AND summary->>'previewJobId' = 'd9600000-0000-4000-8000-000000000004'),
  0,
  'rolled-back partner commit leaves no orphan commit job'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id IN (
     'd9400000-0000-4000-8000-000000000002',
     'd9900000-0000-4000-8000-000000000002'
   )),
  0,
  'failed atomic commits leave no partial audit records'
);

DROP TRIGGER fail_atomic_csf_import_audit ON plugin_data.csf_admin_audit_events;

SELECT * FROM extensions.finish();
ROLLBACK;
