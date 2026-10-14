-- New self-reported zones persist without changing certificate ownership.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(26);
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
-- A nonblank unknown zone must be refused on both browser write paths.
SELECT extensions.throws_ok($$UPDATE public.certificates SET event_timezone='Mars/Base' WHERE id='ce726100-0000-4000-8000-000000000002'$$,'23514',NULL,'unknown nonblank zone fails authenticated update');
SELECT extensions.throws_ok($$INSERT INTO public.certificates(project_title,is_certified,event_start,event_end,event_timezone,check_in_method,user_id,creator_id,type)
 VALUES ('Invalid zone',false,'2026-10-12T15:30Z','2026-10-12T16:30Z','Mars/Base','self_report','ce726000-0000-4000-8000-000000000001','ce726000-0000-4000-8000-000000000001','self-reported')$$,'23514',NULL,'unknown nonblank zone fails authenticated insert');
-- PostgreSQL's catalog accepts Factory, but ECMA-402 rejects it. Direct owner
-- writes must not store a zone that certificateTimezone silently relabels.
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name='Factory'),'Factory is present in PostgreSQL catalog');
SELECT extensions.throws_ok($$UPDATE public.certificates SET event_timezone='Factory' WHERE id='ce726100-0000-4000-8000-000000000002'$$,'23514',NULL,'catalog-only zone fails authenticated update');
SELECT extensions.throws_ok($$INSERT INTO public.certificates(project_title,is_certified,event_start,event_end,event_timezone,check_in_method,user_id,creator_id,type)
 VALUES ('Invalid formatter zone',false,'2026-10-12T15:30Z','2026-10-12T16:30Z','Factory','self_report','ce726000-0000-4000-8000-000000000001','ce726000-0000-4000-8000-000000000001','self-reported')$$,'23514',NULL,'catalog-only zone fails authenticated insert');
SELECT extensions.is((SELECT event_timezone FROM public.user_certificate_read_model WHERE id='ce726100-0000-4000-8000-000000000002'),'Asia/Tokyo','owned list projection carries event zone');
SELECT extensions.is((SELECT event_timezone FROM public.certificate_verification_read_model WHERE id='ce726100-0000-4000-8000-000000000002'),'Asia/Tokyo','certificate projection carries event zone');
SELECT extensions.is((SELECT project_timezone FROM public.certificate_verification_read_model WHERE id='ce726100-0000-4000-8000-000000000002'),NULL::text,'self-report has no invented project zone');
SELECT extensions.lives_ok($$UPDATE public.certificates SET event_timezone='UTC' WHERE id='ce726100-0000-4000-8000-000000000002'$$,'catalog zone UTC remains supported');
SELECT extensions.is((SELECT event_timezone FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),'UTC','valid owner update survives readback');
UPDATE public.certificates SET event_timezone='Asia/Tokyo' WHERE id='ce726100-0000-4000-8000-000000000002';
SET LOCAL "request.jwt.claim.sub" = 'ce726000-0000-4000-8000-000000000002';
SET LOCAL "request.jwt.claims" = '{"sub":"ce726000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.is((SELECT count(*) FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),0::bigint,'another volunteer cannot read the record');
WITH changed AS (
  UPDATE public.certificates SET event_timezone='UTC'
  WHERE id='ce726100-0000-4000-8000-000000000002'
  RETURNING id
)
SELECT extensions.is((SELECT count(*) FROM changed),0::bigint,'another volunteer cannot rewrite the zone');
RESET ROLE;
SELECT extensions.is((SELECT event_timezone FROM public.certificates WHERE id='ce726100-0000-4000-8000-000000000002'),'Asia/Tokyo','refused cross-owner write leaves the zone intact');
SELECT extensions.ok((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_catalog.pg_class WHERE oid='public.certificate_verification_read_model'::regclass),'public verification view keeps invoker boundary');
SELECT extensions.ok((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_catalog.pg_class WHERE oid='public.user_certificate_read_model'::regclass),'owned list view keeps invoker boundary');
SELECT extensions.ok(NOT has_function_privilege('authenticated','private.enforce_certificate_event_timezone()','EXECUTE'),'browser cannot call the private trigger directly');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='certificate_verification_read_model' AND column_name='volunteer_email'),'verification projection still excludes volunteer email');
SELECT * FROM extensions.finish();
ROLLBACK;
