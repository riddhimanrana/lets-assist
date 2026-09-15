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


INSERT INTO class_join_replay_results VALUES ('original',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT plugin_data.csf_staff_connect_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','exact@local.test','Confirmed student identity in person.','ca900000-0000-4000-8000-000000000001');
UPDATE class_join_test_code SET code=plugin_data.csf_rotate_class_join_code('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')->>'code';
SELECT plugin_data.csf_unlink_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_profile_accounts WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND profile_id='ca400000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),'Staff is correcting the identity connection.','ca100000-0000-4000-8000-000000000001');
SELECT extensions.is((SELECT match_status FROM plugin_data.csf_profile_link_requests WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),'resolved','revocation leaves the historical resolved request to revalidate');
INSERT INTO class_join_replay_results VALUES ('revoked',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT extensions.is((SELECT payload->>'needsReview' FROM class_join_replay_results WHERE scenario='revoked'),'true','revoked produces actionable review');
SELECT extensions.is((SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='revoked'),(SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='original'),'revoked reuses the original request');
INSERT INTO class_join_replay_results VALUES ('revoked_retry',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT extensions.is((SELECT payload->>'needsReview' FROM class_join_replay_results WHERE scenario='revoked_retry'),'true','revoked_retry produces actionable review');
SELECT extensions.is((SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='revoked_retry'),(SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='original'),'revoked_retry reuses the original request');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND action='profile.link_request_revalidation_failed'),1::bigint,'revocation reopens and audits exactly once');
SELECT plugin_data.csf_staff_connect_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','exact@local.test','Confirmed student identity in person.','ca900000-0000-4000-8000-000000000002');
SELECT plugin_data.csf_unlink_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001',(SELECT id FROM plugin_data.csf_profile_accounts WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND profile_id='ca400000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),'Staff is correcting the identity connection.','ca100000-0000-4000-8000-000000000001');
SELECT plugin_data.csf_staff_connect_profile_account('ca200000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','exact@local.test','Confirmed student identity in person.','ca900000-0000-4000-8000-000000000003');
UPDATE class_join_test_code SET code=plugin_data.csf_rotate_class_join_code('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')->>'code';
INSERT INTO class_join_replay_results VALUES ('moved',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT extensions.is((SELECT payload->>'needsReview' FROM class_join_replay_results WHERE scenario='moved'),'true','moved produces actionable review');
SELECT extensions.is((SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='moved'),(SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='original'),'moved reuses the original request');
INSERT INTO class_join_replay_results VALUES ('moved_retry',plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL));
SELECT extensions.is((SELECT payload->>'needsReview' FROM class_join_replay_results WHERE scenario='moved_retry'),'true','moved_retry produces actionable review');
SELECT extensions.is((SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='moved_retry'),(SELECT payload->>'requestId' FROM class_join_replay_results WHERE scenario='original'),'moved_retry reuses the original request');
SELECT extensions.is((SELECT profile_id::text FROM plugin_data.csf_profile_accounts WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002' AND status='verified'),'ca400000-0000-4000-8000-000000000002','review preserves the corrected verified account link');
UPDATE plugin_data.csf_profile_link_requests SET match_status='rejected',resolved_by='ca100000-0000-4000-8000-000000000001',resolved_at=now(),resolution_notes='Staff denied this old identity request.' WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002';
UPDATE class_join_test_code SET code=plugin_data.csf_rotate_class_join_code('ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')->>'code';
SELECT extensions.is(plugin_data.csf_join_class_by_code('ca200000-0000-4000-8000-000000000001',(SELECT code FROM class_join_test_code),'ca100000-0000-4000-8000-000000000002','exact@local.test','Exact','Member',NULL)->>'rejected','true','rotation and verified alternate link cannot override a rejection');
SELECT extensions.is((SELECT match_status FROM plugin_data.csf_profile_link_requests WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),'rejected','denied terminal decision remains denied');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_profile_link_requests WHERE organization_id='ca200000-0000-4000-8000-000000000001' AND user_id='ca100000-0000-4000-8000-000000000002'),1::bigint,'all rotations and retries retain one cohort request');
SELECT * FROM extensions.finish();
ROLLBACK;
