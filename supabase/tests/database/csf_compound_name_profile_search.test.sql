BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cf000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'compound-search-officer@local.test','{}','{}',now(),now());
INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('cf100000-0000-4000-8000-000000000001','Compound search fixture','compound-search-fixture','school','986392');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_profiles (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('cf400000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001',
  'Ada Marie','Van Example','ada marie','van example');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_search_profiles(
  'cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001',q,NULL)),
  1,'compound name prefix matches: ' || q)
FROM unnest(ARRAY['Ada Marie Van Example','Van Example Ada Marie','Van Exa','AdaMa','ADA  MARIE VAN EXAMPLE']) q;
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_search_profiles(
  'cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','a',NULL)),0,'one-character queries remain bounded');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_search_profiles(
  'cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','',
  'cf400000-0000-4000-8000-000000000001')),1,'selected profile hydration still works');
INSERT INTO plugin_data.csf_profiles (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('cf400000-0000-4000-8000-000000000002','cf100000-0000-4000-8000-000000000001',
  'Other','Fixture','other','fixture');
UPDATE plugin_data.csf_profiles SET record_status='merged',
  merged_into_profile_id='cf400000-0000-4000-8000-000000000002',
  merged_at=now(),merged_by='cf000000-0000-4000-8000-000000000001',merge_reason='Synthetic merged-record search fixture'
WHERE id='cf400000-0000-4000-8000-000000000001';
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_search_profiles(
  'cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','Ada Marie Van Example',NULL)),0,'merged records stay excluded');
SELECT extensions.throws_ok($$SELECT * FROM plugin_data.csf_search_profiles(
  'cf100000-0000-4000-8000-000000000002','cf000000-0000-4000-8000-000000000001','Ada Marie',NULL)$$,
  '42501',NULL,'officer cannot search another organization');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_search_profiles(uuid,uuid,text,uuid)','EXECUTE'),'anonymous execution denied');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_search_profiles(uuid,uuid,text,uuid)','EXECUTE'),'browser execution denied');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_search_profiles(uuid,uuid,text,uuid)','EXECUTE'),'server execution allowed');
SELECT * FROM extensions.finish();
ROLLBACK;
