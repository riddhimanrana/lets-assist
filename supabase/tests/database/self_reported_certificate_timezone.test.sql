-- New self-reported zones persist without changing certificate ownership.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);
SELECT extensions.has_column('public', 'certificates', 'event_timezone', 'certificate has an event zone');
SELECT extensions.col_type_is('public', 'certificates', 'event_timezone', 'text', 'zone uses text');
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('ce726000-0000-4000-8000-000000000001','authenticated','authenticated','timezone-owner@local.test','{}','{}'),
 ('ce726000-0000-4000-8000-000000000002','authenticated','authenticated','timezone-other@local.test','{}','{}');
INSERT INTO public.certificates(id,project_title,is_certified,event_start,event_end,check_in_method,user_id,creator_id,type)
VALUES ('ce726100-0000-4000-8000-000000000001','Fictional legacy hours',false,'2026-10-12T15:30Z','2026-10-12T16:30Z','self_report','ce726000-0000-4000-8000-000000000001','ce726000-0000-4000-8000-000000000001','self-reported');
SELECT extensions.is((SELECT event_timezone FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000001'),NULL::text,'legacy rows remain unknown rather than inventing a zone');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'ce726000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claims" = '{"sub":"ce726000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.lives_ok($$
 INSERT INTO public.certificates(id,project_title,is_certified,event_start,event_end,event_timezone,check_in_method,user_id,creator_id,type)
 VALUES ('ce726100-0000-4000-8000-000000000002','Fictional Tokyo hours',false,'2026-10-12T15:30Z','2026-10-12T16:30Z','Asia/Tokyo','self_report','ce726000-0000-4000-8000-000000000001','ce726000-0000-4000-8000-000000000001','self-reported')
$$,'authenticated owner can persist a self-reported timezone');
SELECT extensions.is((SELECT event_timezone FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),'Asia/Tokyo','zone survives readback without a project');
SELECT extensions.is((SELECT (event_start AT TIME ZONE event_timezone)::date::text FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),'2026-10-13','local day crosses the UTC date boundary');
SELECT extensions.is((SELECT (event_start AT TIME ZONE event_timezone)::time::text FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),'00:30:00','local wall clock survives UTC storage');
SELECT extensions.throws_ok($$UPDATE public.certificates SET event_timezone='' WHERE id='ce726100-0000-4000-8000-000000000002'$$,'23514',NULL,'empty zones fail the constraint');
SELECT extensions.throws_ok($$UPDATE public.certificates SET event_timezone=repeat('x',101) WHERE id='ce726100-0000-4000-8000-000000000002'$$,'23514',NULL,'oversized zones fail the constraint');
SET LOCAL "request.jwt.claim.sub" = 'ce726000-0000-4000-8000-000000000002';
SET LOCAL "request.jwt.claims" = '{"sub":"ce726000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.is((SELECT count(*) FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),0::bigint,'another volunteer cannot read the record');
SELECT extensions.is((WITH changed AS (UPDATE public.certificates SET event_timezone='UTC' WHERE id='ce726100-0000-4000-8000-000000000002' RETURNING id) SELECT count(*) FROM changed),0::bigint,'another volunteer cannot rewrite the zone');
RESET ROLE;
SELECT extensions.is((SELECT event_timezone FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),'Asia/Tokyo','refused cross-owner write leaves the zone intact');
SELECT * FROM extensions.finish();
ROLLBACK;
