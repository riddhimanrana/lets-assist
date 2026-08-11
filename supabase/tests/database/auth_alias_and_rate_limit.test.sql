BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(53);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), write_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE')
)
SELECT extensions.ok(
  NOT has_table_privilege(role_name, 'public.user_emails', privilege_name),
  format('%s cannot %s public.user_emails', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN write_privileges;

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.email_alias_verification_challenges',
    privilege_name
  ),
  format(
    '%s cannot %s public.email_alias_verification_challenges',
    role_name,
    privilege_name
  )
)
FROM client_roles
CROSS JOIN table_privileges;

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), protected_functions(signature) AS (
  VALUES
    ('public.verify_user_email_alias(uuid,text,text)'),
    ('public.discard_user_email_alias_verification(uuid,uuid,text)'),
    ('public.consume_api_rate_limit(text,integer,integer)')
)
SELECT extensions.ok(
  NOT has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
FROM client_roles
CROSS JOIN protected_functions;

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.verify_user_email_alias(uuid,text,text)',
    'EXECUTE'
  ),
  'service_role can execute email-alias verification'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.discard_user_email_alias_verification(uuid,uuid,text)',
    'EXECUTE'
  ),
  'service_role can discard only an exact undelivered challenge'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.consume_api_rate_limit(text,integer,integer)',
    'EXECUTE'
  ),
  'service_role can execute atomic API rate limiting'
);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(role_name, 'public.api_rate_limits', privilege_name),
  format('%s cannot %s public.api_rate_limits', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN table_privileges;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_emails'
      AND column_name IN (
        'verification_token',
        'verification_token_hash',
        'verification_expires_at',
        'verification_attempts',
        'verification_locked_until',
        'verification_last_sent_at'
      )
  ),
  'verified user_emails contains no pending challenge state'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_alias_verification_challenges'
      AND column_name = 'token_hash'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_alias_verification_challenges'
      AND column_name = 'verification_token'
  ),
  'challenge storage contains a hash and no plaintext-token column'
);

SELECT extensions.ok(
  (
    SELECT is_nullable = 'NO'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_emails'
      AND column_name = 'verified_at'
  ),
  'every persisted user_emails row must be verified'
);

SELECT extensions.ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.email_alias_verification_challenges'::regclass
  ),
  'email-alias challenges have RLS enabled in addition to revoked client grants'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    'f7000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'auth-boundary-owner@local.test',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Auth Boundary Owner"}'::jsonb,
    now(),
    now()
  ),
  (
    'f7000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'auth-boundary-other@local.test',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Auth Boundary Other"}'::jsonb,
    now(),
    now()
  );

SET LOCAL request.jwt.claims =
  '{"sub":"f7000000-0000-4000-8000-000000000001","role":"authenticated","email":"auth-boundary-owner@local.test"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.profiles
    SET email = 'spoofed-primary@local.test'
    WHERE id = 'f7000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'profile email changes require the verified auth flow',
  'an authenticated client cannot spoof profiles.email'
);

RESET ROLE;

INSERT INTO public.email_alias_verification_challenges (
  user_id,
  email,
  token_hash,
  expires_at,
  attempts,
  last_sent_at
)
VALUES (
  'f7000000-0000-4000-8000-000000000001',
  'auth-boundary-alias@local.test',
  repeat('a', 64),
  now() + interval '30 minutes',
  0,
  now()
);

SELECT extensions.is(
  public.verify_user_email_alias(
    'f7000000-0000-4000-8000-000000000001',
    'auth-boundary-alias@local.test',
    repeat('b', 64)
  ),
  'invalid'::text,
  'an incorrect alias code is rejected'
);

SELECT extensions.is(
  (
    SELECT attempts
    FROM public.email_alias_verification_challenges
    WHERE email = 'auth-boundary-alias@local.test'
      AND user_id = 'f7000000-0000-4000-8000-000000000001'
  ),
  1,
  'an incorrect alias code increments the bounded attempt count'
);

UPDATE public.email_alias_verification_challenges
SET attempts = 4
WHERE email = 'auth-boundary-alias@local.test'
  AND user_id = 'f7000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  public.verify_user_email_alias(
    'f7000000-0000-4000-8000-000000000001',
    'auth-boundary-alias@local.test',
    repeat('b', 64)
  ),
  'locked'::text,
  'the fifth incorrect alias code locks verification'
);

SELECT extensions.ok(
  (
    SELECT locked_until > now()
    FROM public.email_alias_verification_challenges
    WHERE email = 'auth-boundary-alias@local.test'
      AND user_id = 'f7000000-0000-4000-8000-000000000001'
  ),
  'alias verification records a future lockout'
);

SELECT extensions.is(
  public.verify_user_email_alias(
    'f7000000-0000-4000-8000-000000000001',
    'auth-boundary-alias@local.test',
    repeat('a', 64)
  ),
  'locked'::text,
  'the correct alias code cannot bypass an active lockout'
);

UPDATE public.email_alias_verification_challenges
SET attempts = 0,
    locked_until = NULL
WHERE email = 'auth-boundary-alias@local.test'
  AND user_id = 'f7000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  public.verify_user_email_alias(
    'f7000000-0000-4000-8000-000000000001',
    'auth-boundary-alias@local.test',
    repeat('a', 64)
  ),
  'verified'::text,
  'a valid unexpired alias code atomically verifies the address'
);

SELECT extensions.ok(
  (
    SELECT
      user_id = 'f7000000-0000-4000-8000-000000000001'
      AND verified_at IS NOT NULL
      AND NOT is_primary
    FROM public.user_emails
    WHERE email = 'auth-boundary-alias@local.test'
  ),
  'successful verification inserts a verified secondary alias'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_alias_verification_challenges
    WHERE email = 'auth-boundary-alias@local.test'
  ),
  0::bigint,
  'successful verification consumes every competing pending challenge'
);

INSERT INTO public.email_alias_verification_challenges (
  user_id,
  email,
  token_hash,
  expires_at,
  last_sent_at
)
VALUES (
  'f7000000-0000-4000-8000-000000000001',
  'expired-auth-boundary-alias@local.test',
  repeat('c', 64),
  now() - interval '1 second',
  now() - interval '31 minutes'
);

SELECT extensions.is(
  public.verify_user_email_alias(
    'f7000000-0000-4000-8000-000000000001',
    'expired-auth-boundary-alias@local.test',
    repeat('c', 64)
  ),
  'invalid'::text,
  'an expired alias code is rejected'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_alias_verification_challenges
    WHERE email = 'expired-auth-boundary-alias@local.test'
  ),
  0::bigint,
  'an expired challenge is consumed'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.user_emails (user_id, email, is_primary, verified_at)
    VALUES (
      'f7000000-0000-4000-8000-000000000001',
      'unverified-row@local.test',
      false,
      NULL
    )
  $$,
  '23502',
  'null value in column "verified_at" of relation "user_emails" violates not-null constraint',
  'an unverified address cannot be persisted in user_emails'
);

INSERT INTO public.email_alias_verification_challenges (
  id,
  user_id,
  email,
  token_hash,
  expires_at,
  last_sent_at
)
VALUES (
  'f7100000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001',
  'delivery-failed-alias@local.test',
  repeat('d', 64),
  now() + interval '30 minutes',
  now()
);

SELECT extensions.is(
  public.discard_user_email_alias_verification(
    'f7100000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000001',
    repeat('e', 64)
  ),
  false,
  'delivery cleanup rejects a stale or mismatched token hash'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_alias_verification_challenges
    WHERE id = 'f7100000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a mismatched cleanup cannot discard the current challenge'
);

SELECT extensions.is(
  public.discard_user_email_alias_verification(
    'f7100000-0000-4000-8000-000000000001',
    'f7000000-0000-4000-8000-000000000001',
    repeat('d', 64)
  ),
  true,
  'delivery cleanup discards the exact undelivered challenge'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_alias_verification_challenges
    WHERE id = 'f7100000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the exact undelivered challenge is removed'
);

DELETE FROM public.api_rate_limits
WHERE rate_limit_key = 'pgtap:auth-boundary';

SELECT extensions.ok(
  (
    SELECT allowed
    FROM public.consume_api_rate_limit('pgtap:auth-boundary', 2, 600)
  ),
  'the first request in an API quota window is allowed'
);

SELECT extensions.ok(
  (
    SELECT allowed
    FROM public.consume_api_rate_limit('pgtap:auth-boundary', 2, 600)
  ),
  'the second request at the API quota is allowed'
);

SELECT extensions.ok(
  NOT (
    SELECT allowed
    FROM public.consume_api_rate_limit('pgtap:auth-boundary', 2, 600)
  ),
  'a request over the API quota is rejected'
);

SELECT extensions.is(
  (
    SELECT request_count
    FROM public.api_rate_limits
    WHERE rate_limit_key = 'pgtap:auth-boundary'
  ),
  2,
  'rejected API requests do not increment beyond the configured cap'
);

SELECT * FROM extensions.finish();

ROLLBACK;
