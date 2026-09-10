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


INSERT INTO class_join_replay_results VALUES ('contact',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT extensions.is((SELECT payload->>'needsReview' FROM class_join_replay_results WHERE scenario='contact'),'true','a unique application email requests staff review');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='ca200000-0000-4000-8000-000000000001'),0::bigint,'a matching contact grants no ownership');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_staff_connect_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','exact@local.test','Confirmed student identity in person.','ca900000-0000-4000-8000-000000000001')$q$,'staff can resolve a waiting identity');
INSERT INTO class_join_replay_results VALUES ('verified',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT extensions.is((SELECT payload->>'connected' FROM class_join_replay_results WHERE scenario='verified'),'true','the independently verified connection can return');
SELECT extensions.is((SELECT payload->>'connectionBasis' FROM class_join_replay_results WHERE scenario='verified'),'officer_decision','the ownership basis remains a staff decision');
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'replayed','true','returning joins are idempotent');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_link_requests WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),1::bigint,'retries keep one request');
UPDATE plugin_data.csf_profiles SET personal_email='other-contact@local.test',normalized_personal_email='other-contact@local.test' WHERE id='ca400000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'connected','true','changing a contact does not change verified ownership');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status) VALUES('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000002','active');
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'connected','false','conflicting active classes do not produce a successful join');
DELETE FROM plugin_data.csf_profile_cohort_memberships WHERE profile_id='ca400000-0000-4000-8000-000000000001' AND cohort_id='ca300000-0000-4000-8000-000000000002';
UPDATE public.organization_members SET status='inactive' WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)$q$,'P0001',NULL,'inactive organization access cannot be restored by a code');
SELECT extensions.is((SELECT status FROM public.organization_members WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),'inactive','inactive access remains inactive');
DELETE FROM public.organization_members WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)$q$,'P0001',NULL,'a returning account cannot recreate removed organization access');
SELECT extensions.is((SELECT count(*) FROM public.organization_members WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),0::bigint,'removed organization access remains absent');
INSERT INTO class_join_replay_results VALUES ('new',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000003','new@local.test','New','Student','New'));
SELECT extensions.is((SELECT payload->>'connected' FROM class_join_replay_results WHERE scenario='new'),'true','a new student can create a self-owned profile');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id='ca200000-0000-4000-8000-000000000001'),0::bigint,'joining awards no semester membership');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_credit_records WHERE organization_id='ca200000-0000-4000-8000-000000000001'),0::bigint,'joining awards no historical credit');
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000004','ambiguous@local.test','Ambiguous','One',NULL)->>'needsReview','true','duplicate contact matches require staff review');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000004'),0::bigint,'ambiguous contact matches receive no account link');
SELECT extensions.is((SELECT role FROM public.organization_members WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000001'),'admin','student joins preserve administrator roles');
SELECT * FROM extensions.finish();
ROLLBACK;
