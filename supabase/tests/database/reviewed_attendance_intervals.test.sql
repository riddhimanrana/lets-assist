BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('a7000000-0000-4000-8000-000000000001','authenticated','authenticated','attendance-owner@local.test',now(),'{}','{"username":"attendance_owner"}',now(),now()),
 ('a7000000-0000-4000-8000-000000000002','authenticated','authenticated','attendance-volunteer@local.test',now(),'{}','{"username":"attendance_volunteer"}',now(),now()),
 ('a7000000-0000-4000-8000-000000000003','authenticated','authenticated','attendance-outsider@local.test',now(),'{}','{"username":"attendance_outsider"}',now(),now());
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,project_timezone) VALUES
 ('a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','Attendance intervals fixture','Local','Synthetic attendance','oneTime','manual',
 '{"oneTime":{"date":"2026-09-18","startTime":"09:00","endTime":"15:00","volunteers":2}}',true,'upcoming','UTC');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
 ('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002','oneTime','approved');
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count) VALUES
 ('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','oneTime','a7000000-0000-4000-8000-000000000001','review',1);
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,decision,match_signup_id,attendance_intervals,review_acknowledged,identity_confirmed) VALUES
 ('a7400000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001',1,'{"name":"Unchanged source"}','Known no email','include','a7200000-0000-4000-8000-000000000001',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',true,true),
 ('a7400000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001',2,'{}','Missing checkout','include',NULL,
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":null}]',true,true),
 ('a7400000-0000-4000-8000-000000000003','a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001',3,'{}','Unreviewed','include',NULL,
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}]',false,false);

SELECT extensions.ok(NOT has_table_privilege('authenticated','public.project_attendance_intervals','SELECT'),'canonical intervals are server-only');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.correct_project_attendance(uuid,integer,text,jsonb,uuid,uuid)','EXECUTE'),'corrections deny browsers');
SELECT extensions.ok(has_function_privilege('service_role','public.correct_project_attendance(uuid,integer,text,jsonb,uuid,uuid)','EXECUTE'),'corrections allow service role');
SELECT extensions.is(private.attendance_interval_minutes(private.normalize_attendance_intervals('[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T09:00:20Z"},{"checkIn":"2026-09-18T10:00:00Z","checkOut":"2026-09-18T10:00:20Z"}]')),1,'round sum once rather than rounding each interval');
SELECT extensions.throws_ok($$SELECT private.normalize_attendance_intervals('[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T11:00:00Z"},{"checkIn":"2026-09-18T10:00:00Z","checkOut":"2026-09-18T12:00:00Z"}]')$$,'22023','attendance intervals must be positive and disjoint','reject overlapping intervals');
SELECT extensions.throws_ok($$SELECT private.normalize_attendance_intervals('[{"checkIn":"2026-09-18T09:00:00Z","checkOut":null}]')$$,'22023','attendance requires complete timestamps with a timezone','missing checkout stays missing');
SELECT extensions.throws_ok($$SELECT private.normalize_attendance_intervals('[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-19T09:01:00Z"}]')$$,'22023','attendance must total at least one minute within a 24 hour envelope','reject over 24 hours');
CREATE TEMP TABLE first_commit AS SELECT * FROM public.commit_paper_signup_batch('a7300000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
 ARRAY['a7400000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000002','a7400000-0000-4000-8000-000000000003']::uuid[],false,'a7500000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT outcome FROM first_commit WHERE row_id='a7400000-0000-4000-8000-000000000001'),'signup_updated','explicit known signup needs no email');
SELECT extensions.is((SELECT detail FROM first_commit WHERE row_id='a7400000-0000-4000-8000-000000000002'),'invalid_time_window','missing checkout cannot mint hours');
SELECT extensions.is((SELECT detail FROM first_commit WHERE row_id='a7400000-0000-4000-8000-000000000003'),'review_required','include alone is not human review');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id='a7300000-0000-4000-8000-000000000001'),'review','partial batch stays reviewable');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_intervals WHERE signup_id='a7200000-0000-4000-8000-000000000001'),2,'stores both intervals');
SELECT extensions.is((SELECT attendance_revision FROM public.project_signups WHERE id='a7200000-0000-4000-8000-000000000001'),1,'first reviewed attendance advances revision');
SELECT extensions.results_eq($$SELECT * FROM public.commit_paper_signup_batch('a7300000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
 ARRAY['a7400000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000002','a7400000-0000-4000-8000-000000000003']::uuid[],false,'a7500000-0000-4000-8000-000000000001')$$,$$SELECT * FROM first_commit$$,'partial commit exact replay preserves outcomes');
SELECT extensions.is(public.update_paper_scan_review_row('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":0,"attendanceIntervals":[{"checkIn":"2026-09-18T09:00:00Z","checkOut":null}]}'),'updated','incomplete intervals save as a draft');
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001','{"expectedRevision":0,"name":"Stale"}')$$,
 '40001','review row changed; refresh before saving','stale row edit is rejected');
SELECT extensions.is((SELECT raw_extraction->>'name' FROM public.project_paper_scan_rows WHERE id='a7400000-0000-4000-8000-000000000001'),'Unchanged source','raw transcription remains unchanged');

CREATE TEMP TABLE publication AS SELECT public.publish_volunteer_hours_transactional('a7000000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','oneTime',
 '[{"signupId":"a7200000-0000-4000-8000-000000000001","checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T13:00:00Z","attendanceRevision":1}]',
 'hours-publication:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') AS result;
SELECT extensions.is((SELECT result->>'outcome' FROM publication),'accepted','legacy pair publication preserves reviewed intervals');
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000001'),120,'certificate excludes two-hour break');
SELECT extensions.is((SELECT result->'deliveries'->0->>'creditedMinutes' FROM publication),'120','publication emails receive canonical minutes');
CREATE TEMP TABLE before_correction AS SELECT id,credited_minutes,attendance_revision FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000001';
CREATE TEMP TABLE before_email AS SELECT count(*)::integer AS count FROM public.hours_publication_email_outbox;
CREATE TEMP TABLE correction AS SELECT public.correct_project_attendance('a7200000-0000-4000-8000-000000000001',1,'Reviewed original sheet',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:30:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001') AS result;
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000001'),150,'correction changes canonical award');
SELECT extensions.is((SELECT id FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000001'),(SELECT id FROM before_correction),'correction retains certificate URL identity');
SELECT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox),(SELECT count FROM before_email),'correction creates no email work');
SELECT extensions.is((SELECT old_credited_minutes FROM private.project_attendance_changes WHERE request_id='a7500000-0000-4000-8000-000000000002'),120,'correction audits previous award');
SELECT extensions.is(public.correct_project_attendance('a7200000-0000-4000-8000-000000000001',1,'Reviewed original sheet',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:30:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001')->>'outcome','replayed','correction exact retry is idempotent');
SELECT extensions.throws_ok($$SELECT public.correct_project_attendance('a7200000-0000-4000-8000-000000000001',1,'Stale correction',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:30:00Z"}]','a7500000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000001')$$,
 '40001','attendance changed; refresh before correcting','stale correction cannot overwrite a reviewed award');
SELECT extensions.throws_ok($$SELECT public.correct_project_attendance('a7200000-0000-4000-8000-000000000001',2,'Unauthorized correction',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:30:00Z"}]','a7500000-0000-4000-8000-000000000004','a7000000-0000-4000-8000-000000000003')$$,
 '42501','not authorized to correct attendance','outsider cannot correct attendance');

SELECT extensions.is(public.update_paper_scan_review_row('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":1,"name":"Guest attendee","email":"guest-attendance@local.test","attendanceIntervals":[{"checkIn":"2026-09-18T08:30:00Z","checkOut":"2026-09-18T09:30:00Z"}],"reviewAcknowledged":true,"identityConfirmed":true}'),'updated','guest draft can resolve missing evidence');
SELECT extensions.is((SELECT detail FROM public.commit_paper_signup_batch('a7300000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',ARRAY['a7400000-0000-4000-8000-000000000002']::uuid[],false,'a7500000-0000-4000-8000-000000000005')),'outside_schedule_requires_reason','out-of-slot times are not clamped');
SELECT public.update_paper_scan_review_row('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":2,"timeExceptionReason":"Setup before scheduled start","reviewAcknowledged":true}');
CREATE TEMP TABLE late_guest AS SELECT * FROM public.commit_paper_signup_batch('a7300000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',ARRAY['a7400000-0000-4000-8000-000000000002']::uuid[],false,'a7500000-0000-4000-8000-000000000006');
SELECT extensions.is((SELECT outcome FROM late_guest),'signup_created','reviewer can record guest at account-required project');
SELECT extensions.is((SELECT check_in_time FROM public.project_signups WHERE id=(SELECT signup_id FROM late_guest)),'2026-09-18T08:30:00Z'::timestamptz,'exception keeps actual check-in');
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE signup_id=(SELECT signup_id FROM late_guest)),60,'late import certificate uses canonical minutes');
SELECT extensions.ok((SELECT anonymous_id IS NOT NULL AND user_id IS NULL FROM late_guest),'guest uses existing anonymous signup model');

CREATE TEMP TABLE manual AS SELECT public.create_manual_attendance_batch('a7100000-0000-4000-8000-000000000001','oneTime','a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000010') AS id;
SELECT extensions.is((SELECT image_count FROM public.project_paper_scan_batches WHERE id=(SELECT id FROM manual)),0,'manual batch needs no photograph');
SELECT extensions.is(public.create_manual_attendance_batch('a7100000-0000-4000-8000-000000000001','oneTime','a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000010'),(SELECT id FROM manual),'manual batch creation is replay-safe');
CREATE TEMP TABLE manual_row AS SELECT public.add_paper_attendance_row('a7100000-0000-4000-8000-000000000001',(SELECT id FROM manual),'a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000011') AS id;
SELECT extensions.is((SELECT attendance_intervals FROM public.project_paper_scan_rows WHERE id=(SELECT id FROM manual_row)),'[]'::jsonb,'manual row starts with blank times');
SELECT extensions.is(public.add_paper_attendance_row('a7100000-0000-4000-8000-000000000001',(SELECT id FROM manual),'a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000011'),(SELECT id FROM manual_row),'manual row creation is replay-safe');

-- A roster-only row can later gain a confirmed address without two headcounts.
SELECT public.update_paper_scan_review_row((SELECT id FROM manual),'a7100000-0000-4000-8000-000000000001',(SELECT id FROM manual_row),'a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":0,"name":"Roster attendee","decision":"include","attendanceIntervals":[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}],"identityConfirmed":true,"reviewAcknowledged":true}');
SELECT extensions.is((SELECT outcome FROM public.commit_paper_signup_batch((SELECT id FROM manual),'a7000000-0000-4000-8000-000000000001',ARRAY[(SELECT id FROM manual_row)],false,'a7500000-0000-4000-8000-000000000012')),'roster_only','unmatched name remains a roster record');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE signup_id IN (SELECT committed_signup_id FROM public.project_paper_scan_rows WHERE id=(SELECT id FROM manual_row))),0,'unmatched name receives no certificate');
SELECT extensions.is(public.update_paper_scan_review_row((SELECT id FROM manual),'a7100000-0000-4000-8000-000000000001',(SELECT id FROM manual_row),'a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":1,"email":"roster-promoted@local.test","identityConfirmed":true,"reviewAcknowledged":true}'),'updated','terminal roster record can be reviewed again');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT id FROM manual)),'review','roster review reopens batch');
SELECT extensions.is((SELECT detail FROM public.commit_paper_signup_batch((SELECT id FROM manual),'a7000000-0000-4000-8000-000000000001',ARRAY[(SELECT id FROM manual_row)],false,'a7500000-0000-4000-8000-000000000013')),'slot_full','roster promotion still enforces capacity');
SELECT extensions.is((SELECT outcome FROM public.commit_paper_signup_batch((SELECT id FROM manual),'a7000000-0000-4000-8000-000000000001',ARRAY[(SELECT id FROM manual_row)],true,'a7500000-0000-4000-8000-000000000014')),'signup_created','explicit capacity override permits roster promotion');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_roster_entries WHERE scan_row_id=(SELECT id FROM manual_row)),0,'promotion atomically removes old roster headcount');
SELECT extensions.is((SELECT source FROM public.project_signups WHERE id=(SELECT committed_signup_id FROM public.project_paper_scan_rows WHERE id=(SELECT id FROM manual_row))),'organizer_manual','manual attendance retains its source');

-- Combining changes only the working copies and retains raw source evidence.
CREATE TEMP TABLE combine_batch AS SELECT public.create_manual_attendance_batch('a7100000-0000-4000-8000-000000000001','oneTime','a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000020') AS id;
CREATE TEMP TABLE combine_rows AS SELECT public.add_paper_attendance_row('a7100000-0000-4000-8000-000000000001',(SELECT id FROM combine_batch),'a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000021') AS target,
 public.add_paper_attendance_row('a7100000-0000-4000-8000-000000000001',(SELECT id FROM combine_batch),'a7000000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000022') AS source;
SELECT public.update_paper_scan_review_row((SELECT id FROM combine_batch),'a7100000-0000-4000-8000-000000000001',(SELECT target FROM combine_rows),'a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":0,"name":"Same confirmed person","decision":"include","attendanceIntervals":[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}],"identityConfirmed":true,"reviewAcknowledged":true}');
SELECT public.update_paper_scan_review_row((SELECT id FROM combine_batch),'a7100000-0000-4000-8000-000000000001',(SELECT source FROM combine_rows),'a7000000-0000-4000-8000-000000000001',
 '{"expectedRevision":0,"name":"Same confirmed person","decision":"include","attendanceIntervals":[{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}],"identityConfirmed":true,"reviewAcknowledged":true}');
CREATE TEMP TABLE combined_raw AS SELECT id,raw_extraction FROM public.project_paper_scan_rows WHERE batch_id=(SELECT id FROM combine_batch);
SELECT extensions.is(public.combine_paper_attendance_rows('a7100000-0000-4000-8000-000000000001',(SELECT id FROM combine_batch),'a7000000-0000-4000-8000-000000000001',(SELECT target FROM combine_rows),ARRAY[(SELECT source FROM combine_rows)],'a7500000-0000-4000-8000-000000000023'),(SELECT target FROM combine_rows),'combine keeps selected target');
SELECT extensions.is((SELECT jsonb_array_length(attendance_intervals) FROM public.project_paper_scan_rows WHERE id=(SELECT target FROM combine_rows)),2,'combine preserves both working intervals');
SELECT extensions.is((SELECT decision FROM public.project_paper_scan_rows WHERE id=(SELECT source FROM combine_rows)),'exclude','combine excludes source row atomically');
SELECT extensions.ok((SELECT NOT review_acknowledged FROM public.project_paper_scan_rows WHERE id=(SELECT target FROM combine_rows)),'combined hours require fresh review acknowledgement');
SELECT extensions.results_eq($$SELECT id,raw_extraction FROM public.project_paper_scan_rows WHERE batch_id=(SELECT id FROM combine_batch) ORDER BY id$$,$$SELECT id,raw_extraction FROM combined_raw ORDER BY id$$,'combine leaves raw provenance unchanged');
SELECT extensions.is(public.combine_paper_attendance_rows('a7100000-0000-4000-8000-000000000001',(SELECT id FROM combine_batch),'a7000000-0000-4000-8000-000000000001',(SELECT target FROM combine_rows),ARRAY[(SELECT source FROM combine_rows)],'a7500000-0000-4000-8000-000000000023'),(SELECT target FROM combine_rows),'combine retry does not append the intervals twice');

-- A person cannot earn overlapping sessions of the same project.
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,project_timezone) VALUES
 ('a7100000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001','Attendance session fixture','Local','Synthetic intervals','sameDayMultiArea','manual',
 '{"sameDayMultiArea":{"date":"2026-09-18","roles":[{"name":"Morning","startTime":"09:00","endTime":"12:00","volunteers":5},{"name":"Afternoon","startTime":"10:00","endTime":"13:00","volunteers":5}]}}',true,'upcoming','UTC');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
 ('a7200000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002','Morning','approved'),
 ('a7200000-0000-4000-8000-000000000003','a7100000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002','Afternoon','approved');
SELECT extensions.is(public.record_project_attendance('a7200000-0000-4000-8000-000000000002',0,'Reviewed morning',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T11:00:00Z"}]','a7500000-0000-4000-8000-000000000030','a7000000-0000-4000-8000-000000000001')->>'outcome','accepted','record attendance saves reviewed hours before publication');
SELECT extensions.throws_ok($$SELECT public.record_project_attendance('a7200000-0000-4000-8000-000000000003',0,'Overlapping afternoon',
 '[{"checkIn":"2026-09-18T10:00:00Z","checkOut":"2026-09-18T12:00:00Z"}]','a7500000-0000-4000-8000-000000000031','a7000000-0000-4000-8000-000000000001')$$,
 '22023','attendance_overlaps_another_session','same person cannot double-credit different sessions');
SELECT extensions.is((SELECT attendance_revision FROM public.project_signups WHERE id='a7200000-0000-4000-8000-000000000003'),0,'failed overlap leaves revision unchanged');
SELECT extensions.is(public.record_project_attendance('a7200000-0000-4000-8000-000000000003',0,'Reviewed afternoon',
 '[{"checkIn":"2026-09-18T11:00:00Z","checkOut":"2026-09-18T12:00:00Z"}]','a7500000-0000-4000-8000-000000000032','a7000000-0000-4000-8000-000000000001')->>'outcome','accepted','touching session boundaries are disjoint');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id='a7100000-0000-4000-8000-000000000002'),0,'recording before publication creates no award');

-- Recording an omitted digital attendee after publication issues one award.
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
 ('a7200000-0000-4000-8000-000000000004','a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000003','oneTime','approved');
CREATE TEMP TABLE late_digital AS SELECT public.record_project_attendance('a7200000-0000-4000-8000-000000000004',0,'Reviewed late attendance',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000033','a7000000-0000-4000-8000-000000000001') AS result;
SELECT extensions.ok((SELECT result->>'certificateId' IS NOT NULL FROM late_digital),'late digital attendance returns certificate identity');
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000004'),120,'late digital attendance uses interval sum');
SELECT public.record_project_attendance('a7200000-0000-4000-8000-000000000004',0,'Reviewed late attendance',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000033','a7000000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000004'),1,'late digital retry creates no second certificate');
SELECT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox WHERE certificate_id=(SELECT id FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000004')),1,'late digital retry creates no second delivery');

-- Replaying old reviewed attendance must not undo a later rejection.
UPDATE public.project_signups SET status='rejected' WHERE id='a7200000-0000-4000-8000-000000000004';
SELECT public.record_project_attendance('a7200000-0000-4000-8000-000000000004',0,'Reviewed late attendance',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000033','a7000000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT status FROM public.project_signups WHERE id='a7200000-0000-4000-8000-000000000004'),'rejected','record replay cannot resurrect a rejected participant');

SELECT extensions.ok(NOT has_function_privilege('authenticated','public.request_corrected_certificate_delivery(uuid,uuid,integer,uuid,uuid)','EXECUTE'),'corrected email request is service-only');
CREATE TEMP TABLE corrected_delivery AS SELECT public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000040','a7000000-0000-4000-8000-000000000001') AS result;
SELECT extensions.is((SELECT result->>'outcome' FROM corrected_delivery),'accepted','explicit send creates a correction receipt');
SELECT extensions.is((SELECT result->'deliveries'->0->>'creditedMinutes' FROM corrected_delivery),'150','explicit correction email snapshots canonical minutes');
SELECT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox WHERE certificate_id=(SELECT id FROM before_correction)),2,'correction creates a separate delivery from original publication');
SELECT extensions.is((SELECT count(DISTINCT idempotency_key)::integer FROM public.hours_publication_email_outbox WHERE certificate_id=(SELECT id FROM before_correction)),2,'correction has a separate provider idempotency key');
SELECT extensions.is(public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000040','a7000000-0000-4000-8000-000000000001')->>'receiptId',(SELECT result->>'receiptId' FROM corrected_delivery),'explicit correction send retry uses the same receipt');
SELECT extensions.is(public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000041','a7000000-0000-4000-8000-000000000001')->>'receiptId',(SELECT result->>'receiptId' FROM corrected_delivery),'a second click cannot duplicate one correction revision');
SELECT extensions.throws_ok($$SELECT public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000042','a7000000-0000-4000-8000-000000000003')$$,'42501','not authorized to send corrected certificate','outsider cannot queue a corrected certificate');
SELECT extensions.throws_ok($$UPDATE public.hours_publication_email_outbox SET certificate_snapshot='{}' WHERE receipt_id=((SELECT result->>'receiptId' FROM corrected_delivery)::uuid)$$,
 '22023','certificate delivery identity and snapshot are immutable','delivery snapshot cannot change after explicit request');
SELECT public.correct_project_attendance('a7200000-0000-4000-8000-000000000001',2,'Second source review',
 '[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T11:00:00Z"},{"checkIn":"2026-09-18T12:00:00Z","checkOut":"2026-09-18T13:00:00Z"}]',
 'a7500000-0000-4000-8000-000000000043','a7000000-0000-4000-8000-000000000001');
SELECT extensions.is(public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000040','a7000000-0000-4000-8000-000000000001')->'deliveries'->0->>'creditedMinutes','150','lost-response recovery preserves the original requested revision');
SELECT extensions.is(public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000041','a7000000-0000-4000-8000-000000000001')->'deliveries'->0->>'creditedMinutes','150','a deduplicated request also replays after a later correction');
SELECT extensions.throws_ok($$SELECT public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),3,
 'a7500000-0000-4000-8000-000000000040','a7000000-0000-4000-8000-000000000001')$$,'22023','corrected certificate request key reused','reusing a send request for different hours fails');
SELECT extensions.throws_ok($$SELECT public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),2,
 'a7500000-0000-4000-8000-000000000044','a7000000-0000-4000-8000-000000000001')$$,'40001','certificate changed; refresh before sending','a new stale send request cannot dispatch old hours');
SELECT extensions.is(public.request_corrected_certificate_delivery('a7100000-0000-4000-8000-000000000001',(SELECT id FROM before_correction),3,
 'a7500000-0000-4000-8000-000000000045','a7000000-0000-4000-8000-000000000001')->'deliveries'->0->>'creditedMinutes','180','a new explicit revision receives its own canonical snapshot');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE signup_id='a7200000-0000-4000-8000-000000000001'),1,'multiple correction sends retain one certificate');

SELECT extensions.ok(NOT has_function_privilege('authenticated','public.project_corrected_certificate_ids(uuid,uuid)','EXECUTE'),'corrected award discovery denies browser roles');
SELECT extensions.is(public.project_corrected_certificate_ids('a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001'),ARRAY[(SELECT id FROM before_correction)],'only corrected awards appear in explicit resend controls');
SELECT extensions.is(public.project_corrected_certificate_ids('a7100000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001'),ARRAY[]::uuid[],'unpublished project has no corrected certificate controls');
SELECT extensions.throws_ok($$SELECT public.project_corrected_certificate_ids('a7100000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000003')$$,'42501','not authorized to read corrected certificates','outsider cannot discover corrected awards');

SELECT * FROM extensions.finish();
ROLLBACK;
