BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('bd100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','batch-finalize-'||n||'@local.test',now(),'{}',jsonb_build_object('username','batch_finalize_'||n),now(),now() FROM generate_series(1,2) n;
CREATE TEMP TABLE batch_fixtures(kind text,project uuid,batch uuid,saved uuid,first_pending uuid,last_pending uuid,request uuid);
CREATE FUNCTION pg_temp.create_batch_fixture(p_kind text,p_saved boolean DEFAULT true,p_roster boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,published)
 VALUES(p,'bd100000-0000-4000-8000-000000000001','Batch finalization fixture','Local','Synthetic review lifecycle','oneTime','manual','{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"12:00","volunteers":10}}','upcoming','UTC','{"oneTime":true}');
 INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count)
 VALUES(b,p,'oneTime','bd100000-0000-4000-8000-000000000001','review',1);
 INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,email,decision,attendance_intervals,review_acknowledged,identity_confirmed) VALUES
 (s,b,p,1,'{"source":"saved sheet row"}','Saved volunteer',CASE WHEN p_roster THEN NULL ELSE 'saved-'||p_kind||'@local.test' END,'include','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',true,true),
 (f,b,p,2,'{"source":"first unresolved sheet row"}','Unresolved volunteer','unresolved-'||p_kind||'@local.test','include','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":null}]',true,true),
 (l,b,p,3,'{"source":"last unresolved sheet row"}','Unresolved volunteer','unresolved-'||p_kind||'@local.test','include','[{"checkIn":null,"checkOut":"2020-09-18T10:00:00Z"}]',false,true);
 IF p_saved THEN
  PERFORM * FROM public.commit_paper_signup_batch(b,'bd100000-0000-4000-8000-000000000001',ARRAY[s,f,l],false,request);
 ELSE
  DELETE FROM public.project_paper_scan_rows WHERE id=s;
 END IF;
 INSERT INTO batch_fixtures VALUES(p_kind,p,b,s,f,l,request);
END; $$;
CREATE FUNCTION pg_temp.patch(p_kind text,p_row text,p_patch jsonb,p_actor uuid DEFAULT 'bd100000-0000-4000-8000-000000000001') RETURNS text LANGUAGE sql AS $$
 SELECT public.update_paper_scan_review_row(f.batch,f.project,CASE p_row WHEN 'first' THEN f.first_pending WHEN 'last' THEN f.last_pending ELSE f.saved END,p_actor,p_patch) FROM batch_fixtures f WHERE f.kind=p_kind;
$$;
CREATE FUNCTION pg_temp.awards(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'signups',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.project_signups s WHERE s.project_id=p_project),
  'intervals',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_attendance_intervals i WHERE i.project_id=p_project),
  'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id=p_project),
  'deliveries',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.project_id=p_project));
$$;
SELECT pg_temp.create_batch_fixture('partial');
CREATE TEMP TABLE partial_awards AS SELECT pg_temp.awards(project) AS value FROM batch_fixtures WHERE kind='partial';
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='partial')),'review','partial save keeps failed rows editable');
SELECT extensions.is(pg_temp.patch('partial','first','{"expectedRevision":0,"decision":"exclude"}'),'updated','coordinator excludes the first failure');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='partial')),'review','another unresolved row keeps the batch in review');
SELECT extensions.throws_ok($$SELECT pg_temp.patch('partial','last','{"expectedRevision":0,"decision":"exclude"}','bd100000-0000-4000-8000-000000000002')$$,'P0001','update_paper_scan_review_row: actor is not a project organizer','outsider cannot finalize a saved batch');
SELECT extensions.throws_ok($$SELECT pg_temp.patch('partial','first','{"expectedRevision":0,"decision":"include"}')$$,'40001','review row changed; refresh before saving','stale exclusion edits fail before changing batch state');
SELECT extensions.is(pg_temp.patch('partial','last','{"expectedRevision":0,"decision":"exclude"}'),'updated','coordinator excludes the final failure');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='partial')),'committed','last exclusion finalizes the partially saved batch');
SELECT extensions.ok((SELECT committed_row_count=1 AND roster_row_count=0 AND committed_at IS NOT NULL FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='partial')),'finalization retains saved counters and timestamp');
SELECT extensions.throws_ok($$SELECT pg_temp.patch('partial','last','{"expectedRevision":0,"decision":"exclude"}')$$,'40001','review row changed; refresh before saving','stale retry remains a revision conflict after finalization');
SELECT extensions.is(pg_temp.patch('partial','last','{"expectedRevision":1,"decision":"include"}'),'not_review','a fresh edit cannot reopen an excluded terminal row');
SELECT extensions.is((SELECT count(*)::integer FROM batch_fixtures f CROSS JOIN LATERAL public.commit_paper_signup_batch(f.batch,'bd100000-0000-4000-8000-000000000001',ARRAY[f.saved,f.first_pending,f.last_pending],false,f.request) result WHERE f.kind='partial'),3,'original partial commit receipt still replays all results');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='partial')),'committed','old commit receipt cannot reopen finalized review');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(batch,project,'bd100000-0000-4000-8000-000000000001') FROM batch_fixtures WHERE kind='partial'),'committed','saved attendance remains protected from discard');
SELECT extensions.is((SELECT pg_temp.awards(project) FROM batch_fixtures WHERE kind='partial'),(SELECT value FROM partial_awards),'exclusion, retries, and discard refusal preserve all attendance and credit');

SELECT pg_temp.create_batch_fixture('roster',true,true);
SELECT pg_temp.patch('roster','first','{"expectedRevision":0,"decision":"exclude"}');
SELECT pg_temp.patch('roster','last','{"expectedRevision":0,"decision":"exclude"}');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='roster')),'committed','saved uncredited roster also allows batch finalization');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_paper_roster_entries WHERE batch_id=(SELECT batch FROM batch_fixtures WHERE kind='roster')),1,'finalization retains the unresolved roster identity');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id=(SELECT project FROM batch_fixtures WHERE kind='roster')),0,'finalizing a roster-only batch awards no credit');
SELECT extensions.is(pg_temp.patch('roster','saved','{"expectedRevision":0,"email":"resolved-roster@local.test"}'),'updated','saved roster identity can still reopen for resolution');
CREATE TEMP TABLE reopened_extra AS SELECT public.add_paper_attendance_row(project,batch,'bd100000-0000-4000-8000-000000000001',gen_random_uuid()) AS id FROM batch_fixtures WHERE kind='roster';
SELECT public.update_paper_scan_review_row(f.batch,f.project,e.id,'bd100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}') FROM batch_fixtures f CROSS JOIN reopened_extra e WHERE f.kind='roster';
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='roster')),'review','excluding another row does not finalize a pending roster resolution');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(batch,project,'bd100000-0000-4000-8000-000000000001') FROM batch_fixtures WHERE kind='roster'),'committed','reopened roster resolution remains protected from discard');

SELECT pg_temp.create_batch_fixture('unsaved',false);
SELECT pg_temp.patch('unsaved','first','{"expectedRevision":0,"decision":"exclude"}');
SELECT pg_temp.patch('unsaved','last','{"expectedRevision":0,"decision":"exclude"}');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='unsaved')),'review','all-excluded unsaved draft is not labeled committed');
SELECT extensions.is((SELECT count(*)::integer FROM batch_fixtures f CROSS JOIN LATERAL public.commit_paper_signup_batch(f.batch,'bd100000-0000-4000-8000-000000000001',ARRAY[f.first_pending,f.last_pending],false,f.request) result WHERE f.kind='unsaved'),0,'commit over concurrently excluded rows saves nothing');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='unsaved')),'review','empty commit keeps the unsaved draft discardable');
SELECT extensions.is((SELECT count(*)::integer FROM batch_fixtures f CROSS JOIN LATERAL public.commit_paper_signup_batch(f.batch,'bd100000-0000-4000-8000-000000000001',ARRAY[f.first_pending,f.last_pending],false,f.request) result WHERE f.kind='unsaved'),0,'empty commit retries without saving attendance');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(batch,project,'bd100000-0000-4000-8000-000000000001') FROM batch_fixtures WHERE kind='unsaved'),'discarded','all-excluded unsaved draft remains discardable after retries');

SELECT pg_temp.create_batch_fixture('combined');
SELECT pg_temp.patch('combined','first','{"expectedRevision":0,"decision":"exclude"}');
CREATE TEMP TABLE combine_request AS SELECT gen_random_uuid() AS id;
SELECT extensions.is((SELECT public.combine_paper_attendance_rows(f.project,f.batch,'bd100000-0000-4000-8000-000000000001',f.first_pending,ARRAY[f.last_pending],r.id) FROM batch_fixtures f CROSS JOIN combine_request r WHERE f.kind='combined'),(SELECT first_pending FROM batch_fixtures WHERE kind='combined'),'explicit combine keeps excluded target identity');
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='combined')),'committed','combine finalizes a saved batch when all remaining rows are excluded');
SELECT extensions.ok((SELECT jsonb_array_length(attendance_intervals)=2 AND NOT review_acknowledged FROM public.project_paper_scan_rows WHERE id=(SELECT first_pending FROM batch_fixtures WHERE kind='combined')),'combined intervals stay unreviewed and retain missing endpoints');
SELECT extensions.is((SELECT raw_extraction->>'source' FROM public.project_paper_scan_rows WHERE id=(SELECT last_pending FROM batch_fixtures WHERE kind='combined')),'last unresolved sheet row','combine retains original source evidence');
SELECT extensions.is((SELECT public.combine_paper_attendance_rows(f.project,f.batch,'bd100000-0000-4000-8000-000000000001',f.first_pending,ARRAY[f.last_pending],r.id) FROM batch_fixtures f CROSS JOIN combine_request r WHERE f.kind='combined'),(SELECT first_pending FROM batch_fixtures WHERE kind='combined'),'combine receipt replays after batch finalization');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(batch,project,'bd100000-0000-4000-8000-000000000001') FROM batch_fixtures WHERE kind='combined'),'committed','combined terminal batch retains saved attendance');

SELECT pg_temp.create_batch_fixture('combined_review');
SELECT public.combine_paper_attendance_rows(project,batch,'bd100000-0000-4000-8000-000000000001',first_pending,ARRAY[last_pending],gen_random_uuid()) FROM batch_fixtures WHERE kind='combined_review';
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='combined_review')),'review','combine keeps an included target in review');
SELECT extensions.ok((SELECT outcome='pending' AND NOT review_acknowledged FROM public.project_paper_scan_rows WHERE id=(SELECT first_pending FROM batch_fixtures WHERE kind='combined_review')),'included combined target still requires review');
SELECT pg_temp.create_batch_fixture('unsaved_combined',false);
SELECT pg_temp.patch('unsaved_combined','first','{"expectedRevision":0,"decision":"exclude"}');
SELECT public.combine_paper_attendance_rows(project,batch,'bd100000-0000-4000-8000-000000000001',first_pending,ARRAY[last_pending],gen_random_uuid()) FROM batch_fixtures WHERE kind='unsaved_combined';
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='unsaved_combined')),'review','combining wholly unsaved excluded rows does not finalize attendance');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(batch,project,'bd100000-0000-4000-8000-000000000001') FROM batch_fixtures WHERE kind='unsaved_combined'),'discarded','wholly unsaved combined rows remain discardable');
SELECT pg_temp.create_batch_fixture('reconciled',true,true);
CREATE TEMP TABLE reconciliation_signup AS SELECT gen_random_uuid() AS id;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) SELECT r.id,f.project,'bd100000-0000-4000-8000-000000000002','oneTime','approved' FROM batch_fixtures f CROSS JOIN reconciliation_signup r WHERE f.kind='reconciled';
SELECT public.record_project_attendance(id,0,'Existing attendance entered through Hours','[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',gen_random_uuid(),'bd100000-0000-4000-8000-000000000001') FROM reconciliation_signup;
CREATE TEMP TABLE reconciled_awards AS SELECT pg_temp.awards(project) AS value FROM batch_fixtures WHERE kind='reconciled';
SELECT pg_temp.patch('reconciled','saved',jsonb_build_object('expectedRevision',0,'matchSignupId',id,'reviewAcknowledged',true,'identityConfirmed',true)) FROM reconciliation_signup;
SELECT extensions.is((SELECT result.outcome FROM batch_fixtures f CROSS JOIN LATERAL public.commit_paper_signup_batch(f.batch,'bd100000-0000-4000-8000-000000000001',ARRAY[f.saved],false,gen_random_uuid()) result WHERE f.kind='reconciled'),'skipped','saved roster reconciles to an existing authoritative award');
SELECT extensions.ok((SELECT outcome='skipped' AND committed_signup_id=(SELECT id FROM reconciliation_signup) FROM public.project_paper_scan_rows WHERE id=(SELECT saved FROM batch_fixtures WHERE kind='reconciled')),'reconciliation retains a durable signup pointer without a primary saved row');
SELECT pg_temp.patch('reconciled','first','{"expectedRevision":0,"decision":"exclude"}');
SELECT pg_temp.patch('reconciled','last','{"expectedRevision":0,"decision":"exclude"}');
SELECT extensions.ok((SELECT status='committed' AND committed_row_count=0 AND roster_row_count=0 FROM public.project_paper_scan_batches WHERE id=(SELECT batch FROM batch_fixtures WHERE kind='reconciled')),'durable reconciled pointer finalizes without inventing a newly saved row');
SELECT extensions.is((SELECT public.discard_paper_scan_batch(batch,project,'bd100000-0000-4000-8000-000000000001') FROM batch_fixtures WHERE kind='reconciled'),'committed','reconciled source evidence cannot be discarded');
SELECT extensions.is((SELECT pg_temp.awards(project) FROM batch_fixtures WHERE kind='reconciled'),(SELECT value FROM reconciled_awards),'reconciliation finalization preserves existing attendance, certificate, and delivery');
SELECT * FROM extensions.finish();
ROLLBACK;
