BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(38);
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.delete_old_anonymous_signups()','EXECUTE')
 AND NOT has_function_privilege('anon','public.archive_anonymous_signups_for_cleanup(uuid[])','EXECUTE')
 AND has_function_privilege('service_role','public.delete_old_anonymous_signups()','EXECUTE'),
 'only the server role can invoke retention entry points');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('fb940000-0000-4000-8000-000000000001','authenticated','authenticated','retention-owner@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,
 schedule,require_login,status,project_timezone,cancelled_at)
SELECT ('fb950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'fb940000-0000-4000-8000-000000000001','Synthetic retention project','Local','Fictional retention fixture',
 'oneTime','manual',jsonb_build_object('oneTime',jsonb_build_object('date',
 CASE WHEN n=3 THEN '2100-01-01' WHEN n=9 THEN to_char((now()-interval '30 days'+interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE '2000-01-01' END,
 'startTime','00:00','endTime',CASE WHEN n=9 THEN greatest('00:01',to_char(
 (now()-interval '30 days'+interval '1 hour') AT TIME ZONE 'UTC','HH24:MI')) ELSE '01:00' END,'volunteers',100)),
 false,CASE WHEN n=2 THEN 'upcoming' WHEN n IN(5,6) THEN 'cancelled' ELSE 'completed' END,'UTC',
 CASE WHEN n=5 THEN now()-interval '40 days' WHEN n=6 THEN now()-interval '5 days' END
FROM generate_series(1,9)n;
UPDATE public.projects SET event_type='multiDay',schedule=jsonb_build_object('multiDay',
 '[{"date":"2000-01-01","slots":[{"id":"old","startTime":"09:00","endTime":"10:00","volunteers":5}]},{"date":"2100-01-01","slots":[{"id":"future","startTime":"09:00","endTime":"10:00","volunteers":5}]}]'::jsonb)
 WHERE id='fb950000-0000-4000-8000-000000000007';
UPDATE public.projects SET event_type='sameDayMultiArea',schedule=
 '{"sameDayMultiArea":{"date":"2000-01-01","overallStart":"09:00","overallEnd":"10:00","roles":[{"id":"role","name":"Help","startTime":"09:00","endTime":"10:00","volunteers":5}]}}'
 WHERE id='fb950000-0000-4000-8000-000000000008';
-- Model an existing invalid legacy record without weakening the publication guard.
ALTER TABLE public.projects DISABLE TRIGGER validate_published_project_schedule;
UPDATE public.projects SET schedule='{}' WHERE id='fb950000-0000-4000-8000-000000000004';
ALTER TABLE public.projects ENABLE TRIGGER validate_published_project_schedule;

CREATE TEMP TABLE retention_cases(n integer,id uuid,expected boolean,label text);
INSERT INTO retention_cases SELECT n,('fb960000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,expected,label
FROM(VALUES
 (1,true,'completed validated old project'),(2,false,'upcoming project with an old date'),
 (3,false,'completed project with a future date'),(4,false,'malformed legacy schedule'),
 (5,true,'old confirmed cancellation'),(6,false,'recent cancellation'),
 (7,false,'multi-day project with a future occurrence'),(8,true,'old same-day roles'),
 (9,false,'project ending after the exact retention cutoff'),(10,true,'old profile with no project association'),
 (11,false,'recent profile with no project association'),(12,false,'linked account identity'),
 (13,false,'old direct project with a future signup in another project')
)x(n,expected,label);
INSERT INTO public.anonymous_signups(id,project_id,email,name,created_at,linked_user_id)
SELECT id,CASE WHEN n<=9 THEN ('fb950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
 WHEN n IN(12,13) THEN 'fb950000-0000-4000-8000-000000000001'::uuid END,
 'retention-'||n||'@local.test','Synthetic participant',
 now()-CASE WHEN n=11 THEN interval '1 day' ELSE interval '60 days' END,
 CASE WHEN n=12 THEN 'fb940000-0000-4000-8000-000000000001'::uuid END FROM retention_cases;
INSERT INTO public.project_signups(id,project_id,anonymous_id,schedule_id,status)
SELECT ('fb970000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fb950000-0000-4000-8000-'||lpad((CASE WHEN n=12 THEN 5 WHEN n=13 THEN 3 ELSE n END)::text,12,'0'))::uuid,id,'oneTime','approved'
FROM retention_cases WHERE n IN(1,4,5,8,12,13);
SELECT extensions.is(private.anonymous_signup_retention_eligible(id),expected,label) FROM retention_cases ORDER BY n;
INSERT INTO public.waiver_signatures(id,project_id,signup_id,anonymous_id,signer_name,signer_email,
 signature_type,signature_storage_path,upload_storage_path,signature_payload,waiver_pdf_storage_path) VALUES
 ('fb980000-0000-4000-8000-000000000001','fb950000-0000-4000-8000-000000000001',
 'fb970000-0000-4000-8000-000000000001','fb960000-0000-4000-8000-000000000001',
 'Synthetic participant','retention-1@local.test','multi-signer','fixtures/retention-signature.png',
 'fixtures/retention-upload.pdf','{"signers":[{"method":"draw","data":"fixtures/retention-signer.png"},{"method":"draw","data":"fixtures/retention-shared.png"}]}',
 'project_waivers/fb950000-0000-4000-8000-000000000001/retention-source.pdf'),
 ('fb980000-0000-4000-8000-000000000004','fb950000-0000-4000-8000-000000000004',
 'fb970000-0000-4000-8000-000000000004','fb960000-0000-4000-8000-000000000004',
 'Retained participant','retention-4@local.test','draw','fixtures/retention-shared.png',NULL,NULL,NULL);
INSERT INTO public.waiver_signatures(id,project_id,signup_id,anonymous_id,signer_name,signer_email,
 signature_type,signature_text,waiver_pdf_storage_path)
SELECT ('fb980000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fb950000-0000-4000-8000-'||lpad((CASE WHEN n=12 THEN 5 ELSE n END)::text,12,'0'))::uuid,
 ('fb970000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,id,'Synthetic participant',
 'retention-'||n||'@local.test','typed','Synthetic participant',
 'project_waivers/fb950000-0000-4000-8000-'||lpad((CASE WHEN n=12 THEN 5 ELSE n END)::text,12,'0')||'/shared-source.pdf'
 FROM retention_cases WHERE n IN(5,8,12);
UPDATE public.projects SET waiver_pdf_storage_path=
 'project_waivers/fb950000-0000-4000-8000-000000000008/shared-source.pdf'
 WHERE id='fb950000-0000-4000-8000-000000000008';
INSERT INTO public.certificates(id,project_title,is_certified,event_start,event_end,check_in_method,
 project_id,signup_id,volunteer_name) VALUES('fb990000-0000-4000-8000-000000000001','Synthetic retention project',
 true,'2000-01-01T00:00:00Z','2000-01-01T01:00:00Z','manual','fb950000-0000-4000-8000-000000000001',
 'fb970000-0000-4000-8000-000000000001','Synthetic participant');

-- The second local connection takes only a synthetic advisory lock and writes no rows.
SELECT extensions.dblink_connect('anonymous_retention_mutex','hostaddr='||host(inet_server_addr())||
 ' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||
 ' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_exec('anonymous_retention_mutex','BEGIN');
SELECT * FROM extensions.dblink('anonymous_retention_mutex',
 $$SELECT pg_try_advisory_xact_lock(hashtextextended('lets-assist-anonymous-retention',0))$$) AS locked(acquired boolean);
SELECT extensions.is(public.delete_old_anonymous_signups(),0,'another cleanup claim causes a bounded no-op');
SELECT extensions.ok(EXISTS(SELECT 1 FROM public.anonymous_signups WHERE id='fb960000-0000-4000-8000-000000000001'),
 'a refused concurrent pass keeps the candidate intact');
SELECT extensions.dblink_exec('anonymous_retention_mutex','ROLLBACK');
SELECT extensions.dblink_disconnect('anonymous_retention_mutex');
SELECT extensions.throws_ok($$SELECT public.archive_anonymous_signups_for_cleanup(array_fill(
 'fb960000-0000-4000-8000-000000000001'::uuid,ARRAY[501]))$$,'P0001',
 'too many anonymous profiles in one cleanup batch','the direct entry point rejects oversized input');
SET LOCAL ROLE service_role;
SELECT extensions.is(public.delete_old_anonymous_signups(),4,'server cron removes only eligible profiles through the archive transaction');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.anonymous_signups WHERE id IN(SELECT id FROM retention_cases)),9::bigint,
 'linked, invalid, active, future, and recent identities remain');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.project_signups WHERE id='fb970000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM public.waiver_signatures WHERE id='fb980000-0000-4000-8000-000000000001'),
 'expired signup and waiver records are removed together');
SELECT extensions.is((SELECT count(*) FROM public.waiver_storage_deletion_queue
 WHERE object_path IN('fixtures/retention-signature.png','fixtures/retention-upload.pdf','fixtures/retention-signer.png')),3::bigint,
 'every now-unreferenced waiver asset has a durable deletion receipt');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.waiver_storage_deletion_queue WHERE object_path='fixtures/retention-shared.png'),
 'a shared asset with a retained signature is not queued');
SELECT extensions.ok(EXISTS(SELECT 1 FROM public.waiver_storage_deletion_queue WHERE bucket_id='waiver-uploads'
 AND object_path='project_waivers/fb950000-0000-4000-8000-000000000001/retention-source.pdf'),
 'the final signature source PDF receives a bucket-aware deletion receipt');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.waiver_storage_deletion_queue WHERE bucket_id='waiver-uploads'
 AND object_path='project_waivers/fb950000-0000-4000-8000-000000000005/shared-source.pdf'),
 'a source PDF referenced by a retained signature is not queued');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.waiver_storage_deletion_queue WHERE bucket_id='waiver-uploads'
 AND object_path='project_waivers/fb950000-0000-4000-8000-000000000008/shared-source.pdf'),
 'a source PDF still referenced by its project is not queued');
SELECT extensions.ok((SELECT signup_id IS NULL AND volunteer_name='Synthetic participant'
 FROM public.certificates WHERE id='fb990000-0000-4000-8000-000000000001'),
 'certificate issuance survives with the deleted signup reference cleared');
SELECT extensions.is(public.delete_old_anonymous_signups(),0,'retrying completed retention does not repeat deletion');

INSERT INTO public.anonymous_signups(id,project_id,email,name,created_at) VALUES
 ('fb960000-0000-4000-8000-000000000020',NULL,'rollback-orphan@local.test','Synthetic orphan',now()-interval '60 days'),
 ('fb960000-0000-4000-8000-000000000021','fb950000-0000-4000-8000-000000000001','rollback-waiver@local.test','Synthetic waiver',now()-interval '60 days');
INSERT INTO public.project_signups(id,project_id,anonymous_id,schedule_id,status) VALUES
 ('fb970000-0000-4000-8000-000000000021','fb950000-0000-4000-8000-000000000001',
 'fb960000-0000-4000-8000-000000000021','oneTime','approved');
INSERT INTO public.waiver_signatures(id,project_id,signup_id,anonymous_id,signer_name,signer_email,signature_type,signature_storage_path,waiver_pdf_storage_path)
VALUES('fb980000-0000-4000-8000-000000000021','fb950000-0000-4000-8000-000000000001',
 'fb970000-0000-4000-8000-000000000021','fb960000-0000-4000-8000-000000000021',
 'Synthetic waiver','rollback-waiver@local.test','draw','fixtures/retention-rollback.png',
 'project_waivers/fb950000-0000-4000-8000-000000000001/rollback-source.pdf');
ALTER TABLE public.waiver_storage_deletion_queue ADD CONSTRAINT synthetic_retention_failure
 CHECK(object_path<>'project_waivers/fb950000-0000-4000-8000-000000000001/rollback-source.pdf') NOT VALID;
SELECT extensions.throws_ok($$SELECT public.archive_anonymous_signups_for_cleanup(ARRAY[
 'fb960000-0000-4000-8000-000000000020'::uuid,'fb960000-0000-4000-8000-000000000021'::uuid])$$,
 '23514',NULL,'a late source-PDF outbox failure rolls back the entire batch');
SELECT extensions.is((SELECT count(*) FROM public.anonymous_signups WHERE id IN
 ('fb960000-0000-4000-8000-000000000020','fb960000-0000-4000-8000-000000000021')),2::bigint,
 'both the earlier candidate and failing candidate survive rollback');
SELECT extensions.ok(EXISTS(SELECT 1 FROM public.waiver_signatures WHERE id='fb980000-0000-4000-8000-000000000021'),
 'failed queueing preserves the waiver path metadata');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.waiver_storage_deletion_queue WHERE object_path='fixtures/retention-rollback.png'),
 'a refused transaction leaves no partial outbox receipt');
ALTER TABLE public.waiver_storage_deletion_queue DROP CONSTRAINT synthetic_retention_failure;
UPDATE public.anonymous_signups SET linked_user_id='fb940000-0000-4000-8000-000000000001'
 WHERE id='fb960000-0000-4000-8000-000000000021';
SELECT extensions.is(public.archive_anonymous_signups_for_cleanup(ARRAY['fb960000-0000-4000-8000-000000000021'::uuid]),
 0::bigint,'the write transaction rechecks a newly linked identity');
UPDATE public.anonymous_signups SET linked_user_id=NULL WHERE id='fb960000-0000-4000-8000-000000000021';
SELECT extensions.is(public.archive_anonymous_signups_for_cleanup(ARRAY['fb960000-0000-4000-8000-000000000020'::uuid,
 'fb960000-0000-4000-8000-000000000021'::uuid]),2::bigint,'retry after repair completes the same eligible batch');
SELECT extensions.is((SELECT count(*) FROM public.waiver_storage_deletion_queue WHERE object_path IN
 ('fixtures/retention-rollback.png','project_waivers/fb950000-0000-4000-8000-000000000001/rollback-source.pdf')),
 2::bigint,'retry preserves both asset and source-PDF cleanup receipts');

INSERT INTO public.anonymous_signups(id,email,name,created_at)
SELECT md5('retention-bounded-'||n)::uuid,'bounded-'||n||'@local.test','Synthetic orphan','1900-01-01'::timestamptz
FROM generate_series(1,503)n;
SELECT extensions.is(public.delete_old_anonymous_signups(),500,'one cron call processes at most five hundred profiles');
SELECT extensions.is((SELECT count(*) FROM public.anonymous_signups WHERE id IN
 (SELECT md5('retention-bounded-'||n)::uuid FROM generate_series(1,503)n)),3::bigint,'overflow remains for the next pass');
SELECT extensions.is(public.delete_old_anonymous_signups(),3,'the next pass drains the bounded remainder');
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.delete_old_anonymous_signups()$$,'42501',NULL,'browser callers cannot execute cron cleanup');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
