BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('ec100000-0000-4000-8000-000000000001','authenticated','authenticated','correction-owner@local.test',now(),'{}','{}',now(),now()),
 ('ec100000-0000-4000-8000-000000000002','authenticated','authenticated','correction-volunteer@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
VALUES ('ec200000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001',
 'Correction retention fixture','Local','Synthetic correction history','oneTime','manual',
 '{"oneTime":{"date":"2020-09-01","startTime":"09:00","endTime":"12:00","volunteers":10}}','upcoming','UTC');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
VALUES ('ec300000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001',
 'ec100000-0000-4000-8000-000000000002','oneTime','approved');

SET LOCAL ROLE service_role;
SELECT public.publish_volunteer_hours_transactional(
 'ec100000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000001','oneTime',
 '[{"signupId":"ec300000-0000-4000-8000-000000000001","checkIn":"2020-09-01T09:00:00Z","checkOut":"2020-09-01T10:00:00Z"}]',
 'hours-publication:v1:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd');
SELECT public.correct_project_attendance(
 'ec300000-0000-4000-8000-000000000001',
 (SELECT attendance_revision FROM public.project_signups WHERE id='ec300000-0000-4000-8000-000000000001'),
 'Reviewed fictional attendance sheet',
 '[{"checkIn":"2020-09-01T09:00:00Z","checkOut":"2020-09-01T10:30:00Z"}]',
 'ec400000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001');
RESET ROLE;
CREATE TEMP TABLE retained_correction AS
 SELECT to_jsonb(a)-'signup_id' AS receipt FROM private.project_attendance_changes a
 WHERE request_id='ec400000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*) FROM retained_correction),1::bigint,'real correction creates its audit receipt');
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE signup_id='ec300000-0000-4000-8000-000000000001'),90,'corrected certificate reflects the reviewed award');

SET LOCAL ROLE service_role;
SELECT extensions.is(public.begin_account_deletion('ec100000-0000-4000-8000-000000000002',
 'ec100000-0000-4000-8000-000000000002')->>'phase','external_pending','volunteer deletion commits its database phase');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.project_signups WHERE id='ec300000-0000-4000-8000-000000000001'),0::bigint,'deletion removes the volunteer signup');
SELECT extensions.is((SELECT count(*) FROM private.project_attendance_changes WHERE request_id='ec400000-0000-4000-8000-000000000001'),1::bigint,'deletion retains the correction audit');
SELECT extensions.ok((SELECT signup_id IS NULL FROM private.project_attendance_changes WHERE request_id='ec400000-0000-4000-8000-000000000001'),'retained audit clears the deleted signup link');
SELECT extensions.is((SELECT to_jsonb(a)-'signup_id' FROM private.project_attendance_changes a WHERE request_id='ec400000-0000-4000-8000-000000000001'),
 (SELECT receipt FROM retained_correction),'deletion preserves intervals, reason, revisions and retry receipt');
SELECT extensions.is((SELECT count(*) FROM public.certificates WHERE project_id='ec200000-0000-4000-8000-000000000001'
 AND user_id IS NULL AND signup_id IS NULL AND credited_minutes=90),1::bigint,'corrected certificate survives with account and signup links cleared');
SELECT extensions.ok(NOT has_table_privilege('anon','private.project_attendance_changes','SELECT')
 AND NOT has_table_privilege('authenticated','private.project_attendance_changes','SELECT'),'retained correction evidence remains server-only');

SELECT * FROM extensions.finish();
ROLLBACK;
