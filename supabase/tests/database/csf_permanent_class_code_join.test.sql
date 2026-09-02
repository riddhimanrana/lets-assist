BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(29);

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

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  ) ->> 'connected',
  'true',
  'one exact verified-email class profile connects automatically'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND profile_id = 'ca400000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000002'
      AND status = 'verified'
  ),
  'the exact-email connection creates a verified account link'
);
INSERT INTO class_join_replay_results (scenario, payload)
SELECT
  'safe exact-email replay',
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM class_join_replay_results
   WHERE scenario = 'safe exact-email replay'),
  'true',
  'an unchanged exact-email connection remains connected on replay'
);
SELECT extensions.is(
  (SELECT payload ->> 'replayed' FROM class_join_replay_results
   WHERE scenario = 'safe exact-email replay'),
  'true',
  'repeating a class-code redemption is idempotent'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000002'
  ),
  1,
  'an idempotent redemption does not duplicate its link request'
);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000002',
  'active'
);
INSERT INTO class_join_replay_results (scenario, payload)
SELECT
  'exact-email replay after class drift',
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM class_join_replay_results
   WHERE scenario = 'exact-email replay after class drift'),
  'false',
  'an exact-email replay fails closed after a second active class appears'
);
SELECT extensions.is(
  (SELECT payload ->> 'needsReview' FROM class_join_replay_results
   WHERE scenario = 'exact-email replay after class drift'),
  'true',
  'class drift returns a durable officer-review state'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002'),
  'needs_review',
  'class drift reopens the exact existing request'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND profile_id = 'ca400000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002'),
  'revoked',
  'class drift revokes the exact stale verified link'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND audit.actor_user_id = 'ca100000-0000-4000-8000-000000000002'
      AND audit.actor_profile_id = 'ca400000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (audit.after_data -> 'blockerCodes') ? 'active_class_changed'
  ),
  'class drift records its stable blocker code'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (
        coalesce(audit.before_data::text, '') || coalesce(audit.after_data::text, '')
      ) ~* '(exact@local[.]test|exact member)'
  ),
  'replay-revalidation audits contain no email or student name'
);

DELETE FROM plugin_data.csf_profile_cohort_memberships
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND profile_id = 'ca400000-0000-4000-8000-000000000001'
  AND cohort_id = 'ca300000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_accounts
SET status = 'verified',
    is_primary = true,
    linked_by = user_id,
    revoked_at = NULL,
    notes = 'Connected by one exact verified-email class match.'
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND profile_id = 'ca400000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_link_requests
SET match_status = 'auto_linked',
    resolution_notes = 'Connected by one exact verified-email match in the selected class.',
    resolved_by = user_id,
    resolved_at = (
      SELECT account.linked_at
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id =
        plugin_data.csf_profile_link_requests.organization_id
        AND account.profile_id =
          plugin_data.csf_profile_link_requests.matched_profile_id
        AND account.user_id = plugin_data.csf_profile_link_requests.user_id
    )
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profiles
SET record_status = 'merged',
    merged_into_profile_id = 'ca400000-0000-4000-8000-000000000002',
    merged_at = now(),
    merged_by = 'ca100000-0000-4000-8000-000000000001',
    merge_reason = 'Synthetic replay-state fixture.'
WHERE id = 'ca400000-0000-4000-8000-000000000001';
INSERT INTO class_join_replay_results (scenario, payload)
SELECT
  'exact-email replay after profile drift',
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM class_join_replay_results
   WHERE scenario = 'exact-email replay after profile drift'),
  'false',
  'an exact-email replay fails closed after the profile becomes inactive'
);
SELECT extensions.ok(
  (SELECT match_status = 'needs_review'
   FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002')
  AND
  (SELECT status = 'revoked'
   FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND profile_id = 'ca400000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002'),
  'profile drift reopens the request and revokes the exact link'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (audit.after_data -> 'blockerCodes') ? 'profile_not_active'
  ),
  'inactive-profile replay records its blocker code'
);

UPDATE plugin_data.csf_profiles
SET record_status = 'active', merged_into_profile_id = NULL, merged_at = NULL,
    merged_by = NULL, merge_reason = NULL
WHERE id = 'ca400000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_profile_accounts
SET status = 'verified',
    is_primary = true,
    linked_by = user_id,
    revoked_at = NULL,
    notes = 'Connected by one exact verified-email class match.'
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND profile_id = 'ca400000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_link_requests
SET match_status = 'auto_linked',
    resolution_notes = 'Connected by one exact verified-email match in the selected class.',
    resolved_by = user_id,
    resolved_at = (
      SELECT account.linked_at
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id =
        plugin_data.csf_profile_link_requests.organization_id
        AND account.profile_id =
          plugin_data.csf_profile_link_requests.matched_profile_id
        AND account.user_id = plugin_data.csf_profile_link_requests.user_id
    )
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
INSERT INTO class_join_replay_results (scenario, payload)
SELECT
  'exact-email replay after access drift',
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM class_join_replay_results
   WHERE scenario = 'exact-email replay after access drift'),
  'false',
  'an exact-email replay fails closed after organization access becomes inactive'
);
SELECT extensions.ok(
  (SELECT match_status = 'needs_review'
   FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002')
  AND
  (SELECT status = 'revoked'
   FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND profile_id = 'ca400000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002'),
  'inactive access reopens the request and revokes the exact link'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (audit.after_data -> 'blockerCodes') ? 'organization_membership_not_active'
  ),
  'inactive organization access records its blocker code'
);

UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_accounts
SET status = 'verified',
    is_primary = true,
    linked_by = user_id,
    revoked_at = NULL,
    notes = 'Connected by one exact verified-email class match.'
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND profile_id = 'ca400000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_link_requests
SET match_status = 'auto_linked',
    resolution_notes = 'Connected by one exact verified-email match in the selected class.',
    resolved_by = user_id,
    resolved_at = (
      SELECT account.linked_at
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id =
        plugin_data.csf_profile_link_requests.organization_id
        AND account.profile_id =
          plugin_data.csf_profile_link_requests.matched_profile_id
        AND account.user_id = plugin_data.csf_profile_link_requests.user_id
    )
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
DELETE FROM public.organization_members
WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  AND user_id = 'ca100000-0000-4000-8000-000000000002';
INSERT INTO class_join_replay_results (scenario, payload)
SELECT
  'exact-email replay after membership removal',
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000002', 'exact@local.test',
    'Exact', 'Member', NULL
  );
SELECT extensions.is(
  (SELECT payload ->> 'connected' FROM class_join_replay_results
   WHERE scenario = 'exact-email replay after membership removal'),
  'false',
  'an exact-email replay fails closed after organization membership is removed'
);
SELECT extensions.ok(
  (SELECT match_status = 'needs_review'
   FROM plugin_data.csf_profile_link_requests
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002')
  AND
  (SELECT status = 'revoked'
   FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
     AND profile_id = 'ca400000-0000-4000-8000-000000000001'
     AND user_id = 'ca100000-0000-4000-8000-000000000002'),
  'missing membership reopens the request and revokes the exact link'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND (audit.after_data -> 'blockerCodes') ? 'organization_membership_not_active'
  ),
  'missing organization membership records its blocker code'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000003', 'new@local.test',
    'New', 'Student', 'New'
  ) ->> 'needsReview',
  'true',
  'no email match creates one officer review request'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND profile.normalized_personal_email = 'new@local.test'
  ) AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND account.user_id = 'ca100000-0000-4000-8000-000000000003'
  ),
  'typed identity creates neither a duplicate profile nor an account link'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
  ),
  0,
  'permanent class-code joins never activate semester membership'
);

SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'ca200000-0000-4000-8000-000000000001', (SELECT code FROM class_join_test_code),
    'ca100000-0000-4000-8000-000000000004', 'ambiguous@local.test',
    'Ambiguous', 'Student', NULL
  ) ->> 'needsReview',
  'true',
  'multiple exact email records enter the officer review queue'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000004'
      AND status = 'verified'
  ),
  'ambiguous evidence does not connect an account automatically'
);
SELECT extensions.is(
  (
    SELECT cardinality(candidate_profile_ids)
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'ca200000-0000-4000-8000-000000000001'
      AND user_id = 'ca100000-0000-4000-8000-000000000004'
  ),
  2,
  'the review request retains both exact-email candidates without name matching'
);

SELECT plugin_data.csf_revoke_class_join_code(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'Join test complete'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_join_class_by_code(
      'ca200000-0000-4000-8000-000000000001', %L,
      'ca100000-0000-4000-8000-000000000003', 'new@local.test',
      'New', 'Student', NULL
    )$$,
    (SELECT code FROM class_join_test_code)
  ),
  'P0001',
  'This CSF class code is no longer active.',
  'revoking a permanent class code invalidates it immediately'
);

SELECT * FROM extensions.finish();
ROLLBACK;
