BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(33);

-- Structure: the hardened wrapper owns the name and the delegate is unreachable.
SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)'
  ) IS NOT NULL,
  'the canonical connect-evidence projection exists'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_resolve_profile_link_request_corroboration_base(uuid,uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass corroboration through the delegate'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)', 'EXECUTE'),
  'only the service role may read connect evidence'
);
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)'::regprocedure
  ) LIKE '%LOCK TABLE plugin_data.csf_profiles%'
  AND pg_get_functiondef(
    'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)'::regprocedure
  ) LIKE '%LOCK TABLE plugin_data.csf_profile_accounts%',
  'the connect path evaluates its evidence under identity table locks'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ef000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'link-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ambiguous.student@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unique.student@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'roster.student@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unconfirmed.student@local.test', NULL, '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'current.student@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'duplicate.student@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'different-name@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'multi-class@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'link-other-org@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ef100000-0000-4000-8000-000000000001',
    'CSF Link Corroboration', 'csf-link-corroboration', 'school', '982201'
  ),
  (
    'ef100000-0000-4000-8000-000000000002',
    'CSF Link Corroboration Other', 'csf-link-corroboration-other', 'school', '982202'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000005', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000006', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000007', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000008', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000009', 'member', 'active'),
  ('ef100000-0000-4000-8000-000000000002', 'ef000000-0000-4000-8000-000000000010', 'admin', 'active');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES
  ('ef200000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 2033, 'Class of 2033', 'active'),
  ('ef200000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001', 2034, 'Class of 2034', 'active');

-- Two same-named classmates: the exact case the ranked suggestion list cannot
-- distinguish and the one that used to be a one-click connect.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email, personal_email,
  normalized_first_name, normalized_last_name,
  normalized_school_email, normalized_personal_email
) VALUES
  ('ef300000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 'Alex', 'Rivera', NULL, NULL, 'alex', 'rivera', NULL, NULL),
  ('ef300000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001', 'Alex', 'Rivera', NULL, NULL, 'alex', 'rivera', NULL, NULL),
  -- Uniquely named, no recorded address: still insufficient identity evidence.
  ('ef300000-0000-4000-8000-000000000003', 'ef100000-0000-4000-8000-000000000001', 'Priya', 'Raman', NULL, NULL, 'priya', 'raman', NULL, NULL),
  -- Fully corroborated: current confirmed email, exact name, and one class.
  ('ef300000-0000-4000-8000-000000000004', 'ef100000-0000-4000-8000-000000000001', 'Rosa', 'Okafor', 'roster.student@local.test', NULL, 'rosa', 'okafor', 'roster.student@local.test', NULL),
  -- Same class, conflicting school email identity.
  ('ef300000-0000-4000-8000-000000000005', 'ef100000-0000-4000-8000-000000000001', 'Priya', 'Raman', 'other.priya@local.test', NULL, 'priya', 'raman', 'other.priya@local.test', NULL),
  ('ef300000-0000-4000-8000-000000000006', 'ef100000-0000-4000-8000-000000000001', 'Uma', 'Shah', 'unconfirmed.student@local.test', NULL, 'uma', 'shah', 'unconfirmed.student@local.test', NULL),
  ('ef300000-0000-4000-8000-000000000007', 'ef100000-0000-4000-8000-000000000001', 'Diego', 'Lopez', 'declared.student@local.test', NULL, 'diego', 'lopez', 'declared.student@local.test', NULL),
  ('ef300000-0000-4000-8000-000000000008', 'ef100000-0000-4000-8000-000000000001', 'Nina', 'Patel', 'duplicate.student@local.test', NULL, 'nina', 'patel', 'duplicate.student@local.test', NULL),
  ('ef300000-0000-4000-8000-000000000009', 'ef100000-0000-4000-8000-000000000001', 'Someone', 'Else', 'duplicate.student@local.test', NULL, 'someone', 'else', 'duplicate.student@local.test', NULL),
  ('ef300000-0000-4000-8000-000000000010', 'ef100000-0000-4000-8000-000000000001', 'Wrong', 'Person', 'different-name@local.test', NULL, 'wrong', 'person', 'different-name@local.test', NULL),
  ('ef300000-0000-4000-8000-000000000011', 'ef100000-0000-4000-8000-000000000001', 'Mina', 'Park', 'multi-class@local.test', NULL, 'mina', 'park', 'multi-class@local.test', NULL);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000002', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000003', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000004', 'ef200000-0000-4000-8000-000000000002', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000006', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000007', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000008', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000009', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000010', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000011', 'ef200000-0000-4000-8000-000000000001', 'active'),
  ('ef100000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000011', 'ef200000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  match_status
) VALUES
  -- Ambiguous: exact name, but two same-named classmates in the class.
  ('ef400000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001',
   'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000002',
   'ambiguous.student@local.test', 'Alex', 'Rivera', 'alex', 'rivera', 'needs_review'),
  -- Unique exact name in a cohort, no email on either side.
  ('ef400000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001',
   'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000003',
   'unique.student@local.test', 'Priya', 'Raman', 'priya', 'raman', 'needs_review'),
  -- Signed-in address exactly equals a roster address on a differently named record.
  ('ef400000-0000-4000-8000-000000000003', 'ef100000-0000-4000-8000-000000000001',
   'ef200000-0000-4000-8000-000000000002', 'ef000000-0000-4000-8000-000000000004',
   'roster.student@local.test', 'Rosa', 'Okafor', 'rosa', 'okafor', 'needs_review');

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  normalized_personal_email, match_status
) VALUES
  ('ef400000-0000-4000-8000-000000000005', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000005', 'unconfirmed.student@local.test', 'Uma', 'Shah', 'uma', 'shah', 'unconfirmed.student@local.test', 'needs_review'),
  ('ef400000-0000-4000-8000-000000000006', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000006', 'declared.student@local.test', 'Diego', 'Lopez', 'diego', 'lopez', 'declared.student@local.test', 'needs_review'),
  ('ef400000-0000-4000-8000-000000000007', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000007', 'duplicate.student@local.test', 'Nina', 'Patel', 'nina', 'patel', 'duplicate.student@local.test', 'needs_review'),
  ('ef400000-0000-4000-8000-000000000008', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000008', 'different-name@local.test', 'Dana', 'Jones', 'dana', 'jones', 'different-name@local.test', 'needs_review'),
  ('ef400000-0000-4000-8000-000000000009', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000009', 'multi-class@local.test', 'Mina', 'Park', 'mina', 'park', 'multi-class@local.test', 'needs_review');

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000003',
      'ef300000-0000-4000-8000-000000000004',
      'connect',
      'Attempted from another organization.',
      'ef000000-0000-4000-8000-000000000010'
    )$$,
  'P0001',
  'Not authorized to resolve CSF profile connections.',
  'an org-B officer cannot connect an org-A request to an org-A profile'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000002',
      'ef400000-0000-4000-8000-000000000003',
      'ef300000-0000-4000-8000-000000000004',
      'connect',
      'Attempted through the wrong organization scope.',
      'ef000000-0000-4000-8000-000000000010'
    )$$,
  'P0001',
  'This connection request has already been resolved.',
  'an org-B officer cannot connect org-A targets through an org-B scope'
);
SELECT extensions.ok(
  (SELECT match_status = 'needs_review'
   FROM plugin_data.csf_profile_link_requests
   WHERE id = 'ef400000-0000-4000-8000-000000000003')
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
      AND profile_id = 'ef300000-0000-4000-8000-000000000004'
      AND user_id = 'ef000000-0000-4000-8000-000000000004'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE actor_user_id = 'ef000000-0000-4000-8000-000000000010'
      AND target_id = 'ef400000-0000-4000-8000-000000000003'
  ),
  'cross-organization connect attempts leave the request pending with zero account links or receipts'
);

-- Evidence projection ------------------------------------------------------

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000001',
    'ef300000-0000-4000-8000-000000000001'
  )->>'canConnect')::boolean,
  'an exact name shared with a classmate is never enough to connect'
);
SELECT extensions.is(
  (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000001',
    'ef300000-0000-4000-8000-000000000001'
  )->'evidence'->>'sameNameCohortRivals')::integer,
  1,
  'the ambiguity is reported as a counted same-name rival, not a score'
);
SELECT extensions.is(
  plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000001',
    'ef300000-0000-4000-8000-000000000001'
  )->'corroboration',
  '[]'::jsonb,
  'no corroborating attribute is claimed for the ambiguous pair'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000002',
    'ef300000-0000-4000-8000-000000000003'
  )->>'canConnect')::boolean,
  'a uniquely named record with no confirmed roster email still cannot connect'
);
SELECT extensions.is(
  plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000002',
    'ef300000-0000-4000-8000-000000000003'
  )->'corroboration',
  '[]'::jsonb,
  'even a unique exact class name remains advisory rather than corroboration'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000003',
    'ef300000-0000-4000-8000-000000000004'
  )->'corroboration') @> '["exact_email"]'::jsonb,
  'an exact current confirmed account address corroborates the matching record'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000005',
    'ef300000-0000-4000-8000-000000000006'
  )->>'canConnect')::boolean,
  'an unconfirmed authentication email cannot authorize a connection'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000006',
    'ef300000-0000-4000-8000-000000000007'
  )->>'canConnect')::boolean,
  'a request-declared address cannot substitute for the current confirmed account email'
);
SELECT extensions.is(
  (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000007',
    'ef300000-0000-4000-8000-000000000008'
  )->'evidence'->>'verifiedEmailProfileMatches')::integer,
  2,
  'duplicate active records carrying the confirmed email are counted explicitly'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000008',
    'ef300000-0000-4000-8000-000000000010'
  )->>'canConnect')::boolean,
  'an exact email cannot connect a differently named student record'
);
SELECT extensions.is(
  (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000009',
    'ef300000-0000-4000-8000-000000000011'
  )->'evidence'->>'activeProfileCohortCount')::integer,
  2,
  'a student record active in multiple classes is explicit blocking evidence'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000002',
    'ef300000-0000-4000-8000-000000000005'
  )->>'canConnect')::boolean,
  'a record outside the requested class with its own school email is blocked'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_link_connect_evidence(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000002',
    'ef300000-0000-4000-8000-000000000005'
  )->'blockers')::text LIKE '%confirmed email does not match%',
  'the blocked pair names the missing confirmed-account match explicitly'
);

-- Consequential path -------------------------------------------------------

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000099',
      '00000000-0000-4000-8000-000000000098',
      'connect',
      'Attempted unauthorized evidence probe.',
      'ef000000-0000-4000-8000-000000000002'
    )$$,
  'P0001',
  'Not authorized to resolve CSF profile connections.',
  'authorization is checked before request or profile evidence can be probed'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000001',
      'ef300000-0000-4000-8000-000000000001',
      'connect',
      'Selected the top ranked suggestion.',
      'ef000000-0000-4000-8000-000000000001'
    )$$,
  'This CSF account connection is not supported by corroborating identity evidence.',
  'the resolve RPC refuses a name-only connection even for an authorized officer'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
    WHERE id = 'ef400000-0000-4000-8000-000000000001'),
  'needs_review',
  'the refused request is left untouched for review'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'),
  0,
  'the refused connection created no account link'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000003',
      'ef300000-0000-4000-8000-000000000004',
      'connect',
      'Signed-in address matches the roster address on this record.',
      'ef000000-0000-4000-8000-000000000001'
    )$$,
  'an exactly corroborated connection still completes'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
      AND profile_id = 'ef300000-0000-4000-8000-000000000004'
      AND user_id = 'ef000000-0000-4000-8000-000000000004'),
  'verified',
  'the corroborated connection produced the verified account link'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
    WHERE id = 'ef400000-0000-4000-8000-000000000003'),
  'resolved',
  'the corroborated request is resolved'
);
SELECT extensions.is(
  plugin_data.csf_resolve_profile_link_request(
    'ef100000-0000-4000-8000-000000000001',
    'ef400000-0000-4000-8000-000000000003',
    'ef300000-0000-4000-8000-000000000004',
    'connect',
    'Signed-in address matches the roster address on this record.',
    'ef000000-0000-4000-8000-000000000001'
  )->>'idempotentReplay',
  'true',
  'an exact retry after a lost response returns the original durable receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
     AND target_id = 'ef400000-0000-4000-8000-000000000003'
     AND action = 'profile.link_request_identity_evidence'),
  1,
  'the successful binding records one immutable corroboration snapshot'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
      AND target_id = 'ef400000-0000-4000-8000-000000000003'
      AND action = 'profile.link_request_identity_evidence'
      AND after_data::text LIKE '%@%'
  ),
  'the evidence audit stores booleans and evidence kinds without raw email addresses'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000003',
      'ef300000-0000-4000-8000-000000000004',
      'connect',
      'Changed rationale after the original connection.',
      'ef000000-0000-4000-8000-000000000001'
    )$$,
  'This connection request has already been resolved.',
  'a changed rationale cannot masquerade as an idempotent retry'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_resolve_profile_link_request(
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000001',
      NULL,
      'reject',
      'Two classmates share this name; asked the student for their school address.',
      'ef000000-0000-4000-8000-000000000001'
    )$$,
  'rejection is unchanged and needs no corroborating evidence'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
    WHERE id = 'ef400000-0000-4000-8000-000000000001'),
  'rejected',
  'the rejected request reaches its terminal state'
);

SELECT * FROM extensions.finish();

ROLLBACK;
