BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(26);
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_upsert_term_meeting_with_attendance_window(uuid,uuid,uuid,text,date[],timestamptz,text,text,boolean,integer,text,uuid,uuid,jsonb)','EXECUTE'),'client cannot bypass staff permission checks');
SELECT extensions.lives_ok($$SELECT plugin_data.csf_validate_attendance_window('{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:45:00Z"}')$$,'valid inclusive window');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_validate_attendance_window('{"timeZone":"invalid"}')$$,'P0001','Choose a valid attendance source time zone.','invalid time zone rejected');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_validate_attendance_window('{"timeZone":"UTC","opensAt":"2026-09-16T20:00:00"}')$$,'P0001','Attendance window timestamps require explicit offsets.','naive stored cutoff rejected');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_validate_attendance_window('{"timeZone":"UTC","opensAt":"2026-09-16T21:00:00Z","closesAt":"2026-09-16T20:00:00Z"}')$$,'P0001','Attendance must close after it opens.','reversed window rejected');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('ed000000-0000-4000-8000-000000000001','authenticated','authenticated','window-officer@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES ('ed100000-0000-4000-8000-000000000001','Window Chapter','window-chapter','school','997351');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES ('ed100000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,is_current) VALUES ('ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','F26','Fall 2026','2026-2027','fall',true);
CREATE TEMP TABLE window_result AS SELECT plugin_data.csf_upsert_term_meeting_with_attendance_window('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',NULL,'September meeting',ARRAY['2026-09-16'::date],NULL,'Gym',NULL,true,1,'active','ed900000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:45:00Z"}') payload;
SELECT extensions.is((SELECT settings->'attendanceWindow'->>'timeZone' FROM plugin_data.csf_term_meetings WHERE id=(SELECT (payload->>'meetingId')::uuid FROM window_result)),'America/Los_Angeles','atomic meeting save retains time zone');
SELECT extensions.is((plugin_data.csf_upsert_term_meeting_with_attendance_window('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',NULL,'September meeting',ARRAY['2026-09-16'::date],NULL,'Gym',NULL,true,1,'active','ed900000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:45:00Z"}')->>'idempotent')::boolean,true,'same request replays');
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='plugin_data.csf_meeting_attendance'::regclass AND tgname='csf_attendance_response_window_guard'),'guard installed on attendance writes');
CREATE TEMP TABLE window_probe (organization_id uuid,term_meeting_id uuid,source text,status text,source_submitted_at timestamptz);
CREATE TRIGGER window_probe_guard BEFORE INSERT ON window_probe FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_attendance_response_window();
CREATE FUNCTION pg_temp.probe_window(p_time timestamptz,p_source text DEFAULT 'sheet') RETURNS void LANGUAGE sql AS $$ INSERT INTO window_probe SELECT 'ed100000-0000-4000-8000-000000000001',(payload->>'meetingId')::uuid,p_source,'attended',p_time FROM window_result $$;
SELECT extensions.lives_ok($$SELECT pg_temp.probe_window('2026-09-16T20:00:00Z')$$,'opening boundary included');
SELECT extensions.lives_ok($$SELECT pg_temp.probe_window('2026-09-16T20:45:00Z')$$,'closing boundary included');
SELECT extensions.throws_ok($$SELECT pg_temp.probe_window('2026-09-16T19:59:59Z')$$,'23514','This response falls outside the meeting attendance window.','early response blocked');
SELECT extensions.throws_ok($$SELECT pg_temp.probe_window('2026-09-16T20:45:01Z')$$,'23514','This response falls outside the meeting attendance window.','late response blocked');
SELECT extensions.throws_ok($$SELECT pg_temp.probe_window(NULL)$$,'23514','This response falls outside the meeting attendance window.','missing timestamp blocked');
SELECT extensions.lives_ok($$SELECT pg_temp.probe_window(NULL,'manual')$$,'audited manual corrections remain available');
SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE correlation_id='ed900000-0000-4000-8000-000000000001' AND after_data->'request'->'attendanceWindow'->>'timeZone'='America/Los_Angeles'),'window included in immutable request receipt');

INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES ('ed300000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','Test','Student','test','student');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,title,source_type) VALUES ('ed400000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','Attendance source','meeting_attendance');
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,source_id) VALUES ('ed500000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed400000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,source_id,job_id,sheet_tab_name,row_number,matched_profile_id) VALUES ('ed600000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed400000-0000-4000-8000-000000000001','ed500000-0000-4000-8000-000000000001','Responses',2,'ed300000-0000-4000-8000-000000000001');
-- Model a pre-window record without weakening the installed trigger.
UPDATE plugin_data.csf_term_meetings SET settings='{}' WHERE id=(SELECT (payload->>'meetingId')::uuid FROM window_result);
INSERT INTO plugin_data.csf_meeting_attendance(id,organization_id,profile_id,term_id,term_meeting_id,meeting_id,meeting_session_id,meeting_key,meeting_label,status,source,source_row_id,source_submitted_at)
SELECT 'ed700000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed300000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',(payload->>'meetingId')::uuid,(payload->>'logicalMeetingId')::uuid,(payload->>'sessionId')::uuid,'september-meeting','September meeting','attended','sheet','ed600000-0000-4000-8000-000000000001','2026-09-16T13:21:16Z' FROM window_result;
UPDATE plugin_data.csf_term_meetings SET settings='{"attendanceWindow":{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:45:00Z"}}' WHERE id=(SELECT (payload->>'meetingId')::uuid FROM window_result);
CREATE FUNCTION pg_temp.correct_window_time(p_corrected timestamptz DEFAULT '2026-09-16T20:21:16Z') RETURNS jsonb LANGUAGE sql AS $$ SELECT plugin_data.csf_correct_attendance_source_timestamp('ed100000-0000-4000-8000-000000000001','ed700000-0000-4000-8000-000000000001','ed600000-0000-4000-8000-000000000001','ed400000-0000-4000-8000-000000000001',2,'2026-09-16T13:21:16Z',p_corrected,'America/Los_Angeles','Verified original response time','ed900000-0000-4000-8000-000000000002','ed000000-0000-4000-8000-000000000001') $$;
SELECT extensions.lives_ok($$SELECT pg_temp.correct_window_time()$$,'source timestamp corrected through audited permission boundary');
SELECT extensions.lives_ok($$SELECT pg_temp.correct_window_time()$$,'timestamp repair replays after record changed');
SELECT extensions.is((SELECT source_submitted_at FROM plugin_data.csf_meeting_attendance WHERE id='ed700000-0000-4000-8000-000000000001'),'2026-09-16T20:21:16Z'::timestamptz,'timestamp reflects verified source zone');
SELECT extensions.is((SELECT source||':'||status FROM plugin_data.csf_meeting_attendance WHERE id='ed700000-0000-4000-8000-000000000001'),'sheet:attended','correction preserves source and attendance status');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id='ed900000-0000-4000-8000-000000000002'),1,'repair audit written once');
SELECT extensions.throws_ok($$SELECT pg_temp.correct_window_time('2026-09-16T20:22:16Z')$$,'P0001','The correction must reinterpret the original source wall clock in its verified time zone.','arbitrary timestamp cannot be substituted');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('ed000000-0000-4000-8000-000000000002','authenticated','authenticated','window-editor@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('ed100000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000002','member','active');
INSERT INTO plugin_data.csf_roles(id,organization_id,key,display_name,role_type)
VALUES ('ed800000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','window_editor','Window editor','custom');
INSERT INTO plugin_data.csf_role_permissions(organization_id,role_id,permission_key)
VALUES
  ('ed100000-0000-4000-8000-000000000001','ed800000-0000-4000-8000-000000000001','manage_meetings'),
  ('ed100000-0000-4000-8000-000000000001','ed800000-0000-4000-8000-000000000001','import_meetings');
INSERT INTO plugin_data.csf_staff_positions(organization_id,user_id,role_id,school_year,display_title,status)
VALUES ('ed100000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000002','ed800000-0000-4000-8000-000000000001','2026-2027','Meeting editor','active');
CREATE FUNCTION pg_temp.edit_window(p_request_id uuid,p_window jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.csf_upsert_term_meeting_with_attendance_window(
    'ed100000-0000-4000-8000-000000000001',
    'ed200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'meetingId')::uuid FROM window_result),
    'September meeting',ARRAY['2026-09-16'::date],NULL,'Gym',NULL,true,1,'active',
    p_request_id,'ed000000-0000-4000-8000-000000000002',p_window
  )
$$;
SELECT extensions.lives_ok($$SELECT pg_temp.edit_window('ed900000-0000-4000-8000-000000000003','{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:45:00Z"}')$$,'meeting editor can save the unchanged attendance window');
SELECT extensions.throws_ok($$SELECT pg_temp.edit_window('ed900000-0000-4000-8000-000000000004','{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:40:00Z"}')$$,'42501','Not authorized for the requested CSF meeting operation.','meeting editor cannot change an existing cutoff without reconciliation authority');
SELECT extensions.is((SELECT settings->'attendanceWindow'->>'closesAt' FROM plugin_data.csf_term_meetings WHERE id=(SELECT (payload->>'meetingId')::uuid FROM window_result)),'2026-09-16T20:45:00Z','denied cutoff edit leaves the stored window unchanged');
INSERT INTO plugin_data.csf_role_permissions(organization_id,role_id,permission_key)
VALUES ('ed100000-0000-4000-8000-000000000001','ed800000-0000-4000-8000-000000000001','reconcile_meeting_attendance');
SELECT extensions.lives_ok($$SELECT pg_temp.edit_window('ed900000-0000-4000-8000-000000000005','{"timeZone":"America/Los_Angeles","opensAt":"2026-09-16T20:00:00Z","closesAt":"2026-09-16T20:40:00Z"}')$$,'reconciliation authority permits a changed cutoff');
SELECT extensions.is((SELECT settings->'attendanceWindow'->>'closesAt' FROM plugin_data.csf_term_meetings WHERE id=(SELECT (payload->>'meetingId')::uuid FROM window_result)),'2026-09-16T20:40:00Z','authorized cutoff edit is stored');

SELECT * FROM extensions.finish();
ROLLBACK;
