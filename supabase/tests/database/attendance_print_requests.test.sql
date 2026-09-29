BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SELECT extensions.ok(NOT has_function_privilege('anon','public.create_attendance_print_sheets(uuid,text[],uuid,integer,integer,uuid)','EXECUTE'),'anonymous cannot prepare print requests');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.create_attendance_print_sheets(uuid,text[],uuid,integer,integer,uuid)','EXECUTE'),'browser cannot call privileged print requests');
SELECT extensions.ok(has_function_privilege('service_role','public.create_attendance_print_sheets(uuid,text[],uuid,integer,integer,uuid)','EXECUTE'),'server may prepare print requests');
SELECT extensions.ok(NOT has_table_privilege('authenticated','private.attendance_print_requests','SELECT'),'request receipts are not readable by browser accounts');
SELECT extensions.ok(NOT has_table_privilege('service_role','private.attendance_print_requests','INSERT'),'service client cannot insert request receipts directly');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.attendance_print_requests'::regclass),'request receipts use RLS');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('bf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','print-request-'||n||'@local.test',now(),'{}',jsonb_build_object('username','print_request_'||n,'full_name','Printed volunteer '||n),now(),now() FROM generate_series(1,4) n;
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
 ('bf200000-0000-4000-8000-000000000001','Print request org','print_request_org','nonprofit','639211'),
 ('bf200000-0000-4000-8000-000000000002','Other print request org','other_print_request_org','nonprofit','639212');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
 ('bf200000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000002','admin','active'),
 ('bf200000-0000-4000-8000-000000000002','bf100000-0000-4000-8000-000000000004','admin','active');
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,organization_id,can_be_managed_by_staff)
SELECT ('bf300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bf100000-0000-4000-8000-000000000001','Atomic printed roster '||n,'Local','Synthetic print requests','sameDayMultiArea','manual','{"sameDayMultiArea":{"date":"2020-09-18","roles":[{"name":"Morning","startTime":"09:00","endTime":"10:00","volunteers":10},{"name":"Afternoon","startTime":"11:00","endTime":"12:00","volunteers":10}]}}','upcoming','UTC','bf200000-0000-4000-8000-000000000001',false FROM generate_series(1,2) n;
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES('bf400000-0000-4000-8000-000000000001','bf300000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000003','Morning','approved');
CREATE TEMP TABLE original_signup AS SELECT to_jsonb(s) AS value FROM public.project_signups s WHERE id='bf400000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Missing'],'bf100000-0000-4000-8000-000000000002',2,1,'bf500000-0000-4000-8000-000000000001')$$,'22023','Invalid schedule session','later session failure aborts the entire print request');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_sheets WHERE project_id='bf300000-0000-4000-8000-000000000001'),0,'failed request retains no earlier sheet');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows WHERE project_id='bf300000-0000-4000-8000-000000000001'),0,'failed request retains no printed roster names');
SELECT extensions.is((SELECT count(*)::integer FROM private.attendance_print_requests WHERE request_id='bf500000-0000-4000-8000-000000000001'),0,'failed request retains no successful receipt');
CREATE TEMP TABLE prepared AS SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'bf100000-0000-4000-8000-000000000002',2,1,'bf500000-0000-4000-8000-000000000001') AS value;
SELECT extensions.is((SELECT jsonb_array_length(value) FROM prepared),2,'active organization admin prepares both sessions even when staff management is off');
SELECT extensions.is((SELECT jsonb_path_query_array(value,'$[*].schedule_id') FROM prepared),'["Morning","Afternoon"]'::jsonb,'response preserves exact requested session order');
SELECT extensions.ok((SELECT bool_and((SELECT count(*) FROM jsonb_object_keys(item))=2 AND item ?& ARRAY['sheet_id','schedule_id']) FROM prepared p CROSS JOIN LATERAL jsonb_array_elements(p.value) item),'response contains only sheet and original session identifiers');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows WHERE project_id='bf300000-0000-4000-8000-000000000001'),7,'both sheets include their requested walk-in and continuation rows');
CREATE TEMP TABLE prepared_rows AS SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sheet_id,r.row_number) AS value FROM public.project_attendance_print_rows r WHERE r.project_id='bf300000-0000-4000-8000-000000000001';
UPDATE public.profiles SET full_name='Later profile name' WHERE id='bf100000-0000-4000-8000-000000000003';
SELECT extensions.is(public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'bf100000-0000-4000-8000-000000000002',2,1,'bf500000-0000-4000-8000-000000000001'),(SELECT value FROM prepared),'read-failure retry returns exactly the original sheet references');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sheet_id,r.row_number) FROM public.project_attendance_print_rows r WHERE r.project_id='bf300000-0000-4000-8000-000000000001'),(SELECT value FROM prepared_rows),'replay retains original names and opaque row references');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_sheets WHERE project_id='bf300000-0000-4000-8000-000000000001'),2,'replay does not create duplicate sheets');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Afternoon','Morning'],'bf100000-0000-4000-8000-000000000002',2,1,'bf500000-0000-4000-8000-000000000001')$$,'22023','print request key reused','request key binds exact session order');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'bf100000-0000-4000-8000-000000000002',3,1,'bf500000-0000-4000-8000-000000000001')$$,'22023','print request key reused','request key binds row counts');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'bf100000-0000-4000-8000-000000000001',2,1,'bf500000-0000-4000-8000-000000000001')$$,'22023','print request key reused','another authorized actor cannot reuse the receipt');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000002',ARRAY['Morning','Afternoon'],'bf100000-0000-4000-8000-000000000002',2,1,'bf500000-0000-4000-8000-000000000001')$$,'22023','print request key reused','request key cannot move to another project');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='bf200000-0000-4000-8000-000000000001' AND user_id='bf100000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'bf100000-0000-4000-8000-000000000002',2,1,'bf500000-0000-4000-8000-000000000001')$$,'42501','Not authorized to print this project','revoked admin cannot replay prior sheet references');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('bf300000-0000-4000-8000-000000000001','Morning','bf100000-0000-4000-8000-000000000002')$$,'42501','Not authorized to print this project','single-sheet compatibility RPC also rechecks revocation');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning'],'bf100000-0000-4000-8000-000000000004',0,0,gen_random_uuid())$$,'42501','Not authorized to print this project','admin from another organization cannot print');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('bf300000-0000-4000-8000-000000000001','Morning',NULL)$$,'42501','Not authorized to print this project','missing actor is denied before creating a snapshot');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet('bf300000-0000-4000-8000-000000000099','Morning','bf100000-0000-4000-8000-000000000001')$$,'42501','Not authorized to print this project','missing project fails closed');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning','Morning'],'bf100000-0000-4000-8000-000000000001',0,0,gen_random_uuid())$$,'22023','Invalid print options','duplicate requested sessions are rejected');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY[]::text[],'bf100000-0000-4000-8000-000000000001',0,0,gen_random_uuid())$$,'22023','Invalid print options','empty print request is rejected');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY['Morning'],'bf100000-0000-4000-8000-000000000001',0,0,NULL)$$,'22023','Invalid print options','durable request ID is required');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('bf300000-0000-4000-8000-000000000001',ARRAY[['Morning','Afternoon']],'bf100000-0000-4000-8000-000000000001',0,0,gen_random_uuid())$$,'22023','Invalid print options','multidimensional session input is rejected');
SELECT extensions.is((SELECT count(*)::integer FROM private.attendance_print_requests WHERE project_id IN('bf300000-0000-4000-8000-000000000001','bf300000-0000-4000-8000-000000000002')),1,'all rejected requests preserve the one successful receipt');
SELECT extensions.is((SELECT to_jsonb(s) FROM public.project_signups s WHERE id='bf400000-0000-4000-8000-000000000001'),(SELECT value FROM original_signup),'printing and retries never modify attendance');
SELECT * FROM extensions.finish();
ROLLBACK;
