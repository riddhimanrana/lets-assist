BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('cb100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','guest-terminal-'||n||'@local.test',now(),'{}',jsonb_build_object('username','guest_terminal_'||n),now(),now() FROM generate_series(1,3) n;
CREATE TEMP TABLE terminal_link_cases AS
 SELECT row_number() OVER(ORDER BY status,session,award)::integer AS id,status,session,award,
  status IN('cancelled','rejected') AND award='none' AS allowed
 FROM (VALUES('cancelled'),('rejected'),('pending'),('approved'),('attended')) statuses(status)
 CROSS JOIN (VALUES('oneTime'),('0')) sessions(session)
 CROSS JOIN (VALUES('none'),('verified'),('legacy')) awards(award)
 WHERE status IN('cancelled','rejected') OR award='none';
CREATE TEMP TABLE terminal_link_fixtures(id integer,project uuid,guest uuid,guest_signup uuid,account_signup uuid,token uuid,allowed boolean);
CREATE FUNCTION pg_temp.terminal_link_snapshot(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'signups',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.project_signups s WHERE s.project_id=p_project),
  'guests',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.anonymous_signups g WHERE g.project_id=p_project),
  'intervals',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_attendance_intervals i WHERE i.project_id=p_project),
  'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id=p_project),
  'waivers',(SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.waiver_signatures w WHERE w.project_id=p_project),
  'deliveries',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.project_id=p_project),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.anonymous_id) FROM private.anonymous_account_links r JOIN public.anonymous_signups g ON g.id=r.anonymous_id WHERE g.project_id=p_project));
$$;
CREATE FUNCTION pg_temp.exercise_terminal_history() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE c terminal_link_cases%ROWTYPE; p uuid; g uuid; gs uuid; a uuid; token uuid;
 actor uuid:='cb100000-0000-4000-8000-000000000001'; account_id uuid:='cb100000-0000-4000-8000-000000000002';
 before jsonb; snapshot jsonb; result jsonb; prior_account jsonb; guest_certificate jsonb; guest_intervals jsonb; deliveries jsonb; account_waiver jsonb; label text;
BEGIN
 FOR c IN SELECT * FROM terminal_link_cases ORDER BY id LOOP
  p:=gen_random_uuid();g:=gen_random_uuid();gs:=gen_random_uuid();a:=gen_random_uuid();token:=gen_random_uuid();
  label:=c.status||'/'||c.session||'/'||c.award;
  INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
   VALUES(p,actor,'Terminal history fixture','Local','Synthetic guest-link history','oneTime','manual','{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"15:00","volunteers":10}}','upcoming','UTC');
  INSERT INTO public.anonymous_signups(id,project_id,email,name,token,confirmed_at) VALUES(g,p,'terminal-guest-'||c.id||'@local.test','Terminal guest',token,now());
  INSERT INTO public.project_signups(id,project_id,anonymous_id,schedule_id,status) VALUES(gs,p,g,'oneTime','approved');
  PERFORM public.publish_volunteer_hours_transactional(actor,p,'oneTime',jsonb_build_array(jsonb_build_object('signupId',gs,'checkIn','2020-09-18T09:00:00Z','checkOut','2020-09-18T11:00:00Z','attendanceRevision',0)),'hours-publication:v1:'||repeat(lpad(c.id::text,2,'0'),32));
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES(a,p,account_id,c.session,c.status);
  INSERT INTO public.waiver_signatures(project_id,signup_id,user_id,signer_name,signer_email,signature_type,signature_text)
   VALUES(p,a,account_id,'Prior account','guest-terminal-2@local.test','typed','Retained terminal evidence');
  IF c.award<>'none' THEN
   INSERT INTO public.certificates(project_id,user_id,signup_id,volunteer_name,volunteer_email,project_title,event_start,event_end,is_certified,creator_id,type,check_in_method,schedule_id)
    VALUES(p,account_id,a,'Prior account','guest-terminal-2@local.test','Retained historical award','2020-09-18T09:00Z','2020-09-18T11:00Z',false,actor,CASE WHEN c.award='legacy' THEN NULL ELSE 'verified' END,'manual',c.session);
  END IF;
  before:=pg_temp.terminal_link_snapshot(p);
  SELECT to_jsonb(s) INTO prior_account FROM public.project_signups s WHERE id=a;
  SELECT to_jsonb(w) INTO account_waiver FROM public.waiver_signatures w WHERE signup_id=a;
  SELECT to_jsonb(cert) INTO guest_certificate FROM public.certificates cert WHERE signup_id=gs;
  guest_intervals:=private.signup_attendance_intervals(gs);
  deliveries:=before->'deliveries';
  IF c.allowed THEN
   result:=public.link_guest_attendance_account(g,account_id,token::text);
   RETURN NEXT extensions.is(result->>'outcome','accepted',label||': terminal uncredited history permits linking');
   RETURN NEXT extensions.is((SELECT to_jsonb(s) FROM public.project_signups s WHERE id=a),prior_account,label||': terminal signup remains unchanged');
   RETURN NEXT extensions.is((SELECT to_jsonb(w) FROM public.waiver_signatures w WHERE signup_id=a),account_waiver,label||': terminal waiver evidence remains unchanged');
   RETURN NEXT extensions.ok((SELECT user_id=account_id AND anonymous_id IS NULL FROM public.project_signups WHERE id=gs),label||': original guest signup moves to account');
   RETURN NEXT extensions.is((SELECT to_jsonb(cert)-'user_id'-'updated_at' FROM public.certificates cert WHERE signup_id=gs),guest_certificate-'user_id'-'updated_at',label||': certificate identity and award snapshot survive');
   RETURN NEXT extensions.is(private.signup_attendance_intervals(gs),guest_intervals,label||': canonical visits survive');
   RETURN NEXT extensions.is(pg_temp.terminal_link_snapshot(p)->'deliveries',deliveries,label||': original delivery ledger remains unchanged');
   RETURN NEXT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE project_id=p AND user_id=account_id),1,label||': account receives exactly one award');
   snapshot:=pg_temp.terminal_link_snapshot(p);
   RETURN NEXT extensions.is(public.link_guest_attendance_account(g,account_id,token::text)->>'outcome','replayed',label||': retry replays');
   RETURN NEXT extensions.is(pg_temp.terminal_link_snapshot(p),snapshot,label||': retry changes no history or credit');
  ELSE
   RETURN NEXT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',g,account_id,token),'23505','account already has attendance for this session',label||': active or credited destination still blocks linking');
   RETURN NEXT extensions.is(pg_temp.terminal_link_snapshot(p),before,label||': rejected transfer preserves all evidence and credit');
  END IF;
  INSERT INTO terminal_link_fixtures VALUES(c.id,p,g,gs,a,token,c.allowed);
 END LOOP;
END;
$$;
SELECT * FROM pg_temp.exercise_terminal_history();

-- Access checks precede durable replay and still apply after a successful link.
CREATE TEMP TABLE access_fixture AS SELECT * FROM terminal_link_fixtures WHERE allowed ORDER BY id LIMIT 1;
CREATE TEMP TABLE access_snapshot AS SELECT pg_temp.terminal_link_snapshot(project) AS snapshot FROM access_fixture;
SELECT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',guest,'cb100000-0000-4000-8000-000000000003',token),'42501','guest access denied','another account cannot claim the linked guest') FROM access_fixture;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='cb100000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',guest,'cb100000-0000-4000-8000-000000000002',token),'42501','destination account unavailable','revoked destination cannot replay a link') FROM access_fixture;
UPDATE auth.users SET banned_until=NULL WHERE id='cb100000-0000-4000-8000-000000000002';
SELECT extensions.is(pg_temp.terminal_link_snapshot(f.project),s.snapshot,'denied access changes no signup, award, waiver, receipt or delivery') FROM access_fixture f CROSS JOIN access_snapshot s;
UPDATE public.anonymous_signups SET token=gen_random_uuid() WHERE id=(SELECT guest FROM access_fixture);
SELECT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',guest,'cb100000-0000-4000-8000-000000000002',token),'42501','guest access denied','revoked guest token cannot replay a link') FROM access_fixture;

-- Corrupt retained provenance cannot transfer a signup from another project.
CREATE TEMP TABLE cross_project_fixture AS SELECT * FROM terminal_link_fixtures WHERE NOT allowed ORDER BY id LIMIT 1;
INSERT INTO public.project_signups(project_id,anonymous_id,schedule_id,status)
 SELECT a.project,b.guest,'oneTime','rejected' FROM access_fixture a CROSS JOIN cross_project_fixture b;
CREATE TEMP TABLE cross_project_snapshot AS SELECT f.project,pg_temp.terminal_link_snapshot(f.project) AS snapshot FROM terminal_link_fixtures f WHERE f.id IN(SELECT id FROM access_fixture UNION SELECT id FROM cross_project_fixture);
SELECT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',guest,'cb100000-0000-4000-8000-000000000002',token),'23505','guest attendance ownership conflict','cross-project guest provenance remains denied') FROM cross_project_fixture;
SELECT extensions.ok(bool_and(pg_temp.terminal_link_snapshot(project)=snapshot),'cross-project rejection leaves both projects unchanged') FROM cross_project_snapshot;
SELECT * FROM extensions.finish();
ROLLBACK;
