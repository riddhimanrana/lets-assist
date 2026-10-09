BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('af100000-0000-4000-8000-000000000001','authenticated','authenticated','attendance-limits-owner@local.test',now(),'{}','{"username":"attendance_limits_owner"}',now(),now()),
 ('af100000-0000-4000-8000-000000000002','authenticated','authenticated','attendance-limits-person@local.test',now(),'{}','{"username":"attendance_limits_person"}',now(),now());
-- Choose a real timezone whose current local hour is noon, keeping this test
-- inside its session at every UTC hour without replacing the database clock.
CREATE TEMP TABLE attendance_clock AS SELECT clock_timestamp() AS observed,
 'Etc/GMT'||CASE WHEN extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::integer>=12 THEN '+' ELSE '-' END
 ||abs(extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::integer-12)::text AS zone;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,published)
SELECT 'af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','Ongoing attendance fixture','Local','Synthetic clock boundary','oneTime','manual',
 jsonb_build_object('oneTime',jsonb_build_object('date',to_char(observed AT TIME ZONE zone,'YYYY-MM-DD'),'startTime','11:00','endTime','14:00','volunteers',5)),
 'upcoming',zone,'{"oneTime":true}'::jsonb FROM attendance_clock;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
 ('af300000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000002','oneTime','approved');
CREATE TEMP TABLE observed_visits AS SELECT
 jsonb_build_array(jsonb_build_object('checkIn',observed-interval '30 minutes','checkOut',observed-interval '15 minutes')) AS past,
 jsonb_build_array(jsonb_build_object('checkIn',observed+interval '15 minutes','checkOut',observed+interval '30 minutes')) AS future FROM attendance_clock;
SELECT extensions.throws_ok($$SELECT public.record_project_attendance('af300000-0000-4000-8000-000000000001',0,'Future transcription',(SELECT future FROM observed_visits),'af600000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001')$$,'22023','attendance times cannot be in the future','recording rejects future actual times');
SELECT extensions.is(public.record_project_attendance('af300000-0000-4000-8000-000000000001',0,'Reviewed completed visit',(SELECT past FROM observed_visits),'af600000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000001')->>'creditedMinutes','15','completed actual visit can be recorded during an ongoing session');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id='af200000-0000-4000-8000-000000000001'),0,'an early published flag cannot trigger an award before session end');
SELECT extensions.throws_ok($$SELECT public.publish_volunteer_hours_transactional('af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','oneTime',
 (SELECT jsonb_build_array(jsonb_build_object('signupId','af300000-0000-4000-8000-000000000001','checkIn',past->0->>'checkIn','checkOut',past->0->>'checkOut','attendanceRevision',1)) FROM observed_visits),'hours-publication:v1:'||repeat('fa',32))$$,'22023','project session has not ended','publication waits until the selected session ends');
SELECT extensions.throws_ok($$SELECT * FROM public.issue_supplemental_verified_certificates('af200000-0000-4000-8000-000000000001','oneTime',ARRAY['af300000-0000-4000-8000-000000000001']::uuid[],'af100000-0000-4000-8000-000000000001')$$,'22023','project session has not ended','direct supplemental issuance also waits for session end');
SELECT extensions.throws_ok($$SELECT public.correct_project_attendance('af300000-0000-4000-8000-000000000001',1,'Future correction',(SELECT future FROM observed_visits),'af600000-0000-4000-8000-000000000003','af100000-0000-4000-8000-000000000001')$$,'22023','attendance times cannot be in the future','correction rejects future actual endpoints');
SELECT extensions.is((SELECT attendance_revision FROM public.project_signups WHERE id='af300000-0000-4000-8000-000000000001'),1,'future correction leaves the recorded revision unchanged');
CREATE TEMP TABLE limit_batch AS SELECT public.create_manual_attendance_batch('af200000-0000-4000-8000-000000000001','oneTime','af100000-0000-4000-8000-000000000001','af600000-0000-4000-8000-000000000010') AS id;
CREATE TEMP TABLE future_row AS SELECT public.add_paper_attendance_row('af200000-0000-4000-8000-000000000001',(SELECT id FROM limit_batch),'af100000-0000-4000-8000-000000000001','af600000-0000-4000-8000-000000000011') AS id;
SELECT extensions.lives_ok($$SELECT public.update_paper_scan_review_row((SELECT id FROM limit_batch),'af200000-0000-4000-8000-000000000001',(SELECT id FROM future_row),'af100000-0000-4000-8000-000000000001',jsonb_build_object('expectedRevision',0,'attendanceIntervals',(SELECT future FROM observed_visits),'matchSignupId','af300000-0000-4000-8000-000000000001','identityConfirmed',true,'reviewAcknowledged',true,'decision','include'))$$,'future transcription remains editable as an unresolved draft');
SELECT extensions.is((SELECT detail FROM public.commit_paper_signup_batch((SELECT id FROM limit_batch),'af100000-0000-4000-8000-000000000001',ARRAY[(SELECT id FROM future_row)],false,'af600000-0000-4000-8000-000000000014')),'invalid_time_window','reviewed future extraction cannot become canonical attendance');
SELECT extensions.lives_ok($$SELECT public.update_paper_scan_review_row((SELECT id FROM limit_batch),'af200000-0000-4000-8000-000000000001',(SELECT id FROM future_row),'af100000-0000-4000-8000-000000000001','{"expectedRevision":1,"decision":"exclude"}'::jsonb)$$,'reviewer can skip a row containing erroneous future extraction');
SELECT extensions.is((SELECT review_revision FROM public.project_paper_scan_rows WHERE id=(SELECT id FROM future_row)),2,'editable draft and skip both retain optimistic revisions');
INSERT INTO public.project_paper_scan_rows(batch_id,project_id,sheet_row_number,raw_extraction)
 SELECT (SELECT id FROM limit_batch),'af200000-0000-4000-8000-000000000001',number,'{}'::jsonb FROM generate_series(2,299) number;
UPDATE public.project_paper_scan_batches SET extracted_row_count=299 WHERE id=(SELECT id FROM limit_batch);
CREATE TEMP TABLE final_row AS SELECT public.add_paper_attendance_row('af200000-0000-4000-8000-000000000001',(SELECT id FROM limit_batch),'af100000-0000-4000-8000-000000000001','af600000-0000-4000-8000-000000000012') AS id;
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_scan_rows WHERE batch_id=(SELECT id FROM limit_batch)),300,'the last visible row can be added');
SELECT extensions.throws_ok($$SELECT public.add_paper_attendance_row('af200000-0000-4000-8000-000000000001',(SELECT id FROM limit_batch),'af100000-0000-4000-8000-000000000001','af600000-0000-4000-8000-000000000013')$$,'22023','batch row limit reached','row301 is refused instead of becoming invisible');
SELECT extensions.is(public.add_paper_attendance_row('af200000-0000-4000-8000-000000000001',(SELECT id FROM limit_batch),'af100000-0000-4000-8000-000000000001','af600000-0000-4000-8000-000000000012'),(SELECT id FROM final_row),'successful row creation replays at the cap');
SELECT extensions.is((SELECT extracted_row_count FROM public.project_paper_scan_batches WHERE id=(SELECT id FROM limit_batch)),300,'replay and refusal cannot inflate the row count');
SELECT extensions.is((SELECT count(*)::integer FROM public.hours_publication_receipts WHERE project_id='af200000-0000-4000-8000-000000000001'),0,'early publication cannot create a receipt or delivery');
SELECT * FROM extensions.finish();
ROLLBACK;
