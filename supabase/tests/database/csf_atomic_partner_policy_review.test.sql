BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(32);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)') IS NOT NULL,
  'the atomic partner-club review operation exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'only service_role can invoke the policy mutation'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%SECURITY DEFINER%SET search_path TO %',
  'the privileged operation has an explicit empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_upsert_partner_club_policy(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_partner_clubs%',
  'the database operation rechecks the exact human permission'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('bd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'policy-admin@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'policy-member@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-policy-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'Atomic Partner Policy', 'atomic-partner-policy', 'school', '992211'),
  ('bd100000-0000-4000-8000-000000000002', 'Other Atomic Partner Policy', 'other-atomic-partner-policy', 'school', '992212');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('bd100000-0000-4000-8000-000000000002', 'bd000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('bd200000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001', 'F39', 'Fall 2039', '2039-2040', 'fall', 'open', true),
  ('bd200000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000002', 'F39', 'Fall 2039', '2039-2040', 'fall', 'open', true);

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status, created_by)
VALUES (
  'bd300000-0000-4000-8000-000000000002',
  'bd100000-0000-4000-8000-000000000002',
  'Other Organization Club',
  'active',
  'bd000000-0000-4000-8000-000000000003'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000002',
    'bd900000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'new',
      'name', 'Unauthorized Club'
    )
  )$$,
  'P0001', 'Not authorized to manage CSF partner clubs.',
  'an ordinary member cannot create or review a partner club'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_clubs WHERE name = 'Unauthorized Club'),
  0,
  'a rejected authorization attempt leaves no club projection'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'returningClubId', 'bd300000-0000-4000-8000-000000000002',
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'returning'
    )
  )$$,
  'P0001', 'Partner club was not found.',
  'an authorized manager cannot attach another organization club'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000009',
    jsonb_build_object(
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'new',
      'name', 'Bad Link Club',
      'spreadsheetUrl', 'javascript:alert(1)'
    )
  )$$,
  'P0001', 'The club spreadsheet link must be an http(s) URL.',
  'the club spreadsheet link must be a plain http(s) URL'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'new',
      'name', 'Science Partners',
      'contactName', 'Taylor Rivera',
      'contactEmail', 'partners@example.test',
      'continuationStatus', 'new',
      'recruitingNewMembers', 'yes',
      'allocationSatisfied', 'yes',
      'allocationNotes', 'Reviewed against the semester allocation.',
      'spreadsheetUrl', 'https://docs.google.com/spreadsheets/d/science-partners',
      'notes', 'Officer-approved record.'
    )
  )$$,
  'an authorized manager atomically creates and reviews a partner club'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_clubs WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  1,
  'one canonical club projection is created'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_aliases WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  1,
  'the canonical normalized alias is created in the same transaction'
);
SELECT extensions.results_eq(
  $$SELECT relationship_status, workflow_status, allocation_satisfied, policy_notes, spreadsheet_url
    FROM plugin_data.csf_partner_club_terms
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'$$,
  $$VALUES ('new'::text, 'active'::text, true, 'Reviewed against the semester allocation.'::text, 'https://docs.google.com/spreadsheets/d/science-partners'::text)$$,
  'the current semester projection contains the reviewed record and sheet link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key = 'policy-request:bd900000-0000-4000-8000-000000000003'),
  1,
  'the review appends one durable lifecycle receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'bd900000-0000-4000-8000-000000000003'),
  1,
  'the review appends one staff audit in the same transaction'
);
SELECT extensions.is(
  (SELECT event_type FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key = 'policy-request:bd900000-0000-4000-8000-000000000003'),
  'point_policy_published',
  'the lifecycle receipt identifies a published partner-club review'
);

SELECT extensions.is(
  (plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'new',
      'name', 'Science Partners',
      'contactName', 'Taylor Rivera',
      'contactEmail', 'partners@example.test',
      'continuationStatus', 'new',
      'recruitingNewMembers', 'yes',
      'allocationSatisfied', 'yes',
      'allocationNotes', 'Reviewed against the semester allocation.',
      'spreadsheetUrl', 'https://docs.google.com/spreadsheets/d/science-partners',
      'notes', 'Officer-approved record.'
    )
  ) ->> 'idempotent'),
  'true',
  'an exact request replay returns the committed outcome'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_clubs WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  1,
  'exact replay cannot duplicate the club projection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_terms WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  1,
  'exact replay cannot duplicate the term projection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  1,
  'exact replay cannot duplicate lifecycle history'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'bd900000-0000-4000-8000-000000000003'),
  1,
  'exact replay cannot duplicate staff audit history'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'new',
      'name', 'Science Partners',
      'contactName', 'Taylor Rivera',
      'contactEmail', 'partners@example.test',
      'continuationStatus', 'new',
      'recruitingNewMembers', 'yes',
      'allocationSatisfied', 'yes',
      'allocationNotes', 'A materially different review narrative.',
      'spreadsheetUrl', 'https://docs.google.com/spreadsheets/d/science-partners',
      'notes', 'Officer-approved record.'
    )
  )$$,
  'P0001', 'That partner-club policy request identifier is already bound to a different review.',
  'a stable request identifier cannot be rebound to different review content'
);
SELECT extensions.is(
  (SELECT policy_notes FROM plugin_data.csf_partner_club_terms WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  'Reviewed against the semester allocation.',
  'a conflicting replay leaves the current record unchanged'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'new',
      'name', '  science   partners  '
    )
  )$$,
  'P0001', 'That club name or alias already belongs to another canonical partner club.',
  'a normalized alias cannot be rebound to a duplicate canonical club'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_clubs WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  1,
  'an alias conflict cannot leave an orphan club projection'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_upsert_partner_club_policy(
    'bd100000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'bd900000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'partnerClubId', (SELECT id FROM plugin_data.csf_partner_clubs WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
      'returningClubId', (SELECT id FROM plugin_data.csf_partner_clubs WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
      'termId', 'bd200000-0000-4000-8000-000000000001',
      'termStatus', 'returning',
      'name', 'Science Partners',
      'recruitingNewMembers', 'unknown',
      'allocationSatisfied', 'no',
      'allocationNotes', 'Record returned after a second officer review.',
      'spreadsheetUrl', 'https://docs.google.com/spreadsheets/d/science-partners-v2',
      'notes', 'Return for changes.'
    )
  )$$,
  'a returning-club review updates the exact locked club-term projection'
);
SELECT extensions.results_eq(
  $$SELECT relationship_status, workflow_status, allocation_satisfied, policy_notes, spreadsheet_url
    FROM plugin_data.csf_partner_club_terms
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'$$,
  $$VALUES ('returning'::text, 'active'::text, false, 'Record returned after a second officer review.'::text, 'https://docs.google.com/spreadsheets/d/science-partners-v2'::text)$$,
  'the returning review replaces the term projection with its exact reviewed record'
);
SELECT extensions.is(
  (SELECT contact_email FROM plugin_data.csf_partner_clubs WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  'partners@example.test',
  'omitted returning-club contact data inherits the canonical club value'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'),
  2,
  'a distinct review appends a second lifecycle receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND action = 'partner_club.policy_review'),
  2,
  'a distinct review appends a second staff audit receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_partner_club_term_events AS event
   JOIN plugin_data.csf_admin_audit_events AS audit
     ON audit.organization_id = event.organization_id
    AND audit.correlation_id = event.correlation_id
   WHERE event.organization_id = 'bd100000-0000-4000-8000-000000000001'),
  2,
  'each lifecycle receipt and staff audit share the browser request correlation'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_term_events
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND (metadata ? 'contactEmail' OR metadata ? 'contactName')
  ),
  'lifecycle metadata keeps direct partner contact details out of the replay receipt'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_term_events
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND NULLIF(metadata ->> 'requestFingerprint', '') IS NULL
  ),
  'every review receipt stores a canonical request fingerprint for conflict detection'
);

SELECT * FROM extensions.finish();
ROLLBACK;
