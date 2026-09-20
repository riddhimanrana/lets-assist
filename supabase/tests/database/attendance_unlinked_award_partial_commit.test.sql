BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('b9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','partial-legacy-'||n||'@local.test',now(),'{}',jsonb_build_object('username','partial_legacy_'||n),now(),now() FROM generate_series(1,5) n;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,published) VALUES
 ('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','Unlinked award partial fixture','Local','Synthetic historical award','oneTime','manual','{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"15:00","volunteers":20}}','upcoming','UTC','{"oneTime":true}');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
SELECT ('b9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b9200000-0000-4000-8000-000000000001',('b9100000-0000-4000-8000-'||lpad((n+1)::text,12,'0'))::uuid,'oneTime','approved' FROM generate_series(1,4) n;
INSERT INTO public.certificates(id,project_id,user_id,project_title,volunteer_name,volunteer_email,event_start,event_end,is_certified,type,check_in_method,schedule_id)
VALUES('b9400000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000003','Historical project title','Historical volunteer','partial-legacy-3@local.test','2020-09-18T09:00:00Z','2020-09-18T13:00:00Z',false,NULL,'manual','oneTime');
CREATE TEMP TABLE original_award AS SELECT to_jsonb(certificates) AS snapshot FROM public.certificates WHERE id='b9400000-0000-4000-8000-000000000001';
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count) VALUES
 ('b9500000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','oneTime','b9100000-0000-4000-8000-000000000001','review',1);
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,decision,match_signup_id,attendance_intervals,review_acknowledged,identity_confirmed)
SELECT ('b9600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b9500000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001',n,jsonb_build_object('source','Fictional handwritten sheet','row',n),'Reviewed volunteer','include',('b9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',true,true FROM generate_series(1,3) n;
CREATE TEMP TABLE original_unresolved AS SELECT to_jsonb(rows) AS snapshot FROM public.project_paper_scan_rows rows WHERE id='b9600000-0000-4000-8000-000000000002';
CREATE TEMP TABLE first_partial AS SELECT * FROM public.commit_paper_signup_batch('b9500000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',ARRAY['b9600000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000002','b9600000-0000-4000-8000-000000000003']::uuid[],false,'b9700000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT outcome FROM first_partial WHERE row_id='b9600000-0000-4000-8000-000000000001'),'signup_updated','valid row saves despite a later unlinked historical award');
SELECT extensions.is((SELECT outcome FROM first_partial WHERE row_id='b9600000-0000-4000-8000-000000000003'),'signup_updated','valid row after the orphan still saves');
SELECT extensions.is((SELECT detail FROM first_partial WHERE row_id='b9600000-0000-4000-8000-000000000002'),'unlinked_platform_award_requires_reconciliation','legacy row returns an actionable reconciliation problem');
SELECT extensions.ok((SELECT outcome='failed' AND signup_id IS NULL AND user_id IS NULL AND anonymous_id IS NULL FROM first_partial WHERE row_id='b9600000-0000-4000-8000-000000000002'),'unresolved legacy row reports no saved attendance');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id='b9500000-0000-4000-8000-000000000001'),'review','partially saved batch remains reviewable');
SELECT extensions.is((SELECT committed_row_count FROM public.project_paper_scan_batches WHERE id='b9500000-0000-4000-8000-000000000001'),2,'batch counts both valid rows');
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE signup_id='b9300000-0000-4000-8000-000000000001'),60,'valid attendee receives the reviewed credit once');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id='b9200000-0000-4000-8000-000000000001'),3,'two new awards plus one historical award remain');
SELECT extensions.is((SELECT count(*)::integer FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.project_id='b9200000-0000-4000-8000-000000000001'),2,'only the newly credited attendees have deliveries');
SELECT extensions.is((SELECT to_jsonb(certificates) FROM public.certificates WHERE id='b9400000-0000-4000-8000-000000000001'),(SELECT snapshot FROM original_award),'unlinked award snapshot and URL remain unchanged');
SELECT extensions.ok((SELECT status='approved' AND attendance_revision=0 AND check_in_time IS NULL AND check_out_time IS NULL FROM public.project_signups WHERE id='b9300000-0000-4000-8000-000000000002'),'failed row leaves signup status, summaries and revision unchanged');
SELECT extensions.is(private.signup_attendance_intervals('b9300000-0000-4000-8000-000000000002'),'[]'::jsonb,'failed row leaves no canonical intervals');
SELECT extensions.ok((SELECT rows.raw_extraction=prior.snapshot->'raw_extraction' AND rows.attendance_intervals=prior.snapshot->'attendance_intervals' AND rows.review_acknowledged AND rows.identity_confirmed AND rows.committed_signup_id IS NULL AND rows.decision='include' FROM public.project_paper_scan_rows rows CROSS JOIN original_unresolved prior WHERE rows.id='b9600000-0000-4000-8000-000000000002'),'unresolved row retains source, reviewed transcription and confirmed identity');
CREATE TEMP TABLE saved_state AS SELECT to_jsonb(s) AS signup,to_jsonb(c) AS certificate,to_jsonb(o) AS outbox FROM public.project_signups s JOIN public.certificates c ON c.signup_id=s.id JOIN public.hours_publication_email_outbox o ON o.certificate_id=c.id WHERE s.id IN ('b9300000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000003');
SELECT extensions.results_eq($$SELECT * FROM public.commit_paper_signup_batch('b9500000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',ARRAY['b9600000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000002','b9600000-0000-4000-8000-000000000003']::uuid[],false,'b9700000-0000-4000-8000-000000000001')$$,$$SELECT * FROM first_partial$$,'same request replays saved and unresolved outcomes');
SELECT extensions.results_eq($$SELECT * FROM public.commit_paper_signup_batch('b9500000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',ARRAY['b9600000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000002','b9600000-0000-4000-8000-000000000003']::uuid[],false,'b9700000-0000-4000-8000-000000000002')$$,$$SELECT * FROM first_partial$$,'new request retries unresolved row without recrediting saved attendees');
SELECT extensions.ok((SELECT bool_and(to_jsonb(s)=prior.signup AND to_jsonb(c)=prior.certificate AND to_jsonb(o)=prior.outbox) FROM public.project_signups s JOIN public.certificates c ON c.signup_id=s.id JOIN public.hours_publication_email_outbox o ON o.certificate_id=c.id JOIN saved_state prior ON s.id=(prior.signup->>'id')::uuid),'retry preserves complete signup, award and delivery records');
SELECT extensions.is((SELECT count(*)::integer FROM private.paper_attendance_commit_receipts WHERE batch_id='b9500000-0000-4000-8000-000000000001'),2,'each distinct request has one durable receipt');
SELECT extensions.is(public.update_paper_scan_review_row('b9500000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000001','{"expectedRevision":0,"name":"Clarified historical volunteer"}'),'updated','unresolved legacy row remains editable after partial save');

-- A real, unrelated unique constraint failure must still abort the request.
CREATE TEMP TABLE unexpected_duplicate(id integer PRIMARY KEY);
INSERT INTO unexpected_duplicate VALUES(1);
CREATE FUNCTION pg_temp.reject_unexpected_signup_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='b9300000-0000-4000-8000-000000000004' THEN INSERT INTO unexpected_duplicate VALUES(1); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER test_unexpected_unique BEFORE UPDATE OF check_in_time ON public.project_signups FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_unexpected_signup_update();
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count) VALUES
 ('b9500000-0000-4000-8000-000000000002','b9200000-0000-4000-8000-000000000001','oneTime','b9100000-0000-4000-8000-000000000001','review',1);
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,email,decision,match_signup_id,attendance_intervals,review_acknowledged,identity_confirmed) VALUES
 ('b9600000-0000-4000-8000-000000000004','b9500000-0000-4000-8000-000000000002','b9200000-0000-4000-8000-000000000001',1,'{}','Synthetic guest','partial-unexpected-guest@local.test','include',NULL,'[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',true,true),
 ('b9600000-0000-4000-8000-000000000005','b9500000-0000-4000-8000-000000000002','b9200000-0000-4000-8000-000000000001',2,'{}','Unexpected constraint',NULL,'include','b9300000-0000-4000-8000-000000000004','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',true,true);
SELECT extensions.throws_ok($$SELECT * FROM public.commit_paper_signup_batch('b9500000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000001',ARRAY['b9600000-0000-4000-8000-000000000004','b9600000-0000-4000-8000-000000000005']::uuid[],false,'b9700000-0000-4000-8000-000000000003')$$,'23505','duplicate key value violates unique constraint "unexpected_duplicate_pkey"','unexpected unique violation still escapes the row handler');
SELECT extensions.is((SELECT count(*)::integer FROM private.paper_attendance_commit_receipts WHERE request_id='b9700000-0000-4000-8000-000000000003'),0,'unexpected failure creates no successful receipt');
SELECT extensions.is((SELECT count(*)::integer FROM public.anonymous_signups WHERE project_id='b9200000-0000-4000-8000-000000000001' AND email='partial-unexpected-guest@local.test'),0,'unexpected failure rolls back the earlier guest identity');
SELECT extensions.ok((SELECT bool_and(outcome='pending' AND committed_signup_id IS NULL) FROM public.project_paper_scan_rows WHERE batch_id='b9500000-0000-4000-8000-000000000002'),'unexpected failure rolls back every working row');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id='b9200000-0000-4000-8000-000000000001'),3,'unexpected failure adds no award');
SELECT extensions.is((SELECT to_jsonb(certificates) FROM public.certificates WHERE id='b9400000-0000-4000-8000-000000000001'),(SELECT snapshot FROM original_award),'all retries and failures preserve the historical award');
SELECT * FROM extensions.finish();
ROLLBACK;
