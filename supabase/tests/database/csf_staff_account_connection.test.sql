BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(29);

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

SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)','EXECUTE'), 'anon execution privilege is correct');

SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)','EXECUTE'), 'authenticated execution privilege is correct');

SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)','EXECUTE'), 'service_role execution privilege is correct');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, '42501', NULL, 'ordinary member cannot connect an account');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000003','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, '42501', NULL, 'outsider cannot connect an account');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-target@local.test','short','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'short verification reason is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000004','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'cross organization profile is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000005','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'merged profile is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000003','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'profile without an active class is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-outsider@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'nonmember target is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-inactive@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'inactive target membership is preserved');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-unconfirmed@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'unconfirmed login email is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','missing@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'unknown login email is rejected');

SELECT extensions.lives_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001',' CONNECT-TARGET@LOCAL.TEST ','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'staff can connect a confirmed organization member whose roster email differs');

SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND profile_id='fc140000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000002' AND status='verified' AND connection_basis='officer_decision' AND linked_by='fc100000-0000-4000-8000-000000000001'), 'connection records officer provenance');

SELECT extensions.ok((SELECT personal_email='source1@local.test' FROM plugin_data.csf_profiles WHERE id='fc140000-0000-4000-8000-000000000001'), 'roster contact email is preserved');

SELECT extensions.ok(EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND user_id='fc100000-0000-4000-8000-000000000002' AND role='member' AND status='active'), 'host membership role is preserved');

SELECT extensions.ok((SELECT count(*)=1 FROM plugin_data.csf_admin_audit_events WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND correlation_id='fc190000-0000-4000-8000-000000000001' AND action='profile.account_connected_by_staff'), 'one correlated connection audit exists');

SELECT extensions.ok(((plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001'))->>'replayed')::boolean, 'identical retry replays the existing result');

SELECT extensions.ok((SELECT count(*)=1 FROM plugin_data.csf_admin_audit_events WHERE organization_id='fc110000-0000-4000-8000-000000000001' AND correlation_id='fc190000-0000-4000-8000-000000000001' AND action='profile.account_connected_by_staff'), 'retry does not duplicate the audit');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'changed retry profile is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-target@local.test','A different reason for this request.','fc190000-0000-4000-8000-000000000001')$q$, 'P0001', NULL, 'changed retry reason is rejected');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','connect-target@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000002')$q$, 'P0001', NULL, 'verified account cannot move to another profile');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','connect-second@local.test','Confirmed identity with this student.','fc190000-0000-4000-8000-000000000003')$q$, 'P0001', NULL, 'verified profile cannot receive another account');

SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM plugin_data.csf_term_memberships WHERE organization_id='fc110000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_credit_records WHERE organization_id='fc110000-0000-4000-8000-000000000001'), 'identity linking grants no semester credit');

UPDATE auth.users SET email='connect-renamed@local.test'
WHERE id='fc100000-0000-4000-8000-000000000002';

SELECT extensions.ok(
  (plugin_data.csf_staff_connect_profile_account(
    'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001','connect-target@local.test',
    'Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001'
  )->>'replayed')::boolean,
  'the original request remains a historical receipt after a login email change'
);
SELECT extensions.ok(
  (SELECT count(*)=1 FROM plugin_data.csf_admin_audit_events
   WHERE organization_id='fc110000-0000-4000-8000-000000000001'
     AND action='profile.account_connected_by_staff')
  AND EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id='fc110000-0000-4000-8000-000000000001'
      AND profile_id='fc140000-0000-4000-8000-000000000001'
      AND user_id='fc100000-0000-4000-8000-000000000002' AND status='verified'),
  'historical replay neither creates another link nor repeats the audit'
);
SELECT extensions.throws_ok(
  $q$SELECT plugin_data.csf_staff_connect_profile_account(
    'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000002',
    'fc100000-0000-4000-8000-000000000001','connect-target@local.test',
    'Confirmed identity with this student.','fc190000-0000-4000-8000-000000000004')$q$,
  'P0001','Exactly one active organization member must have that confirmed login email.',
  'a new request cannot use the stale login email'
);
SELECT extensions.throws_ok(
  $q$SELECT plugin_data.csf_staff_connect_profile_account(
    'fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001','connect-renamed@local.test',
    'Confirmed identity with this student.','fc190000-0000-4000-8000-000000000001')$q$,
  'P0001','This request ID was already used for a different connection.',
  'a receipt request ID cannot be reused with a changed email'
);

SELECT * FROM extensions.finish();

ROLLBACK;
