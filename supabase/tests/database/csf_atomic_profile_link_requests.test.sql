BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(33);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_submit_profile_link_request(uuid,text,uuid,text,text,text,text,text,text,text,text,text,integer,text,integer,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot invoke the manual profile-link transaction directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_submit_profile_link_request(uuid,text,uuid,text,text,text,text,text,text,text,text,text,integer,text,integer,text)',
    'EXECUTE'
  ),
  'the trusted server can submit a manual profile-link request'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('f2100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'link-admin@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fallback-exact@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'existing-link@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'outside-link@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'wrong-class-link@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'closed-link@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'no-class-link@local.test', now(), '{}', '{}', now(), now()),
  ('f2100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'mismatched-application@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('f2200000-0000-4000-8000-000000000001', 'CSF Link Request Test', 'csf-link-request-test', 'school', '992202');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('f2200000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000003', 'admin', 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000006', 'staff', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('f2300000-0000-4000-8000-000000000001', 'f2200000-0000-4000-8000-000000000001', 'F40', 'Fall 2040', '2040-2041', 'fall', true),
  ('f2300000-0000-4000-8000-000000000002', 'f2200000-0000-4000-8000-000000000001', 'S41', 'Spring 2041', '2040-2041', 'spring', false);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('f2400000-0000-4000-8000-000000000001', 'f2200000-0000-4000-8000-000000000001', 2042, 'Class of 2042'),
  ('f2400000-0000-4000-8000-000000000002', 'f2200000-0000-4000-8000-000000000001', 2043, 'Class of 2043');

INSERT INTO plugin_data.csf_cohort_terms (
  organization_id, cohort_id, term_id, grade_level, status
) VALUES
  ('f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 11, 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000002', 11, 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('f2500000-0000-4000-8000-000000000002', 'f2200000-0000-4000-8000-000000000001', 'Fallback', 'Exact', 'fallback', 'exact', 'fallback-exact@local.test', 'fallback-exact@local.test'),
  ('f2500000-0000-4000-8000-000000000003', 'f2200000-0000-4000-8000-000000000001', 'Existing', 'Link', 'existing', 'link', 'existing-link@local.test', 'existing-link@local.test'),
  ('f2500000-0000-4000-8000-000000000005', 'f2200000-0000-4000-8000-000000000001', 'Wrong', 'Class', 'wrong', 'class', 'wrong-class-link@local.test', 'wrong-class-link@local.test'),
  ('f2500000-0000-4000-8000-000000000006', 'f2200000-0000-4000-8000-000000000001', 'Closed', 'Link', 'closed', 'link', 'closed-link@local.test', 'closed-link@local.test'),
  ('f2500000-0000-4000-8000-000000000007', 'f2200000-0000-4000-8000-000000000001', 'No', 'Class', 'no', 'class', 'no-class-link@local.test', 'no-class-link@local.test'),
  ('f2500000-0000-4000-8000-000000000008', 'f2200000-0000-4000-8000-000000000001', 'Mismatched', 'Application', 'mismatched', 'application', 'mismatched-application@local.test', 'mismatched-application@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000002', 'f2400000-0000-4000-8000-000000000001', 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000003', 'f2400000-0000-4000-8000-000000000001', 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000005', 'f2400000-0000-4000-8000-000000000002', 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000006', 'f2400000-0000-4000-8000-000000000001', 'active'),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000008', 'f2400000-0000-4000-8000-000000000001', 'active');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000003', 'f2100000-0000-4000-8000-000000000003', 'verified', true),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000005', 'f2100000-0000-4000-8000-000000000005', 'verified', true),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000006', 'f2100000-0000-4000-8000-000000000006', 'verified', true),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000007', 'f2100000-0000-4000-8000-000000000007', 'verified', true),
  ('f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000008', 'f2100000-0000-4000-8000-000000000008', 'verified', true);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  ('f2600000-0000-4000-8000-000000000003', 'f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000003', 'f2400000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'manual', 'accepted'),
  ('f2600000-0000-4000-8000-000000000006', 'f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000006', 'f2400000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000002', 'manual', 'accepted'),
  ('f2600000-0000-4000-8000-000000000008', 'f2200000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000008', 'f2400000-0000-4000-8000-000000000002', 'f2300000-0000-4000-8000-000000000001', 'manual', 'accepted');

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title,
  invitation_scope, delivery_status, is_active
) VALUES
  ('f2700000-0000-4000-8000-000000000001', 'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001', 'fallback-review-token-long-enough-00001', 'Fallback review', 'cohort', 'link_ready', true),
  ('f2700000-0000-4000-8000-000000000002', 'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001', 'wrong-class-token-long-enough-0000001', 'Wrong class review', 'cohort', 'link_ready', true),
  ('f2700000-0000-4000-8000-000000000003', 'f2200000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000002', 'f2400000-0000-4000-8000-000000000001', 'closed-link-token-long-enough-0000001', 'Closed term identity link', 'cohort', 'link_ready', true);

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title, link_type,
  invitation_scope, delivery_status, is_active
) VALUES (
  'f2700000-0000-4000-8000-000000000004',
  'f2200000-0000-4000-8000-000000000001',
  'f2300000-0000-4000-8000-000000000001',
  'f2400000-0000-4000-8000-000000000001',
  'application-only-link-long-enough-0001',
  'Application only', 'application_google_form', 'cohort', 'link_ready', true
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'application-only-link-long-enough-0001',
      'f2100000-0000-4000-8000-000000000002',
      'fallback-exact@local.test',
      'Fallback', NULL, 'Exact', NULL, NULL, 'fallback-exact@local.test',
      'fallback', 'exact', NULL, NULL, 11, 'unknown'
    )
  $$,
  'P0001',
  'This CSF class invitation is no longer active.',
  'an application-only cohort link cannot submit a profile connection request'
);

CREATE TEMP TABLE csf_atomic_link_results (
  scenario text NOT NULL,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'fallback', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'fallback-review-token-long-enough-00001',
      'f2100000-0000-4000-8000-000000000002',
      'fallback-exact@local.test',
      'Fallback', NULL, 'Exact', NULL, NULL, 'fallback-exact@local.test',
      'fallback', 'exact', NULL, NULL, 11, 'unknown'
    )
  $$,
  'a reusable-link fallback is submitted atomically'
);
SELECT extensions.ok(
  (
    SELECT payload->>'status' = 'needs_review'
      AND payload->'profileId' = 'null'::jsonb
      AND payload::text NOT LIKE '%f2500000-0000-4000-8000-000000000002%'
    FROM csf_atomic_link_results
    WHERE scenario = 'fallback'
  ),
  'an exact fallback match does not bypass signed confirmation or disclose a profile ID'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000002'
  ),
  'an unresolved fallback grants neither host membership nor a profile account link'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_link_requests AS request
    WHERE request.organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND request.user_id = 'f2100000-0000-4000-8000-000000000002'
      AND request.match_status = 'needs_review'
      AND request.candidate_profile_ids = ARRAY['f2500000-0000-4000-8000-000000000002'::uuid]
      AND request.claim_correlation_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND audit.actor_user_id = 'f2100000-0000-4000-8000-000000000002'
      AND audit.action = 'profile.link_request_submitted'
      AND audit.reason_code = 'profile_connection_review_requested'
  ),
  'the private review request and its immutable audit event commit together'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'fallback-retry', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'fallback-review-token-long-enough-00001',
      'f2100000-0000-4000-8000-000000000002',
      'fallback-exact@local.test',
      'Fallback', NULL, 'Exact', NULL, NULL, 'fallback-exact@local.test',
      'fallback', 'exact', NULL, NULL, 11, 'unknown'
    )
  $$,
  'retrying an identical fallback request succeeds'
);
SELECT extensions.ok(
  (
    SELECT retry.payload->>'requestId' = original.payload->>'requestId'
      AND retry.payload->>'correlationId' = original.payload->>'correlationId'
      AND (retry.payload->>'idempotentReplay')::boolean
    FROM csf_atomic_link_results AS original
    JOIN csf_atomic_link_results AS retry ON retry.scenario = 'fallback-retry'
    WHERE original.scenario = 'fallback'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND actor_user_id = 'f2100000-0000-4000-8000-000000000002'
      AND action = 'profile.link_request_submitted'
  ),
  'an unknown-outcome retry reuses the request and writes no duplicate audit'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'fallback-corrected', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'fallback-review-token-long-enough-00001',
      'f2100000-0000-4000-8000-000000000002',
      'fallback-exact@local.test',
      'Fallback', NULL, 'Exact', 'Fallback E.', NULL, 'fallback-exact@local.test',
      'fallback', 'exact', NULL, NULL, 11, 'unknown'
    )
  $$,
  'changed review details create a new visible attempt'
);
SELECT extensions.ok(
  (
    SELECT corrected.payload->>'requestId' <> original.payload->>'requestId'
    FROM csf_atomic_link_results AS original
    JOIN csf_atomic_link_results AS corrected
      ON corrected.scenario = 'fallback-corrected'
    WHERE original.scenario = 'fallback'
  ) AND (
    SELECT count(*) = 2
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000002'
      AND match_status = 'needs_review'
  ),
  'a correction is not silently replaced by the prior review request'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      NULL,
      'f2100000-0000-4000-8000-000000000004',
      'outside-link@local.test',
      'Outside', NULL, 'Link', NULL, NULL, NULL,
      'outside', 'link', 2042, 'F40', 11, 'unknown'
    )
  $$,
  'P0001',
  'Join this organization or use the current class invitation.',
  'My CSF requests require existing active organization membership'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000004'
  ),
  0,
  'a rejected My CSF request leaves no partial row'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'existing', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      NULL,
      'f2100000-0000-4000-8000-000000000003',
      'existing-link@local.test',
      'Existing', NULL, 'Link', NULL, NULL, 'existing-link@local.test',
      'existing', 'link', 2042, 'F40', 11, 'returning'
    )
  $$,
  'an existing verified My CSF profile is connected transactionally'
);
SELECT extensions.ok(
  (
    SELECT (payload->>'connected')::boolean
      AND payload->>'status' = 'auto_linked'
      AND (payload->>'termMembershipActivated')::boolean
    FROM csf_atomic_link_results
    WHERE scenario = 'existing'
  ),
  'the RPC reports the account and open-term membership outcome truthfully'
);
SELECT extensions.is(
  (
    SELECT role::text
    FROM public.organization_members
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000003'
  ),
  'admin',
  'connecting a profile never downgrades an existing organization admin'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND profile_id = 'f2500000-0000-4000-8000-000000000003'
      AND term_id = 'f2300000-0000-4000-8000-000000000001'
  ),
  'active',
  'an accepted application receives one active open-term membership'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND actor_user_id = 'f2100000-0000-4000-8000-000000000003'
      AND action = 'profile.existing_account_connected'
  ),
  1,
  'the existing-profile connection writes one correlated audit event'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'existing-retry', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      NULL,
      'f2100000-0000-4000-8000-000000000003',
      'existing-link@local.test',
      'Existing', NULL, 'Link', NULL, NULL, 'existing-link@local.test',
      'existing', 'link', 2042, 'F40', 11, 'returning'
    )
  $$,
  'a valid connected profile can be retried after an unknown outcome'
);
SELECT extensions.ok(
  (
    SELECT retry.payload->>'requestId' = original.payload->>'requestId'
      AND (retry.payload->>'connected')::boolean
      AND (retry.payload->>'termMembershipActivated')::boolean
      AND (retry.payload->>'idempotentReplay')::boolean
    FROM csf_atomic_link_results AS original
    JOIN csf_atomic_link_results AS retry
      ON retry.scenario = 'existing-retry'
    WHERE original.scenario = 'existing'
  ) AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND actor_user_id = 'f2100000-0000-4000-8000-000000000003'
      AND action = 'profile.existing_account_connected'
  ),
  'a valid retry returns the original truth without a duplicate audit'
);

UPDATE plugin_data.csf_profile_accounts
SET status = 'revoked', is_primary = false, revoked_at = now()
WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
  AND profile_id = 'f2500000-0000-4000-8000-000000000003'
  AND user_id = 'f2100000-0000-4000-8000-000000000003';

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'stale-retry', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      NULL,
      'f2100000-0000-4000-8000-000000000003',
      'existing-link@local.test',
      'Existing', NULL, 'Link', NULL, NULL, 'existing-link@local.test',
      'existing', 'link', 2042, 'F40', 11, 'returning'
    )
  $$,
  'an unknown-outcome retry revalidates the current account connection'
);
SELECT extensions.ok(
  (
    SELECT payload->>'status' = 'needs_review'
      AND NOT (payload->>'connected')::boolean
      AND payload->'profileId' = 'null'::jsonb
      AND NOT (payload->>'idempotentReplay')::boolean
    FROM csf_atomic_link_results
    WHERE scenario = 'stale-retry'
  ),
  'a revoked connection is never returned as a successful idempotent replay'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_link_requests AS request
    WHERE request.organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND request.user_id = 'f2100000-0000-4000-8000-000000000003'
      AND request.match_status = 'needs_review'
      AND request.matched_profile_id IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND audit.actor_user_id = 'f2100000-0000-4000-8000-000000000003'
      AND audit.action = 'profile.link_request_revalidation_failed'
      AND audit.reason_code = 'profile_connection_revalidation_required'
  ),
  'failed replay revalidation is persisted and audited atomically'
);

SELECT extensions.is(
  (
    plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'wrong-class-token-long-enough-0000001',
      'f2100000-0000-4000-8000-000000000005',
      'wrong-class-link@local.test',
      'Wrong', NULL, 'Class', NULL, NULL, 'wrong-class-link@local.test',
      'wrong', 'class', NULL, NULL, 11, 'unknown'
    )->>'status'
  ),
  'needs_review',
  'an existing profile from another class routes to officer review'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND profile_id = 'f2500000-0000-4000-8000-000000000005'
      AND cohort_id = 'f2400000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000005'
  ),
  'a class conflict creates no incorrect cohort or host membership'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'no-class', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'fallback-review-token-long-enough-00001',
      'f2100000-0000-4000-8000-000000000007',
      'no-class-link@local.test',
      'No', NULL, 'Class', NULL, NULL, 'no-class-link@local.test',
      'no', 'class', NULL, NULL, 11, 'unknown'
    )
  $$,
  'an existing account without class history is routed atomically to review'
);
SELECT extensions.is(
  (
    SELECT payload->>'status'
    FROM csf_atomic_link_results
    WHERE scenario = 'no-class'
  ),
  'needs_review',
  'an existing account cannot self-assign its profile to the invitation class'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND profile_id = 'f2500000-0000-4000-8000-000000000007'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND user_id = 'f2100000-0000-4000-8000-000000000007'
  ),
  'review routing creates neither a cohort assignment nor host membership'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'mismatched-application', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'fallback-review-token-long-enough-00001',
      'f2100000-0000-4000-8000-000000000008',
      'mismatched-application@local.test',
      'Mismatched', NULL, 'Application', NULL, NULL, 'mismatched-application@local.test',
      'mismatched', 'application', NULL, NULL, 11, 'returning'
    )
  $$,
  'a verified identity with a mismatched accepted application remains connectable'
);
SELECT extensions.ok(
  (
    SELECT (payload->>'connected')::boolean
      AND NOT (payload->>'termMembershipActivated')::boolean
    FROM csf_atomic_link_results
    WHERE scenario = 'mismatched-application'
  ),
  'identity connection does not treat another cohort application as membership approval'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND profile_id = 'f2500000-0000-4000-8000-000000000008'
      AND term_id = 'f2300000-0000-4000-8000-000000000001'
  ),
  'a mismatched accepted application cannot activate a term membership'
);

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id, reopenable
) VALUES (
  'f2800000-0000-4000-8000-000000000001',
  'f2200000-0000-4000-8000-000000000001',
  'f2300000-0000-4000-8000-000000000002',
  1, '{}'::jsonb, '[]'::jsonb,
  'f2100000-0000-4000-8000-000000000001',
  1, 'f2810000-0000-4000-8000-000000000001', false
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id,
  status, status_reason, completed_at, finalized_closure_id,
  finalized_revision, finalized_correlation_id, updated_at
) VALUES (
  'f2900000-0000-4000-8000-000000000001',
  'f2200000-0000-4000-8000-000000000001',
  'f2500000-0000-4000-8000-000000000006',
  'f2300000-0000-4000-8000-000000000002',
  'f2400000-0000-4000-8000-000000000001',
  'f2600000-0000-4000-8000-000000000006',
  'completed', 'Closed fixture outcome.', '2041-05-01T12:00:00Z',
  'f2800000-0000-4000-8000-000000000001', 1,
  'f2910000-0000-4000-8000-000000000001',
  '2041-05-01T12:00:00Z'
);

INSERT INTO plugin_data.csf_term_close_authorizations (
  transaction_id, organization_id, term_id, closure_id,
  closure_revision, actor_user_id, correlation_id
) VALUES (
  pg_catalog.txid_current(),
  'f2200000-0000-4000-8000-000000000001',
  'f2300000-0000-4000-8000-000000000002',
  'f2800000-0000-4000-8000-000000000001',
  1,
  'f2100000-0000-4000-8000-000000000001',
  'f2810000-0000-4000-8000-000000000001'
);

UPDATE plugin_data.csf_terms
SET lifecycle_status = 'closed',
    closed_at = '2041-05-01T12:00:00Z',
    closed_by = 'f2100000-0000-4000-8000-000000000001',
    closure_policy_version = 1,
    closure_revision = 1,
    latest_closure_id = 'f2800000-0000-4000-8000-000000000001',
    active_closure_id = 'f2800000-0000-4000-8000-000000000001'
WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
  AND id = 'f2300000-0000-4000-8000-000000000002';

DELETE FROM plugin_data.csf_term_close_authorizations
WHERE transaction_id = pg_catalog.txid_current()
  AND organization_id = 'f2200000-0000-4000-8000-000000000001'
  AND term_id = 'f2300000-0000-4000-8000-000000000002';

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_atomic_link_results (scenario, payload)
    SELECT 'closed', plugin_data.csf_submit_profile_link_request(
      'f2200000-0000-4000-8000-000000000001',
      'closed-link-token-long-enough-0000001',
      'f2100000-0000-4000-8000-000000000006',
      'closed-link@local.test',
      'Closed', NULL, 'Link', NULL, NULL, 'closed-link@local.test',
      'closed', 'link', NULL, NULL, 11, 'returning'
    )
  $$,
  'identity connection succeeds after semester close'
);
SELECT extensions.ok(
  (
    SELECT (payload->>'connected')::boolean
      AND NOT (payload->>'termMembershipActivated')::boolean
    FROM csf_atomic_link_results
    WHERE scenario = 'closed'
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships
    WHERE id = 'f2900000-0000-4000-8000-000000000001'
      AND status = 'completed'
      AND finalized_closure_id = 'f2800000-0000-4000-8000-000000000001'
      AND updated_at = '2041-05-01T12:00:00Z'::timestamptz
  )
  AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'f2200000-0000-4000-8000-000000000001'
      AND actor_user_id = 'f2100000-0000-4000-8000-000000000006'
      AND action = 'profile.existing_account_connected'
      AND (after_data->>'termMembershipActivated')::boolean = false
  ),
  'closed-term connection preserves frozen membership bytes and audits no activation'
);

SELECT * FROM extensions.finish();
ROLLBACK;
