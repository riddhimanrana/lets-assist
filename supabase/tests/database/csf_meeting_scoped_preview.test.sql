BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('fa100000-0000-4000-8000-000000000001','Meeting isolation fixture','meeting-isolation-fixture','school','517221');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,lifecycle_status,is_current) VALUES
('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','F40','Fall 2040','2040-2041','fall','open',true);
INSERT INTO plugin_data.csf_term_meetings(id,organization_id,term_id,meeting_key,label) VALUES
('fa300000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','september','September fixture'),
('fa300000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','october','October fixture');
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,mode,status,source_type,mapping_version,mapping_snapshot,created_at) VALUES
('fa400000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','preview','needs_resolution','meeting_attendance',1,'{}','2040-09-01'),
('fa400000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000001','preview','needs_resolution','meeting_attendance',1,'{"meetingId":"fa300000-0000-4000-8000-000000000002"}','2040-10-01'),
('fa400000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000000001','preview','needs_resolution','meeting_attendance',1,'{}','2040-10-02');
INSERT INTO plugin_data.csf_sheet_import_rows(organization_id,job_id,sheet_tab_name,row_number,import_status,normalized_data) VALUES
('fa100000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001','Responses',2,'pending','{"meetingId":"fa300000-0000-4000-8000-000000000001"}'),
('fa100000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000003','Responses',2,'pending','{"meetingId":"fa300000-0000-4000-8000-000000000001"}'),
('fa100000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000003','Responses',3,'pending','{"meetingId":"fa300000-0000-4000-8000-000000000002"}');
SELECT extensions.is(plugin_data.csf_meeting_preview_id('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001'),
 'fa400000-0000-4000-8000-000000000001'::uuid,'legacy previews use the immutable identity of every response');
SELECT extensions.is(plugin_data.csf_meeting_preview_id('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000002'),
 'fa400000-0000-4000-8000-000000000002'::uuid,'new previews use their immutable meeting mapping');
SELECT extensions.is(plugin_data.csf_meeting_preview_id('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000002'),NULL::uuid,
 'a selected preview from another meeting never falls back');
SELECT extensions.is(plugin_data.csf_meeting_preview_id('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000003'),NULL::uuid,
 'mixed legacy identities cannot enter either meeting detail');
SELECT extensions.is(plugin_data.csf_meeting_preview_id('fa100000-0000-4000-8000-000000000099','fa300000-0000-4000-8000-000000000001'),NULL::uuid,
 'meeting preview selection is organization scoped');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_meeting_preview_id(uuid,uuid,uuid)','EXECUTE'),
 'browser clients cannot select meeting previews directly');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('fa500000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','Fictional','Attendee','fictional','attendee');
INSERT INTO plugin_data.csf_meeting_attendance(organization_id,profile_id,term_id,meeting_key,meeting_label,status) VALUES
('fa100000-0000-4000-8000-000000000001','fa500000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','september','September fixture','attended'),
('fa100000-0000-4000-8000-000000000001','fa500000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','october','October fixture','missed');
SELECT extensions.is((SELECT attended_count FROM plugin_data.csf_meeting_attendance_counts('fa100000-0000-4000-8000-000000000001',ARRAY['fa300000-0000-4000-8000-000000000001']::uuid[])),1::bigint,
 'summary counts canonical attended records');
SELECT extensions.is((SELECT attended_count FROM plugin_data.csf_meeting_attendance_counts('fa100000-0000-4000-8000-000000000001',ARRAY['fa300000-0000-4000-8000-000000000002']::uuid[])),0::bigint,
 'missed attendance is not counted as attended');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_meeting_attendance_counts(uuid,uuid[])','EXECUTE'),
 'browser clients cannot read attendance counts directly');
SELECT * FROM extensions.finish();
ROLLBACK;
