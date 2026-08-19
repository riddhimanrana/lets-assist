-- Contract for the server-only Google OAuth attempt ledger.
--
-- Four properties carry the whole repair:
--   1. the ledger is unreachable from client roles, and its only callable
--      surface is a service_role-only public wrapper;
--   2. concurrent attempts coexist, so a second connect click cannot
--      invalidate the first (the cross-tab `invalid_state` collapse);
--   3. claim is exactly once, distinguishing an exchange still in flight from
--      one already settled, and recovering an abandoned claim through a
--      bounded lease instead of stranding the attempt;
--   4. a recorded success always names the durable connection it produced.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(49);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'oauth-actor@example.invalid', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'oauth-other@example.invalid', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.user_calendar_connections (
  id, user_id, provider, access_token, refresh_token,
  token_expires_at, calendar_email, connection_type
)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'google', 'enc-access', 'enc-refresh',
  now() + interval '1 hour', 'oauth-actor@example.invalid', 'calendar'
);

-- ---------------------------------------------------------------------------
-- Server-only posture
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  to_regclass('app_private.google_oauth_attempts') IS NOT NULL,
  'the attempt ledger exists'
);

SELECT extensions.ok(
  (
    SELECT class.relrowsecurity AND class.relforcerowsecurity
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'app_private'
      AND class.relname = 'google_oauth_attempts'
  ),
  'the attempt ledger forces row level security'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'app_private' AND tablename = 'google_oauth_attempts'
  ),
  0,
  'the attempt ledger grants no row level access to any client role'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS client(role_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS access(mode)
    WHERE has_table_privilege(
      client.role_name,
      'app_private.google_oauth_attempts',
      access.mode
    )
  ),
  'client roles hold no table privilege on the attempt ledger'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname IN (
        'begin_google_oauth_attempt',
        'claim_google_oauth_attempt',
        'finalize_google_oauth_attempt'
      )
  ),
  3,
  'each attempt lifecycle function has a PostgREST-callable public wrapper'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS client(role_name)
    WHERE namespace.nspname IN ('app_private', 'public')
      AND proc.proname LIKE '%google_oauth_attempt%'
      AND has_function_privilege(client.role_name, proc.oid, 'EXECUTE')
  ),
  'no client role can execute any attempt function or its public wrapper'
);

SELECT extensions.ok(
  (
    SELECT bool_and(has_function_privilege('service_role', proc.oid, 'EXECUTE'))
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname IN ('app_private', 'public')
      AND proc.proname LIKE '%google_oauth_attempt%'
  ),
  'service_role can execute every attempt function and wrapper'
);

-- ---------------------------------------------------------------------------
-- Concurrent attempts coexist
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT public.begin_google_oauth_attempt(
      'attemptrefpersonalcal01', repeat('A', 43), repeat('B', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43),
      'personal_calendar', NULL, NULL, NULL,
      '/account/calendar', repeat('D', 43),
      'encrypted-verifier-one', 'ABCDEFGH01', 600
    )
  $$,
  'a personal calendar attempt is recorded through the public wrapper'
);

SELECT extensions.lives_ok(
  $$
    SELECT public.begin_google_oauth_attempt(
      'attemptrefpersonalsheet1', repeat('E', 43), repeat('F', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43),
      'personal_sheets', NULL, NULL, NULL,
      '/account/calendar', repeat('G', 43),
      'encrypted-verifier-two', 'ABCDEFGH02', 600
    )
  $$,
  'a second concurrent attempt for the same user does not disturb the first'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM app_private.google_oauth_attempts
    WHERE user_id = 'a0000000-0000-4000-8000-000000000001'
      AND status = 'pending'
  ),
  2,
  'both concurrent attempts remain independently claimable'
);

-- ---------------------------------------------------------------------------
-- Binding invariants
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_google_oauth_attempt(
      'attemptrefcsfnocapabil1', repeat('H', 43), repeat('I', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43),
      'csf_import', NULL, NULL, NULL,
      '/organization/x?tab=csf-imports', repeat('J', 43),
      'encrypted-verifier-three', 'ABCDEFGH03', 600
    )
  $$,
  '23514',
  NULL,
  'a CSF import attempt cannot omit its organization, plugin, and capability'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_google_oauth_attempt(
      'attemptrefabsolutereturn', repeat('K', 43), repeat('L', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43),
      'personal_calendar', NULL, NULL, NULL,
      '//evil.example/path', repeat('M', 43),
      'encrypted-verifier-four', 'ABCDEFGH04', 600
    )
  $$,
  '23514',
  NULL,
  'a protocol-relative return path is rejected at the storage boundary'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_google_oauth_attempt(
      'attemptrefbadttl0000001', repeat('N', 43), repeat('O', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43),
      'personal_calendar', NULL, NULL, NULL,
      '/account/calendar', repeat('P', 43),
      'encrypted-verifier-five', 'ABCDEFGH05', 86400
    )
  $$,
  'P0001',
  'Google OAuth attempt TTL is out of range',
  'an unbounded attempt lifetime is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT verdict FROM public.claim_google_oauth_attempt(
      repeat('A', 43), repeat('B', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 86400
    )
  $$,
  'P0001',
  'Google OAuth attempt lease is out of range',
  'an unbounded processing lease is refused'
);

-- ---------------------------------------------------------------------------
-- Claim fails closed on the wrong browser, principal, or session
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('Z', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'unknown_attempt',
  'an unknown state digest is rejected'
);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('X', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'cookie_mismatch',
  'a callback without the attempt-specific cookie is rejected'
);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000002', repeat('C', 43), 120
  )),
  'user_mismatch',
  'a callback presented by another signed-in user is rejected'
);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('Y', 43), 120
  )),
  'session_mismatch',
  'a callback presented under a different session is rejected'
);

SELECT extensions.is(
  (
    SELECT status FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('A', 43)
  ),
  'pending',
  'a rejected claim leaves the attempt claimable by the legitimate browser'
);

-- ---------------------------------------------------------------------------
-- Claim is exactly once, and distinguishes in-flight from settled
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'claimed',
  'the first callback claims the attempt'
);

SELECT extensions.is(
  (SELECT claim_epoch FROM app_private.google_oauth_attempts
   WHERE state_digest = repeat('A', 43)),
  1,
  'the first claim opens epoch one'
);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'in_progress',
  'a duplicate arriving while the lease holds is told the exchange is in flight'
);

SELECT extensions.is(
  (SELECT code_verifier_encrypted FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  NULL,
  'an in-flight duplicate is never handed the PKCE verifier'
);

SELECT extensions.is(
  (SELECT code_verifier_encrypted FROM public.claim_google_oauth_attempt(
    repeat('E', 43), repeat('F', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'encrypted-verifier-two',
  'a claim releases only its own PKCE verifier'
);

SELECT extensions.ok(
  NOT public.finalize_google_oauth_attempt(
    (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('A', 43)),
    99, 'succeeded', 'connected', 'c0000000-0000-4000-8000-000000000001'
  ),
  'a caller presenting a stale claim epoch cannot finalize'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.finalize_google_oauth_attempt(
      (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('A', 43)),
      1, 'succeeded', 'connected', NULL
    )
  $$,
  'P0001',
  'A successful Google OAuth attempt must name its connection',
  'a success without a durable connection is refused'
);

SELECT extensions.ok(
  public.finalize_google_oauth_attempt(
    (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('A', 43)),
    1, 'succeeded', 'connected', 'c0000000-0000-4000-8000-000000000001'
  ),
  'the current claimant finalizes its own attempt'
);

SELECT extensions.is(
  (
    SELECT code_verifier_encrypted FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('A', 43)
  ),
  'consumed',
  'finalizing tombstones the PKCE verifier'
);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'already_settled',
  'a duplicated callback after settlement is refused a second claim'
);

SELECT extensions.is(
  (SELECT recorded_outcome_code FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'connected',
  'a duplicated callback reads back the recorded outcome instead of re-exchanging'
);

SELECT extensions.is(
  (SELECT recorded_connection_id FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'c0000000-0000-4000-8000-000000000001'::uuid,
  'the replayed success names the durable connection it produced'
);

SELECT extensions.is(
  (SELECT code_verifier_encrypted FROM public.claim_google_oauth_attempt(
    repeat('A', 43), repeat('B', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  NULL,
  'a settled duplicate is never handed a PKCE verifier'
);

SELECT extensions.ok(
  NOT public.finalize_google_oauth_attempt(
    (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('A', 43)),
    1, 'failed', 'token_exchange_failed', NULL
  ),
  'a settled attempt cannot be finalized a second time'
);

SELECT extensions.is(
  (
    SELECT outcome_code FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('A', 43)
  ),
  'connected',
  'the first recorded outcome is immutable'
);

-- ---------------------------------------------------------------------------
-- An abandoned claim recovers through the lease instead of stranding
-- ---------------------------------------------------------------------------

UPDATE app_private.google_oauth_attempts
SET lease_expires_at = now() - interval '1 second'
WHERE state_digest = repeat('E', 43);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('E', 43), repeat('F', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'claimed',
  'an attempt whose processing lease lapsed is reclaimable, not stranded'
);

SELECT extensions.is(
  (SELECT claim_epoch FROM app_private.google_oauth_attempts
   WHERE state_digest = repeat('E', 43)),
  2,
  'lease recovery advances the claim epoch so the abandoned worker cannot finalize'
);

SELECT extensions.ok(
  NOT public.finalize_google_oauth_attempt(
    (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('E', 43)),
    1, 'failed', 'token_exchange_failed', NULL
  ),
  'the superseded worker cannot finalize over its successor'
);

-- ---------------------------------------------------------------------------
-- Expiry settles the attempt rather than leaving it claimable
-- ---------------------------------------------------------------------------

UPDATE app_private.google_oauth_attempts
SET expires_at = now() - interval '1 minute',
    lease_expires_at = now() - interval '1 second'
WHERE state_digest = repeat('E', 43);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('E', 43), repeat('F', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'expired',
  'an expired attempt is settled instead of claimed'
);

SELECT extensions.is(
  (
    SELECT status || ':' || outcome_code
    FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('E', 43)
  ),
  'failed:expired_state',
  'expiry records a bounded terminal outcome'
);

SELECT extensions.is(
  (
    SELECT connection_id FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('E', 43)
  ),
  NULL,
  'a failed attempt names no connection'
);

-- ---------------------------------------------------------------------------
-- A spent authorization code is reconciled, never re-exchanged
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT public.begin_google_oauth_attempt(
      'attemptrefexchangedcase1', repeat('Q', 43), repeat('R', 43),
      'a0000000-0000-4000-8000-000000000001', repeat('C', 43),
      'personal_calendar', NULL, NULL, NULL,
      '/account/calendar', repeat('S', 43),
      'encrypted-verifier-six', 'ABCDEFGH06', 600
    )
  $$,
  'an attempt exists to exercise the spent-code path'
);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('Q', 43), repeat('R', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'claimed',
  'the spent-code attempt is claimed once'
);

SELECT extensions.ok(
  public.mark_google_oauth_attempt_exchanged(
    (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('Q', 43)),
    1
  ),
  'the claimant records that the authorization code was presented'
);

SELECT extensions.ok(
  NOT public.mark_google_oauth_attempt_exchanged(
    (SELECT id FROM app_private.google_oauth_attempts WHERE state_digest = repeat('Q', 43)),
    99
  ),
  'a stale epoch cannot record a code exchange'
);

UPDATE app_private.google_oauth_attempts
SET lease_expires_at = now() - interval '1 second'
WHERE state_digest = repeat('Q', 43);

SELECT extensions.is(
  (SELECT verdict FROM public.claim_google_oauth_attempt(
    repeat('Q', 43), repeat('R', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'already_settled',
  'an abandoned attempt whose code was spent is never reclaimed for re-exchange'
);

SELECT extensions.is(
  (
    SELECT status || ':' || outcome_code
    FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('Q', 43)
  ),
  'unknown:connection_outcome_unknown',
  'the spent-code attempt settles as an explicit unknown outcome'
);

SELECT extensions.is(
  (
    SELECT code_verifier_encrypted FROM app_private.google_oauth_attempts
    WHERE state_digest = repeat('Q', 43)
  ),
  'consumed',
  'reconciling an unknown outcome also tombstones the verifier'
);

SELECT extensions.is(
  (SELECT recorded_status FROM public.claim_google_oauth_attempt(
    repeat('Q', 43), repeat('R', 43),
    'a0000000-0000-4000-8000-000000000001', repeat('C', 43), 120
  )),
  'unknown',
  'a later duplicate reads back the unknown outcome rather than a false result'
);

SELECT extensions.throws_ok(
  $$
    UPDATE app_private.google_oauth_attempts
    SET status = 'unknown', outcome_code = 'connection_outcome_unknown',
        claim_epoch = 1, claimed_at = now(), lease_expires_at = NULL,
        finalized_at = now()
    WHERE state_digest = repeat('A', 43)
  $$,
  '23514',
  NULL,
  'an unknown outcome cannot be recorded unless the code was actually spent'
);

SELECT extensions.finish();

ROLLBACK;
