BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

SELECT extensions.ok(NOT has_function_privilege('anon','public.link_guest_attendance_account(uuid,uuid,text)','EXECUTE'),'guest RPC denies anonymous callers');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.link_guest_attendance_account(uuid,uuid,text)','EXECUTE'),'guest RPC requires server authentication');
SELECT extensions.ok(has_function_privilege('service_role','public.link_guest_attendance_account(uuid,uuid,text)','EXECUTE'),'server can execute guest link');
SELECT extensions.ok(NOT has_table_privilege('authenticated','private.anonymous_account_links','SELECT'),'link receipts are private');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('ac100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'guest-link-'||n||'@local.test',now(),'{}',jsonb_build_object('username','guest_link_'||n),now(),now()
FROM generate_series(1,3) n;
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status)
SELECT ('ac200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ac100000-0000-4000-8000-000000000001',
  'Guest link fixture '||n,'Local','Synthetic guest link test','oneTime','manual',
  '{"oneTime":{"date":"2020-09-01","startTime":"09:00","endTime":"17:00","volunteers":10}}',true,'upcoming'
FROM generate_series(1,3) n;
INSERT INTO public.anonymous_signups(id,project_id,email,name,token,confirmed_at)
SELECT ('ac300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('ac200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'guest-original-'||n||'@local.test','Guest '||n,
  ('ac400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()
FROM generate_series(1,3) n;
INSERT INTO public.project_signups(id,project_id,anonymous_id,schedule_id,status,check_in_time,check_out_time)
SELECT ('ac500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('ac200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('ac300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'oneTime','attended','2020-09-01T16:00Z','2020-09-01T19:00Z'
FROM generate_series(1,3) n;
INSERT INTO public.certificates(id,project_id,signup_id,volunteer_name,volunteer_email,project_title,event_start,event_end,is_certified,creator_id,type,check_in_method,credited_minutes)
SELECT ('ac600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('ac200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('ac500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Guest '||n,'guest-original-'||n||'@local.test','Guest link fixture '||n,
  '2020-09-01T16:00Z','2020-09-01T19:00Z',false,'ac100000-0000-4000-8000-000000000001','verified','manual',120
FROM generate_series(1,3) n;
INSERT INTO public.waiver_signatures(id,project_id,signup_id,anonymous_id,signer_name,signer_email,signature_type,signature_text)
VALUES('ac700000-0000-4000-8000-000000000001','ac200000-0000-4000-8000-000000000001','ac500000-0000-4000-8000-000000000001','ac300000-0000-4000-8000-000000000001','Guest 1','guest-original-1@local.test','typed','Guest 1');

SELECT extensions.throws_ok($$SELECT public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000002','wrong')$$,'42501','guest access denied','token is required even through service RPC');
SELECT extensions.is(public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000002','ac400000-0000-4000-8000-000000000001')->>'outcome','accepted','guest link commits');
SELECT extensions.is((SELECT user_id FROM public.project_signups WHERE id='ac500000-0000-4000-8000-000000000001'),'ac100000-0000-4000-8000-000000000002'::uuid,'signup moves to account');
SELECT extensions.is((SELECT user_id FROM public.certificates WHERE id='ac600000-0000-4000-8000-000000000001'),'ac100000-0000-4000-8000-000000000002'::uuid,'same certificate belongs to account');
SELECT extensions.is((SELECT credited_minutes FROM public.certificates WHERE id='ac600000-0000-4000-8000-000000000001'),120,'canonical minutes survive linking');
SELECT extensions.is((SELECT user_id FROM public.waiver_signatures WHERE id='ac700000-0000-4000-8000-000000000001'),'ac100000-0000-4000-8000-000000000002'::uuid,'waiver ownership moves atomically');
SELECT extensions.is((SELECT signature_text FROM public.waiver_signatures WHERE id='ac700000-0000-4000-8000-000000000001'),'Guest 1','signed evidence remains unchanged');
SELECT extensions.is(public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000002','ac400000-0000-4000-8000-000000000001')->>'outcome','replayed','same account retries safely');
SELECT extensions.is((SELECT count(*)::integer FROM public.certificates WHERE signup_id='ac500000-0000-4000-8000-000000000001'),1,'replay retains exactly one award');
SELECT extensions.throws_ok($$SELECT public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000003','ac400000-0000-4000-8000-000000000001')$$,'42501','guest access denied','second account cannot claim linked guest');

-- Fail after signup transfer to prove the entire operation rolls back.
CREATE FUNCTION pg_temp.reject_certificate_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.id='ac600000-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'injected certificate failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER reject_test_guest_transfer BEFORE UPDATE ON public.certificates FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_certificate_transfer();
SELECT extensions.throws_ok($$SELECT public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000002','ac100000-0000-4000-8000-000000000002','ac400000-0000-4000-8000-000000000002')$$,'23514','injected certificate failure','late write failure aborts link');
SELECT extensions.is((SELECT anonymous_id FROM public.project_signups WHERE id='ac500000-0000-4000-8000-000000000002'),'ac300000-0000-4000-8000-000000000002'::uuid,'failed link retains guest signup');
SELECT extensions.is((SELECT count(*)::integer FROM private.anonymous_account_links WHERE anonymous_id='ac300000-0000-4000-8000-000000000002'),0,'failed link creates no receipt');
DROP TRIGGER reject_test_guest_transfer ON public.certificates;
SELECT extensions.is(public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000002','ac100000-0000-4000-8000-000000000002','ac400000-0000-4000-8000-000000000002')->>'outcome','accepted','failed link retries successfully');

-- The previous action could stop after moving signups but before certificates.
UPDATE public.project_signups SET user_id='ac100000-0000-4000-8000-000000000002',anonymous_id=NULL WHERE id='ac500000-0000-4000-8000-000000000003';
SELECT extensions.is(public.link_guest_attendance_account('ac300000-0000-4000-8000-000000000003','ac100000-0000-4000-8000-000000000002','ac400000-0000-4000-8000-000000000003')->>'signupCount','1','legacy partial transfer recovers from account-owned signup certificate');
SELECT extensions.is((SELECT user_id FROM public.certificates WHERE id='ac600000-0000-4000-8000-000000000003'),'ac100000-0000-4000-8000-000000000002'::uuid,'legacy recovery attaches original award');
SELECT extensions.is((SELECT sum(credited_minutes)::integer FROM public.certificates WHERE id::text LIKE 'ac600000-%'),360,'all original awards and totals remain intact');
SELECT * FROM extensions.finish();
ROLLBACK;
