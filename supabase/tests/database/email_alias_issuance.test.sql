BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(33);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.issue_user_email_alias_verification(uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'anon cannot issue email-alias verification codes'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.issue_user_email_alias_verification(uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated cannot bypass server-side email-alias issuance'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.issue_user_email_alias_verification(uuid,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role can atomically issue email-alias verification codes'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.issue_user_email_alias_verification_unlocked(uuid,text,text,timestamptz)'
  ) IS NULL,
  'the obsolete unlocked issuer is removed'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.sync_primary_user_email(uuid)',
    'EXECUTE'
  ),
  'anon cannot invoke primary-email synchronization'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_primary_user_email(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot invoke primary-email synchronization directly'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sync_primary_user_email(uuid)',
    'EXECUTE'
  ),
  'service_role can atomically synchronize the primary Auth email'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'fa000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'alias-owner-one@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'fa000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'alias-owner-two@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'fa000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'primary-owner@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000001',
      'shared-pending-alias@local.test',
      repeat('a', 64),
      now() + interval '30 minutes'
    )
  ),
  'issued'::text,
  'the first user receives a per-user pending challenge'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000001',
      'shared-pending-alias@local.test',
      repeat('b', 64),
      now() + interval '30 minutes'
    )
  ),
  'cooldown'::text,
  'an immediate resend is rejected by the database cooldown'
);

SELECT extensions.is(
  (
    SELECT token_hash
    FROM public.email_alias_verification_challenges
    WHERE user_id = 'fa000000-0000-4000-8000-000000000001'
      AND email = 'shared-pending-alias@local.test'
  ),
  repeat('a', 64),
  'a rejected resend cannot invalidate the already-issued code'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000002',
      'shared-pending-alias@local.test',
      repeat('b', 64),
      now() + interval '30 minutes'
    )
  ),
  'issued'::text,
  'another user may request the same still-unverified address'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_alias_verification_challenges
    WHERE email = 'shared-pending-alias@local.test'
  ),
  2::bigint,
  'pending challenges are keyed independently by user and email'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.user_emails
    WHERE email = 'shared-pending-alias@local.test'
  ),
  0::bigint,
  'pending requests do not reserve the globally unique verified alias'
);

UPDATE public.email_alias_verification_challenges
SET last_sent_at = now() - interval '61 seconds',
    locked_until = now() + interval '15 minutes',
    attempts = 5
WHERE user_id = 'fa000000-0000-4000-8000-000000000001'
  AND email = 'shared-pending-alias@local.test';

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000001',
      'shared-pending-alias@local.test',
      repeat('c', 64),
      now() + interval '30 minutes'
    )
  ),
  'locked'::text,
  'resend cannot bypass an active verification lockout'
);

SELECT extensions.is(
  (
    SELECT token_hash
    FROM public.email_alias_verification_challenges
    WHERE user_id = 'fa000000-0000-4000-8000-000000000001'
      AND email = 'shared-pending-alias@local.test'
  ),
  repeat('a', 64),
  'a locked resend leaves the current secret unchanged'
);

UPDATE public.email_alias_verification_challenges
SET last_sent_at = now() - interval '61 seconds',
    locked_until = NULL,
    attempts = 0
WHERE user_id = 'fa000000-0000-4000-8000-000000000001'
  AND email = 'shared-pending-alias@local.test';

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000001',
      'shared-pending-alias@local.test',
      repeat('c', 64),
      now() + interval '30 minutes'
    )
  ),
  'issued'::text,
  'a resend is issued after cooldown and lockout expire'
);

SELECT extensions.is(
  (
    SELECT token_hash
    FROM public.email_alias_verification_challenges
    WHERE user_id = 'fa000000-0000-4000-8000-000000000001'
      AND email = 'shared-pending-alias@local.test'
  ),
  repeat('c', 64),
  'the post-cooldown issue stores the new code hash'
);

SELECT extensions.is(
  public.verify_user_email_alias(
    'fa000000-0000-4000-8000-000000000001',
    'shared-pending-alias@local.test',
    repeat('c', 64)
  ),
  'verified'::text,
  'the first successful verifier atomically claims the address'
);

SELECT extensions.ok(
  (
    SELECT
      user_id = 'fa000000-0000-4000-8000-000000000001'
      AND verified_at IS NOT NULL
    FROM public.user_emails
    WHERE email = 'shared-pending-alias@local.test'
  ),
  'the verified alias belongs to the successful verifier'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_alias_verification_challenges
    WHERE email = 'shared-pending-alias@local.test'
  ),
  0::bigint,
  'claiming a verified alias clears every competing pending challenge'
);

SELECT extensions.is(
  public.verify_user_email_alias(
    'fa000000-0000-4000-8000-000000000002',
    'shared-pending-alias@local.test',
    repeat('b', 64)
  ),
  'invalid'::text,
  'a cleared competing challenge cannot verify later'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000002',
      'shared-pending-alias@local.test',
      repeat('d', 64),
      now() + interval '30 minutes'
    )
  ),
  'unavailable'::text,
  'a verified cross-user alias conflict cannot be reissued'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000003',
      'primary-owner@local.test',
      repeat('e', 64),
      now() + interval '30 minutes'
    )
  ),
  'already_verified'::text,
  'a user primary Auth email does not receive a redundant challenge'
);

SELECT extensions.ok(
  (
    SELECT
      user_id = 'fa000000-0000-4000-8000-000000000003'
      AND is_primary
      AND verified_at IS NOT NULL
    FROM public.user_emails
    WHERE email = 'primary-owner@local.test'
  ),
  'the authoritative Auth email is synchronized as the one primary alias'
);

INSERT INTO public.user_emails (
  user_id,
  email,
  is_primary,
  verified_at
)
VALUES (
  'fa000000-0000-4000-8000-000000000003',
  'stale-primary@local.test',
  false,
  now()
);

UPDATE public.user_emails
SET is_primary = false
WHERE user_id = 'fa000000-0000-4000-8000-000000000003'
  AND email = 'primary-owner@local.test';

UPDATE public.user_emails
SET is_primary = true
WHERE user_id = 'fa000000-0000-4000-8000-000000000003'
  AND email = 'stale-primary@local.test';

SELECT extensions.is(
  (
    SELECT status
    FROM public.sync_primary_user_email(
      'fa000000-0000-4000-8000-000000000003'
    )
  ),
  'synced'::text,
  'the primary-email RPC repairs a stale primary flag atomically'
);

SELECT extensions.ok(
  (
    SELECT is_primary
    FROM public.user_emails
    WHERE user_id = 'fa000000-0000-4000-8000-000000000003'
      AND email = 'primary-owner@local.test'
  )
  AND NOT (
    SELECT is_primary
    FROM public.user_emails
    WHERE user_id = 'fa000000-0000-4000-8000-000000000003'
      AND email = 'stale-primary@local.test'
  ),
  'primary synchronization promotes Auth state and demotes the former row'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT user_id
    FROM public.user_emails
    WHERE is_primary
    GROUP BY user_id
    HAVING count(*) > 1
  ),
  'no user has more than one primary email'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.user_emails_one_primary_per_user_idx'::regclass
      AND indisunique
      AND indisvalid
  ),
  'a valid partial unique index enforces one primary row per user'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.user_emails (
      user_id,
      email,
      is_primary,
      verified_at
    )
    VALUES (
      'fa000000-0000-4000-8000-000000000003',
      'second-primary@local.test',
      true,
      now()
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "user_emails_one_primary_per_user_idx"',
  'the database rejects a second primary email for one user'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000002',
      'primary-owner@local.test',
      repeat('f', 64),
      now() + interval '30 minutes'
    )
  ),
  'unavailable'::text,
  'another user cannot challenge an existing primary Auth email'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000001',
      'other-alias@local.test',
      repeat('e', 64),
      now() + interval '2 hours'
    )
  $$,
  'P0001',
  'invalid email-alias verification issue request',
  'issuance rejects an excessive verification lifetime'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.issue_user_email_alias_verification(
      'fa000000-0000-4000-8000-000000000002',
      'Case-Normalized@LOCAL.TEST',
      repeat('e', 64),
      now() + interval '30 minutes'
    )
  ),
  'issued'::text,
  'issuance accepts a valid mixed-case input'
);

SELECT extensions.is(
  (
    SELECT email
    FROM public.email_alias_verification_challenges
    WHERE user_id = 'fa000000-0000-4000-8000-000000000002'
      AND email = 'case-normalized@local.test'
  ),
  'case-normalized@local.test'::text,
  'the challenge address is normalized before persistence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
