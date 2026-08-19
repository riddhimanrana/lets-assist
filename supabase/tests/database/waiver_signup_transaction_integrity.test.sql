BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(40);

-- ---------------------------------------------------------------------------
-- Exact execution ACLs, including negative controls for the private core.
-- ---------------------------------------------------------------------------

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), protected_functions(signature) AS (
  VALUES
    ('private.insert_project_signup_locked(uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb)'),
    ('public.insert_project_signup_with_waiver(uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb)'),
    ('public.insert_project_signup_with_capacity(uuid, text, uuid, uuid, text, text, jsonb)')
)
SELECT extensions.ok(
  NOT has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
FROM client_roles
CROSS JOIN protected_functions;

SELECT extensions.ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
FROM (
  VALUES
    ('private.insert_project_signup_locked(uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb)'),
    ('public.insert_project_signup_with_waiver(uuid, text, uuid, uuid, text, text, jsonb, jsonb, jsonb)'),
    ('public.insert_project_signup_with_capacity(uuid, text, uuid, uuid, text, text, jsonb)')
) AS service_functions(signature);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'waiver-signup-owner@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Signup Owner"}'::jsonb, now(), now()
  ),
  (
    'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'waiver-signup-volunteer@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Signup Volunteer"}'::jsonb, now(), now()
  );

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, workflow_status,
  waiver_required, waiver_pdf_storage_path
)
VALUES
  (
    'c2000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'Waiver Signup Project', 'Local', 'Signup integrity fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-04-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'published', true,
    'project_waivers/c2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  (
    'c2000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000001',
    'Open Signup Project', 'Local', 'Signup integrity fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-04-01","startTime":"09:00","endTime":"12:00","volunteers":1}}'::jsonb,
    false, 'published', false, NULL
  ),
  (
    'c2000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000001',
    'Staged Waiver Project', 'Local', 'Signup integrity fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-04-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', true,
    'project_waivers/c2000000-0000-4000-8000-000000000003/source.pdf'
  );

CREATE TEMPORARY TABLE signup_call_result AS
SELECT * FROM public.insert_project_signup_with_waiver(
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
) WITH NO DATA;

CREATE OR REPLACE FUNCTION pg_temp.run_signup(
  p_project_id uuid,
  p_schedule_id text,
  p_user_id uuid,
  p_anonymous_id uuid,
  p_status text,
  p_waiver jsonb DEFAULT NULL,
  p_anonymous_profile jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_outcome text;
BEGIN
  DELETE FROM signup_call_result;
  INSERT INTO signup_call_result
  SELECT * FROM public.insert_project_signup_with_waiver(
    p_project_id, p_schedule_id, p_user_id, p_anonymous_id, p_status,
    NULL, NULL, p_waiver, p_anonymous_profile
  );
  SELECT outcome INTO v_outcome FROM signup_call_result;
  RETURN v_outcome;
END;
$$;

-- A payload that names a foreign project and signup. The transaction must
-- ignore both and bind the evidence to its own row.
CREATE OR REPLACE FUNCTION pg_temp.waiver_payload()
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'signer_name', 'Signature Fixture',
    'signer_email', 'signer@local.test',
    'signature_type', 'typed',
    'signature_text', 'Signature Fixture',
    'project_id', 'c2000000-0000-4000-8000-000000000002',
    'signup_id', '00000000-0000-4000-8000-0000000000ff',
    'user_id', '00000000-0000-4000-8000-0000000000ee'
  );
$$;

-- ---------------------------------------------------------------------------
-- Identity: a session actor may never carry guest identity
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000002', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved',
    NULL,
    '{"email":"spoofed@allowed-domain.test","name":"Spoofed Guest"}'::jsonb
  ),
  'conflicting_identity',
  'a session actor carrying a guest profile is refused'
);

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000002', 'oneTime',
    'c1000000-0000-4000-8000-000000000002',
    'c3000000-0000-4000-8000-0000000000aa', 'approved'
  ),
  'conflicting_identity',
  'a session actor carrying a guest profile id is refused'
);

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000002', 'oneTime',
    NULL, NULL, 'approved'
  ),
  'invalid_input',
  'a signup with no identity at all is refused'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.project_signups),
  0::bigint,
  'no refused identity attempt created a signup row'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.anonymous_signups),
  0::bigint,
  'no refused identity attempt created a guest profile'
);

-- ---------------------------------------------------------------------------
-- A waiver project never yields a signup without evidence
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000001', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved'
  ),
  'waiver_required',
  'a waiver project refuses a signup submitted without evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the refused waiver signup left no row and consumed no capacity'
);

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000001', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved',
    NULL,
    '{"email":"guest@local.test","name":"Guest"}'::jsonb
  ),
  'conflicting_identity',
  'a waiver project refuses a mixed-identity submission before any write'
);

-- ---------------------------------------------------------------------------
-- A staged project is not signable
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000003', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved',
    pg_temp.waiver_payload()
  ),
  'project_unpublished',
  'an unpublished waiver project cannot be signed up for'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'the unpublished project consumed no capacity'
);

-- ---------------------------------------------------------------------------
-- The committed path binds evidence to its own transaction, not the payload
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000001', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved',
    pg_temp.waiver_payload()
  ),
  'inserted',
  'a waiver project accepts a signup that carries its evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_signatures AS signatures
    JOIN signup_call_result AS result
      ON result.signup_id = signatures.signup_id
     AND result.waiver_signature_id = signatures.id
    WHERE signatures.project_id = 'c2000000-0000-4000-8000-000000000001'
      AND signatures.user_id = 'c1000000-0000-4000-8000-000000000002'
      AND signatures.anonymous_id IS NULL
  ),
  1::bigint,
  'evidence is bound to the transaction identity, not the supplied payload'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_signatures
    WHERE project_id = 'c2000000-0000-4000-8000-000000000002'
       OR user_id = '00000000-0000-4000-8000-0000000000ee'
  ),
  0::bigint,
  'payload-supplied project and actor identifiers are ignored'
);

-- ---------------------------------------------------------------------------
-- Replay: a lost response takes no second seat and writes no second evidence
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000001', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved',
    pg_temp.waiver_payload()
  ),
  'already_exists',
  'a replayed signup reports the existing row instead of inserting again'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the replay consumed exactly one seat'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_signatures
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the replay stored exactly one waiver signature'
);

SELECT extensions.ok(
  (SELECT signup_id FROM signup_call_result) = (
    SELECT id
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  'the replay returns the identifier of the original signup'
);

-- ---------------------------------------------------------------------------
-- Crash boundary: a faulted waiver insert leaves no signup behind
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT public.insert_project_signup_with_waiver(
      'c2000000-0000-4000-8000-000000000001',
      'oneTime',
      'c1000000-0000-4000-8000-000000000001',
      NULL,
      'approved',
      NULL,
      NULL,
      jsonb_build_object(
        'signer_name', 'Cross Tenant',
        'signer_email', 'cross@local.test',
        'signature_type', 'typed',
        'waiver_pdf_storage_path',
          'project_waivers/c2000000-0000-4000-8000-000000000002/source.pdf'
      ),
      NULL
    )
  $$,
  '23514',
  NULL,
  'a cross-project evidence path faults the whole signup transaction'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
      AND user_id = 'c1000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the faulted transaction left no approved signup for its actor'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the faulted transaction consumed no additional capacity'
);

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000001', 'oneTime',
    'c1000000-0000-4000-8000-000000000001', NULL, 'approved',
    '{"signer_name":"Bad Mode","signer_email":"bad@local.test","signature_type":"forged"}'::jsonb
  ),
  'invalid_waiver',
  'an unsupported signature mode is refused before anything is written'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the refused waiver payload consumed no capacity'
);

-- ---------------------------------------------------------------------------
-- Guest signups: identity, seat, and evidence are one transaction
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000001', 'oneTime',
    NULL, NULL, 'pending',
    jsonb_build_object(
      'signer_name', 'Guest Signer',
      'signer_email', 'guest-signer@local.test',
      'signature_type', 'typed',
      'signature_text', 'Guest Signer'
    ),
    '{"email":"guest-signer@local.test","name":"Guest Signer","confirmed":false}'::jsonb
  ),
  'inserted',
  'a guest signup creates its identity, seat, and evidence together'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_signatures AS signatures
    JOIN signup_call_result AS result
      ON result.anonymous_signup_id = signatures.anonymous_id
     AND result.signup_id = signatures.signup_id
    WHERE signatures.user_id IS NULL
  ),
  1::bigint,
  'the guest evidence row carries the identity created by the same transaction'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.anonymous_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'exactly one guest identity exists after the committed signup'
);

-- A guest refused for capacity must leave no identity behind. The open
-- project holds a single seat, which the next call takes.
SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000002', 'oneTime',
    'c1000000-0000-4000-8000-000000000002', NULL, 'approved'
  ),
  'inserted',
  'the single open seat is taken by a session actor'
);

SELECT extensions.is(
  pg_temp.run_signup(
    'c2000000-0000-4000-8000-000000000002', 'oneTime',
    NULL, NULL, 'approved', NULL,
    '{"email":"late-guest@local.test","name":"Late Guest","confirmed":true}'::jsonb
  ),
  'slot_full',
  'a guest refused for capacity is refused before its identity is created'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.anonymous_signups
    WHERE lower(email) = 'late-guest@local.test'
  ),
  0::bigint,
  'the capacity refusal left no orphan guest identity'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'the full slot still holds exactly its capacity'
);

-- ---------------------------------------------------------------------------
-- The compatibility wrapper fails closed on waiver projects
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT outcome
    FROM public.insert_project_signup_with_capacity(
      'c2000000-0000-4000-8000-000000000001',
      'oneTime',
      'c1000000-0000-4000-8000-000000000001',
      NULL,
      'approved'
    )
  ),
  'waiver_required',
  'the waiver-unaware wrapper cannot create an unsigned waiver signup'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'the waiver-unaware wrapper consumed no capacity'
);

SELECT * FROM extensions.finish();

ROLLBACK;
