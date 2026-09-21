BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('ce100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','exception-provenance-'||n||'@local.test',now(),'{}',jsonb_build_object('username','exception_provenance_'||n),now(),now() FROM generate_series(1,4) n;
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES('ce200000-0000-4000-8000-000000000001','Exception review fixture','exception_review_fixture','nonprofit','638201');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('ce200000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000002','admin','active');
CREATE TEMP TABLE provenance_fixtures(id integer,project uuid,signup uuid,entries jsonb,request text);
DO $$
DECLARE n integer;p uuid;s uuid;
BEGIN
 FOR n IN 1..16 LOOP
  p:=gen_random_uuid();s:=('ce300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  INSERT INTO public.projects(id,creator_id,organization_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
   VALUES(p,'ce100000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001','Exception review fixture','Local','Synthetic publication provenance','oneTime','manual','{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"15:00","volunteers":10}}','upcoming','UTC');
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES(s,p,'ce100000-0000-4000-8000-000000000003','0','approved');
  INSERT INTO provenance_fixtures VALUES(n,p,s,jsonb_build_array(jsonb_build_object('signupId',s,'checkIn','2020-09-18T08:00:00Z','checkOut','2020-09-18T10:00:00Z','attendanceRevision',0,'timeExceptionReason','  Early setup reviewed with volunteer  ')),'hours-publication:v1:'||repeat(lpad(n::text,2,'0'),32));
 END LOOP;
END;
$$;
CREATE FUNCTION pg_temp.provenance_snapshot(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'project',(SELECT to_jsonb(p) FROM public.projects p WHERE p.id=p_project),
  'signups',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.project_signups s WHERE s.project_id=p_project),
  'intervals',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_attendance_intervals i WHERE i.project_id=p_project),
  'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM private.project_attendance_changes a WHERE a.project_id=p_project),
  'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id=p_project),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.hours_publication_receipts r WHERE r.project_id=p_project),
  'deliveries',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.project_id=p_project));
$$;
CREATE FUNCTION pg_temp.publish_provenance(p_case integer,p_actor uuid DEFAULT 'ce100000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.publish_volunteer_hours_transactional(p_actor,project,'default',entries,request) FROM provenance_fixtures WHERE id=p_case;
$$;
SELECT extensions.is(pg_temp.publish_provenance(1)->>'outcome','accepted','direct out-of-session publication succeeds with reviewed reason');
SELECT extensions.is((SELECT count(*)::integer FROM private.project_attendance_changes WHERE project_id=f.project),1,'direct publication creates one audit event') FROM provenance_fixtures f WHERE id=1;
SELECT extensions.ok(a.actor_id='ce100000-0000-4000-8000-000000000001' AND a.signup_id=f.signup AND a.project_id=f.project AND a.reason='Early setup reviewed with volunteer','audit retains actor, signup, project and trimmed reason') FROM provenance_fixtures f JOIN private.project_attendance_changes a ON a.signup_id=f.signup WHERE f.id=1;
SELECT extensions.ok(a.old_intervals='[]' AND a.new_intervals=private.signup_attendance_intervals(f.signup) AND a.old_revision=0 AND a.new_revision=1 AND a.new_credited_minutes=120,'audit retains prior and resulting attendance, minutes and revisions') FROM provenance_fixtures f JOIN private.project_attendance_changes a ON a.signup_id=f.signup WHERE f.id=1;
SELECT extensions.ok(a.request_payload->>'operation'='publication' AND a.request_payload->>'publicationReceiptId'=r.id::text AND a.request_payload->>'requestKey'=f.request AND a.request_payload->>'scheduleId'='oneTime' AND a.request_payload->'reasonSource'->>'kind'='direct' AND a.result->>'publicationReceiptId'=r.id::text,'audit links canonical session aliases to the durable publication receipt') FROM provenance_fixtures f JOIN private.project_attendance_changes a ON a.signup_id=f.signup JOIN public.hours_publication_receipts r ON r.project_id=f.project WHERE f.id=1;
SELECT extensions.ok(a.old_credited_minutes IS NULL AND a.request_payload->'oldAttendanceMinutes'='null'::jsonb AND a.request_payload->'oldAwardCreditedMinutes'='null'::jsonb,'first publication does not claim a previous award correction') FROM provenance_fixtures f JOIN private.project_attendance_changes a ON a.signup_id=f.signup WHERE f.id=1;
SELECT extensions.is(public.project_corrected_certificate_ids(project,'ce100000-0000-4000-8000-000000000001'),ARRAY[]::uuid[],'publication provenance does not enable corrected-certificate resend') FROM provenance_fixtures WHERE id=1;
SELECT extensions.throws_ok(format('SELECT public.request_corrected_certificate_delivery(%L,%L,1,%L,%L)',f.project,c.id,gen_random_uuid(),'ce100000-0000-4000-8000-000000000001'),'22023','certificate has no reviewed award correction','resend requires an actual award correction') FROM provenance_fixtures f JOIN public.certificates c ON c.signup_id=f.signup WHERE f.id=1;
CREATE TEMP TABLE direct_snapshot AS SELECT pg_temp.provenance_snapshot(project) AS snapshot FROM provenance_fixtures WHERE id=1;
SELECT extensions.is(pg_temp.publish_provenance(1)->>'outcome','replayed','exact direct publication retry replays');
SELECT extensions.is(pg_temp.provenance_snapshot(project),(SELECT snapshot FROM direct_snapshot),'retry duplicates neither audit nor credit nor delivery') FROM provenance_fixtures WHERE id=1;
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,timeExceptionReason}','"Different explanation"') WHERE id=1;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(1)$$,'22023','publication request key was already used for different input','changed reason cannot reuse the original request key');
SELECT extensions.is(pg_temp.provenance_snapshot(project),(SELECT snapshot FROM direct_snapshot),'payload conflict preserves the audit and all published records') FROM provenance_fixtures WHERE id=1;

UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,timeExceptionReason}','{"invalid":true}') WHERE id=2;
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,timeExceptionReason}',to_jsonb(repeat('x',1001))) WHERE id=3;
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,timeExceptionReason}','"   "') WHERE id=4;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(2)$$,'22023','invalid attendance exception reason','non-text reasons are rejected');
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(3)$$,'22023','invalid attendance exception reason','overlong reasons are rejected');
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(4)$$,'22023','outside_schedule_requires_reason','blank reason cannot authorize exceptional times');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='ce200000-0000-4000-8000-000000000001' AND user_id='ce100000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(5,'ce100000-0000-4000-8000-000000000002')$$,'42501','not authorized to publish project hours','revoked organization admin cannot create exception provenance');
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,attendanceRevision}','9') WHERE id=6;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(6)$$,'40001','attendance changed; refresh before publishing','stale revision cannot create exception provenance');
SELECT extensions.is((SELECT count(*)::integer FROM private.project_attendance_changes a JOIN provenance_fixtures f ON f.project=a.project_id WHERE f.id BETWEEN 2 AND 6),0,'invalid, unauthorized and stale calls create no audit');
SELECT extensions.is((SELECT count(*)::integer FROM public.hours_publication_receipts r JOIN provenance_fixtures f ON f.project=r.project_id WHERE f.id BETWEEN 2 AND 6),0,'invalid, unauthorized and stale calls create no receipt');

INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) SELECT 'ce300000-0000-4000-8000-000000000099',project,'ce100000-0000-4000-8000-000000000004','oneTime','approved' FROM provenance_fixtures WHERE id=7;
UPDATE provenance_fixtures SET entries=entries||jsonb_build_array(jsonb_build_object('signupId','ce300000-0000-4000-8000-000000000099','checkIn','2020-09-18T08:00:00Z','checkOut','2020-09-18T10:00:00Z','attendanceRevision',0)) WHERE id=7;
CREATE TEMP TABLE multi_snapshot AS SELECT pg_temp.provenance_snapshot(project) AS snapshot FROM provenance_fixtures WHERE id=7;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(7)$$,'22023','outside_schedule_requires_reason','later unresolved row aborts multi-row publication');
SELECT extensions.is(pg_temp.provenance_snapshot(project),(SELECT snapshot FROM multi_snapshot),'later failure rolls back earlier audit, attendance, award and delivery writes') FROM provenance_fixtures WHERE id=7;

-- Paper reasons authorize only their exact saved visits, including legacy pairs.
DO $$
DECLARE f provenance_fixtures%ROWTYPE;b uuid;visits jsonb;
BEGIN
 FOR f IN SELECT * FROM provenance_fixtures WHERE id BETWEEN 8 AND 12 LOOP
  b:=gen_random_uuid();visits:='[{"checkIn":"2020-09-18T08:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]';
  PERFORM private.set_project_attendance_intervals(f.signup,visits,'Original paper review');
  INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count) VALUES(b,f.project,'0','ce100000-0000-4000-8000-000000000001','committed',1);
  INSERT INTO public.project_paper_scan_rows(batch_id,project_id,sheet_row_number,raw_extraction,name,decision,outcome,committed_signup_id,attendance_intervals,check_in_time,check_out_time,review_acknowledged,identity_confirmed,time_exception_reason)
   VALUES(b,f.project,1,'{}','Paper volunteer','include','signup_updated',f.signup,CASE WHEN f.id IN(9,10) THEN '[]'::jsonb ELSE private.normalize_attendance_intervals(visits) END,'2020-09-18T08:00:00Z',CASE WHEN f.id=10 THEN NULL ELSE '2020-09-18T10:00:00Z'::timestamptz END,true,true,'Original paper review');
  IF f.id=11 THEN PERFORM private.set_project_attendance_intervals(f.signup,'[{"checkIn":"2020-09-18T07:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]','Different actual times'); END IF;
  UPDATE provenance_fixtures SET entries=jsonb_set(entries #- '{0,timeExceptionReason}','{0,attendanceRevision}',to_jsonb((SELECT attendance_revision FROM public.project_signups WHERE id=f.signup))) WHERE id=f.id;
 END LOOP;
END;
$$;
SELECT extensions.is(pg_temp.publish_provenance(8)->>'outcome','accepted','matching reviewed paper intervals preserve their reason');
SELECT extensions.is(pg_temp.publish_provenance(9)->>'outcome','accepted','matching complete legacy paper pair preserves its reason');
SELECT extensions.ok(bool_and(a.reason='Original paper review' AND a.request_payload->'reasonSource'->>'kind'='paper' AND a.request_payload->'reasonSource'->>'scanRowId' IS NOT NULL AND a.request_payload->>'oldAttendanceMinutes'='120'),'paper publication retains the source row and prior canonical minutes') FROM private.project_attendance_changes a JOIN provenance_fixtures f ON f.project=a.project_id WHERE f.id IN(8,9);
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(10)$$,'22023','outside_schedule_requires_reason','incomplete legacy paper pair remains unresolved without normalization errors');
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,checkIn}','"2020-09-18T07:00:00Z"') WHERE id IN(11,12);
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,intervals}','[{"checkIn":"2020-09-18T07:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]') WHERE id=12;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(11)$$,'22023','outside_schedule_requires_reason','old paper reason cannot authorize already-changed canonical intervals');
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(12)$$,'22023','outside_schedule_requires_reason','old paper reason cannot authorize proposed replacement intervals');
SELECT extensions.is((SELECT count(*)::integer FROM private.project_attendance_changes a JOIN provenance_fixtures f ON f.project=a.project_id WHERE f.id BETWEEN 10 AND 12),0,'unmatched paper reasons create no publication audit');

SELECT public.record_project_attendance(signup,0,'Reviewed in Hours before publication','[{"checkIn":"2020-09-18T08:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',gen_random_uuid(),'ce100000-0000-4000-8000-000000000001') FROM provenance_fixtures WHERE id=13;
UPDATE provenance_fixtures SET entries=jsonb_set(entries #- '{0,timeExceptionReason}','{0,attendanceRevision}','1') WHERE id=13;
SELECT extensions.is(pg_temp.publish_provenance(13)->>'outcome','accepted','matching prior attendance-change reason remains valid');
SELECT extensions.ok(a.request_payload->'reasonSource'->>'kind'='attendance_change' AND a.request_payload->'reasonSource'->>'changeId'=prior.id::text AND a.new_intervals=prior.new_intervals,'publication records the exact inherited attendance review') FROM provenance_fixtures f JOIN private.project_attendance_changes a ON a.signup_id=f.signup AND a.request_payload->>'operation'='publication' JOIN private.project_attendance_changes prior ON prior.signup_id=f.signup AND prior.request_payload->>'operation' IS NULL WHERE f.id=13;
-- A failure after award creation must also roll back the provenance event.
CREATE FUNCTION pg_temp.reject_provenance_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hours_publication_receipts r JOIN provenance_fixtures f ON f.project=r.project_id WHERE r.id=NEW.receipt_id AND f.id=14) THEN
  RAISE EXCEPTION 'injected outbox failure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reject_provenance_outbox BEFORE INSERT ON public.hours_publication_email_outbox FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_provenance_outbox();
CREATE TEMP TABLE late_failure_snapshot AS SELECT pg_temp.provenance_snapshot(project) AS snapshot FROM provenance_fixtures WHERE id=14;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(14)$$,'23514','injected outbox failure','late delivery failure aborts the reviewed publication');
SELECT extensions.is(pg_temp.provenance_snapshot(project),(SELECT snapshot FROM late_failure_snapshot),'late failure rolls back audit, intervals, certificate, receipt and delivery together') FROM provenance_fixtures WHERE id=14;
DROP TRIGGER reject_provenance_outbox ON public.hours_publication_email_outbox;
SELECT extensions.is(pg_temp.publish_provenance(14)->>'outcome','accepted','failed publication can retry with its original request key');
SELECT extensions.is((SELECT count(*)::integer FROM private.project_attendance_changes a WHERE a.project_id=f.project),1,'successful retry retains exactly one audit event') FROM provenance_fixtures f WHERE id=14;
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,timeExceptionReason}',to_jsonb(repeat('x',1000))) WHERE id=15;
SELECT extensions.is(pg_temp.publish_provenance(15)->>'outcome','accepted','the maximum valid reason length remains supported');
SELECT extensions.is((SELECT char_length(reason) FROM private.project_attendance_changes a WHERE a.project_id=f.project),1000,'the complete maximum-length reason is retained') FROM provenance_fixtures f WHERE id=15;
SELECT public.record_project_attendance(signup,0,'Original Hours review','[{"checkIn":"2020-09-18T08:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]',gen_random_uuid(),'ce100000-0000-4000-8000-000000000001') FROM provenance_fixtures WHERE id=16;
UPDATE provenance_fixtures SET entries=jsonb_set(jsonb_set(entries #- '{0,timeExceptionReason}','{0,attendanceRevision}','1'),'{0,checkIn}','"2020-09-18T07:00:00Z"') WHERE id=16;
UPDATE provenance_fixtures SET entries=jsonb_set(entries,'{0,intervals}','[{"checkIn":"2020-09-18T07:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]') WHERE id=16;
CREATE TEMP TABLE old_review_snapshot AS SELECT pg_temp.provenance_snapshot(project) AS snapshot FROM provenance_fixtures WHERE id=16;
SELECT extensions.throws_ok($$SELECT pg_temp.publish_provenance(16)$$,'22023','outside_schedule_requires_reason','a prior Hours reason cannot authorize different proposed visits');
SELECT extensions.is(pg_temp.provenance_snapshot(project),(SELECT snapshot FROM old_review_snapshot),'failed inheritance preserves the original attendance review') FROM provenance_fixtures WHERE id=16;
SELECT * FROM extensions.finish();
ROLLBACK;
