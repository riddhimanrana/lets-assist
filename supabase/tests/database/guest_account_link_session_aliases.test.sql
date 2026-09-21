BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('ab100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'guest-link-alias-'||n||'@local.test',now(),'{}',jsonb_build_object('username','guest_link_alias_'||n),now(),now()
FROM generate_series(1,2) n;
CREATE TEMP TABLE link_alias_cases(id integer,event_type text,guest_session text,account_session text);
INSERT INTO link_alias_cases VALUES
 (1,'oneTime','0','oneTime'),(2,'oneTime','default','0'),
 (3,'multiDay','day-0-slot-0','2020-09-18-0'),(4,'multiDay','0-0','day-0-slot-0'),
 (5,'multiDay','2020-09-18-0-0','0-0'),(6,'multiDay','2020-09-18-0','day-0-slot-0'),
 (7,'sameDayMultiArea','role-0','Morning'),(8,'sameDayMultiArea','Morning','role-0');
CREATE TEMP TABLE link_alias_fixtures(id integer,project uuid,guest uuid,guest_signup uuid,account_signup uuid,certificate uuid,token uuid,original jsonb);
CREATE FUNCTION pg_temp.link_snapshot(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'signups',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.project_signups s WHERE s.project_id=p_project),
  'guests',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.anonymous_signups g WHERE g.project_id=p_project),
  'certificates',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id=p_project),
  'deliveries',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.hours_publication_email_outbox o JOIN public.certificates c ON c.id=o.certificate_id WHERE c.project_id=p_project),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.anonymous_id) FROM private.anonymous_account_links r JOIN public.anonymous_signups g ON g.id=r.anonymous_id WHERE g.project_id=p_project));
$$;
CREATE FUNCTION pg_temp.exercise_link_aliases() RETURNS SETOF text LANGUAGE plpgsql AS $$
#variable_conflict use_variable
DECLARE c link_alias_cases%ROWTYPE; p uuid; g uuid; gs uuid; a uuid; cert uuid; token uuid; schedule jsonb; before jsonb;
BEGIN
 FOR c IN SELECT * FROM link_alias_cases ORDER BY id LOOP
  p:=gen_random_uuid(); g:=gen_random_uuid(); gs:=gen_random_uuid(); a:=gen_random_uuid(); cert:=gen_random_uuid(); token:=gen_random_uuid();
  schedule:=CASE c.event_type
   WHEN 'oneTime' THEN '{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"15:00","volunteers":10}}'::jsonb
   WHEN 'multiDay' THEN '{"multiDay":[{"date":"2020-09-18","slots":[{"startTime":"09:00","endTime":"11:00","volunteers":10},{"startTime":"12:00","endTime":"15:00","volunteers":10}]}]}'::jsonb
   ELSE '{"sameDayMultiArea":{"date":"2020-09-18","roles":[{"name":"Morning","startTime":"09:00","endTime":"11:00","volunteers":10},{"name":"Afternoon","startTime":"12:00","endTime":"15:00","volunteers":10}]}}'::jsonb END;
  INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone)
  VALUES(p,'ab100000-0000-4000-8000-000000000001','Guest link alias fixture','Local','Synthetic alias conflict',c.event_type,'manual',schedule,'upcoming','UTC');
  INSERT INTO public.anonymous_signups(id,project_id,email,name,token,confirmed_at)
  VALUES(g,p,'unlinked-guest-'||c.id||'@local.test','Alias guest',token,now());
  INSERT INTO public.project_signups(id,project_id,anonymous_id,schedule_id,status,check_in_time,check_out_time)
  VALUES(gs,p,g,c.guest_session,'attended','2020-09-18T09:00Z','2020-09-18T11:00Z');
  INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
  VALUES(a,p,'ab100000-0000-4000-8000-000000000002',c.account_session,'approved');
  INSERT INTO public.certificates(id,project_id,signup_id,volunteer_name,volunteer_email,project_title,event_start,event_end,is_certified,creator_id,type,check_in_method,credited_minutes,schedule_id)
  VALUES(cert,p,gs,'Alias guest','unlinked-guest-'||c.id||'@local.test','Original award snapshot','2020-09-18T09:00Z','2020-09-18T11:00Z',false,'ab100000-0000-4000-8000-000000000001','verified','manual',120,c.guest_session);
  before:=pg_temp.link_snapshot(p);
  RETURN NEXT extensions.ok((SELECT check_in_time IS NULL AND check_out_time IS NULL FROM public.project_signups WHERE id=a),'alias '||c.id||': existing account has no timestamps');
  RETURN NEXT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',g,'ab100000-0000-4000-8000-000000000002',token),'23505','account already has attendance for this session','alias '||c.id||': equivalent session cannot transfer a second signup');
  RETURN NEXT extensions.is(pg_temp.link_snapshot(p),before,'alias '||c.id||': rejected link preserves identities, award snapshot, deliveries, and receipt state');
  INSERT INTO link_alias_fixtures VALUES(c.id,p,g,gs,a,cert,token,before);
 END LOOP;
END; $$;
SELECT * FROM pg_temp.exercise_link_aliases();

-- A distinct session can link without changing its stored schedule or award.
UPDATE public.project_signups SET schedule_id='day-0-slot-1',status='attended',check_in_time='2020-09-18T12:00Z',check_out_time='2020-09-18T13:00Z'
WHERE id=(SELECT account_signup FROM link_alias_fixtures WHERE id=5);
SELECT extensions.is(public.link_guest_attendance_account(f.guest,'ab100000-0000-4000-8000-000000000002',f.token::text)->>'outcome','accepted','different non-overlapping session links successfully') FROM link_alias_fixtures f WHERE f.id=5;
SELECT extensions.ok(s.user_id='ab100000-0000-4000-8000-000000000002' AND s.anonymous_id IS NULL AND s.schedule_id=c.guest_session,'link retains original guest signup and raw session alias')
FROM link_alias_fixtures f JOIN link_alias_cases c USING(id) JOIN public.project_signups s ON s.id=f.guest_signup WHERE f.id=5;
SELECT extensions.is(to_jsonb(c)-'user_id'-'updated_at',(f.original->'certificates'->0)-'user_id'-'updated_at','successful link preserves the full award snapshot and certificate ID')
FROM link_alias_fixtures f JOIN public.certificates c ON c.id=f.certificate WHERE f.id=5;
SELECT extensions.is(c.user_id,'ab100000-0000-4000-8000-000000000002'::uuid,'original certificate belongs to the linked account')
FROM link_alias_fixtures f JOIN public.certificates c ON c.id=f.certificate WHERE f.id=5;
CREATE TEMP TABLE linked_snapshot AS SELECT f.id,pg_temp.link_snapshot(f.project) AS snapshot FROM link_alias_fixtures f WHERE f.id=5;
SELECT extensions.is(public.link_guest_attendance_account(f.guest,'ab100000-0000-4000-8000-000000000002',f.token::text)->>'outcome','replayed','distinct-session link retry uses its receipt') FROM link_alias_fixtures f WHERE f.id=5;
SELECT extensions.is(pg_temp.link_snapshot(f.project),s.snapshot,'retry leaves signup, award, delivery, and receipt unchanged') FROM link_alias_fixtures f JOIN linked_snapshot s USING(id);
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates c WHERE c.project_id=f.project),1,'link and retry retain exactly one existing award') FROM link_alias_fixtures f WHERE f.id=5;

-- Canonical session separation does not bypass the independent overlap guard.
UPDATE public.project_signups SET schedule_id='day-0-slot-1',status='attended',check_in_time='2020-09-18T09:30Z',check_out_time='2020-09-18T10:30Z'
WHERE id=(SELECT account_signup FROM link_alias_fixtures WHERE id=6);
CREATE TEMP TABLE overlap_snapshot AS SELECT f.id,pg_temp.link_snapshot(f.project) AS snapshot FROM link_alias_fixtures f WHERE f.id=6;
SELECT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',f.guest,'ab100000-0000-4000-8000-000000000002',f.token),'23505','account has overlapping attendance','different session with overlapping actual times still fails') FROM link_alias_fixtures f WHERE f.id=6;
SELECT extensions.is(pg_temp.link_snapshot(f.project),s.snapshot,'overlap rejection preserves the original guest award') FROM link_alias_fixtures f JOIN overlap_snapshot s USING(id);

-- Preserve the original conflict rule for equal, unrecognized legacy IDs.
UPDATE public.project_signups SET schedule_id='unknown-legacy-slot' WHERE project_id=(SELECT project FROM link_alias_fixtures WHERE id=1);
SELECT extensions.throws_ok(format('SELECT public.link_guest_attendance_account(%L,%L,%L)',f.guest,'ab100000-0000-4000-8000-000000000002',f.token),'23505','account already has attendance for this session','equal unknown legacy IDs remain a conflict') FROM link_alias_fixtures f WHERE f.id=1;
SELECT * FROM extensions.finish();
ROLLBACK;
