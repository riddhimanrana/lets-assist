BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES ('fc100000-0000-4000-8000-000000000001','authenticated','authenticated','connect-admin@local.test',now(),'{}','{}',now(),now()),
('fc100000-0000-4000-8000-000000000002','authenticated','authenticated','connect-target@local.test',now(),'{}','{}',now(),now()),
('fc100000-0000-4000-8000-000000000003','authenticated','authenticated','connect-outsider@local.test',now(),'{}','{}',now(),now()),
('fc100000-0000-4000-8000-000000000004','authenticated','authenticated','connect-inactive@local.test',now(),'{}','{}',now(),now()),
('fc100000-0000-4000-8000-000000000005','authenticated','authenticated','connect-unconfirmed@local.test',NULL,'{}','{}',now(),now()),
('fc100000-0000-4000-8000-000000000006','authenticated','authenticated','connect-second@local.test',now(),'{}','{}',now(),now());

INSERT INTO public.organizations(id,name,username,type,join_code) VALUES ('fc110000-0000-4000-8000-000000000001','Staff connection test','staff-connect-test','school','975531'),('fc110000-0000-4000-8000-000000000002','Other staff connection test','staff-connect-other','school','975532');

INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES ('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','admin','active'),('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002','member','active'),('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000004','staff','inactive'),('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000005','member','active'),('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000006','member','active');

INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label,status) VALUES ('fc130000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',2032,'Class of 2032','active'),('fc130000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000002',2032,'Class of 2032','active');

INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email,record_status) VALUES ('fc140000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','Fictional','Student1','fictional','student1','source1@local.test','source1@local.test','active'),('fc140000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000001','Fictional','Student2','fictional','student2','source2@local.test','source2@local.test','active'),('fc140000-0000-4000-8000-000000000003','fc110000-0000-4000-8000-000000000001','Fictional','Student3','fictional','student3','source3@local.test','source3@local.test','active'),('fc140000-0000-4000-8000-000000000004','fc110000-0000-4000-8000-000000000002','Fictional','Student4','fictional','student4','source4@local.test','source4@local.test','active'),('fc140000-0000-4000-8000-000000000005','fc110000-0000-4000-8000-000000000001','Fictional','Student5','fictional','student5','source5@local.test','source5@local.test','active');

INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status) VALUES ('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','active'),('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002','fc130000-0000-4000-8000-000000000001','active'),('fc110000-0000-4000-8000-000000000002','fc140000-0000-4000-8000-000000000004','fc130000-0000-4000-8000-000000000002','active'),('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000005','fc130000-0000-4000-8000-000000000001','active');

UPDATE plugin_data.csf_profiles SET record_status='merged',merged_into_profile_id='fc140000-0000-4000-8000-000000000001',merged_at=now(),merged_by='fc100000-0000-4000-8000-000000000001',merge_reason='Fictional merged record.' WHERE id='fc140000-0000-4000-8000-000000000005';

SELECT extensions.lives_ok($q$
 SELECT plugin_data.csf_staff_connect_profile_account(
 'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
 'fc100000-0000-4000-8000-000000000001','connect-target@local.test',
 'Fixture identity initially connected to the wrong record.','fc190000-0000-4000-8000-000000000011')
$q$,'staff creates the original connection');
SELECT extensions.lives_ok($q$
 SELECT plugin_data.csf_unlink_profile_account(
 'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
 (SELECT id FROM plugin_data.csf_profile_accounts WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000002'),
 'Staff verified that the account belongs to the other record.','fc100000-0000-4000-8000-000000000001')
$q$,'staff unlinks the incorrect record through the authorized action');
SELECT extensions.lives_ok($q$
 SELECT plugin_data.csf_staff_connect_profile_account(
 'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002',
 'fc100000-0000-4000-8000-000000000001','connect-target@local.test',
 'Staff independently verified ownership of the corrected record.','fc190000-0000-4000-8000-000000000012')
$q$,'staff connects the correct record despite a different reported contact');
CREATE TEMP TABLE returning_codes AS SELECT plugin_data.csf_rotate_class_join_code(
 'fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001',
 'fc100000-0000-4000-8000-000000000001') AS result;
CREATE TEMP TABLE returning_results(scenario text,result jsonb);
INSERT INTO returning_results VALUES ('first',plugin_data.csf_join_class_by_code(
 'fc110000-0000-4000-8000-000000000001',(SELECT result->>'code' FROM returning_codes),
 'fc100000-0000-4000-8000-000000000002','connect-target@local.test','Fictional','Student2'));
SELECT extensions.is((SELECT result->>'connected' FROM returning_results WHERE scenario='first'),'true','first class-code request accepts a staff-verified connection despite revoked history');
SELECT extensions.is((SELECT result->>'profileId' FROM returning_results WHERE scenario='first'),'fc140000-0000-4000-8000-000000000002','returning account reaches the corrected profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND profile_id='fc140000-0000-4000-8000-000000000001' AND status='revoked'),1,'the old connection remains revoked');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND match_status IN ('pending','needs_review')),0,'verified return does not request redundant staff review');
INSERT INTO returning_results VALUES ('retry',plugin_data.csf_join_class_by_code(
 'fc110000-0000-4000-8000-000000000001',(SELECT result->>'code' FROM returning_codes),
 'fc100000-0000-4000-8000-000000000002','connect-target@local.test','Fictional','Student2'));
SELECT extensions.is((SELECT result->>'connected' FROM returning_results WHERE scenario='retry'),'true','retry preserves the verified corrected connection');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,connection_basis)
 VALUES('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000006','revoked',false,'unknown');
UPDATE returning_codes SET result=plugin_data.csf_rotate_class_join_code(
 'fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001');
INSERT INTO returning_results VALUES ('rotated',plugin_data.csf_join_class_by_code(
 'fc110000-0000-4000-8000-000000000001',(SELECT result->>'code' FROM returning_codes),
 'fc100000-0000-4000-8000-000000000002','connect-target@local.test','Fictional','Student2'));
SELECT extensions.is((SELECT result->>'connected' FROM returning_results WHERE scenario='rotated'),'true','a regenerated code ignores revoked history on both account and profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND status='verified'),1,'joining creates no additional verified connections');
UPDATE plugin_data.csf_profile_accounts SET status='pending' WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000006';
UPDATE returning_codes SET result=plugin_data.csf_rotate_class_join_code(
 'fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001');
INSERT INTO returning_results VALUES ('pending_conflict',plugin_data.csf_join_class_by_code(
 'fc110000-0000-4000-8000-000000000001',(SELECT result->>'code' FROM returning_codes),
 'fc100000-0000-4000-8000-000000000002','connect-target@local.test','Fictional','Student2'));
SELECT extensions.is((SELECT result->>'needsReview' FROM returning_results WHERE scenario='pending_conflict'),'true','a live pending ownership conflict still requires review');
SELECT extensions.is((SELECT role::text FROM public.organization_members WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000002'),'member','connection and returning join do not grant staff access');
SELECT * FROM extensions.finish();
ROLLBACK;
