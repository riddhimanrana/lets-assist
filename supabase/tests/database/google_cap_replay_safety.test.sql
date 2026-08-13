BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(47);

SELECT extensions.has_table(
  'private',
  'google_cap_event_receipts',
  'Google CAP events have a durable private receipt ledger'
);

SELECT extensions.has_column(
  'private',
  'google_cap_event_receipts',
  'jti_hash',
  'the receipt is keyed by a one-way jti coordinate'
);

SELECT extensions.hasnt_column(
  'private',
  'google_cap_event_receipts',
  'raw_token',
  'raw signed tokens cannot be stored in the receipt'
);

SELECT extensions.hasnt_column(
  'private',
  'google_cap_event_receipts',
  'google_subject',
  'raw Google subjects cannot be stored in the receipt'
);

SELECT extensions.ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'private.google_cap_event_receipts'::regclass
  ),
  'the private receipt ledger has RLS enabled and forced'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'private.google_cap_event_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service code cannot bypass the reviewed receipt functions'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.claim_google_cap_event(text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot claim Google CAP events'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_google_cap_event(text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot claim Google CAP events'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_google_cap_event(text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ),
  'the server role can claim a validated Google CAP event'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.finish_google_cap_event(uuid,uuid,boolean,text,integer,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot settle Google CAP events'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.finish_google_cap_event(uuid,uuid,boolean,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot settle Google CAP events'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.finish_google_cap_event(uuid,uuid,boolean,text,integer,integer)',
    'EXECUTE'
  ),
  'the server role can settle its claimed Google CAP event'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.begin_google_cap_event_effect(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot begin Google CAP Auth effects'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.begin_google_cap_event_effect(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot begin Google CAP Auth effects'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.begin_google_cap_event_effect(uuid,uuid,text)',
    'EXECUTE'
  ),
  'the server role can begin a lease-fenced Google CAP Auth effect'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ca000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'google-cap-user@local.test',
  now(),
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
)
VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'synthetic-google-subject',
  'ca000000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-google-subject"}'::jsonb,
  'google',
  now(),
  now()
);

CREATE TEMP TABLE first_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('a', 64),
  repeat('b', 64),
  repeat('c', 64),
  'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  timestamptz '2026-08-12 19:00:00+00',
  'synthetic-google-subject'
);

SELECT extensions.is(
  (SELECT decision FROM first_claim),
  'execute',
  'the first delivery receives an execution lease'
);

SELECT extensions.is(
  (SELECT user_id FROM first_claim),
  'ca000000-0000-4000-8000-000000000001'::uuid,
  'the claim resolves the indexed Google identity without an admin-user scan'
);

SELECT extensions.ok(
  (
    SELECT
      jti_hash = repeat('a', 64)
      AND token_hash = repeat('b', 64)
      AND subject_hash = repeat('c', 64)
      AND row_to_json(receipt)::text NOT LIKE '%synthetic-google-subject%'
    FROM private.google_cap_event_receipts AS receipt
    WHERE id = (SELECT receipt_id FROM first_claim)
  ),
  'the durable receipt contains hashes and never the raw provider subject'
);

SELECT extensions.is(
  (
    SELECT decision
    FROM public.claim_google_cap_event(
      repeat('a', 64), repeat('b', 64), repeat('c', 64),
      'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
      timestamptz '2026-08-12 19:00:00+00',
      'synthetic-google-subject'
    )
  ),
  'in_progress',
  'a concurrent duplicate does not repeat the security effect'
);

SELECT extensions.is(
  public.finish_google_cap_event(
    (SELECT receipt_id FROM first_claim),
    'ca200000-0000-4000-8000-000000000001',
    true,
    'sessions_terminated',
    1,
    0
  ),
  false,
  'a forged claim token cannot settle another worker receipt'
);

CREATE TEMP TABLE first_effect AS
SELECT *
FROM public.begin_google_cap_event_effect(
  (SELECT receipt_id FROM first_claim),
  (SELECT claim_token FROM first_claim),
  'synthetic-google-subject'
);

SELECT extensions.is(
  (SELECT decision FROM first_effect),
  'execute',
  'the live lease owner fences and revalidates before its Auth effect'
);

SELECT extensions.is(
  public.finish_google_cap_event(
    (SELECT receipt_id FROM first_claim),
    (SELECT claim_token FROM first_claim),
    true,
    'sessions_terminated',
    1,
    0
  ),
  true,
  'the owning worker can settle the completed event'
);

SELECT extensions.ok(
  (
    SELECT
      status = 'completed'
      AND claim_token IS NULL
      AND safe_outcome = 'sessions_terminated'
      AND action_count = 1
      AND error_count = 0
      AND completed_at IS NOT NULL
    FROM private.google_cap_event_receipts
    WHERE id = (SELECT receipt_id FROM first_claim)
  ),
  'settlement persists only bounded aggregate outcome data'
);

SELECT extensions.ok(
  (
    SELECT decision = 'replayed' AND claim_token IS NULL
    FROM public.claim_google_cap_event(
      repeat('a', 64), repeat('b', 64), repeat('c', 64),
      'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
      timestamptz '2026-08-12 19:00:00+00',
      'synthetic-google-subject'
    )
  ),
  'a completed redelivery is replayed without a new execution lease'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.claim_google_cap_event(
      repeat('a', 64), repeat('d', 64), repeat('c', 64),
      'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
      timestamptz '2026-08-12 19:00:00+00',
      'synthetic-google-subject'
    )
  $$,
  '22023',
  'Google CAP jti is already bound to another signed event',
  'one jti cannot be rebound to different signed bytes'
);

CREATE TEMP TABLE second_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('d', 64), repeat('e', 64), repeat('c', 64),
  'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
  timestamptz '2026-08-12 19:01:00+00',
  'synthetic-google-subject'
);

SELECT extensions.is(
  (SELECT decision FROM second_claim),
  'execute',
  'a later event for the same identity can run after settlement'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.claim_google_cap_event(
      repeat('f', 64), repeat('1', 64), repeat('c', 64),
      'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
      timestamptz '2026-08-12 19:02:00+00',
      'synthetic-google-subject'
    )
  $$,
  '23505',
  NULL,
  'different events cannot mutate one identity concurrently'
);

SELECT extensions.is(
  public.finish_google_cap_event(
    (SELECT receipt_id FROM second_claim),
    (SELECT claim_token FROM second_claim),
    false,
    'retryable_failure',
    0,
    1
  ),
  true,
  'a retryable provider or auth failure releases the identity lease'
);

CREATE TEMP TABLE third_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('f', 64), repeat('1', 64), repeat('c', 64),
  'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
  timestamptz '2026-08-12 19:02:00+00',
  'synthetic-google-subject'
);

SELECT extensions.is(
  (SELECT decision FROM third_claim),
  'execute',
  'the deferred identity event can claim after the prior worker releases it'
);

SELECT extensions.is(
  public.finish_google_cap_event(
    (SELECT receipt_id FROM third_claim),
    (SELECT claim_token FROM third_claim),
    false,
    'retryable_failure',
    0,
    1
  ),
  true,
  'a failed identity event remains durable and retryable'
);

CREATE TEMP TABLE retried_third_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('f', 64), repeat('1', 64), repeat('c', 64),
  'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
  timestamptz '2026-08-12 19:02:00+00',
  'synthetic-google-subject'
);

SELECT extensions.ok(
  (
    SELECT decision = 'execute' AND attempt_count = 2 AND claim_token IS NOT NULL
    FROM retried_third_claim
  ),
  'a failed delivery receives a new lease and monotonic attempt count'
);

UPDATE private.google_cap_event_receipts
SET status = 'failed',
    claim_token = NULL,
    attempt_count = 100,
    lease_expires_at = NULL,
    safe_outcome = 'retryable_failure',
    action_count = 0,
    error_count = 1,
    completed_at = NULL
WHERE id = (SELECT receipt_id FROM retried_third_claim);

SELECT extensions.lives_ok(
  $$
    SELECT public.claim_google_cap_event(
      repeat('f', 64), repeat('1', 64), repeat('c', 64),
      'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
      timestamptz '2026-08-12 19:02:00+00',
      'synthetic-google-subject'
    )
  $$,
  'a receipt remains retryable after its bounded attempt counter saturates'
);

SELECT extensions.ok(
  (
    SELECT status = 'processing' AND attempt_count = 100
    FROM private.google_cap_event_receipts
    WHERE id = (SELECT receipt_id FROM retried_third_claim)
  ),
  'the saturated attempt counter remains bounded while a new lease is issued'
);

CREATE TEMP TABLE unmapped_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('2', 64), repeat('3', 64), repeat('4', 64),
  'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
  timestamptz '2026-08-12 19:03:00+00',
  'late-linked-google-subject'
);

SELECT extensions.is(
  (SELECT user_id FROM unmapped_claim),
  NULL::uuid,
  'an initially unlinked Google subject has no resolved local user'
);

CREATE TEMP TABLE unmapped_effect AS
SELECT *
FROM public.begin_google_cap_event_effect(
  (SELECT receipt_id FROM unmapped_claim),
  (SELECT claim_token FROM unmapped_claim),
  'late-linked-google-subject'
);

SELECT extensions.is(
  (SELECT decision FROM unmapped_effect),
  'no_local_user',
  'an actionable event without a local identity remains retryable'
);

SELECT extensions.ok(
  (
    SELECT
      status = 'failed'
      AND claim_token IS NULL
      AND safe_outcome = 'no_local_user'
      AND completed_at IS NULL
    FROM private.google_cap_event_receipts
    WHERE id = (SELECT receipt_id FROM unmapped_claim)
  ),
  'no-local-user does not permanently complete the actionable receipt'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ca000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'google-cap-late-link@local.test',
  now(),
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
)
VALUES (
  'ca100000-0000-4000-8000-000000000002',
  'late-linked-google-subject',
  'ca000000-0000-4000-8000-000000000002',
  '{"sub":"late-linked-google-subject"}'::jsonb,
  'google',
  now(),
  now()
);

SELECT extensions.is(
  (
    SELECT user_id
    FROM public.claim_google_cap_event(
      repeat('2', 64), repeat('3', 64), repeat('4', 64),
      'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
      timestamptz '2026-08-12 19:03:00+00',
      'late-linked-google-subject'
    )
  ),
  'ca000000-0000-4000-8000-000000000002'::uuid,
  'a failed receipt re-resolves an identity linked after the first claim'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'ca000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'google-cap-reassigned-old@local.test',
    now(),
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'ca000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'google-cap-reassigned-new@local.test',
    now(),
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
)
VALUES (
  'ca100000-0000-4000-8000-000000000003',
  'reassigned-google-subject',
  'ca000000-0000-4000-8000-000000000003',
  '{"sub":"reassigned-google-subject"}'::jsonb,
  'google',
  now(),
  now()
);

CREATE TEMP TABLE assigned_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('5', 64), repeat('6', 64), repeat('7', 64),
  'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  timestamptz '2026-08-12 19:04:00+00',
  'reassigned-google-subject'
);

SELECT extensions.is(
  (SELECT user_id FROM assigned_claim),
  'ca000000-0000-4000-8000-000000000003'::uuid,
  'the first claim resolves the identity owner at claim time'
);

UPDATE auth.identities
SET user_id = 'ca000000-0000-4000-8000-000000000004',
    updated_at = now()
WHERE id = 'ca100000-0000-4000-8000-000000000003';

CREATE TEMP TABLE reassigned_effect AS
SELECT *
FROM public.begin_google_cap_event_effect(
  (SELECT receipt_id FROM assigned_claim),
  (SELECT claim_token FROM assigned_claim),
  'reassigned-google-subject'
);

SELECT extensions.is(
  (SELECT decision FROM reassigned_effect),
  'identity_changed',
  'identity ownership is revalidated immediately before the Auth effect'
);

SELECT extensions.ok(
  (
    SELECT
      status = 'failed'
      AND claim_token IS NULL
      AND safe_outcome = 'identity_changed'
    FROM private.google_cap_event_receipts
    WHERE id = (SELECT receipt_id FROM assigned_claim)
  ),
  'an ownership change releases the stale claim without mutating Auth'
);

SELECT extensions.is(
  (
    SELECT user_id
    FROM public.claim_google_cap_event(
      repeat('5', 64), repeat('6', 64), repeat('7', 64),
      'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
      timestamptz '2026-08-12 19:04:00+00',
      'reassigned-google-subject'
    )
  ),
  'ca000000-0000-4000-8000-000000000004'::uuid,
  'a failed receipt cannot keep acting on a stale identity owner'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ca000000-0000-4000-8000-000000000005',
  'authenticated',
  'authenticated',
  'google-cap-takeover@local.test',
  now(),
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
)
VALUES (
  'ca100000-0000-4000-8000-000000000005',
  'takeover-google-subject',
  'ca000000-0000-4000-8000-000000000005',
  '{"sub":"takeover-google-subject"}'::jsonb,
  'google',
  now(),
  now()
);

CREATE TEMP TABLE expired_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('8', 64), repeat('9', 64), repeat('0', 64),
  'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  timestamptz '2026-08-12 19:05:00+00',
  'takeover-google-subject'
);

UPDATE private.google_cap_event_receipts
SET lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
WHERE id = (SELECT receipt_id FROM expired_claim);

CREATE TEMP TABLE takeover_claim AS
SELECT *
FROM public.claim_google_cap_event(
  repeat('8', 64), repeat('9', 64), repeat('0', 64),
  'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  timestamptz '2026-08-12 19:05:00+00',
  'takeover-google-subject'
);

SELECT extensions.is(
  (
    SELECT decision
    FROM public.begin_google_cap_event_effect(
      (SELECT receipt_id FROM expired_claim),
      (SELECT claim_token FROM expired_claim),
      'takeover-google-subject'
    )
  ),
  'lease_lost',
  'an expired worker cannot begin an Auth effect after lease takeover'
);

SELECT extensions.is(
  (
    SELECT decision
    FROM public.begin_google_cap_event_effect(
      (SELECT receipt_id FROM takeover_claim),
      (SELECT claim_token FROM takeover_claim),
      'takeover-google-subject'
    )
  ),
  'execute',
  'the current lease owner can atomically fence its Auth effect'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.claim_google_cap_event(
      repeat('a0', 32), repeat('b0', 32), repeat('0', 64),
      'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
      timestamptz '2026-08-12 19:06:00+00',
      'takeover-google-subject'
    )
  $$,
  '23505',
  NULL,
  'an effect-started event remains exclusive and cannot be reclaimed'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.claim_google_cap_event(text,text,text,text,timestamptz,text)'::regprocedure
  ) NOT LIKE '%identity_data%',
  'the claim resolver has no unindexed JSON identity fallback'
);

SELECT extensions.has_index(
  'private',
  'google_cap_event_receipts',
  'google_cap_event_receipts_processing_subject_uidx',
  'one processing receipt per provider identity is enforced by the database'
);

SELECT extensions.ok(
  (
    SELECT pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid)
      LIKE '%status = ANY%processing%effect_started%'
    FROM pg_catalog.pg_index AS index_state
    WHERE index_state.indexrelid =
      'private.google_cap_event_receipts_processing_subject_uidx'::regclass
  ),
  'the subject uniqueness index covers processing and effect-started receipts'
);

SELECT * FROM extensions.finish();

ROLLBACK;
