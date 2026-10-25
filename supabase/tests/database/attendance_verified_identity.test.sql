BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('a8100000-0000-4000-8000-000000000001','authenticated','authenticated','identity-owner@local.test',now(),'{}','{"username":"identity_owner"}',now(),now()),
 ('a8100000-0000-4000-8000-000000000002','authenticated','authenticated','identity-unconfirmed@local.test',NULL,'{}','{"username":"identity_unconfirmed"}',now(),now()),
 ('a8100000-0000-4000-8000-000000000003','authenticated','authenticated','identity-current@local.test',now(),'{}','{"username":"identity_current"}',now(),now()),
 ('a8100000-0000-4000-8000-000000000004','authenticated','authenticated','identity-verified@local.test',now(),'{}','{"username":"identity_verified"}',now(),now());
UPDATE public.profiles SET email='identity-stale@local.test' WHERE id='a8100000-0000-4000-8000-000000000003';
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,require_login,status,project_timezone) VALUES
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','Verified identity fixture','Local','Synthetic attendance','oneTime','manual',
 '{"oneTime":{"date":"2026-09-18","startTime":"09:00","endTime":"15:00","volunteers":20}}',true,'upcoming','UTC');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES
 ('a8300000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000003','oneTime','approved');
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count) VALUES
 ('a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001','oneTime','a8100000-0000-4000-8000-000000000001','review',1);
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,email,decision,attendance_intervals,review_acknowledged,identity_confirmed) VALUES
 ('a8500000-0000-4000-8000-000000000001','a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001',1,'{}','Unconfirmed visitor','identity-unconfirmed@local.test','include','[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}]',true,true),
 ('a8500000-0000-4000-8000-000000000002','a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001',2,'{}','Stale profile visitor','identity-stale@local.test','include','[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}]',true,true),
 ('a8500000-0000-4000-8000-000000000003','a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001',3,'{}','Verified account','identity-verified@local.test','include','[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}]',true,true),
 ('a8500000-0000-4000-8000-000000000004','a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001',4,'{}','Current account','identity-current@local.test','include','[{"checkIn":"2026-09-18T09:00:00Z","checkOut":"2026-09-18T10:00:00Z"}]',true,true);

SELECT public.update_paper_scan_review_row('a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}');
SELECT public.update_paper_scan_review_row('a8400000-0000-4000-8000-000000000001','a8200000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','{"expectedRevision":1,"decision":"include"}');
SELECT extensions.ok((SELECT review_acknowledged AND identity_confirmed FROM public.project_paper_scan_rows WHERE id='a8500000-0000-4000-8000-000000000001'),'include or exclude alone preserves reviewed evidence');
CREATE TEMP TABLE identity_results AS SELECT * FROM public.commit_paper_signup_batch('a8400000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001',
 ARRAY['a8500000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000002','a8500000-0000-4000-8000-000000000003','a8500000-0000-4000-8000-000000000004']::uuid[],false,'a8600000-0000-4000-8000-000000000001');
SELECT extensions.ok((SELECT user_id IS NULL AND anonymous_id IS NOT NULL AND outcome='signup_created' FROM identity_results WHERE row_id='a8500000-0000-4000-8000-000000000001'),'unconfirmed account email stays a guest identity');
SELECT extensions.ok((SELECT user_id IS NULL AND anonymous_id IS NOT NULL AND outcome='signup_created' FROM identity_results WHERE row_id='a8500000-0000-4000-8000-000000000002'),'stale profile email cannot match an account or its signup');
SELECT extensions.is((SELECT user_id FROM identity_results WHERE row_id='a8500000-0000-4000-8000-000000000003'),'a8100000-0000-4000-8000-000000000004'::uuid,'confirmed current auth email identifies the account');
SELECT extensions.is((SELECT signup_id FROM identity_results WHERE row_id='a8500000-0000-4000-8000-000000000004'),'a8300000-0000-4000-8000-000000000001'::uuid,'current auth email reuses the account signup despite stale profile email');
SELECT extensions.is((SELECT email::text FROM public.profiles WHERE id='a8100000-0000-4000-8000-000000000003'),'identity-stale@local.test','attendance matching never rewrites the profile email');
SELECT * FROM extensions.finish();
ROLLBACK;
