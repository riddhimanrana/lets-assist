-- Replay-safe notification keys must be opt-in. Ordinary event notifications
-- use NULL and remain repeatable; a non-null key is unique per recipient.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('fd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'dedupe-one@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('fd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'dedupe-two@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'dedupe_key'
  ),
  'notifications exposes the optional dedupe key'
);

SELECT extensions.is(
  (
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'dedupe_key'
  ),
  'YES',
  'dedupe keys are nullable so ordinary notifications remain repeatable'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'notifications_user_dedupe_key_unique'
      AND i.indisunique
      AND i.indpred IS NOT NULL
  ),
  'the per-recipient dedupe index is unique and partial'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type)
    VALUES
      ('fd000000-0000-4000-8000-000000000001', 'first', 'b', 'general'),
      ('fd000000-0000-4000-8000-000000000001', 'second', 'b', 'general')$$,
  'missing keys permit repeat notifications of the same type'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.notifications
    WHERE user_id = 'fd000000-0000-4000-8000-000000000001'
      AND dedupe_key IS NULL),
  2::bigint,
  'both non-deduplicated notifications persist'
);

INSERT INTO public.notifications (user_id, title, body, type, dedupe_key)
VALUES (
  'fd000000-0000-4000-8000-000000000001',
  'username nudge', 'b', 'general', 'account:set-custom-username'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type, dedupe_key)
    VALUES (
      'fd000000-0000-4000-8000-000000000001',
      'username nudge replay', 'b', 'general', 'account:set-custom-username'
    )$$,
  '23505',
  NULL,
  'the same recipient and key cannot be inserted twice'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type, dedupe_key)
    VALUES (
      'fd000000-0000-4000-8000-000000000002',
      'username nudge', 'b', 'general', 'account:set-custom-username'
    )$$,
  'the same key remains reusable for a different recipient'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type, dedupe_key)
    VALUES (
      'fd000000-0000-4000-8000-000000000001',
      'blank key', 'b', 'general', ''
    )$$,
  '23514',
  NULL,
  'blank dedupe keys are rejected instead of becoming ambiguous sentinels'
);

SELECT * FROM extensions.finish();

ROLLBACK;
