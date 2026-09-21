BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('eaa00000-0000-4000-8000-000000000001','homonym-officer@local.test',now()),
 ('eaa00000-0000-4000-8000-000000000002','verified-student@local.test',now());
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('eaa10000-0000-4000-8000-000000000001','Fictional homonym chapter','homonym-chapter','school','974823');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('eaa10000-0000-4000-8000-000000000001','eaa00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
 ('eaa20000-0000-4000-8000-000000000001','eaa10000-0000-4000-8000-000000000001',2040,'Class of 2040'),
 ('eaa20000-0000-4000-8000-000000000002','eaa10000-0000-4000-8000-000000000001',2041,'Class of 2041');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
SELECT md5('homonym-profile:'||n)::uuid,'eaa10000-0000-4000-8000-000000000001',
 'Zora','Fixture'||n,'zora','fixture'||n,'existing'||n||'@local.test','existing'||n||'@local.test'
FROM generate_series(1,13) n WHERE n<>7;
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
SELECT 'eaa10000-0000-4000-8000-000000000001',md5('homonym-profile:'||n)::uuid,
 CASE WHEN n=2 THEN 'eaa20000-0000-4000-8000-000000000002' ELSE 'eaa20000-0000-4000-8000-000000000001' END::uuid,'active'
FROM generate_series(1,13) n WHERE n NOT IN (4,7);
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary)
VALUES ('eaa10000-0000-4000-8000-000000000001',md5('homonym-profile:6')::uuid,'eaa00000-0000-4000-8000-000000000002','verified',true);
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,mode,status,source_type)
VALUES ('eaa30000-0000-4000-8000-000000000001','eaa10000-0000-4000-8000-000000000001','preview','needs_resolution','application_responses');
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,cohort_id,sheet_tab_name,row_number,import_status,normalized_data)
SELECT md5('homonym-row:'||n)::uuid,'eaa10000-0000-4000-8000-000000000001','eaa30000-0000-4000-8000-000000000001',
 'eaa20000-0000-4000-8000-000000000002','Responses',n+1,'conflict',
 jsonb_build_object('record',jsonb_build_object('identity',jsonb_build_object('firstName','Zora','lastName','Fixture'||n),
   'contact',jsonb_build_object('responseEmail',CASE n WHEN 3 THEN 'existing3@local.test' WHEN 5 THEN NULL WHEN 6 THEN 'verified-student@local.test' WHEN 9 THEN 'existing3@local.test' WHEN 10 THEN 'verified-student@local.test' WHEN 11 THEN 'reported-owner@local.test' WHEN 12 THEN 'application-owner@local.test' WHEN 13 THEN 'foreign-owner@local.test' ELSE 'applicant'||n||'@local.test' END)))
FROM generate_series(1,13) n;
UPDATE plugin_data.csf_profiles SET reported_application_personal_email='reported-owner@local.test' WHERE id=md5('homonym-profile:3')::uuid;
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES ('eaa40000-0000-4000-8000-000000000001','eaa10000-0000-4000-8000-000000000001','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES ('eaa10000-0000-4000-8000-000000000001','eaa20000-0000-4000-8000-000000000001','eaa40000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_term_applications(organization_id,profile_id,cohort_id,term_id,source,most_checked_email)
VALUES ('eaa10000-0000-4000-8000-000000000001',md5('homonym-profile:3')::uuid,'eaa20000-0000-4000-8000-000000000001','eaa40000-0000-4000-8000-000000000001','manual','application-owner@local.test');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('eaa10000-0000-4000-8000-000000000002','Other fictional chapter','foreign-homonym-chapter','school','974824');
INSERT INTO plugin_data.csf_profiles(organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
VALUES ('eaa10000-0000-4000-8000-000000000002','Different','Student','different','student','foreign-owner@local.test','foreign-owner@local.test');
CREATE TEMP TABLE original_profiles AS SELECT id,to_jsonb(p) AS value FROM plugin_data.csf_profiles p WHERE organization_id='eaa10000-0000-4000-8000-000000000001';

CREATE FUNCTION pg_temp.create_applicant(n integer, request_suffix text DEFAULT '') RETURNS jsonb LANGUAGE sql AS $$
 SELECT plugin_data.csf_create_profile_for_application_import_row(
   'eaa10000-0000-4000-8000-000000000001',md5('homonym-row:'||n)::uuid,'eaa00000-0000-4000-8000-000000000001',
   md5('homonym-request:'||n||request_suffix)::uuid,'Officer checked the distinct fictional class and application contacts.');
$$;
CREATE TEMP TABLE created_homonym AS SELECT pg_temp.create_applicant(1) AS result;
SELECT extensions.ok((SELECT (result->>'profileId')::uuid<>md5('homonym-profile:1')::uuid FROM created_homonym),'reviewed different-class student receives a distinct profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='eaa10000-0000-4000-8000-000000000001' AND last_name='Fixture1'),2,'both same-name students remain');
SELECT extensions.ok((SELECT matched_profile_id=(SELECT (result->>'profileId')::uuid FROM created_homonym) AND import_status='pending' FROM plugin_data.csf_sheet_import_rows WHERE id=md5('homonym-row:1')::uuid),'the new profile and reviewed source row are connected atomically');
SELECT extensions.ok((pg_temp.create_applicant(1)->>'idempotent')::boolean,'the same request safely replays');
SELECT extensions.throws_ok($$SELECT pg_temp.create_applicant(1,'-different')$$,'P0001','This application row no longer needs a profile decision.','a new request cannot create a second profile from the resolved row');

SELECT extensions.throws_ok(format('SELECT pg_temp.create_applicant(%s)',n),'P0001',
 'Review the existing student and class before adding another record with this name.',
 CASE n WHEN 2 THEN 'same-class names still require reconciliation' WHEN 3 THEN 'matching canonical contact requires reconciliation'
 WHEN 4 THEN 'unknown existing class requires reconciliation' WHEN 5 THEN 'missing application contact requires reconciliation'
 WHEN 6 THEN 'matching verified account requires reconciliation' END)
FROM generate_series(2,6) n;
SELECT extensions.throws_ok(format('SELECT pg_temp.create_applicant(%s)',n),'P0001',
 'Review the existing student and class before adding another record with this name.',
 CASE n WHEN 9 THEN 'a differently named canonical contact owner blocks duplicate creation'
 WHEN 10 THEN 'a differently named verified account owner blocks duplicate creation'
 WHEN 11 THEN 'a differently named reported contact owner still requires review'
 WHEN 12 THEN 'a differently named application contact owner still requires review' END)
FROM generate_series(9,12) n;
SELECT extensions.lives_ok($$SELECT pg_temp.create_applicant(13)$$,'contact evidence in another chapter cannot block this chapter');
SELECT extensions.lives_ok($$SELECT pg_temp.create_applicant(7)$$,'the ordinary new applicant path still works');

CREATE FUNCTION pg_temp.refuse_homonym_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id=md5('homonym-row:8')::uuid AND NEW.matched_profile_id IS NOT NULL THEN
   RAISE EXCEPTION 'Fictional reconciliation failure';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fictional_homonym_refusal BEFORE UPDATE ON plugin_data.csf_sheet_import_rows
FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_homonym_match();
SELECT extensions.throws_ok($$SELECT pg_temp.create_applicant(8)$$,'P0001','Fictional reconciliation failure','a failed reconciliation rolls the entire creation back');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='eaa10000-0000-4000-8000-000000000001' AND last_name='Fixture8'),1,'failure leaves no extra student');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='eaa10000-0000-4000-8000-000000000001' AND correlation_id=md5('homonym-request:8')::uuid),0,'failure leaves no successful creation receipt');
SELECT extensions.is((SELECT count(*)::integer FROM original_profiles old JOIN plugin_data.csf_profiles p USING(id) WHERE old.value IS DISTINCT FROM to_jsonb(p)),0,'all existing profile fields stay unchanged');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts WHERE organization_id='eaa10000-0000-4000-8000-000000000001'),1,'creating a student never connects an account');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id='eaa10000-0000-4000-8000-000000000001'),0,'creating a student never approves membership');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE id=(SELECT (result->>'profileId')::uuid FROM created_homonym) AND (school_email IS NOT NULL OR personal_email IS NOT NULL)),0,'form contacts never become canonical identity');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_create_profile_for_application_import_row(
 'eaa10000-0000-4000-8000-000000000001',md5('homonym-row:8')::uuid,'eaa00000-0000-4000-8000-000000000002',gen_random_uuid(),'Unapproved request')$$,
 '42501',NULL,'a student cannot invoke the reviewed creation path');
SELECT extensions.function_privs_are('plugin_data','csf_create_profile_for_application_import_row_legacy',ARRAY['uuid','uuid','uuid','uuid','text'],'service_role',ARRAY[]::text[],'the receipt-free helper stays owner-only');
SELECT * FROM extensions.finish();
ROLLBACK;
