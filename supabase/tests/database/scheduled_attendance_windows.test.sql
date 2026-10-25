BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- Fixed fictional dates make every expected instant independent of the host's
-- time zone and avoid sleeping until a cron boundary. Invalid legacy schedules
-- are staged only while the published-schedule trigger is disabled in this
-- rollback-only test; ordinary inserts retain that production validation.
CREATE TEMP TABLE scheduled_attendance_cases (
  ordinal integer GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL,
  event_type text NOT NULL DEFAULT 'oneTime',
  method text NOT NULL DEFAULT 'auto',
  schedule jsonb NOT NULL DEFAULT '{"oneTime":{"date":"2020-01-15","startTime":"10:00","endTime":"12:00","volunteers":10}}',
  schedule_id text NOT NULL DEFAULT 'oneTime',
  zone text NOT NULL DEFAULT 'UTC',
  workflow text NOT NULL DEFAULT 'published',
  initial_status text NOT NULL DEFAULT 'approved',
  initial_in timestamptz,
  initial_out timestamptz,
  expected_status text NOT NULL DEFAULT 'attended',
  expected_in timestamptz DEFAULT '2020-01-15 10:00:00+00',
  expected_out timestamptz DEFAULT '2020-01-15 12:00:00+00',
  project_id uuid,
  signup_id uuid
);
INSERT INTO scheduled_attendance_cases(name) VALUES ('one-time');
INSERT INTO scheduled_attendance_cases(name,schedule_id) VALUES
 ('one-time-zero-alias','0'),
 ('one-time-default-alias','default');
INSERT INTO scheduled_attendance_cases(name,event_type,schedule,schedule_id)
VALUES
 ('multi-day-current','multiDay','{"multiDay":[{"date":"2020-01-15","slots":[{"startTime":"10:00","endTime":"12:00","volunteers":10}]}]}','2020-01-15-0-0'),
 ('multi-day-legacy','multiDay','{"multiDay":[{"date":"2020-01-15","slots":[{"startTime":"10:00","endTime":"12:00","volunteers":10}]}]}','2020-01-15-0'),
 ('multi-day-index-alias','multiDay','{"multiDay":[{"date":"2020-01-15","slots":[{"startTime":"10:00","endTime":"12:00","volunteers":10}]}]}','0-0'),
 ('multi-day-descriptive-alias','multiDay','{"multiDay":[{"date":"2020-01-15","slots":[{"startTime":"10:00","endTime":"12:00","volunteers":10}]}]}','day-0-slot-0'),
 ('named-role','sameDayMultiArea','{"sameDayMultiArea":{"date":"2020-01-15","overallStart":"09:00","overallEnd":"14:00","roles":[{"name":"Fictional desk","startTime":"10:00","endTime":"12:00","volunteers":10}]}}','Fictional desk'),
 ('named-role-index-alias','sameDayMultiArea','{"sameDayMultiArea":{"date":"2020-01-15","overallStart":"09:00","overallEnd":"14:00","roles":[{"name":"Fictional desk","startTime":"10:00","endTime":"12:00","volunteers":10}]}}','role-0');
INSERT INTO scheduled_attendance_cases(name,event_type,schedule,schedule_id,expected_in,expected_out)
VALUES ('named-role-beats-index-alias','sameDayMultiArea',
 '{"sameDayMultiArea":{"date":"2020-01-15","overallStart":"09:00","overallEnd":"14:00","roles":[{"name":"Fictional desk","startTime":"10:00","endTime":"11:00","volunteers":10},{"name":"role-0","startTime":"12:00","endTime":"13:00","volunteers":10}]}}',
 'role-0','2020-01-15 12:00:00+00','2020-01-15 13:00:00+00');
INSERT INTO scheduled_attendance_cases(name,zone,expected_in,expected_out)
VALUES
 ('Pacific-winter','America/Los_Angeles','2020-01-15 18:00:00+00','2020-01-15 20:00:00+00'),
 ('Tokyo','Asia/Tokyo','2020-01-15 01:00:00+00','2020-01-15 03:00:00+00');
INSERT INTO scheduled_attendance_cases(name,schedule,zone,expected_in,expected_out)
VALUES
 ('Pacific-summer','{"oneTime":{"date":"2020-07-15","startTime":"10:00","endTime":"12:00","volunteers":10}}','America/Los_Angeles','2020-07-15 17:00:00+00','2020-07-15 19:00:00+00'),
 ('DST-spring-crossing','{"oneTime":{"date":"2020-03-08","startTime":"01:30","endTime":"03:30","volunteers":10}}','America/Los_Angeles','2020-03-08 09:30:00+00','2020-03-08 10:30:00+00'),
 ('DST-fall-crossing','{"oneTime":{"date":"2020-11-01","startTime":"00:30","endTime":"02:30","volunteers":10}}','America/Los_Angeles','2020-11-01 07:30:00+00','2020-11-01 10:30:00+00');
INSERT INTO scheduled_attendance_cases(name,method,initial_status,initial_in,initial_out,expected_status,expected_in,expected_out)
VALUES
 ('QR-scheduled-end','qr-code','attended','2020-01-15 10:15:00+00',NULL,'attended','2020-01-15 10:15:00+00','2020-01-15 12:00:00+00'),
 ('QR-explicit-early-checkout','qr-code','attended','2020-01-15 10:15:00+00','2020-01-15 10:45:00+00','attended','2020-01-15 10:15:00+00','2020-01-15 10:45:00+00'),
 ('QR-corrupt-late-arrival','qr-code','attended','2020-01-15 12:15:00+00',NULL,'attended','2020-01-15 12:15:00+00',NULL),
 ('QR-without-arrival','qr-code','approved',NULL,NULL,'approved',NULL,NULL),
 ('manual-not-automatic','manual','approved',NULL,NULL,'approved',NULL,NULL),
 ('manual-checkout-untouched','manual','attended','2020-01-15 10:15:00+00',NULL,'attended','2020-01-15 10:15:00+00',NULL),
 ('pending','auto','pending',NULL,NULL,'pending',NULL,NULL),
 ('rejected','auto','rejected',NULL,NULL,'rejected',NULL,NULL);
INSERT INTO scheduled_attendance_cases(name,event_type,method,schedule,schedule_id,initial_status,initial_in,expected_status,expected_in,expected_out)
VALUES ('QR-named-role-index-alias','sameDayMultiArea','qr-code',
 '{"sameDayMultiArea":{"date":"2020-01-15","overallStart":"09:00","overallEnd":"14:00","roles":[{"name":"Fictional desk","startTime":"10:00","endTime":"12:00","volunteers":10}]}}',
 'role-0','attended','2020-01-15 10:15:00+00','attended','2020-01-15 10:15:00+00','2020-01-15 12:00:00+00');
INSERT INTO scheduled_attendance_cases(name,event_type,method,schedule,schedule_id,initial_status,initial_in,expected_status,expected_in,expected_out)
VALUES ('QR-named-role-beats-index-alias','sameDayMultiArea','qr-code',
 '{"sameDayMultiArea":{"date":"2020-01-15","overallStart":"09:00","overallEnd":"14:00","roles":[{"name":"Fictional desk","startTime":"10:00","endTime":"11:00","volunteers":10},{"name":"role-0","startTime":"12:00","endTime":"13:00","volunteers":10}]}}',
 'role-0','attended','2020-01-15 12:15:00+00','attended','2020-01-15 12:15:00+00','2020-01-15 13:00:00+00');
INSERT INTO scheduled_attendance_cases(name,workflow,expected_status,expected_in,expected_out)
VALUES ('draft','draft','approved',NULL,NULL);
INSERT INTO scheduled_attendance_cases(name,schedule,expected_status,expected_in,expected_out)
VALUES
 ('future','{"oneTime":{"date":"2999-01-15","startTime":"10:00","endTime":"12:00","volunteers":10}}','approved',NULL,NULL),
 ('blank-start','{"oneTime":{"date":"2020-01-15","startTime":"","endTime":"12:00","volunteers":10}}','approved',NULL,NULL),
 ('whitespace-start','{"oneTime":{"date":"2020-01-15","startTime":"   ","endTime":"12:00","volunteers":10}}','approved',NULL,NULL),
 ('missing-start','{"oneTime":{"date":"2020-01-15","endTime":"12:00","volunteers":10}}','approved',NULL,NULL),
 ('bad-time','{"oneTime":{"date":"2020-01-15","startTime":"bad-time","endTime":"12:00","volunteers":10}}','approved',NULL,NULL),
 ('invalid-date','{"oneTime":{"date":"2020-02-30","startTime":"10:00","endTime":"12:00","volunteers":10}}','approved',NULL,NULL),
 ('zero-duration','{"oneTime":{"date":"2020-01-15","startTime":"10:00","endTime":"10:00","volunteers":10}}','approved',NULL,NULL),
 ('reversed-duration','{"oneTime":{"date":"2020-01-15","startTime":"12:00","endTime":"10:00","volunteers":10}}','approved',NULL,NULL),
 ('blank-end','{"oneTime":{"date":"2020-01-15","startTime":"10:00","endTime":"","volunteers":10}}','approved',NULL,NULL);
INSERT INTO scheduled_attendance_cases(name,event_type,schedule,schedule_id,expected_status,expected_in,expected_out)
VALUES
 ('malformed-slots','multiDay','{"multiDay":[{"date":"2020-01-15","slots":"bad-shape"}]}','2020-01-15-0-0','approved',NULL,NULL),
 ('mismatched-multi-day-date','multiDay','{"multiDay":[{"date":"2020-01-15","slots":[{"startTime":"10:00","endTime":"12:00","volunteers":10}]}]}','2020-01-16-0-0','approved',NULL,NULL),
 ('unknown-role','sameDayMultiArea','{"sameDayMultiArea":{"date":"2020-01-15","overallStart":"09:00","overallEnd":"14:00","roles":[{"name":"Fictional desk","startTime":"10:00","endTime":"12:00","volunteers":10}]}}','Different desk','approved',NULL,NULL);
INSERT INTO scheduled_attendance_cases(name,expected_status,expected_in,expected_out)
VALUES ('cancelled-project','approved',NULL,NULL),('inactive-project','approved',NULL,NULL);

UPDATE scheduled_attendance_cases
SET project_id = ('ad724000-0000-4000-8000-' || lpad(ordinal::text,12,'0'))::uuid,
    signup_id = ('ad724100-0000-4000-8000-' || lpad(ordinal::text,12,'0'))::uuid;
SELECT extensions.plan((SELECT count(*)::integer + 13 FROM scheduled_attendance_cases));

INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('ad724000-0000-4000-8000-000000900001','authenticated','authenticated','scheduled-owner@local.test','{}','{}'),
 ('ad724000-0000-4000-8000-000000900002','authenticated','authenticated','scheduled-volunteer@local.test','{}','{}');
ALTER TABLE public.projects DISABLE TRIGGER validate_published_project_schedule;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,project_timezone,status,workflow_status)
SELECT project_id,'ad724000-0000-4000-8000-000000900001',name,'Local','Fictional attendance regression',event_type,method,schedule,zone,'upcoming',workflow
FROM scheduled_attendance_cases;
ALTER TABLE public.projects ENABLE TRIGGER validate_published_project_schedule;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status,check_in_time,check_out_time)
SELECT signup_id,project_id,'ad724000-0000-4000-8000-000000900002',schedule_id,initial_status,initial_in,initial_out
FROM scheduled_attendance_cases;
UPDATE public.projects p SET status = 'cancelled'
FROM scheduled_attendance_cases c WHERE p.id=c.project_id AND c.name='cancelled-project';
UPDATE public.projects p SET status = 'inactive'
FROM scheduled_attendance_cases c WHERE p.id=c.project_id AND c.name='inactive-project';

SELECT extensions.ok(NOT has_function_privilege('anon','public.process_automatic_check_ins()','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.process_automatic_check_ins()','EXECUTE'),
 'browser roles cannot manufacture scheduled check-in');
SELECT extensions.ok(NOT has_function_privilege('anon','public.process_automatic_check_outs()','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.process_automatic_check_outs()','EXECUTE'),
 'browser roles cannot manufacture scheduled checkout');
SELECT extensions.ok(NOT has_function_privilege('anon','private.project_attendance_slot_window(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','private.project_attendance_slot_window(uuid,text)','EXECUTE'),
 'selected attendance windows remain private');
SELECT extensions.ok(has_function_privilege('service_role','public.process_automatic_check_ins()','EXECUTE')
 AND has_function_privilege('service_role','public.process_automatic_check_outs()','EXECUTE')
 AND has_function_privilege('service_role','private.project_attendance_slot_window(uuid,text)','EXECUTE'),
 'reviewed service execution is explicit');
SELECT extensions.is((SELECT count(*) FROM pg_catalog.pg_proc
 WHERE oid IN ('public.process_automatic_check_ins()'::regprocedure,'public.process_automatic_check_outs()'::regprocedure,'private.project_attendance_slot_window(uuid,text)'::regprocedure)
 AND proowner='postgres'::regrole AND proconfig=ARRAY['search_path=""']),3::bigint,
 'worker/parser ownership and safe search paths are pinned');
SELECT extensions.is((SELECT count(*) FROM private.project_attendance_slot_window(NULL,NULL)),0::bigint,
 'missing selected session never resolves to a date');

CREATE TEMP TABLE awards_before AS SELECT
 (SELECT count(*) FROM public.certificates) AS certificates,
 (SELECT count(*) FROM plugin_data.csf_point_submissions) AS points;
-- Exercise the real status worker before attendance: valid past projects become
-- completed, which must not strand previously approved scheduled attendance.
SELECT extensions.lives_ok('SELECT public.process_projects()','status maintenance precedes attendance without invalid legacy rows aborting it');
SELECT extensions.is((SELECT p.status FROM public.projects p JOIN scheduled_attendance_cases c ON c.project_id=p.id WHERE c.name='named-role'),
 'completed','published named-role project actually advances before attendance');
SET LOCAL timezone = 'Asia/Tokyo';
SELECT extensions.lives_ok('SELECT public.checkin_signups(); SELECT public.checkout_signups();',
 'both unchanged cron wrappers complete with valid and malformed legacy rows');
SELECT extensions.is(
 jsonb_build_object('status',s.status,'in',s.check_in_time,'out',s.check_out_time),
 jsonb_build_object('status',c.expected_status,'in',c.expected_in,'out',c.expected_out),
 c.name || ': only the correct selected attendance interval is recorded'
)
FROM scheduled_attendance_cases c JOIN public.project_signups s ON s.id=c.signup_id
ORDER BY c.ordinal;

CREATE TEMP TABLE attendance_before_retry AS
SELECT s.id,s.status,s.check_in_time,s.check_out_time
FROM public.project_signups s JOIN scheduled_attendance_cases c ON c.signup_id=s.id;
SELECT extensions.lives_ok('SELECT public.process_automatic_check_ins(); SELECT public.process_automatic_check_outs();',
 'direct canonical job retry completes');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM attendance_before_retry s),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM (
  SELECT s.id,s.status,s.check_in_time,s.check_out_time
  FROM public.project_signups s JOIN scheduled_attendance_cases c ON c.signup_id=s.id
 ) s),'retry preserves every existing arrival, explicit departure and skipped row');
SELECT extensions.is((SELECT count(*) FROM public.certificates),(SELECT certificates FROM awards_before),
 'scheduled attendance does not publish certificates');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_point_submissions),(SELECT points FROM awards_before),
 'scheduled platform attendance does not manufacture CSF points');

SELECT * FROM extensions.finish();
ROLLBACK;
