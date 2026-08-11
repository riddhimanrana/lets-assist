-- Contextual CSF commits refuse atomically while a sibling row is unresolved, and a
-- preview-less historical partner batch fails closed until an officer acknowledges it.
--
-- Every commit below also carries `p_evidence_token`. The refusal paths keep proving what
-- they always proved -- readiness is read, and refuses, before the receipt is spent -- and
-- the succeeding paths spend a real one. What the receipt itself refuses (missing, wrong,
-- expired, replayed) and what a refusal does NOT spend live in
-- csf_contextual_commit_evidence.test.sql, so this file stays about readiness.
--
-- Every identity below is synthetic and lives only inside this rolled-back transaction.
-- Concurrency is proved separately, in csf_contextual_commit_lock_order.test.sql, because
-- a second session cannot see fixtures this transaction has not committed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- An exact plan. no_plan() cannot distinguish "every assertion passed" from "some never
-- ran", and a gate that silently stops running is the failure this file exists to catch.
SELECT extensions.plan(61);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'e1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'contextual-readiness-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'e1100000-0000-4000-8000-000000000001',
  'CSF Contextual Commit Readiness',
  'csf-contextual-commit-readiness',
  'school',
  '995101'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'F31', 'Fall 2031', '2031-2032', 'fall'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('e1300000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001',
   'Ready', 'Attendee', 'ready', 'attendee'),
  ('e1300000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001',
   'Clean', 'Attendee', 'clean', 'attendee'),
  ('e1300000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000001',
   'Ready', 'Auditee', 'ready', 'auditee'),
  ('e1300000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001',
   'Clean', 'Auditee', 'clean', 'auditee'),
  ('e1300000-0000-4000-8000-000000000005', 'e1100000-0000-4000-8000-000000000001',
   'Second', 'Attendee', 'second', 'attendee'),
  ('e1300000-0000-4000-8000-000000000006', 'e1100000-0000-4000-8000-000000000001',
   'Termless', 'Attendee', 'termless', 'attendee'),
  ('e1300000-0000-4000-8000-000000000007', 'e1100000-0000-4000-8000-000000000001',
   'Linked', 'Auditee', 'linked', 'auditee'),
  ('e1300000-0000-4000-8000-000000000008', 'e1100000-0000-4000-8000-000000000001',
   'Historical', 'Auditee', 'historical', 'auditee');

-- Four meetings: one preview holds an unresolved sibling, one is all ready, one holds
-- ready rows that name no member or no semester, one names the same member twice.
INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date
) VALUES
  (
    'e1400000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'blocked-meeting', 'Blocked meeting', '2031-09-01'
  ),
  (
    'e1400000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'clean-meeting', 'Clean meeting', '2031-10-01'
  ),
  (
    'e1400000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'unreconciled-meeting', 'Unreconciled meeting', '2031-11-01'
  ),
  (
    'e1400000-0000-4000-8000-000000000004',
    'e1100000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'repeated-meeting', 'Repeated meeting', '2031-12-01'
  );

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES
  ('e1b00000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001',
   'e1200000-0000-4000-8000-000000000001', 'blocked-meeting', 'Blocked meeting'),
  ('e1b00000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001',
   'e1200000-0000-4000-8000-000000000001', 'clean-meeting', 'Clean meeting'),
  ('e1b00000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000001',
   'e1200000-0000-4000-8000-000000000001', 'unreconciled-meeting', 'Unreconciled meeting'),
  ('e1b00000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001',
   'e1200000-0000-4000-8000-000000000001', 'repeated-meeting', 'Repeated meeting');

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date
) VALUES
  ('e1c00000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001',
   'e1b00000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001', '2031-09-01'),
  ('e1c00000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001',
   'e1b00000-0000-4000-8000-000000000002', 'e1400000-0000-4000-8000-000000000002', '2031-10-01'),
  ('e1c00000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000001',
   'e1b00000-0000-4000-8000-000000000003', 'e1400000-0000-4000-8000-000000000003', '2031-11-01'),
  ('e1c00000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001',
   'e1b00000-0000-4000-8000-000000000004', 'e1400000-0000-4000-8000-000000000004', '2031-12-01');

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, approved_point_types
) VALUES (
  'e1800000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'Synthetic Readiness Club',
  ARRAY['non_drive']::text[]
);

-- Sources. The four whose commits actually succeed below are Google-backed and carry the
-- exact drive coordinates a receipt is minted against; the two partner sources whose
-- commits are refused before any consume stay uploaded workbooks on purpose, so the
-- refusal paths are not quietly proved on a source family they do not run on. Both
-- partner families are real: an uploaded audit workbook and a Sheets-backed one.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path,
  drive_file_id, drive_mime_type, drive_modified_at, sync_status, settings
) VALUES
  ('e1500000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001',
   'meeting_attendance', 'Blocked meeting source',
   'google_sheets', 'contextual-blocked-meeting', NULL,
   'contextual-blocked-meeting', 'application/vnd.google-apps.spreadsheet',
   '2031-08-01T00:00:00Z', 'not_synced',
   '{"sourceKind":"meeting_attendance","meetingId":"e1400000-0000-4000-8000-000000000001"}'),
  ('e1500000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001',
   'meeting_attendance', 'Clean meeting source',
   'google_sheets', 'contextual-clean-meeting', NULL,
   'contextual-clean-meeting', 'application/vnd.google-apps.spreadsheet',
   '2031-08-02T00:00:00Z', 'not_synced',
   '{"sourceKind":"meeting_attendance","meetingId":"e1400000-0000-4000-8000-000000000002"}'),
  ('e1500000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Blocked partner source',
   'uploaded_xlsx', NULL, 'csf/fixture/contextual-blocked.xlsx',
   NULL, NULL, NULL, 'not_synced',
   '{"sourceKind":"partner_club_audit"}'),
  ('e1500000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Clean partner source',
   'google_sheets', 'contextual-clean-partner', NULL,
   'contextual-clean-partner', 'application/vnd.google-apps.spreadsheet',
   '2031-08-04T00:00:00Z', 'not_synced',
   '{"sourceKind":"partner_club_audit"}'),
  ('e1500000-0000-4000-8000-000000000005', 'e1100000-0000-4000-8000-000000000001',
   'meeting_attendance', 'Unreconciled meeting source',
   'google_sheets', 'contextual-unreconciled-meeting', NULL,
   'contextual-unreconciled-meeting', 'application/vnd.google-apps.spreadsheet',
   '2031-08-05T00:00:00Z', 'not_synced',
   '{"sourceKind":"meeting_attendance","meetingId":"e1400000-0000-4000-8000-000000000003"}'),
  ('e1500000-0000-4000-8000-000000000006', 'e1100000-0000-4000-8000-000000000001',
   'meeting_attendance', 'Repeated meeting source',
   'google_sheets', 'contextual-repeated-meeting', NULL,
   'contextual-repeated-meeting', 'application/vnd.google-apps.spreadsheet',
   '2031-08-06T00:00:00Z', 'not_synced',
   '{"sourceKind":"meeting_attendance","meetingId":"e1400000-0000-4000-8000-000000000004"}'),
  ('e1500000-0000-4000-8000-000000000007', 'e1100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Linked-preview partner source',
   'google_sheets', 'contextual-linked-partner', NULL,
   'contextual-linked-partner', 'application/vnd.google-apps.spreadsheet',
   '2031-08-07T00:00:00Z', 'not_synced',
   '{"sourceKind":"partner_club_audit"}');

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  mapping_snapshot, mapping_version, correlation_id, summary, completed_at
) VALUES
  (
    'e1600000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'needs_resolution', 'meeting_attendance',
    'contextual-blocked-meeting', 'Blocked Meeting', 'Responses', 'Responses!A1:C10',
    '{"version":1,"sourceType":"meeting_attendance"}', 1,
    'e1d00000-0000-4000-8000-000000000001', '{}', now()
  ),
  (
    'e1600000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'meeting_attendance',
    'contextual-clean-meeting', 'Clean Meeting', 'Responses', 'Responses!A1:C10',
    '{"version":1,"sourceType":"meeting_attendance"}', 1,
    'e1d00000-0000-4000-8000-000000000002', '{}', now()
  ),
  (
    'e1600000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'needs_resolution', 'partner_club_audit',
    'csf/fixture/contextual-blocked.xlsx', 'Blocked Partner', 'Audit', 'Audit!A1:E12',
    '{"version":1,"sourceType":"partner_club_audit"}', 1,
    'e1d00000-0000-4000-8000-000000000003', '{}', now()
  ),
  (
    'e1600000-0000-4000-8000-000000000004',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'partner_club_audit',
    'contextual-clean-partner', 'Clean Partner', 'Audit', 'Audit!A1:E12',
    '{"version":1,"sourceType":"partner_club_audit"}', 1,
    'e1d00000-0000-4000-8000-000000000004', '{}', now()
  ),
  (
    'e1600000-0000-4000-8000-000000000005',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000005',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'meeting_attendance',
    'contextual-unreconciled-meeting', 'Unreconciled Meeting', 'Responses', 'Responses!A1:C10',
    '{"version":1,"sourceType":"meeting_attendance"}', 1,
    'e1d00000-0000-4000-8000-000000000005', '{}', now()
  ),
  (
    'e1600000-0000-4000-8000-000000000006',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000006',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'meeting_attendance',
    'contextual-repeated-meeting', 'Repeated Meeting', 'Responses', 'Responses!A1:C10',
    '{"version":1,"sourceType":"meeting_attendance"}', 1,
    'e1d00000-0000-4000-8000-000000000006', '{}', now()
  ),
  (
    'e1600000-0000-4000-8000-000000000007',
    'e1100000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000007',
    'e1000000-0000-4000-8000-000000000001',
    'preview', 'needs_resolution', 'partner_club_audit',
    'contextual-linked-partner', 'Linked Partner', 'Audit', 'Audit!A1:E12',
    '{"version":1,"sourceType":"partner_club_audit"}', 1,
    'e1d00000-0000-4000-8000-000000000007', '{}', now()
  );

INSERT INTO plugin_data.csf_partner_submission_batches (
  id, organization_id, partner_club_id, term_id, title, source, source_url, status, submitted_by, summary
) VALUES
  (
    'e1900000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1800000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Synthetic blocked audit', 'sheet', 'csf/fixture/contextual-blocked.xlsx', 'needs_verification',
    'e1000000-0000-4000-8000-000000000001',
    '{"sheetImportPreviewJobId":"e1600000-0000-4000-8000-000000000003","sheetImportCorrelationId":"e1d00000-0000-4000-8000-000000000003"}'
  ),
  (
    'e1900000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'e1800000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Synthetic clean audit', 'sheet', 'csf/fixture/contextual-clean.xlsx', 'needs_verification',
    'e1000000-0000-4000-8000-000000000001',
    '{"sheetImportPreviewJobId":"e1600000-0000-4000-8000-000000000004","sheetImportCorrelationId":"e1d00000-0000-4000-8000-000000000004"}'
  ),
  -- The batch itself is clean. Only its linked immutable preview blocks, so this is the
  -- fixture that reaches the linked-preview half of the partner gate at all.
  (
    'e1900000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'e1800000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Synthetic linked audit', 'sheet', 'csf/fixture/contextual-linked.xlsx', 'needs_verification',
    'e1000000-0000-4000-8000-000000000001',
    '{"sheetImportPreviewJobId":"e1600000-0000-4000-8000-000000000007","sheetImportCorrelationId":"e1d00000-0000-4000-8000-000000000007"}'
  ),
  -- A settled `matched` row that carries no importable point value: the row the commit
  -- loop used to count as `failed` and drop while reporting success.
  (
    'e1900000-0000-4000-8000-000000000004',
    'e1100000-0000-4000-8000-000000000001',
    'e1800000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Synthetic invalid audit', 'sheet', 'csf/fixture/contextual-invalid.xlsx', 'needs_verification',
    'e1000000-0000-4000-8000-000000000001',
    '{}'
  ),
  -- A historical batch with no linked preview: nothing revalidates its source.
  (
    'e1900000-0000-4000-8000-000000000005',
    'e1100000-0000-4000-8000-000000000001',
    'e1800000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Synthetic historical audit', 'sheet', 'csf/fixture/contextual-historical.xlsx', 'needs_verification',
    'e1000000-0000-4000-8000-000000000001',
    '{}'
  );

-- The blocked meeting preview: one ready row beside one ambiguous sibling.
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status, correlation_id
) VALUES
  (
    'e1700000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Ready Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000001","submittedName":"Ready Attendee"}',
    'contextual-meeting-ready-hash', 'e1300000-0000-4000-8000-000000000001', 'pending',
    'e1d00000-0000-4000-8000-000000000001'
  ),
  (
    'e1700000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 3, '{"Name":"Unresolved Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000001","submittedName":"Unresolved Attendee"}',
    'contextual-meeting-ambiguous-hash', NULL, 'ambiguous',
    'e1d00000-0000-4000-8000-000000000001'
  ),
  (
    'e1700000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000002',
    'e1500000-0000-4000-8000-000000000002',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Clean Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000002","submittedName":"Clean Attendee"}',
    'contextual-meeting-clean-hash', 'e1300000-0000-4000-8000-000000000002', 'pending',
    'e1d00000-0000-4000-8000-000000000002'
  ),
  (
    'e1700000-0000-4000-8000-000000000004',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000003',
    'e1500000-0000-4000-8000-000000000003',
    'e1200000-0000-4000-8000-000000000001',
    'Audit', 2, '{"Name":"Ready Auditee"}',
    '{"partnerAuditBatchId":"e1900000-0000-4000-8000-000000000001","source":{"rowHash":"contextual-partner-ready-hash"}}',
    'contextual-partner-ready-hash', 'e1300000-0000-4000-8000-000000000003', 'pending',
    'e1d00000-0000-4000-8000-000000000003'
  ),
  (
    'e1700000-0000-4000-8000-000000000005',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000003',
    'e1500000-0000-4000-8000-000000000003',
    'e1200000-0000-4000-8000-000000000001',
    'Audit', 3, '{"Name":"Unresolved Auditee"}',
    '{"partnerAuditBatchId":"e1900000-0000-4000-8000-000000000001","source":{"rowHash":"contextual-partner-ambiguous-hash"}}',
    'contextual-partner-ambiguous-hash', NULL, 'ambiguous',
    'e1d00000-0000-4000-8000-000000000003'
  ),
  (
    'e1700000-0000-4000-8000-000000000006',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000004',
    'e1500000-0000-4000-8000-000000000004',
    'e1200000-0000-4000-8000-000000000001',
    'Audit', 2, '{"Name":"Clean Auditee"}',
    '{"partnerAuditBatchId":"e1900000-0000-4000-8000-000000000002","source":{"rowHash":"contextual-partner-clean-hash"}}',
    'contextual-partner-clean-hash', 'e1300000-0000-4000-8000-000000000004', 'pending',
    'e1d00000-0000-4000-8000-000000000004'
  ),
  -- The unreconciled meeting preview: one ready row, one pending row naming no member,
  -- and one pending row naming no semester. Every fixture the commit would need to
  -- succeed exists, so only readiness can be what refuses it.
  (
    'e1700000-0000-4000-8000-000000000007',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000005',
    'e1500000-0000-4000-8000-000000000005',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Unmatched Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000003","submittedName":"Unmatched Attendee"}',
    'contextual-meeting-unmatched-hash', NULL, 'pending',
    'e1d00000-0000-4000-8000-000000000005'
  ),
  (
    'e1700000-0000-4000-8000-000000000008',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000005',
    'e1500000-0000-4000-8000-000000000005',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 3, '{"Name":"Second Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000003","submittedName":"Second Attendee"}',
    'contextual-meeting-second-hash', 'e1300000-0000-4000-8000-000000000005', 'pending',
    'e1d00000-0000-4000-8000-000000000005'
  ),
  (
    'e1700000-0000-4000-8000-00000000000b',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000005',
    'e1500000-0000-4000-8000-000000000005',
    NULL,
    'Responses', 4, '{"Name":"Termless Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000003","submittedName":"Termless Attendee"}',
    'contextual-meeting-termless-hash', 'e1300000-0000-4000-8000-000000000006', 'pending',
    'e1d00000-0000-4000-8000-000000000005'
  ),
  -- The repeated meeting preview: two ready rows naming the same member.
  (
    'e1700000-0000-4000-8000-000000000009',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000006',
    'e1500000-0000-4000-8000-000000000006',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 2, '{"Name":"Clean Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000004","submittedName":"Clean Attendee"}',
    'contextual-meeting-repeat-a-hash', 'e1300000-0000-4000-8000-000000000002', 'pending',
    'e1d00000-0000-4000-8000-000000000006'
  ),
  (
    'e1700000-0000-4000-8000-00000000000a',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000006',
    'e1500000-0000-4000-8000-000000000006',
    'e1200000-0000-4000-8000-000000000001',
    'Responses', 3, '{"Name":"Clean Attendee"}',
    '{"meetingId":"e1400000-0000-4000-8000-000000000004","submittedName":"Clean Attendee"}',
    'contextual-meeting-repeat-b-hash', 'e1300000-0000-4000-8000-000000000002', 'pending',
    'e1d00000-0000-4000-8000-000000000006'
  ),
  -- The linked partner preview: one ready row and one row the preview could not read.
  (
    'e1700000-0000-4000-8000-00000000000c',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000007',
    'e1500000-0000-4000-8000-000000000007',
    'e1200000-0000-4000-8000-000000000001',
    'Audit', 2, '{"Name":"Linked Auditee"}',
    '{"partnerAuditBatchId":"e1900000-0000-4000-8000-000000000003","source":{"rowHash":"contextual-partner-linked-ready-hash"}}',
    'contextual-partner-linked-ready-hash', 'e1300000-0000-4000-8000-000000000007', 'pending',
    'e1d00000-0000-4000-8000-000000000007'
  ),
  (
    'e1700000-0000-4000-8000-00000000000d',
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000007',
    'e1500000-0000-4000-8000-000000000007',
    'e1200000-0000-4000-8000-000000000001',
    'Audit', 3, '{"Name":"Unreadable Auditee"}',
    '{"partnerAuditBatchId":"e1900000-0000-4000-8000-000000000003","source":{"rowHash":"contextual-partner-linked-error-hash"}}',
    'contextual-partner-linked-error-hash', NULL, 'error',
    'e1d00000-0000-4000-8000-000000000007'
  );

INSERT INTO plugin_data.csf_partner_submission_rows (
  id, organization_id, batch_id, profile_id, matched_status, raw_data, normalized_data,
  claimed_points, point_type
) VALUES
  (
    'e1a00000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000003',
    'matched', '{"Name":"Ready Auditee"}',
    '{"source":{"rowHash":"contextual-partner-ready-hash"}}', 2, 'non_drive'
  ),
  (
    'e1a00000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000001',
    NULL, 'ambiguous', '{"Name":"Unresolved Auditee"}',
    '{"source":{"rowHash":"contextual-partner-ambiguous-hash"}}', 1, 'non_drive'
  ),
  (
    'e1a00000-0000-4000-8000-000000000003',
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000004',
    'matched', '{"Name":"Clean Auditee"}',
    '{"source":{"rowHash":"contextual-partner-clean-hash"}}', 3, 'non_drive'
  ),
  (
    'e1a00000-0000-4000-8000-000000000004',
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000003',
    'e1300000-0000-4000-8000-000000000007',
    'matched', '{"Name":"Linked Auditee"}',
    '{"source":{"rowHash":"contextual-partner-linked-ready-hash"}}', 2, 'non_drive'
  ),
  (
    'e1a00000-0000-4000-8000-000000000005',
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000004',
    'e1300000-0000-4000-8000-000000000004',
    'matched', '{"Name":"Invalid Auditee"}',
    '{"source":{"rowHash":"contextual-partner-invalid-hash"}}', 0, 'non_drive'
  ),
  (
    'e1a00000-0000-4000-8000-000000000006',
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000005',
    'e1300000-0000-4000-8000-000000000008',
    'matched', '{"Name":"Historical Auditee"}',
    '{"source":{"rowHash":"contextual-partner-historical-hash"}}', 4, 'non_drive'
  );

-- ---------------------------------------------------------------------------
-- A2. The source-evidence receipts the four succeeding commits will spend.
--
-- Minted directly rather than through `csf_refresh_sheet_source_evidence`, and the two
-- are not the same statement: the issuer additionally asserts the officer is an
-- authorized import actor and validates a live provider answer, neither of which this
-- file is about. What is written below is EXACTLY the row that issuer writes -- the same
-- canonical metadata digest recomputed from the receipt's own coordinates, the same
-- `evidenceRevision`/`evidenceDigest` pair on the source, the same generation -- because
-- `csf_consume_sheet_source_evidence` re-derives every one of them and refuses a receipt
-- that does not describe itself. A hand-waved fixture would be refused here, which is the
-- point: these receipts are valid because they are shaped correctly, not because the test
-- asked nicely.
--
-- One receipt per preview, with a chosen nonce so each commit below names its own.
WITH minted AS (
  SELECT *
  FROM (VALUES
    ('e1600000-0000-4000-8000-000000000001'::uuid, 'e1e00000-0000-4000-8000-000000000001'::uuid),
    ('e1600000-0000-4000-8000-000000000002'::uuid, 'e1e00000-0000-4000-8000-000000000002'::uuid),
    ('e1600000-0000-4000-8000-000000000004'::uuid, 'e1e00000-0000-4000-8000-000000000004'::uuid),
    ('e1600000-0000-4000-8000-000000000007'::uuid, 'e1e00000-0000-4000-8000-000000000007'::uuid)
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
          'version', '7',
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
        'evidenceRevision', '7',
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
  'e1000000-0000-4000-8000-000000000001', coordinate.preview_job_id,
  'google_sheets', coordinate.nonce, 1, coordinate.metadata_digest,
  coordinate.provider_file_id, '7',
  'application/vnd.google-apps.spreadsheet', coordinate.modified_time,
  now(), now() + interval '2 minutes'
FROM coordinate;

-- ---------------------------------------------------------------------------
-- B. The readiness projections themselves.
-- ---------------------------------------------------------------------------
SELECT extensions.is(
  plugin_data.csf_import_preview_row_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000001'
  ),
  ARRAY['Reconcile 1 conflicting row(s) before importing.']::text[],
  'preview readiness names the unresolved sibling in the shared readiness vocabulary'
);
SELECT extensions.is(
  plugin_data.csf_import_preview_row_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000002'
  ),
  ARRAY[]::text[],
  'an all-ready preview reports no readiness blocker'
);
SELECT extensions.is(
  plugin_data.csf_import_preview_row_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000007'
  ),
  ARRAY['Resolve 1 row(s) that could not be read before importing.']::text[],
  'preview readiness names a row the preview could not read into a valid record'
);
SELECT extensions.is(
  plugin_data.csf_meeting_attendance_preview_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000005'
  ),
  ARRAY['Reconcile 2 conflicting row(s) before importing.']::text[],
  'meeting readiness counts the ready rows naming no member and no semester'
);
SELECT extensions.is(
  plugin_data.csf_meeting_attendance_preview_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000006'
  ),
  ARRAY['Only one attendance record per member can be committed for this meeting.']::text[],
  'meeting readiness names two ready rows that would write one member twice'
);
SELECT extensions.is(
  plugin_data.csf_meeting_attendance_preview_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000002'
  ),
  ARRAY[]::text[],
  'an all-ready meeting preview reports no attendance readiness blocker'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000001'
  ),
  ARRAY['Reconcile 1 conflicting row(s) before importing.']::text[],
  'partner-audit batch readiness names the undecided batch row'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000002'
  ),
  ARRAY[]::text[],
  'an all-ready partner-audit batch reports no readiness blocker'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000003'
  ),
  ARRAY[]::text[],
  'the linked-preview fixture batch is itself clean, so only its preview can block it'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000004'
  ),
  ARRAY[
    'Resolve 1 row(s) that could not be read before importing.',
    'Acknowledge this audit batch, recorded before import previews were linked, before importing.'
  ]::text[],
  'a matched row with no importable point value is named before the provenance blocker'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000005'
  ),
  ARRAY[
    'Acknowledge this audit batch, recorded before import previews were linked, before importing.'
  ]::text[],
  'a clean batch with no linked preview still blocks on unproved provenance'
);

-- ---------------------------------------------------------------------------
-- C. One ready row plus one unresolved row writes nothing at all.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1600000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit past an unresolved sibling row.',
      'e1d00000-0000-4000-8000-000000000001', 'e1e00000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Reconcile 1 conflicting row(s) before importing.',
  'a meeting commit refuses while a sibling row is unresolved'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND term_meeting_id = 'e1400000-0000-4000-8000-000000000001'),
  0,
  'the refused meeting commit wrote no attendance record for its ready row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND mode = 'commit'
     AND summary->>'previewJobId' = 'e1600000-0000-4000-8000-000000000001'),
  0,
  'the refused meeting commit created no commit job'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'e1700000-0000-4000-8000-000000000001'),
  'pending',
  'the refused meeting commit left its ready row pending'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND target_id = 'e1400000-0000-4000-8000-000000000001'),
  0,
  'the refused meeting commit wrote no audit event'
);
SELECT extensions.is(
  (SELECT last_sync_status FROM plugin_data.csf_sheet_sources
   WHERE id = 'e1500000-0000-4000-8000-000000000001'),
  NULL,
  'the refused meeting commit left its source health untouched'
);

-- A ready row that names no member, and a ready row that names no semester, are now
-- refusals rather than rows the loop marks `duplicate` and counts as `failed`.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1600000-0000-4000-8000-000000000005',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit rows naming no member and no semester.',
      'e1d00000-0000-4000-8000-000000000005', NULL
    )
  $$,
  'P0001',
  'Reconcile 2 conflicting row(s) before importing.',
  'a meeting commit refuses ready rows with no matched member or no semester'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_meeting_id = 'e1400000-0000-4000-8000-000000000003'),
  0,
  'the refused unreconciled meeting commit wrote no attendance for its one ready row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit'
     AND summary->>'previewJobId' = 'e1600000-0000-4000-8000-000000000005'),
  0,
  'the refused unreconciled meeting commit created no commit job'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1600000-0000-4000-8000-000000000006',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit two ready rows for one member.',
      'e1d00000-0000-4000-8000-000000000006', NULL
    )
  $$,
  'P0001',
  'Only one attendance record per member can be committed for this meeting.',
  'a meeting commit refuses two ready rows targeting the same member'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_meeting_id = 'e1400000-0000-4000-8000-000000000004'),
  0,
  'the refused repeated meeting commit wrote neither of the duplicate rows'
);

-- ---------------------------------------------------------------------------
-- D. The same for the partner-club audit, including the linked-preview-only gate.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000001',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit past an unresolved sibling row.',
      'e1d00000-0000-4000-8000-000000000003', NULL
    )
  $$,
  'P0001',
  'Reconcile 1 conflicting row(s) before importing.',
  'a partner-audit commit refuses while a sibling row is unresolved'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic blocked audit partner club audit'),
  0,
  'the refused partner commit created no point submission for its ready row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE evidence->>'partnerAuditBatchId' = 'e1900000-0000-4000-8000-000000000001'),
  0,
  'the refused partner commit created no credit record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_activity_events
   WHERE source_ref->>'partnerAuditBatchId' = 'e1900000-0000-4000-8000-000000000001'),
  0,
  'the refused partner commit created no member activity event'
);
SELECT extensions.ok(
  (SELECT generated_submission_id IS NULL
   FROM plugin_data.csf_partner_submission_rows
   WHERE id = 'e1a00000-0000-4000-8000-000000000001'),
  'the refused partner commit left its ready batch row uncommitted'
);
SELECT extensions.ok(
  (SELECT NOT (summary ? 'atomicCommitCorrelationId')
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'e1900000-0000-4000-8000-000000000001'),
  'the refused partner commit recorded no commit correlation on the batch'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'e1900000-0000-4000-8000-000000000001'),
  0,
  'the refused partner commit wrote no audit event'
);

-- The batch is clean and only the linked immutable preview blocks. This is the case the
-- previous fixture could never reach, because its batch blocked first.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000003',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit a clean batch past its unreadable preview row.',
      'e1d00000-0000-4000-8000-000000000007', 'e1e00000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'Resolve 1 row(s) that could not be read before importing.',
  'a clean partner batch still refuses while only its linked preview blocks'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic linked audit partner club audit'),
  0,
  'the refused linked-preview commit created no point submission'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit'
     AND summary->>'previewJobId' = 'e1600000-0000-4000-8000-000000000007'),
  0,
  'the refused linked-preview commit created no commit job'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000004',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit a matched row with no importable point value.',
      NULL, NULL
    )
  $$,
  'P0001',
  'Resolve 1 row(s) that could not be read before importing.',
  'a partner-audit commit refuses a matched row carrying no importable point value'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE evidence->>'partnerAuditBatchId' = 'e1900000-0000-4000-8000-000000000004'),
  0,
  'the refused invalid-row commit created no credit record'
);

-- ---------------------------------------------------------------------------
-- E. All-ready commits still succeed, and replay is still idempotent.
-- ---------------------------------------------------------------------------
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1600000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001',
      'Committed the all-ready synthetic attendance preview.',
      'e1d00000-0000-4000-8000-000000000002', 'e1e00000-0000-4000-8000-000000000002'
    )
  $$,
  'an all-ready meeting-attendance preview still commits'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE source_row_id = 'e1700000-0000-4000-8000-000000000003'),
  1,
  'the all-ready meeting commit created its attendance record'
);
SELECT extensions.ok(
  (
    plugin_data.csf_commit_meeting_attendance_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1600000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001',
      'Committed the all-ready synthetic attendance preview.',
      'e1d00000-0000-4000-8000-000000000002', NULL
    )->>'idempotent'
  )::boolean,
  'replaying the all-ready meeting commit is idempotent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND mode = 'commit'
     AND summary->>'previewJobId' = 'e1600000-0000-4000-8000-000000000002'),
  1,
  'replaying the all-ready meeting commit does not duplicate its commit job'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000002',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Committed the all-ready synthetic partner audit.',
      'e1d00000-0000-4000-8000-000000000004', 'e1e00000-0000-4000-8000-000000000004'
    )
  $$,
  'an all-ready partner-club audit still commits'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic clean audit partner club audit'),
  1,
  'the all-ready partner commit created its point submission'
);
SELECT extensions.ok(
  (
    plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000002',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Committed the all-ready synthetic partner audit.',
      'e1d00000-0000-4000-8000-000000000004', NULL
    )->>'idempotent'
  )::boolean,
  'replaying the all-ready partner commit is idempotent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic clean audit partner club audit'),
  1,
  'replaying the all-ready partner commit does not duplicate its point submission'
);

-- ---------------------------------------------------------------------------
-- F. Settling the unreadable preview row unblocks the clean linked batch, and the
--    replay of that commit stays idempotent.
-- ---------------------------------------------------------------------------
SELECT plugin_data.csf_reconcile_sheet_import_row(
  'e1100000-0000-4000-8000-000000000001',
  'e1700000-0000-4000-8000-00000000000d',
  NULL,
  'skip',
  'The synthetic row could not be read into a valid record.',
  'e1000000-0000-4000-8000-000000000001',
  'e1d00000-0000-4000-8000-000000000007'
);
SELECT extensions.is(
  plugin_data.csf_import_preview_row_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1600000-0000-4000-8000-000000000007'
  ),
  ARRAY[]::text[],
  'settling the unreadable row clears the linked preview readiness blocker'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000003',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Committed after the unreadable preview row was skipped.',
      'e1d00000-0000-4000-8000-000000000007', 'e1e00000-0000-4000-8000-000000000007'
    )
  $$,
  'the previously refused linked-preview commit succeeds once its preview is settled'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic linked audit partner club audit'),
  1,
  'the unblocked linked-preview commit created exactly the ready row it had refused'
);
SELECT extensions.ok(
  (
    plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000003',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Committed after the unreadable preview row was skipped.',
      'e1d00000-0000-4000-8000-000000000007', NULL
    )->>'idempotent'
  )::boolean,
  'replaying the unblocked linked-preview commit is idempotent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic linked audit partner club audit'),
  1,
  'replaying the unblocked linked-preview commit does not duplicate its point submission'
);

-- ---------------------------------------------------------------------------
-- G. A preview-less historical batch fails closed, and the acknowledgement is a real,
--    reachable, attributed way out of it rather than a permanent brick.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000005',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to commit an unverifiable historical batch.',
      NULL, NULL
    )
  $$,
  'P0001',
  'Acknowledge this audit batch, recorded before import previews were linked, before importing.',
  'a partner-audit batch with no linked preview fails closed'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic historical audit partner club audit'),
  0,
  'the fail-closed historical batch created no point submission'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'e1900000-0000-4000-8000-000000000005'),
  0,
  'the fail-closed historical batch wrote no audit event'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000005',
      'e1000000-0000-4000-8000-000000000001',
      'Officer vouches for the synthetic historical workbook.',
      'e1d00000-0000-4000-8000-000000000008'
    )
  $$,
  'an authorized officer can acknowledge a preview-less historical batch'
);
SELECT extensions.is(
  (SELECT summary->>'historicalProvenanceAcknowledgedBy'
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'e1900000-0000-4000-8000-000000000005'),
  'e1000000-0000-4000-8000-000000000001',
  'the acknowledgement attributes the batch to the deciding officer'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'e1900000-0000-4000-8000-000000000005'
     AND action = 'partner_audit.historical_provenance_acknowledged'
     AND actor_user_id = 'e1000000-0000-4000-8000-000000000001'
     AND reason_code = 'partner_audit_historical_provenance_acknowledged'),
  1,
  'the acknowledgement writes one immutable audit event naming its officer'
);
SELECT extensions.ok(
  (
    plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000005',
      'e1000000-0000-4000-8000-000000000001',
      'Officer vouches for the synthetic historical workbook.',
      'e1d00000-0000-4000-8000-000000000008'
    )->>'idempotent'
  )::boolean,
  'replaying the acknowledgement is idempotent'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000005'
  ),
  ARRAY[]::text[],
  'the acknowledged historical batch reports no readiness blocker'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000005',
      'approved',
      'e1000000-0000-4000-8000-000000000001',
      'Committed the acknowledged historical batch.',
      NULL, NULL
    )
  $$,
  'the acknowledged historical batch commits through the ordinary path'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic historical audit partner club audit'),
  1,
  'the acknowledged historical batch generated its one credit-bearing submission'
);
SELECT extensions.is(
  (SELECT after_data->>'historicalProvenanceAcknowledgedBy'
   FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'e1900000-0000-4000-8000-000000000005'
     AND action = 'partner_audit.commit'),
  'e1000000-0000-4000-8000-000000000001',
  'the commit audit event carries the acknowledgement forward'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000003',
      'e1000000-0000-4000-8000-000000000001',
      'Attempted to acknowledge a batch whose source is proved at commit.',
      NULL
    )
  $$,
  'P0001',
  'This audit batch is linked to an import preview, so its source is proved at commit rather than acknowledged.',
  'a preview-linked batch cannot be acknowledged instead of proved'
);

-- ---------------------------------------------------------------------------
-- H. Resolving the sibling unblocks the previously refused meeting commit.
-- ---------------------------------------------------------------------------
SELECT plugin_data.csf_reconcile_sheet_import_row(
  'e1100000-0000-4000-8000-000000000001',
  'e1700000-0000-4000-8000-000000000002',
  NULL,
  'skip',
  'The synthetic row names no member record.',
  'e1000000-0000-4000-8000-000000000001',
  'e1d00000-0000-4000-8000-000000000001'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e1100000-0000-4000-8000-000000000001',
      'e1600000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'Committed after the sibling row was skipped.',
      'e1d00000-0000-4000-8000-000000000001', 'e1e00000-0000-4000-8000-000000000001'
    )
  $$,
  'the previously refused meeting commit succeeds once its sibling is resolved'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE source_row_id = 'e1700000-0000-4000-8000-000000000001'),
  1,
  'the unblocked meeting commit created exactly the ready row it had refused'
);

SELECT * FROM extensions.finish();
ROLLBACK;
