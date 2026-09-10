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


INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,connection_basis)
VALUES('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002','verified',true,'unknown');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_hold_unproven_account_connections('fc110000-0000-4000-8000-000000000001',ARRAY[]::uuid[])$q$,'P0001',NULL,'changed scope aborts the hold');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_hold_unproven_account_connections('fc110000-0000-4000-8000-000000000001',ARRAY['fc190000-0000-4000-8000-000000000099']::uuid[])$q$,'P0001',NULL,'a different account with the same count cannot pass the scope check');
INSERT INTO plugin_data.csf_profile_link_requests
  (organization_id,user_id,first_name,last_name,normalized_first_name,normalized_last_name,
   matched_profile_id,match_status,resolved_by,resolved_at)
VALUES ('fc110000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002',
  'Fictional','Student1','fictional','student1','fc140000-0000-4000-8000-000000000001',
  'resolved','fc100000-0000-4000-8000-000000000001',now());
SELECT extensions.is(plugin_data.csf_hold_unproven_account_connections('fc110000-0000-4000-8000-000000000001',ARRAY(SELECT id FROM plugin_data.csf_profile_accounts WHERE organization_id='fc110000-0000-4000-8000-000000000001')),1,'only the previewed connection is held');
SELECT extensions.ok((SELECT match_status='needs_review' AND resolved_by IS NULL AND resolved_at IS NULL
  FROM plugin_data.csf_profile_link_requests WHERE organization_id='fc110000-0000-4000-8000-000000000001'),
  'the old resolved request returns to staff review without a stale decision');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE organization_id='fc110000-0000-4000-8000-000000000001'
    AND action='profile.link_request_ownership_review_required'),1::bigint,'reopening the request is audited');
SELECT extensions.is((SELECT status FROM plugin_data.csf_profile_accounts WHERE profile_id='fc140000-0000-4000-8000-000000000001'),'pending','history ownership requires review');
SELECT extensions.is((SELECT status FROM public.organization_members WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000002'),'active','organization access remains active');
SELECT extensions.is((SELECT count(*) FROM auth.users WHERE id='fc100000-0000-4000-8000-000000000002'),1::bigint,'login account is preserved');
SELECT extensions.is((SELECT role FROM public.organization_members WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000001'),'admin','staff authority is preserved');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND action='profile.account_ownership_review_required'),1::bigint,'restriction has an audit receipt');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Verified identity with the student in person.','fc190000-0000-4000-8000-000000000001')$q$,'staff can verify the held account using a different application email');
SELECT extensions.is((SELECT connection_basis FROM plugin_data.csf_profile_accounts WHERE profile_id='fc140000-0000-4000-8000-000000000001'),'officer_decision','restored connection records independent staff verification');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE id='fc140000-0000-4000-8000-000000000001'),'source1@local.test','staff verification does not overwrite source contact');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_hold_unproven_account_connections(uuid,uuid[])','EXECUTE'),'application service cannot run the operator hold');
-- A historical email match is not ownership proof, even if an older join
-- recorded its basis as verified_email. New self-owned and staff links survive.
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,connection_basis)
VALUES
('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000003','verified',true,'verified_email'),
('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000003','fc100000-0000-4000-8000-000000000004','verified',true,'verified_email'),
('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000005','fc100000-0000-4000-8000-000000000006','verified',true,'officer_decision');
UPDATE plugin_data.csf_profiles SET source_summary=jsonb_build_object(
  'createdBy','permanent_class_code','accountOwnerUserId','fc100000-0000-4000-8000-000000000004')
WHERE id='fc140000-0000-4000-8000-000000000003';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_hold_unproven_account_connections('fc110000-0000-4000-8000-000000000001',ARRAY[]::uuid[])$q$,'P0001',NULL,'the preview includes legacy verified-email matches');
SELECT extensions.is(plugin_data.csf_hold_unproven_account_connections('fc110000-0000-4000-8000-000000000001',ARRAY(
  SELECT id FROM plugin_data.csf_profile_accounts WHERE profile_id='fc140000-0000-4000-8000-000000000002'
)),1,'the legacy contact-only connection is held');
SELECT extensions.is((SELECT status FROM plugin_data.csf_profile_accounts WHERE profile_id='fc140000-0000-4000-8000-000000000002'),'pending','legacy verified-email labels do not grant history ownership');
SELECT extensions.is((SELECT status FROM plugin_data.csf_profile_accounts WHERE profile_id='fc140000-0000-4000-8000-000000000003'),'verified','a new self-owned profile retains access');
SELECT extensions.is((SELECT status FROM plugin_data.csf_profile_accounts WHERE profile_id='fc140000-0000-4000-8000-000000000005'),'verified','independent staff verification retains access');
SELECT extensions.is(plugin_data.csf_hold_unproven_account_connections('fc110000-0000-4000-8000-000000000001',ARRAY[]::uuid[]),0,'a fresh empty preview makes retries harmless');
SELECT * FROM extensions.finish();
ROLLBACK;
