BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot redeem class codes through a browser-direct RPC'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can perform the audited class-code join operation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ca100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@local.test', now(), '{}', '{}', now(), now()),
  ('ca100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'exact@local.test', now(), '{}', '{}', now(), now()),
  ('ca100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'new@local.test', now(), '{}', '{}', now(), now()),
  ('ca100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ambiguous@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ca200000-0000-4000-8000-000000000001', 'Class Join Test',
  'class-join-test', 'school', '984002'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001', 'admin', 'active'
);
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  (
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001', 2033, 'Class of 2033'
  ),
  (
    'ca300000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000001', 2034, 'Class of 2034'
  );

CREATE TEMP TABLE class_join_test_code AS
SELECT plugin_data.csf_rotate_class_join_code(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001'
) ->> 'code' AS code;

CREATE TEMP TABLE class_join_replay_results (
  scenario text PRIMARY KEY,
  payload jsonb NOT NULL
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('ca400000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'Exact', 'Member', 'exact', 'member', 'exact@local.test', 'exact@local.test'),
  ('ca400000-0000-4000-8000-000000000002', 'ca200000-0000-4000-8000-000000000001', 'Ambiguous', 'One', 'ambiguous', 'one', 'ambiguous@local.test', 'ambiguous@local.test'),
  ('ca400000-0000-4000-8000-000000000003', 'ca200000-0000-4000-8000-000000000001', 'Ambiguous', 'Two', 'ambiguous', 'two', 'ambiguous@local.test', 'ambiguous@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('ca200000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'active'),
  ('ca200000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000001', 'active'),
  ('ca200000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000003', 'ca300000-0000-4000-8000-000000000001', 'active');


INSERT INTO class_join_replay_results VALUES ('first',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
UPDATE class_join_test_code SET code=plugin_data.csf_rotate_class_join_code('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')->>'code';
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'requestId',(SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='first'),'rotation reuses the same open cohort request');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_link_requests WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),1::bigint,'rotation creates no duplicate request');
UPDATE plugin_data.csf_profile_link_requests SET match_status='rejected',resolved_by='ca100000-0000-4000-8000-000000000001',resolved_at=now(),resolution_notes='Wrong student identity verified by officer.' WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002';
UPDATE class_join_test_code SET code=plugin_data.csf_rotate_class_join_code('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')->>'code';
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'rejected','true','rotating again preserves the staff rejection');
INSERT INTO plugin_data.csf_profile_link_requests(organization_id,cohort_id,user_id,signed_in_email,first_name,last_name,normalized_first_name,normalized_last_name,match_status) VALUES('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member','exact','member','needs_review');
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'rejected','true','legacy open duplicate cannot override terminal rejection');
UPDATE plugin_data.csf_profile_link_requests SET match_status='resolved',matched_profile_id='ca400000-0000-4000-8000-000000000001',resolved_by='ca100000-0000-4000-8000-000000000001',resolved_at=now() WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002' AND match_status='needs_review';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)$q$,'P0001','This class has conflicting connection decisions. Staff must review them before you can continue.','contradictory legacy decisions fail closed');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_link_requests WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),2::bigint,'legacy duplicate evidence is preserved');
UPDATE plugin_data.csf_profile_link_requests SET match_status='needs_review',matched_profile_id=NULL,resolved_by=NULL,resolved_at=NULL WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002';
SELECT plugin_data.csf_staff_connect_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','exact@local.test','Confirmed student identity in person.','ca900000-0000-4000-8000-000000000001');
UPDATE class_join_test_code SET code=plugin_data.csf_rotate_class_join_code('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')->>'code';
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'connected','true','rotation preserves a staff-verified returning connection');
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'connectionBasis','officer_decision','rotation retains the positive ownership receipt');

INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,connection_basis)
VALUES('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000003','pending',false,'unknown');
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'needsReview','true','a resolved cohort request reopens for a later competing ownership hold');
SELECT extensions.is((SELECT status FROM plugin_data.csf_profile_accounts WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),'verified','request review does not revoke the established account connection');

SELECT * FROM extensions.finish();
ROLLBACK;
