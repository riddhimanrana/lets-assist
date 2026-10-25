BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('a7000000-0000-4000-8000-000000000001','authenticated','authenticated','attendance-owner@local.test',now(),'{}','{"username":"attendance_owner"}',now(),now()),
 ('a7000000-0000-4000-8000-000000000002','authenticated','authenticated','attendance-volunteer@local.test',now(),'{}','{"username":"attendance_volunteer"}',now(),now()),
 ('a7000000-0000-4000-8000-000000000003','authenticated','authenticated','attendance-outsider@local.test',now(),'{}','{"username":"attendance_outsider"}',now(),now());
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,project_timezone) VALUES
 ('a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','Attendance intervals fixture','Local','Synthetic attendance','oneTime','manual',
 '{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"15:00","volunteers":2}}',true,'upcoming','UTC');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
 ('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002','oneTime','approved');
SELECT extensions.lives_ok($$SELECT public.record_project_attendance('a7200000-0000-4000-8000-000000000001',0,'Synthetic reviewed attendance',
 '[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001')$$,'record split attendance through the authorized service');
SELECT extensions.is(public.publish_volunteer_hours_transactional('a7000000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','oneTime',
 '[{"signupId":"a7200000-0000-4000-8000-000000000001","checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T13:00:00Z","attendanceRevision":1}]',
 'hours-publication:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')->>'outcome','accepted','publish the reviewed award before correction');
SELECT extensions.lives_ok($$SELECT public.correct_project_attendance('a7200000-0000-4000-8000-000000000001',1,'Synthetic private correction note',
 '[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:30:00Z"},{"checkIn":"2020-09-18T12:00:00Z","checkOut":"2020-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001')$$,'correct split attendance before export');
CREATE TEMP TABLE attendance_export AS SELECT public.account_data_export_snapshot('a7000000-0000-4000-8000-000000000002') value;
SELECT extensions.is((SELECT value->'datasets'->'certificates'->0->>'credited_minutes' FROM attendance_export),'150','export uses corrected minutes, not the 240-minute outer envelope');
SELECT extensions.is((SELECT value->'datasets'->'certificates'->0->>'attendance_revision' FROM attendance_export),'2','certificate revision identifies the corrected award');
SELECT extensions.is((SELECT value->'datasets'->'projectSignups'->0->>'attendance_revision' FROM attendance_export),'2','signup revision matches the corrected award');
SELECT extensions.is((SELECT jsonb_array_length(value->'datasets'->'attendanceIntervals') FROM attendance_export),2,'both disjoint intervals survive the export');
SELECT extensions.is((SELECT (value->'counts'->>'attendanceIntervals')::integer FROM attendance_export),2,'interval manifest count matches the records');
SELECT extensions.is((SELECT sum(extract(epoch FROM (r->>'check_out_time')::timestamptz - (r->>'check_in_time')::timestamptz)/60)::integer FROM attendance_export,jsonb_array_elements(value->'datasets'->'attendanceIntervals') r),150,'exported intervals explain the credited minutes');
SELECT extensions.ok((SELECT bool_and(r->>'signup_id'='a7200000-0000-4000-8000-000000000001') FROM attendance_export,jsonb_array_elements(value->'datasets'->'attendanceIntervals') r),'every exported interval references the owned signup');
SELECT extensions.is(jsonb_array_length(public.account_data_export_snapshot('a7000000-0000-4000-8000-000000000001')->'datasets'->'attendanceIntervals'),0,'project ownership does not grant account export access to volunteer intervals');
SELECT extensions.is(jsonb_array_length(public.account_data_export_snapshot('a7000000-0000-4000-8000-000000000003')->'datasets'->'attendanceIntervals'),0,'an unrelated account receives no attendance intervals');
SELECT extensions.ok((SELECT value::text NOT LIKE '%Synthetic private correction note%' FROM attendance_export),'private correction audit notes are excluded');
-- A historical certificate without canonical minutes must not invent an award.
UPDATE public.certificates SET credited_minutes=NULL,attendance_revision=0 WHERE signup_id='a7200000-0000-4000-8000-000000000001';
SELECT extensions.is(public.account_data_export_snapshot('a7000000-0000-4000-8000-000000000002')->'datasets'->'certificates'->0->'credited_minutes','null'::jsonb,'legacy null minutes remain null in the export');
-- Exercise the export limit independently of attendance write validation.
INSERT INTO public.project_attendance_intervals(signup_id,project_id,check_in_time,check_out_time)
SELECT 'a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001',
 '2010-01-01T00:00:00Z'::timestamptz+n*interval '1 minute','2010-01-01T00:00:00Z'::timestamptz+(n+1)*interval '1 minute' FROM generate_series(1,9999) n;
SELECT extensions.throws_ok($$SELECT public.account_data_export_snapshot('a7000000-0000-4000-8000-000000000002')$$,'54000','account_export_dataset_limit','10001 intervals fail the whole export rather than truncate');
SELECT * FROM extensions.finish();
ROLLBACK;
