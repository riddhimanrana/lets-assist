-- A contextual CSF commit spends a real source-evidence receipt, or it does not write.
--
-- The readiness contract -- which sibling rows stop a commit -- is proved in
-- csf_contextual_commit_readiness.test.sql, and the lock order in
-- csf_contextual_commit_lock_order.test.sql. This file proves the third thing the two
-- commits now do: `p_evidence_token` is consumed inside the commit transaction, exactly
-- once, and every way of failing to produce one is a refusal that writes nothing.
--
-- The receipts below are minted directly rather than through
-- `csf_refresh_sheet_source_evidence`, because that issuer additionally asserts an
-- authorized import actor and validates a live provider answer, neither of which is what
-- this file is about. What is written IS what that issuer writes: the same canonical
-- metadata digest recomputed from the receipt's own coordinates, the same
-- `evidenceRevision`/`evidenceDigest` pair on the source, the same generation.
-- `csf_consume_sheet_source_evidence` re-derives all three and refuses a receipt that
-- does not describe itself, so these receipts work because they are correctly shaped --
-- not because the fixture asserted they should.
--
-- Every identity is synthetic and lives only inside this rolled-back transaction.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- An exact plan. no_plan() cannot distinguish "every assertion passed" from "some never
-- ran", and a fence that silently stops running is the failure this file exists to catch.
SELECT extensions.plan(30);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'contextual-evidence-officer@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'e3100000-0000-4000-8000-000000000001',
  'CSF Contextual Commit Evidence',
  'csf-contextual-commit-evidence',
  'school',
  '995121'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'e3100000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'e3200000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'F33', 'Fall 2033', '2033-2034', 'fall'
);

-- The third profile is `merged`, which is what makes the rollback fixture reach a raise
-- INSIDE the write loop -- after the receipt has been consumed. Readiness cannot see it:
-- the row names a member and a semester, so nothing about it is unreconciled.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name,
  record_status, merged_into_profile_id, merged_at, merged_by, merge_reason
) VALUES
  ('e3300000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'Proved', 'Attendee', 'proved', 'attendee', 'active', NULL, NULL, NULL, NULL),
  ('e3300000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'Proved', 'Auditee', 'proved', 'auditee', 'active', NULL, NULL, NULL, NULL),
  -- `csf_profiles_merge_state_check` makes a merged record without its merge attribution
  -- unrepresentable, so the whole four-column state is written rather than the status alone.
  ('e3300000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000001',
   'Merged', 'Attendee', 'merged', 'attendee', 'merged',
   'e3300000-0000-4000-8000-000000000001', now(),
   'e3000000-0000-4000-8000-000000000001', 'Merged before the evidence fixture ran.');

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date
) VALUES
  ('e3400000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'proved-meeting', 'Proved meeting', '2033-09-01'),
  ('e3400000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'rolled-back-meeting', 'Rolled back meeting', '2033-10-01');

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES
  ('e3b00000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'proved-meeting', 'Proved meeting'),
  ('e3b00000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'rolled-back-meeting', 'Rolled back meeting');

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date
) VALUES
  ('e3c00000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3b00000-0000-4000-8000-000000000001', 'e3400000-0000-4000-8000-000000000001', '2033-09-01'),
  ('e3c00000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3b00000-0000-4000-8000-000000000002', 'e3400000-0000-4000-8000-000000000002', '2033-10-01');

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, approved_point_types
) VALUES (
  'e3800000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'Synthetic Evidence Club',
  ARRAY['non_drive']::text[]
);

-- Three Google-backed sources, because only that family can carry a database receipt at
-- all. Each records the exact drive coordinates the receipts below attest to.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id, uploaded_file_path,
  drive_file_id, drive_mime_type, drive_modified_at, sync_status, settings
) VALUES
  ('e3500000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'meeting_attendance', 'Proved meeting source',
   'google_sheets', 'evidence-proved-meeting', NULL,
   'evidence-proved-meeting', 'application/vnd.google-apps.spreadsheet',
   '2033-08-01T00:00:00Z', 'not_synced',
   '{"sourceKind":"meeting_attendance","meetingId":"e3400000-0000-4000-8000-000000000001"}'),
  ('e3500000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'meeting_attendance', 'Rolled back meeting source',
   'google_sheets', 'evidence-rolled-back-meeting', NULL,
   'evidence-rolled-back-meeting', 'application/vnd.google-apps.spreadsheet',
   '2033-08-02T00:00:00Z', 'not_synced',
   '{"sourceKind":"meeting_attendance","meetingId":"e3400000-0000-4000-8000-000000000002"}'),
  ('e3500000-0000-4000-8000-000000000004', 'e3100000-0000-4000-8000-000000000001',
   'partner_club_audit', 'Proved partner source',
   'google_sheets', 'evidence-proved-partner', NULL,
   'evidence-proved-partner', 'application/vnd.google-apps.spreadsheet',
   '2033-08-04T00:00:00Z', 'not_synced',
   '{"sourceKind":"partner_club_audit"}');

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  mapping_snapshot, mapping_version, correlation_id, summary, completed_at
) VALUES
  ('e3600000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3500000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'meeting_attendance',
   'evidence-proved-meeting', 'Proved Meeting', 'Responses', 'Responses!A1:C10',
   '{"version":1,"sourceType":"meeting_attendance"}', 1,
   'e3d00000-0000-4000-8000-000000000001', '{}', now()),
  ('e3600000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3500000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'meeting_attendance',
   'evidence-rolled-back-meeting', 'Rolled Back Meeting', 'Responses', 'Responses!A1:C10',
   '{"version":1,"sourceType":"meeting_attendance"}', 1,
   'e3d00000-0000-4000-8000-000000000002', '{}', now()),
  -- A SECOND reviewed preview of the SAME source. This is what makes the preview binding
  -- testable at all: a receipt issued against this one must not spend on the first.
  ('e3600000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000001',
   'e3500000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'meeting_attendance',
   'evidence-proved-meeting', 'Proved Meeting Again', 'Responses', 'Responses!A1:C10',
   '{"version":1,"sourceType":"meeting_attendance"}', 1,
   'e3d00000-0000-4000-8000-000000000003', '{}', now()),
  ('e3600000-0000-4000-8000-000000000004', 'e3100000-0000-4000-8000-000000000001',
   'e3500000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'partner_club_audit',
   'evidence-proved-partner', 'Proved Partner', 'Audit', 'Audit!A1:E12',
   '{"version":1,"sourceType":"partner_club_audit"}', 1,
   'e3d00000-0000-4000-8000-000000000004', '{}', now());

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status, correlation_id
) VALUES
  ('e3700000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3600000-0000-4000-8000-000000000001', 'e3500000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'Responses', 2, '{"Name":"Proved Attendee"}',
   '{"meetingId":"e3400000-0000-4000-8000-000000000001","submittedName":"Proved Attendee"}',
   'evidence-proved-meeting-hash', 'e3300000-0000-4000-8000-000000000001', 'pending',
   'e3d00000-0000-4000-8000-000000000001'),
  -- Names a member and a semester, so readiness passes it. The member is `merged`, which
  -- only the write loop notices -- after the receipt has been spent.
  ('e3700000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3600000-0000-4000-8000-000000000002', 'e3500000-0000-4000-8000-000000000002',
   'e3200000-0000-4000-8000-000000000001', 'Responses', 2, '{"Name":"Merged Attendee"}',
   '{"meetingId":"e3400000-0000-4000-8000-000000000002","submittedName":"Merged Attendee"}',
   'evidence-rolled-back-meeting-hash', 'e3300000-0000-4000-8000-000000000003', 'pending',
   'e3d00000-0000-4000-8000-000000000002'),
  ('e3700000-0000-4000-8000-000000000004', 'e3100000-0000-4000-8000-000000000001',
   'e3600000-0000-4000-8000-000000000004', 'e3500000-0000-4000-8000-000000000004',
   'e3200000-0000-4000-8000-000000000001', 'Audit', 2, '{"Name":"Proved Auditee"}',
   '{"partnerAuditBatchId":"e3900000-0000-4000-8000-000000000001","source":{"rowHash":"evidence-proved-partner-hash"}}',
   'evidence-proved-partner-hash', 'e3300000-0000-4000-8000-000000000002', 'pending',
   'e3d00000-0000-4000-8000-000000000004');

INSERT INTO plugin_data.csf_partner_submission_batches (
  id, organization_id, partner_club_id, term_id, title, source, source_url, status, submitted_by, summary
) VALUES
  ('e3900000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3800000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001',
   'Synthetic proved audit', 'sheet', 'evidence-proved-partner', 'needs_verification',
   'e3000000-0000-4000-8000-000000000001',
   '{"sheetImportPreviewJobId":"e3600000-0000-4000-8000-000000000004","sheetImportCorrelationId":"e3d00000-0000-4000-8000-000000000004"}'),
  -- No linked preview: the historical shape, whose way in is the acknowledgement rather
  -- than a receipt, because no receipt can be issued against a preview that does not exist.
  ('e3900000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3800000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001',
   'Synthetic historical audit', 'sheet', 'csf/fixture/evidence-historical.xlsx', 'needs_verification',
   'e3000000-0000-4000-8000-000000000001',
   '{}');

INSERT INTO plugin_data.csf_partner_submission_rows (
  id, organization_id, batch_id, profile_id, matched_status, raw_data, normalized_data,
  claimed_points, point_type
) VALUES
  ('e3a00000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3900000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000002',
   'matched', '{"Name":"Proved Auditee"}',
   '{"source":{"rowHash":"evidence-proved-partner-hash"}}', 2, 'non_drive'),
  ('e3a00000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3900000-0000-4000-8000-000000000002', 'e3300000-0000-4000-8000-000000000002',
   'matched', '{"Name":"Historical Auditee"}',
   '{"source":{"rowHash":"evidence-historical-hash"}}', 4, 'non_drive');

-- ---------------------------------------------------------------------------
-- The receipts. Six, over three sources, each shaped exactly as its issuer writes it.
--
--   ...0001  valid, bound to the proved meeting preview
--   ...0002  identical but EXPIRED
--   ...0003  identical but issued for a DIFFERENT officer
--   ...0004  identical but issued for the SECOND preview of the same source
--   ...0005  valid, bound to the rolled-back meeting preview
--   ...0006  valid, bound to the partner preview
--
-- The wrong-officer id is a bare uuid on purpose: `actor_user_id` on this table carries no
-- foreign key, and inventing a second auth user would imply this test says something about
-- authorization rather than about receipt binding.
-- ---------------------------------------------------------------------------
WITH minted AS (
  SELECT *
  FROM (VALUES
    ('e3e00000-0000-4000-8000-000000000001'::uuid, 'e3500000-0000-4000-8000-000000000001'::uuid,
     'e3600000-0000-4000-8000-000000000001'::uuid, 'e3000000-0000-4000-8000-000000000001'::uuid,
     interval '2 minutes'),
    ('e3e00000-0000-4000-8000-000000000002'::uuid, 'e3500000-0000-4000-8000-000000000001'::uuid,
     'e3600000-0000-4000-8000-000000000001'::uuid, 'e3000000-0000-4000-8000-000000000001'::uuid,
     interval '-1 minute'),
    ('e3e00000-0000-4000-8000-000000000003'::uuid, 'e3500000-0000-4000-8000-000000000001'::uuid,
     'e3600000-0000-4000-8000-000000000001'::uuid, 'e3000000-0000-4000-8000-0000000000ff'::uuid,
     interval '2 minutes'),
    ('e3e00000-0000-4000-8000-000000000004'::uuid, 'e3500000-0000-4000-8000-000000000001'::uuid,
     'e3600000-0000-4000-8000-000000000003'::uuid, 'e3000000-0000-4000-8000-000000000001'::uuid,
     interval '2 minutes'),
    ('e3e00000-0000-4000-8000-000000000005'::uuid, 'e3500000-0000-4000-8000-000000000002'::uuid,
     'e3600000-0000-4000-8000-000000000002'::uuid, 'e3000000-0000-4000-8000-000000000001'::uuid,
     interval '2 minutes'),
    ('e3e00000-0000-4000-8000-000000000006'::uuid, 'e3500000-0000-4000-8000-000000000004'::uuid,
     'e3600000-0000-4000-8000-000000000004'::uuid, 'e3000000-0000-4000-8000-000000000001'::uuid,
     interval '2 minutes')
  ) AS receipt(nonce, source_id, preview_job_id, actor_user_id, lifetime)
),
digest AS (
  SELECT
    source.id AS source_id,
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
          'version', '13',
          'trashed', false
        )),
        'UTF8'
      )),
      'hex'
    ) AS metadata_digest
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = 'e3100000-0000-4000-8000-000000000001'
),
refreshed AS (
  UPDATE plugin_data.csf_sheet_sources AS source
  SET evidence_generation = 1,
      evidence_refreshed_at = now(),
      settings = source.settings || jsonb_build_object(
        'evidenceRevision', '13',
        'evidenceDigest', digest.metadata_digest
      )
  FROM digest
  WHERE source.id = digest.source_id
  RETURNING source.id
)
INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
  organization_id, source_id, actor_user_id, preview_job_id, provider, nonce,
  evidence_generation, metadata_digest, provider_file_id, provider_version,
  mime_type, modified_time, access_checked_at, expires_at
)
SELECT
  'e3100000-0000-4000-8000-000000000001', minted.source_id, minted.actor_user_id,
  minted.preview_job_id, 'google_sheets', minted.nonce, 1, digest.metadata_digest,
  digest.provider_file_id, '13',
  'application/vnd.google-apps.spreadsheet', digest.modified_time,
  now(), now() + minted.lifetime
FROM minted
JOIN digest ON digest.source_id = minted.source_id;

-- ---------------------------------------------------------------------------
-- A. No receipt is a refusal, not a value.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit with no source freshness check.',
      'e3d00000-0000-4000-8000-000000000001',
      NULL
    )
  $$,
  '55000',
  'This CSF import must re-verify its source immediately before committing.',
  'a meeting commit with no receipt refuses'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_meeting_id = 'e3400000-0000-4000-8000-000000000001'),
  0,
  'and wrote no attendance record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit'
     AND summary->>'previewJobId' = 'e3600000-0000-4000-8000-000000000001'),
  0,
  'and created no commit job'
);

-- ---------------------------------------------------------------------------
-- B. A receipt that belongs to somebody else, or to another preview, or to another
--    moment. Each refuses, and none of them is spent by refusing.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit with another officer''s receipt.',
      'e3d00000-0000-4000-8000-000000000001',
      'e3e00000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'This CSF source freshness check was issued for a different officer, source, or organization.',
  'a meeting commit refuses a receipt issued for a different officer'
);
SELECT extensions.is(
  (SELECT consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE nonce = 'e3e00000-0000-4000-8000-000000000003'),
  NULL,
  'and refusing it does not spend it'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit one preview with the other preview''s receipt.',
      'e3d00000-0000-4000-8000-000000000001',
      'e3e00000-0000-4000-8000-000000000004'
    )
  $$,
  '42501',
  'This CSF source freshness check was issued for a different preview; check this preview and import again.',
  'a meeting commit refuses a receipt issued against another preview of the same source'
);
SELECT extensions.is(
  (SELECT consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE nonce = 'e3e00000-0000-4000-8000-000000000004'),
  NULL,
  'and refusing that one does not spend it either'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit with an expired receipt.',
      'e3d00000-0000-4000-8000-000000000001',
      'e3e00000-0000-4000-8000-000000000002'
    )
  $$,
  '55000',
  'This CSF source freshness check has expired; re-read the source and import again.',
  'a meeting commit refuses an expired receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_meeting_id = 'e3400000-0000-4000-8000-000000000001'),
  0,
  'and none of the three refusals wrote an attendance record'
);

-- ---------------------------------------------------------------------------
-- C. The valid receipt commits, and is spent exactly once.
-- ---------------------------------------------------------------------------
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'Committed the proved synthetic attendance preview.',
      'e3d00000-0000-4000-8000-000000000001',
      'e3e00000-0000-4000-8000-000000000001'
    )
  $$,
  'a meeting commit holding a valid receipt commits'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE source_row_id = 'e3700000-0000-4000-8000-000000000001'),
  1,
  'and wrote exactly its one ready row'
);
SELECT extensions.ok(
  (SELECT consumed_at IS NOT NULL
   FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE nonce = 'e3e00000-0000-4000-8000-000000000001'),
  'and the receipt is spent'
);
SELECT extensions.is(
  (SELECT consumed_by_job_id FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE nonce = 'e3e00000-0000-4000-8000-000000000001'),
  'e3600000-0000-4000-8000-000000000001'::uuid,
  'and recorded against exactly the preview it was issued for'
);

-- Single use, durably. Asserted against the consume itself rather than against a second
-- commit, because there is no second commit that could reach it: replaying the receipt on
-- its OWN preview short-circuits on the idempotent return before the consume runs, and
-- offering it to any other preview is refused by the preview binding above. This is the
-- same call the commit makes, with the same arguments it would pass.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_consume_sheet_source_evidence(
      'e3100000-0000-4000-8000-000000000001',
      'e3500000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e3e00000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001'
    )
  $$,
  '55000',
  'This CSF source freshness check has already been used.',
  'and a spent receipt cannot be spent a second time'
);

-- ---------------------------------------------------------------------------
-- D. An idempotent replay needs no fresh receipt, because it writes nothing new.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (
    plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'Replayed the proved synthetic attendance preview.',
      'e3d00000-0000-4000-8000-000000000001',
      NULL
    )->>'idempotent'
  )::boolean,
  'replaying an already-committed meeting snapshot with a NULL receipt is idempotent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit'
     AND summary->>'previewJobId' = 'e3600000-0000-4000-8000-000000000001'),
  1,
  'and the replay did not duplicate the commit job'
);

-- ---------------------------------------------------------------------------
-- E. A raise AFTER the consume rolls the consume back with it.
--
-- This is the property that makes "spend the receipt inside the commit transaction" mean
-- something. The row below passes readiness -- it names a member and a semester -- and is
-- refused by the write loop, which is downstream of the consume. If the spend survived
-- that rollback, an officer would have to obtain a fresh receipt to retry a commit that
-- never happened.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_meeting_attendance_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3600000-0000-4000-8000-000000000002',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit a row naming a merged member.',
      'e3d00000-0000-4000-8000-000000000002',
      'e3e00000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  NULL,
  'a commit that raises inside the write loop is refused'
);
SELECT extensions.is(
  (SELECT consumed_at FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE nonce = 'e3e00000-0000-4000-8000-000000000005'),
  NULL,
  'and its receipt is preserved, because the consume rolled back with the write'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_meeting_id = 'e3400000-0000-4000-8000-000000000002'),
  0,
  'and no attendance record survived the rollback'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_sheet_import_jobs
   WHERE mode = 'commit'
     AND summary->>'previewJobId' = 'e3600000-0000-4000-8000-000000000002'),
  0,
  'and no commit job survived it either'
);

-- ---------------------------------------------------------------------------
-- F. The partner path: a linked preview is held to the same receipt.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3900000-0000-4000-8000-000000000001',
      'approved',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit a linked partner batch with no receipt.',
      'e3d00000-0000-4000-8000-000000000004',
      NULL
    )
  $$,
  '55000',
  'This CSF import must re-verify its source immediately before committing.',
  'a partner-audit commit with a linked preview and no receipt refuses'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE evidence->>'partnerAuditBatchId' = 'e3900000-0000-4000-8000-000000000001'),
  0,
  'and created no credit record'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3900000-0000-4000-8000-000000000001',
      'approved',
      'e3000000-0000-4000-8000-000000000001',
      'Committed the proved synthetic partner audit.',
      'e3d00000-0000-4000-8000-000000000004',
      'e3e00000-0000-4000-8000-000000000006'
    )
  $$,
  'and the same batch commits once it holds a valid receipt'
);
SELECT extensions.ok(
  (SELECT consumed_at IS NOT NULL
   FROM plugin_data.csf_sheet_source_evidence_tokens
   WHERE nonce = 'e3e00000-0000-4000-8000-000000000006'),
  'spending it exactly once'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic proved audit partner club audit'),
  1,
  'and generating exactly its one matched row'
);
SELECT extensions.ok(
  (
    plugin_data.csf_commit_partner_audit_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3900000-0000-4000-8000-000000000001',
      'approved',
      'e3000000-0000-4000-8000-000000000001',
      'Replayed the proved synthetic partner audit.',
      'e3d00000-0000-4000-8000-000000000004',
      NULL
    )->>'idempotent'
  )::boolean,
  'replaying an already-committed partner batch with a NULL receipt is idempotent'
);

-- ---------------------------------------------------------------------------
-- G. The preview-less batch: a receipt is a contradiction, and the acknowledgement is
--    still the way in. This is the branch that must NOT be re-bricked -- no receipt can
--    be issued against a preview that does not exist, so demanding one would make these
--    batches permanently unimportable.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3900000-0000-4000-8000-000000000002',
      'approved',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit an unacknowledged preview-less batch.',
      NULL,
      NULL
    )
  $$,
  'P0001',
  'Acknowledge this audit batch, recorded before import previews were linked, before importing.',
  'an unacknowledged preview-less batch still fails closed on provenance'
);
SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
  'e3100000-0000-4000-8000-000000000001',
  'e3900000-0000-4000-8000-000000000002',
  'e3000000-0000-4000-8000-000000000001',
  'Officer vouches for the synthetic historical workbook.',
  'e3d00000-0000-4000-8000-000000000005'
);
-- Acknowledged, so readiness no longer refuses it -- and now the receipt branch is what
-- this batch reaches. A supplied receipt is a contradiction here: there is no preview it
-- could have been issued against, and this one demonstrably belongs to another source's
-- preview entirely.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3900000-0000-4000-8000-000000000002',
      'approved',
      'e3000000-0000-4000-8000-000000000001',
      'Attempted to commit a preview-less batch with a receipt.',
      NULL,
      'e3e00000-0000-4000-8000-000000000004'
    )
  $$,
  '55000',
  'This audit batch has no linked import preview, so no source freshness check could have been issued for it.',
  'and it refuses a supplied receipt rather than ignoring it'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'e3100000-0000-4000-8000-000000000001',
      'e3900000-0000-4000-8000-000000000002',
      'approved',
      'e3000000-0000-4000-8000-000000000001',
      'Committed the acknowledged historical batch.',
      NULL,
      NULL
    )
  $$,
  'while the acknowledged batch still commits with no receipt at all'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic historical audit partner club audit'),
  1,
  'and generated its one credit-bearing submission'
);

SELECT * FROM extensions.finish();
ROLLBACK;
