BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

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

-- Synthetic active profiles satisfy the commit identity checks.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name,
  record_status, merged_into_profile_id, merged_at, merged_by, merge_reason
) VALUES
  ('e3300000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'Proved', 'Attendee', 'proved', 'attendee', 'active', NULL, NULL, NULL, NULL),
  ('e3300000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000001',
   'Rollback', 'Attendee', 'rollback', 'attendee', 'active',
   NULL, NULL, NULL, NULL);

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

-- Google Sheets fixture sources retain the coordinates attested by their receipts.
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
   '{"sourceKind":"meeting_attendance","meetingId":"e3400000-0000-4000-8000-000000000002"}');

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
  ('e3600000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000001',
   'e3500000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'preview', 'completed', 'meeting_attendance',
   'evidence-proved-meeting', 'Proved Meeting Again', 'Responses', 'Responses!A1:C10',
   '{"version":1,"sourceType":"meeting_attendance"}', 1,
   'e3d00000-0000-4000-8000-000000000003', '{}', now());

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, term_id, sheet_tab_name, row_number,
  raw_data, normalized_data, row_hash, matched_profile_id, import_status, correlation_id
) VALUES
  ('e3700000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001',
   'e3600000-0000-4000-8000-000000000001', 'e3500000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'Responses', 2, '{"Name":"Proved Attendee"}',
   '{"meetingId":"e3400000-0000-4000-8000-000000000001","submittedName":"Proved Attendee","sourceSubmittedAt":"2033-09-01T20:20:00Z"}',
   'evidence-proved-meeting-hash', 'e3300000-0000-4000-8000-000000000001', 'pending',
   'e3d00000-0000-4000-8000-000000000001'),
  ('e3700000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001',
   'e3600000-0000-4000-8000-000000000002', 'e3500000-0000-4000-8000-000000000002',
   'e3200000-0000-4000-8000-000000000001', 'Responses', 2, '{"Name":"Merged Attendee"}',
   '{"meetingId":"e3400000-0000-4000-8000-000000000002","submittedName":"Merged Attendee"}',
   'evidence-rolled-back-meeting-hash', 'e3300000-0000-4000-8000-000000000003', 'pending',
   'e3d00000-0000-4000-8000-000000000002');

-- The benchmark consumes receipt ...0001 for the first preview.
-- Receipt binding and expiry behavior have separate contextual-evidence coverage.
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


-- Existing rows must not execute BEFORE INSERT guards or overwrite officer records.
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
SELECT ('e3300000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'e3100000-0000-4000-8000-000000000001','Synthetic','Attendee '||n,'synthetic','attendee '||n FROM generate_series(1,133) n;
INSERT INTO plugin_data.csf_sheet_import_rows(organization_id,job_id,source_id,term_id,sheet_tab_name,row_number,raw_data,normalized_data,row_hash,matched_profile_id,import_status,correlation_id)
SELECT 'e3100000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000001','e3500000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','Responses',n+2,'{}',jsonb_build_object('meetingId','e3400000-0000-4000-8000-000000000001','sourceSubmittedAt','2033-09-01T20:20:00Z'),'noop-'||n,('e3300000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'pending','e3d00000-0000-4000-8000-000000000001' FROM generate_series(1,133) n;
INSERT INTO plugin_data.csf_meeting_attendance(organization_id,profile_id,term_id,term_meeting_id,meeting_id,meeting_session_id,meeting_key,meeting_label,status,source)
SELECT 'e3100000-0000-4000-8000-000000000001',('e3300000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001','e3400000-0000-4000-8000-000000000001','e3b00000-0000-4000-8000-000000000001','e3c00000-0000-4000-8000-000000000001','proved-meeting','Proved meeting','attended','manual' FROM generate_series(1,132) n;
UPDATE plugin_data.csf_term_meetings SET settings='{"attendanceWindow":{"timeZone":"America/Los_Angeles","opensAt":"2033-09-01T20:00:00Z","closesAt":"2033-09-01T20:45:00Z"}}' WHERE id='e3400000-0000-4000-8000-000000000001';
CREATE TEMP TABLE insert_attempts(id uuid);
CREATE FUNCTION pg_temp.count_attendance_attempts() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO insert_attempts VALUES(NEW.profile_id); RETURN NEW; END $$;
CREATE TRIGGER aaa_count_attendance_attempts BEFORE INSERT ON plugin_data.csf_meeting_attendance FOR EACH ROW EXECUTE FUNCTION pg_temp.count_attendance_attempts();
CREATE TEMP TABLE benchmark(started timestamptz,result jsonb,elapsed interval);
INSERT INTO benchmark(started) VALUES(clock_timestamp());
UPDATE benchmark SET result=plugin_data.csf_commit_meeting_attendance_import('e3100000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Synthetic existing attendance benchmark','e3d00000-0000-4000-8000-000000000001','e3e00000-0000-4000-8000-000000000001',true);
UPDATE benchmark SET elapsed=clock_timestamp()-started;
SELECT extensions.is((SELECT (result->>'created')::integer FROM benchmark),2,'creates only two new records');
SELECT extensions.is((SELECT (result->>'unchanged')::integer FROM benchmark),132,'reports all existing attendance unchanged');
SELECT extensions.is((SELECT count(*)::integer FROM insert_attempts),2,'only new records run attendance insert guards');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance WHERE organization_id='e3100000-0000-4000-8000-000000000001' AND source='manual'),132,'existing manual corrections remain untouched');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows WHERE job_id='e3600000-0000-4000-8000-000000000001' AND import_status='duplicate'),132,'unchanged import rows retain duplicate accounting');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)','EXECUTE'),'internal implementation remains owner-only');
SELECT extensions.ok((SELECT elapsed<interval '8 seconds' FROM benchmark),'134-row synthetic commit stays below the observed timeout');
SELECT extensions.diag('134-row commit elapsed: '||(SELECT elapsed::text FROM benchmark));
SELECT extensions.ok(position('ON CONFLICT (profile_id, term_id, meeting_key) DO NOTHING' in pg_get_functiondef('plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)'::regprocedure))>0,'concurrent insert conflict protection remains installed');
SELECT extensions.throws_ok($q$
INSERT INTO plugin_data.csf_meeting_attendance(organization_id,profile_id,term_id,term_meeting_id,meeting_id,meeting_session_id,meeting_key,meeting_label,status,source,source_submitted_at)
VALUES('e3100000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000003','e3200000-0000-4000-8000-000000000001','e3400000-0000-4000-8000-000000000001','e3b00000-0000-4000-8000-000000000001','e3c00000-0000-4000-8000-000000000001','proved-meeting','Proved meeting','attended','sheet','2033-09-01T20:45:01Z')
$q$,'23514','This response falls outside the meeting attendance window.','new attendance still rejects late source responses');
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='plugin_data.csf_meeting_attendance'::regclass AND i.indisunique AND pg_get_indexdef(i.indexrelid) LIKE '%(profile_id, term_id, meeting_key)%'),'unique index remains the concurrent write arbiter');
SELECT * FROM extensions.finish();
ROLLBACK;
