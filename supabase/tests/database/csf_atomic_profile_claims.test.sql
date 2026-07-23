BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(66);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_actor_has_permission(uuid,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot probe CSF staff permissions directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_profile_claim_candidate(uuid,text,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot query roster claim candidates directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_confirm_profile_claim(uuid,text,uuid,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot bypass the signed claim action'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_decline_profile_claim(uuid,text,uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated clients cannot create arbitrary claim reviews'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot resolve profile connections directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_profile_claim_candidate(uuid,text,uuid,text)', 'EXECUTE'),
  'the server can query a minimal exact-email claim candidate'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_confirm_profile_claim(uuid,text,uuid,uuid,text)', 'EXECUTE'),
  'the server can confirm a claim transactionally'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_decline_profile_claim(uuid,text,uuid,uuid,text,text)', 'EXECUTE'),
  'the server can route a declined match to officer review'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'the server can resolve a connection transactionally'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'claim-admin@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'exact-claim@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ambiguous-claim@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'declined-claim@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'claim-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000017', 'authenticated', 'authenticated', 'wrong-class@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('e1100000-0000-4000-8000-000000000001', 'CSF Claim Test', 'csf-claim-test', 'school', '992201');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'F31', 'Fall 2031', '2031-2032', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('e1300000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 2032, 'Class of 2032'),
  ('e1300000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001', 2033, 'Class of 2033');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e1400000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'Exact', 'Claim', 'exact', 'claim', 'exact-claim@local.test', 'exact-claim@local.test'),
  ('e1400000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001', 'First', 'Duplicate', 'first', 'duplicate', 'ambiguous-claim@local.test', 'ambiguous-claim@local.test'),
  ('e1400000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000001', 'Second', 'Duplicate', 'second', 'duplicate', 'ambiguous-claim@local.test', 'ambiguous-claim@local.test'),
  ('e1400000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001', 'Declined', 'Match', 'declined', 'match', 'declined-claim@local.test', 'declined-claim@local.test'),
  ('e1400000-0000-4000-8000-000000000005', 'e1100000-0000-4000-8000-000000000001', 'Correct', 'Record', 'correct', 'record', NULL, NULL),
  ('e1400000-0000-4000-8000-000000000017', 'e1100000-0000-4000-8000-000000000001', 'Wrong', 'Class', 'wrong', 'class', 'wrong-class@local.test', 'wrong-class@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000004', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000017', 'e1300000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title,
  invitation_scope, delivery_status, is_active
) VALUES
  ('e1500000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'cohort-claim-token-long-enough-000001', 'Class of 2032', 'cohort', 'link_ready', true),
  ('e1500000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'cohort-decline-token-long-enough-0001', 'Class of 2032 review', 'cohort', 'link_ready', true);

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title, link_type,
  invitation_scope, delivery_status, is_active
) VALUES (
  'e1500000-0000-4000-8000-000000000018',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001',
  'application-only-token-long-enough-001',
  'Application only', 'application_google_form', 'cohort', 'link_ready', true
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_profile_claim_candidate(
      'e1100000-0000-4000-8000-000000000001',
      'application-only-token-long-enough-001',
      'e1000000-0000-4000-8000-000000000002',
      'exact-claim@local.test'
    )
  $$,
  'P0001',
  'This CSF class invitation is no longer active.',
  'an application-only cohort link cannot expose a profile candidate'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'application-only-token-long-enough-001',
      'e1400000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000002',
      'exact-claim@local.test'
    )
  $$,
  'P0001',
  'This CSF class invitation is no longer active.',
  'an application-only cohort link cannot confirm a profile claim'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_decline_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'application-only-token-long-enough-001',
      'e1400000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000002',
      'exact-claim@local.test',
      'This application-only link should not enter profile review.'
    )
  $$,
  'P0001',
  'This CSF class invitation is no longer active.',
  'an application-only cohort link cannot create a profile review'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'plugin_data'
      AND tablename = 'csf_profile_accounts'
      AND indexname = 'csf_profile_accounts_one_verified_user_per_org_idx'
      AND indexdef LIKE '%(organization_id, user_id)%WHERE (status = %verified%'
  ),
  'one verified CSF profile per organization and user is enforced by a database unique index'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conname IN (
      'csf_onboarding_links_term_organization_fkey',
      'csf_onboarding_links_cohort_organization_fkey',
      'csf_profile_cohort_memberships_profile_organization_fkey',
      'csf_profile_cohort_memberships_cohort_organization_fkey',
      'csf_profile_link_requests_link_organization_fkey',
      'csf_profile_link_requests_term_organization_fkey',
      'csf_profile_link_requests_cohort_organization_fkey',
      'csf_profile_link_requests_profile_organization_fkey'
    )
      AND contype = 'f'
      AND convalidated
  ),
  8,
  'claim, invitation, and cohort relationships have validated tenant-scoped foreign keys'
);

SELECT extensions.is(
  plugin_data.csf_profile_claim_candidate(
    'e1100000-0000-4000-8000-000000000001',
    'cohort-claim-token-long-enough-000001',
    'e1000000-0000-4000-8000-000000000002',
    'exact-claim@local.test'
  )->>'status',
  'candidate',
  'one exact verified email produces one candidate'
);

SELECT extensions.ok(
  (plugin_data.csf_profile_claim_candidate(
    'e1100000-0000-4000-8000-000000000001',
    'cohort-claim-token-long-enough-000001',
    'e1000000-0000-4000-8000-000000000002',
    'exact-claim@local.test'
  )::text !~ '@'),
  'candidate output does not expose an email address'
);

SELECT extensions.is(
  plugin_data.csf_profile_claim_candidate(
    'e1100000-0000-4000-8000-000000000001',
    'cohort-claim-token-long-enough-000001',
    'e1000000-0000-4000-8000-000000000017',
    'wrong-class@local.test'
  )->>'status',
  'review',
  'an exact email match from another active cohort routes to officer review'
);
SELECT extensions.ok(
  (
    WITH result AS (
      SELECT plugin_data.csf_profile_claim_candidate(
        'e1100000-0000-4000-8000-000000000001',
        'cohort-claim-token-long-enough-000001',
        'e1000000-0000-4000-8000-000000000017',
        'wrong-class@local.test'
      ) AS payload
    )
    SELECT payload->'candidate' = 'null'::jsonb
      AND payload::text NOT LIKE '%Class of 2032%'
      AND payload::text NOT LIKE '%e1400000-0000-4000-8000-000000000017%'
    FROM result
  ),
  'a cohort mismatch discloses neither a false class label nor the matched profile ID'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'cohort-claim-token-long-enough-000001',
      'e1400000-0000-4000-8000-000000000017',
      'e1000000-0000-4000-8000-000000000017',
      'wrong-class@local.test'
    )
  $$,
  'P0001',
  'This CSF record belongs to a different class and requires officer review.',
  'confirmation revalidates the active cohort instead of trusting a stale client candidate'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000017'
  ) AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000017'
  ) AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000017'
      AND cohort_id = 'e1300000-0000-4000-8000-000000000001'
  ),
  'a class mismatch creates no host access, account link, or wrong cohort membership'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'cohort-claim-token-long-enough-000001',
      'e1400000-0000-4000-8000-000000000005',
      'e1000000-0000-4000-8000-000000000002',
      'exact-claim@local.test'
    )
  $$,
  'P0001',
  'The profile claim is no longer valid.',
  'confirmation revalidates the exact profile instead of trusting the client'
);

CREATE TEMP TABLE csf_profile_claim_results (
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_profile_claim_results (payload)
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'cohort-claim-token-long-enough-000001',
      'e1400000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000002',
      'exact-claim@local.test'
    )
  $$,
  'an exact candidate confirmation commits atomically'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_profile_claim_results (payload)
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'cohort-claim-token-long-enough-000001',
      'e1400000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000002',
      'exact-claim@local.test'
    )
  $$,
  'retrying the same successful claim returns its original result'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
      AND count(DISTINCT payload->>'requestId') = 1
      AND count(DISTINCT payload->>'correlationId') = 1
      AND bool_or(coalesce((payload->>'idempotentReplay')::boolean, false))
    FROM csf_profile_claim_results
  ),
  'an unknown-outcome retry reuses the original request and correlation ID'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND profile_id = 'e1400000-0000-4000-8000-000000000001'
     AND user_id = 'e1000000-0000-4000-8000-000000000002'),
  'verified',
  'confirmation links the account'
);
SELECT extensions.is(
  (SELECT role::text FROM public.organization_members
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND user_id = 'e1000000-0000-4000-8000-000000000002'),
  'member',
  'confirmation creates host organization membership'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_cohort_memberships
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND profile_id = 'e1400000-0000-4000-8000-000000000001'
     AND cohort_id = 'e1300000-0000-4000-8000-000000000001'),
  'active',
  'confirmation records cohort membership'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND action = 'profile.claim_confirmed'),
  1,
  'confirmation writes one immutable audit event'
);

CREATE FUNCTION pg_temp.csf_duplicate_verified_profile_is_blocked()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO plugin_data.csf_profile_accounts (
    organization_id, profile_id, user_id, status, is_primary
  ) VALUES (
    'e1100000-0000-4000-8000-000000000001',
    'e1400000-0000-4000-8000-000000000005',
    'e1000000-0000-4000-8000-000000000002',
    'verified', true
  );
  RETURN false;
EXCEPTION
  WHEN unique_violation THEN
    RETURN true;
END;
$$;

SELECT extensions.ok(
  pg_temp.csf_duplicate_verified_profile_is_blocked(),
  'the database rejects a second verified profile for the same organization account'
);
SELECT extensions.ok(
  (SELECT is_active FROM plugin_data.csf_onboarding_links
   WHERE id = 'e1500000-0000-4000-8000-000000000001'),
  'a reusable cohort invitation remains active after one claim'
);

SELECT extensions.is(
  plugin_data.csf_profile_claim_candidate(
    'e1100000-0000-4000-8000-000000000001',
    'cohort-claim-token-long-enough-000001',
    'e1000000-0000-4000-8000-000000000003',
    'ambiguous-claim@local.test'
  )->>'status',
  'ambiguous',
  'duplicate exact emails never auto-select a roster record'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_decline_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'cohort-decline-token-long-enough-0001',
      'e1400000-0000-4000-8000-000000000004',
      'e1000000-0000-4000-8000-000000000004',
      'declined-claim@local.test',
      'The pre-generated record is not mine.'
    )
  $$,
  'Not me creates an officer-review request without linking'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE user_id = 'e1000000-0000-4000-8000-000000000004'
   ORDER BY created_at DESC LIMIT 1),
  'needs_review',
  'a declined candidate remains in officer review'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_profile_link_requests
       WHERE user_id = 'e1000000-0000-4000-8000-000000000004'
       ORDER BY created_at DESC LIMIT 1),
      'e1400000-0000-4000-8000-000000000005',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  'Not authorized to resolve CSF profile connections.',
  'an ordinary user cannot resolve a connection request'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_profile_link_requests
       WHERE user_id = 'e1000000-0000-4000-8000-000000000004'
       ORDER BY created_at DESC LIMIT 1),
      'e1400000-0000-4000-8000-000000000005',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'an organization admin can resolve the request atomically'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE user_id = 'e1000000-0000-4000-8000-000000000004'
   ORDER BY created_at DESC LIMIT 1),
  'resolved',
  'the resolved request has one final state'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND profile_id = 'e1400000-0000-4000-8000-000000000005'
     AND user_id = 'e1000000-0000-4000-8000-000000000004'),
  'verified',
  'officer resolution links the selected record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND action = 'profile.link_request_resolved'),
  1,
  'officer resolution writes one correlated audit event'
);

UPDATE plugin_data.csf_profile_accounts
SET status = 'revoked', revoked_at = now(), notes = 'Fixture: revoked after a successful unknown-outcome claim.'
WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
  AND profile_id = 'e1400000-0000-4000-8000-000000000001'
  AND user_id = 'e1000000-0000-4000-8000-000000000002';
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
  AND user_id = 'e1000000-0000-4000-8000-000000000002';

SELECT extensions.ok(
  (
    WITH retry AS (
      SELECT plugin_data.csf_confirm_profile_claim(
        'e1100000-0000-4000-8000-000000000001',
        'cohort-claim-token-long-enough-000001',
        'e1400000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000002',
        'exact-claim@local.test'
      ) AS payload
    )
    SELECT (payload->>'reviewRequired')::boolean
      AND NOT (payload->>'termMembershipActivated')::boolean
      AND payload->'profileId' = 'null'::jsonb
    FROM retry
  ),
  'a retry after revocation routes to review instead of reporting a connected profile'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000002'
      AND status = 'revoked' AND revoked_at IS NOT NULL
  ) AND EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000002'
      AND status = 'inactive'
  ) AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND actor_user_id = 'e1000000-0000-4000-8000-000000000002'
      AND action = 'profile.claim_confirmed'
  ) AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_link_requests
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000002'
      AND match_status = 'needs_review'
      AND matched_profile_id IS NULL
  ) AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND actor_user_id = 'e1000000-0000-4000-8000-000000000002'
      AND action = 'profile.claim_revalidation_failed'
      AND reason_code = 'profile_claim_revalidation_required'
  ),
  'a stale retry never reactivates access and records the review transition atomically'
);

-- Reactivation safeguards use separate records so each path proves that the
-- claim transaction either preserves an intentional inactive/revoked/finalized
-- state or rolls back every write.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'inactive-self@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'revoked-self@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'revoked-term-self@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'finalized-term-self@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'inactive-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'revoked-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'revoked-term-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'finalized-term-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e1400000-0000-4000-8000-000000000006', 'e1100000-0000-4000-8000-000000000001', 'Inactive', 'Self', 'inactive', 'self', 'inactive-self@local.test', 'inactive-self@local.test'),
  ('e1400000-0000-4000-8000-000000000007', 'e1100000-0000-4000-8000-000000000001', 'Revoked', 'Self', 'revoked', 'self', 'revoked-self@local.test', 'revoked-self@local.test'),
  ('e1400000-0000-4000-8000-000000000008', 'e1100000-0000-4000-8000-000000000001', 'Revoked Term', 'Self', 'revoked term', 'self', 'revoked-term-self@local.test', 'revoked-term-self@local.test'),
  ('e1400000-0000-4000-8000-000000000009', 'e1100000-0000-4000-8000-000000000001', 'Finalized Term', 'Self', 'finalized term', 'self', 'finalized-term-self@local.test', 'finalized-term-self@local.test'),
  ('e1400000-0000-4000-8000-000000000010', 'e1100000-0000-4000-8000-000000000001', 'Claim', 'Admin', 'claim', 'admin', 'claim-admin@local.test', 'claim-admin@local.test'),
  ('e1400000-0000-4000-8000-000000000011', 'e1100000-0000-4000-8000-000000000001', 'Inactive', 'Officer', 'inactive', 'officer', 'inactive-officer@local.test', 'inactive-officer@local.test'),
  ('e1400000-0000-4000-8000-000000000012', 'e1100000-0000-4000-8000-000000000001', 'Revoked', 'Officer', 'revoked', 'officer', 'revoked-officer@local.test', 'revoked-officer@local.test'),
  ('e1400000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'Revoked Term', 'Officer', 'revoked term', 'officer', 'revoked-term-officer@local.test', 'revoked-term-officer@local.test'),
  ('e1400000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'Finalized Term', 'Officer', 'finalized term', 'officer', 'finalized-term-officer@local.test', 'finalized-term-officer@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000006', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000007', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000008', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000009', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000010', 'e1300000-0000-4000-8000-000000000001', 'active');

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title,
  invitation_scope, delivery_status, is_active
) VALUES
  ('e1500000-0000-4000-8000-000000000003', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'inactive-self-token-long-enough-000001', 'Inactive self claim', 'cohort', 'link_ready', true),
  ('e1500000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'revoked-self-token-long-enough-000001', 'Revoked self claim', 'cohort', 'link_ready', true),
  ('e1500000-0000-4000-8000-000000000005', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'revoked-term-self-token-long-000001', 'Revoked term self claim', 'cohort', 'link_ready', true),
  ('e1500000-0000-4000-8000-000000000006', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'finalized-term-self-token-long-0001', 'Finalized term self claim', 'cohort', 'link_ready', true),
  ('e1500000-0000-4000-8000-000000000007', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'admin-self-token-long-enough-0000001', 'Admin self claim', 'cohort', 'link_ready', true);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000006', 'staff', 'inactive'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000008', 'staff', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011', 'staff', 'inactive'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013', 'staff', 'active');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary, revoked_at, notes
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000007', 'revoked', false, now(), 'Fixture: previously revoked self connection.'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000012', 'revoked', false, now(), 'Fixture: previously revoked officer connection.');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  ('e1600000-0000-4000-8000-000000000008', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000008', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'manual', 'accepted'),
  ('e1600000-0000-4000-8000-000000000009', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000009', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'manual', 'accepted'),
  ('e1600000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000013', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'manual', 'accepted'),
  ('e1600000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000014', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'manual', 'accepted');

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id, reopenable
) VALUES (
  'e1700000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  1, '{}'::jsonb, '[]'::jsonb,
  'e1000000-0000-4000-8000-000000000001',
  1, 'e1710000-0000-4000-8000-000000000001', false
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id,
  status, status_reason, completed_at, finalized_closure_id,
  finalized_revision, finalized_correlation_id
) VALUES
  ('e1800000-0000-4000-8000-000000000008', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000008', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000008', 'revoked', 'Fixture: membership revoked.', NULL, NULL, NULL, NULL),
  ('e1800000-0000-4000-8000-000000000009', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000009', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000009', 'completed', 'Fixture: membership finalized.', now(), 'e1700000-0000-4000-8000-000000000001', 1, 'e1810000-0000-4000-8000-000000000009'),
  ('e1800000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000013', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000013', 'revoked', 'Fixture: membership revoked.', NULL, NULL, NULL, NULL),
  ('e1800000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000014', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000014', 'completed', 'Fixture: membership finalized.', now(), 'e1700000-0000-4000-8000-000000000001', 1, 'e1810000-0000-4000-8000-000000000014');

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, term_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  matched_profile_id, candidate_profile_ids, match_status, resolution_notes
) VALUES
  ('e1900000-0000-4000-8000-000000000011', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011', 'inactive-officer@local.test', 'Inactive', 'Officer', 'inactive', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000011'::uuid], 'needs_review', 'Fixture: officer review required.'),
  ('e1900000-0000-4000-8000-000000000012', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000012', 'revoked-officer@local.test', 'Revoked', 'Officer', 'revoked', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000012'::uuid], 'needs_review', 'Fixture: officer review required.'),
  ('e1900000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013', 'revoked-term-officer@local.test', 'Revoked Term', 'Officer', 'revoked term', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000013'::uuid], 'needs_review', 'Fixture: officer review required.'),
  ('e1900000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000014', 'finalized-term-officer@local.test', 'Finalized Term', 'Officer', 'finalized term', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000014'::uuid], 'needs_review', 'Fixture: officer review required.');

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'inactive-self-token-long-enough-000001',
      'e1400000-0000-4000-8000-000000000006',
      'e1000000-0000-4000-8000-000000000006',
      'inactive-self@local.test'
    )
  $$,
  'P0001',
  'This account has inactive organization access; an administrator must review it.',
  'self-claim cannot reactivate inactive host organization access'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000006'
      AND role = 'staff' AND status = 'inactive'
  ) AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000006'
  ),
  'failed self-claim preserves the inactive staff record and creates no CSF account link'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'revoked-self-token-long-enough-000001',
      'e1400000-0000-4000-8000-000000000007',
      'e1000000-0000-4000-8000-000000000007',
      'revoked-self@local.test'
    )
  $$,
  'P0001',
  'This CSF account connection was revoked and requires officer review.',
  'self-claim cannot reactivate a revoked CSF account connection'
);
SELECT extensions.ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND profile_id = 'e1400000-0000-4000-8000-000000000007'
     AND user_id = 'e1000000-0000-4000-8000-000000000007')
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000007'
  ),
  'failed self-claim leaves the revoked link intact and rolls back host membership creation'
);

SELECT extensions.is(
  (plugin_data.csf_confirm_profile_claim(
    'e1100000-0000-4000-8000-000000000001',
    'revoked-term-self-token-long-000001',
    'e1400000-0000-4000-8000-000000000008',
    'e1000000-0000-4000-8000-000000000008',
    'revoked-term-self@local.test'
  )->>'termMembershipActivated')::boolean,
  false,
  'self-claim reports that a revoked term membership was not activated'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_term_memberships
   WHERE id = 'e1800000-0000-4000-8000-000000000008'),
  'revoked',
  'self-claim leaves a revoked term membership revoked'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000008'
      AND role = 'staff' AND status = 'active'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND actor_user_id = 'e1000000-0000-4000-8000-000000000008'
      AND action = 'profile.claim_confirmed'
      AND (after_data->>'termMembershipActivated')::boolean = false
  ),
  'self-claim preserves active staff access and audits the blocked term activation truthfully'
);

SELECT extensions.is(
  (plugin_data.csf_confirm_profile_claim(
    'e1100000-0000-4000-8000-000000000001',
    'finalized-term-self-token-long-0001',
    'e1400000-0000-4000-8000-000000000009',
    'e1000000-0000-4000-8000-000000000009',
    'finalized-term-self@local.test'
  )->>'termMembershipActivated')::boolean,
  false,
  'self-claim reports that a finalized term membership was not activated'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000009'
      AND status = 'completed'
      AND finalized_closure_id = 'e1700000-0000-4000-8000-000000000001'
      AND finalized_revision = 1
  ),
  'self-claim leaves a finalized term membership and its closure pointer unchanged'
);
SELECT extensions.is(
  (SELECT (after_data->>'termMembershipActivated')::boolean
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND actor_user_id = 'e1000000-0000-4000-8000-000000000009'
     AND action = 'profile.claim_confirmed'
   ORDER BY created_at DESC LIMIT 1),
  false,
  'self-claim audit records no finalized membership activation'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_confirm_profile_claim(
      'e1100000-0000-4000-8000-000000000001',
      'admin-self-token-long-enough-0000001',
      'e1400000-0000-4000-8000-000000000010',
      'e1000000-0000-4000-8000-000000000001',
      'claim-admin@local.test'
    )
  $$,
  'an active organization admin can confirm their matching record'
);
SELECT extensions.is(
  (SELECT role::text FROM public.organization_members
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND user_id = 'e1000000-0000-4000-8000-000000000001'),
  'admin',
  'self-claim never downgrades an existing organization admin'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000011',
      'e1400000-0000-4000-8000-000000000011',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This account has inactive organization access; reactivate it through organization administration first.',
  'officer resolution cannot reactivate inactive host organization access'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000011'
      AND role = 'staff' AND status = 'inactive'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000011'
      AND match_status = 'needs_review'
  ),
  'failed officer resolution preserves inactive staff access and the unresolved request'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000012',
      'e1400000-0000-4000-8000-000000000012',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This CSF account connection was revoked; use the explicit relink workflow.',
  'officer resolution cannot reactivate a revoked CSF account connection'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000012'
      AND user_id = 'e1000000-0000-4000-8000-000000000012'
      AND status = 'revoked' AND revoked_at IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000012'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000012'
      AND match_status = 'needs_review'
  ),
  'failed officer resolution leaves the revoked link intact and rolls back every other write'
);

SELECT extensions.is(
  (plugin_data.csf_resolve_profile_link_request(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000013',
    'e1400000-0000-4000-8000-000000000013',
    'connect', 'Confirmed against the source roster.',
    'e1000000-0000-4000-8000-000000000001'
  )->>'membershipGranted')::boolean,
  false,
  'officer resolution reports that a revoked term membership was not granted'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000013'
      AND status = 'revoked'
  ) AND EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000013'
      AND role = 'staff' AND status = 'active'
  ),
  'officer resolution preserves a revoked term membership and existing staff role'
);
SELECT extensions.is(
  (SELECT (after_data->>'membershipGranted')::boolean
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND target_id = 'e1900000-0000-4000-8000-000000000013'
     AND action = 'profile.link_request_resolved'),
  false,
  'officer audit records no revoked term membership grant'
);

SELECT extensions.is(
  (plugin_data.csf_resolve_profile_link_request(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000014',
    'e1400000-0000-4000-8000-000000000014',
    'connect', 'Confirmed against the source roster.',
    'e1000000-0000-4000-8000-000000000001'
  )->>'membershipGranted')::boolean,
  false,
  'officer resolution reports that a finalized term membership was not granted'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000014'
      AND status = 'completed'
      AND finalized_closure_id = 'e1700000-0000-4000-8000-000000000001'
      AND finalized_revision = 1
  ),
  'officer resolution leaves finalized membership evidence unchanged'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000014'
      AND match_status = 'resolved'
      AND matched_profile_id = 'e1400000-0000-4000-8000-000000000014'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000014'
      AND user_id = 'e1000000-0000-4000-8000-000000000014'
      AND status = 'verified'
  ),
  'officer resolution can connect identity without changing the finalized semester outcome'
);

-- A genuinely closed term exercises the later evidence-write trigger. Identity
-- connection must still succeed, but neither self-confirmation nor officer
-- resolution may issue the membership INSERT that the closed-term guard rejects.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000015', 'authenticated', 'authenticated', 'closed-self@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'closed-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'e1200000-0000-4000-8000-000000000002',
  'e1100000-0000-4000-8000-000000000001',
  'S32', 'Spring 2032', '2031-2032', 'spring', 'open', false
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e1400000-0000-4000-8000-000000000015', 'e1100000-0000-4000-8000-000000000001', 'Closed', 'Self', 'closed', 'self', 'closed-self@local.test', 'closed-self@local.test'),
  ('e1400000-0000-4000-8000-000000000016', 'e1100000-0000-4000-8000-000000000001', 'Closed', 'Officer', 'closed', 'officer', 'closed-officer@local.test', 'closed-officer@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000015', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000016', 'e1300000-0000-4000-8000-000000000001', 'active');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  ('e1600000-0000-4000-8000-000000000015', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000015', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002', 'manual', 'accepted'),
  ('e1600000-0000-4000-8000-000000000016', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000016', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002', 'manual', 'accepted');

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id, reopenable
) VALUES (
  'e1700000-0000-4000-8000-000000000002',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  1, '{}'::jsonb, '[]'::jsonb,
  'e1000000-0000-4000-8000-000000000001',
  1, 'e1710000-0000-4000-8000-000000000002', false
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id,
  status, status_reason, completed_at, finalized_closure_id,
  finalized_revision, finalized_correlation_id, updated_at
) VALUES
  ('e1800000-0000-4000-8000-000000000015', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000015', 'e1200000-0000-4000-8000-000000000002', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000015', 'completed', 'Closed fixture outcome.', '2032-05-01T12:00:00Z', 'e1700000-0000-4000-8000-000000000002', 1, 'e1810000-0000-4000-8000-000000000015', '2032-05-01T12:00:00Z'),
  ('e1800000-0000-4000-8000-000000000016', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000016', 'e1200000-0000-4000-8000-000000000002', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000016', 'completed', 'Closed fixture outcome.', '2032-05-01T12:00:00Z', 'e1700000-0000-4000-8000-000000000002', 1, 'e1810000-0000-4000-8000-000000000016', '2032-05-01T12:00:00Z');

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title,
  invitation_scope, delivery_status, is_active
) VALUES (
  'e1500000-0000-4000-8000-000000000008',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  'e1300000-0000-4000-8000-000000000001',
  'closed-self-token-long-enough-000001',
  'Closed term self claim', 'cohort', 'link_ready', true
);

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, term_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  matched_profile_id, candidate_profile_ids, match_status, resolution_notes
) VALUES (
  'e1900000-0000-4000-8000-000000000016',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  'e1300000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000016',
  'closed-officer@local.test', 'Closed', 'Officer', 'closed', 'officer',
  NULL, ARRAY['e1400000-0000-4000-8000-000000000016'::uuid],
  'needs_review', 'Fixture: resolve identity after close.'
);

INSERT INTO plugin_data.csf_term_close_authorizations (
  transaction_id, organization_id, term_id, closure_id,
  closure_revision, actor_user_id, correlation_id
) VALUES (
  pg_catalog.txid_current(),
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  'e1700000-0000-4000-8000-000000000002',
  1,
  'e1000000-0000-4000-8000-000000000001',
  'e1710000-0000-4000-8000-000000000002'
);

UPDATE plugin_data.csf_terms
SET lifecycle_status = 'closed', is_current = false,
    closed_at = '2032-05-01T12:00:00Z',
    closed_by = 'e1000000-0000-4000-8000-000000000001',
    closure_policy_version = 1, closure_revision = 1,
    latest_closure_id = 'e1700000-0000-4000-8000-000000000002',
    active_closure_id = 'e1700000-0000-4000-8000-000000000002'
WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
  AND id = 'e1200000-0000-4000-8000-000000000002';

DELETE FROM plugin_data.csf_term_close_authorizations
WHERE transaction_id = pg_catalog.txid_current()
  AND organization_id = 'e1100000-0000-4000-8000-000000000001'
  AND term_id = 'e1200000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (plugin_data.csf_confirm_profile_claim(
    'e1100000-0000-4000-8000-000000000001',
    'closed-self-token-long-enough-000001',
    'e1400000-0000-4000-8000-000000000015',
    'e1000000-0000-4000-8000-000000000015',
    'closed-self@local.test'
  )->>'termMembershipActivated')::boolean,
  false,
  'self-confirmation connects identity after close without attempting term activation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000015'
      AND user_id = 'e1000000-0000-4000-8000-000000000015'
      AND status = 'verified'
  ) AND EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000015'
      AND status = 'active'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000015'
      AND status = 'completed'
      AND finalized_closure_id = 'e1700000-0000-4000-8000-000000000002'
      AND updated_at = '2032-05-01T12:00:00Z'::timestamptz
  ),
  'closed-term self-confirmation writes identity access while preserving frozen membership bytes'
);

SELECT extensions.is(
  (plugin_data.csf_resolve_profile_link_request(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000016',
    'e1400000-0000-4000-8000-000000000016',
    'connect', 'Confirmed against the closed-term source roster.',
    'e1000000-0000-4000-8000-000000000001'
  )->>'membershipGranted')::boolean,
  false,
  'officer resolution connects identity after close without attempting term activation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000016'
      AND match_status = 'resolved'
      AND matched_profile_id = 'e1400000-0000-4000-8000-000000000016'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000016'
      AND user_id = 'e1000000-0000-4000-8000-000000000016'
      AND status = 'verified'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000016'
      AND status = 'completed'
      AND finalized_closure_id = 'e1700000-0000-4000-8000-000000000002'
      AND updated_at = '2032-05-01T12:00:00Z'::timestamptz
  ),
  'closed-term officer resolution records the identity decision without changing frozen membership'
);

SELECT * FROM extensions.finish();
ROLLBACK;
