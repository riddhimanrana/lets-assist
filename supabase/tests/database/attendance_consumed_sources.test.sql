-- Combine receipts prevent a source row from producing attendance twice.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('c8100000-0000-4000-8000-000000000001','authenticated','authenticated','consumed-owner@local.test',now(),'{}','{"username":"consumed_owner"}',now(),now());
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
VALUES('c8200000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000001','Consumed source fixture','Local','Synthetic attendance','oneTime','manual','{"oneTime":{"date":"2021-08-11","startTime":"09:00","endTime":"15:00","volunteers":10}}','upcoming','UTC');
CREATE TEMP TABLE test_batch AS SELECT public.create_manual_attendance_batch('c8200000-0000-4000-8000-000000000001','oneTime','c8100000-0000-4000-8000-000000000001','c8500000-0000-4000-8000-000000000001') AS id;
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,decision,attendance_intervals,review_acknowledged,identity_confirmed)
SELECT ('c8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(SELECT id FROM test_batch),'c8200000-0000-4000-8000-000000000001',n,'{}','Synthetic same person',CASE WHEN n=1 THEN 'exclude' ELSE 'include' END,
 jsonb_build_array(jsonb_build_object('checkIn','2021-08-11T'||lpad((8+n)::text,2,'0')||':00:00Z','checkOut','2021-08-11T'||lpad((9+n)::text,2,'0')||':00:00Z')),true,true
FROM generate_series(1,3) n;
GRANT SELECT ON test_batch TO service_role;
CREATE TEMP TABLE other_batch AS SELECT public.create_manual_attendance_batch('c8200000-0000-4000-8000-000000000001','oneTime','c8100000-0000-4000-8000-000000000001','c8500000-0000-4000-8000-000000000099') AS id;
GRANT SELECT ON other_batch TO service_role;

SELECT extensions.ok(NOT has_function_privilege('anon','private.paper_attendance_row_consumed(uuid,uuid,uuid)','execute')
 AND NOT has_function_privilege('authenticated','private.paper_attendance_row_consumed(uuid,uuid,uuid)','execute')
 AND NOT has_function_privilege('service_role','private.paper_attendance_row_consumed(uuid,uuid,uuid)','execute'),'consumption lookup is owner-only');
SET LOCAL ROLE service_role;
SELECT extensions.is(public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000001',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000002'),
 'c8400000-0000-4000-8000-000000000001'::uuid,'excluded unsaved target can still combine');
SELECT extensions.is(public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000001',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000002'),
 'c8400000-0000-4000-8000-000000000001'::uuid,'exact retry returns the original target');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000003',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000003')$$,
 '22023','attendance row already combined','another target cannot consume the same source');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000002',ARRAY['c8400000-0000-4000-8000-000000000003']::uuid[],'c8500000-0000-4000-8000-000000000004')$$,
 '22023','attendance row already combined','a consumed source cannot become a target');
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row((SELECT id FROM test_batch),'c8200000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000002','c8100000-0000-4000-8000-000000000001','{"expectedRevision":1,"decision":"include","reviewAcknowledged":true}')$$,
 '22023','attendance row already combined','review cannot reactivate a consumed source');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000003',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000002')$$,
 '22023','combine request key reused','changed retry payload is refused');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM other_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000001',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000002')$$,
 '22023','combine request key reused','retry cannot change its batch scope');
RESET ROLE;
SELECT extensions.is((SELECT count(*)::int FROM private.paper_attendance_review_operations WHERE batch_id=(SELECT id FROM test_batch)),1,'one durable combine receipt exists');
SELECT extensions.is((SELECT jsonb_array_length(attendance_intervals) FROM public.project_paper_scan_rows WHERE id='c8400000-0000-4000-8000-000000000001'),2,'retry and refused combine do not append intervals');

-- Reproduce a source reactivated by the previous review implementation.
UPDATE public.project_paper_scan_rows SET decision='include',outcome='pending',outcome_detail=NULL,review_acknowledged=true WHERE id='c8400000-0000-4000-8000-000000000002';
CREATE TEMP TABLE before_commit AS SELECT to_jsonb(r) AS row_state,to_jsonb(b) AS batch_state FROM public.project_paper_scan_rows r JOIN public.project_paper_scan_batches b ON b.id=r.batch_id WHERE r.id='c8400000-0000-4000-8000-000000000002';
GRANT SELECT ON test_batch, before_commit TO service_role;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000003',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000005')$$,
 '22023','attendance row already combined','receipt protects a source with an erased display marker');
SELECT extensions.throws_ok($$SELECT * FROM public.commit_paper_signup_batch((SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],false,'c8500000-0000-4000-8000-000000000006')$$,
 '22023','attendance row already combined','commit rejects a legacy reactivated source');
RESET ROLE;
SELECT extensions.ok((SELECT to_jsonb(r)=prior.row_state AND to_jsonb(b)=prior.batch_state FROM public.project_paper_scan_rows r JOIN public.project_paper_scan_batches b ON b.id=r.batch_id CROSS JOIN before_commit prior WHERE r.id='c8400000-0000-4000-8000-000000000002'),'refused commit preserves row and batch state');
SELECT extensions.is((SELECT count(*)::int FROM private.paper_attendance_commit_receipts WHERE batch_id=(SELECT id FROM test_batch)),0,'refused commit leaves no receipt');
SELECT extensions.is((SELECT count(*)::int FROM public.project_paper_roster_entries WHERE batch_id=(SELECT id FROM test_batch)),0,'refused commit creates no roster attendance');
SELECT extensions.is((SELECT count(*)::int FROM public.certificates WHERE project_id='c8200000-0000-4000-8000-000000000001'),0,'refused commit creates no award');
UPDATE public.project_paper_scan_rows SET decision='exclude' WHERE id='c8400000-0000-4000-8000-000000000002';
SELECT public.update_paper_scan_review_row((SELECT id FROM test_batch),'c8200000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000001','{"expectedRevision":1,"decision":"include","reviewAcknowledged":true}');
SELECT public.update_paper_scan_review_row((SELECT id FROM test_batch),'c8200000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000003','c8100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}');
SELECT extensions.is((SELECT outcome FROM public.commit_paper_signup_batch((SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001',ARRAY['c8400000-0000-4000-8000-000000000001']::uuid[],false,'c8500000-0000-4000-8000-000000000007')),'roster_only','combined target saves normally after review');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT id FROM test_batch)),'committed','batch finalizes after target save');
SELECT extensions.is(public.combine_paper_attendance_rows('c8200000-0000-4000-8000-000000000001',(SELECT id FROM test_batch),'c8100000-0000-4000-8000-000000000001','c8400000-0000-4000-8000-000000000001',ARRAY['c8400000-0000-4000-8000-000000000002']::uuid[],'c8500000-0000-4000-8000-000000000002'),
 'c8400000-0000-4000-8000-000000000001'::uuid,'exact combine retry survives finalization');
SELECT * FROM extensions.finish();
ROLLBACK;
