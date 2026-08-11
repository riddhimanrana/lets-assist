-- Contract for the per-user plugin display preference.
--
-- Two things must hold for the platform switch to be trustworthy: content is
-- visible by default (a person who never opened the setting keeps seeing what
-- they always saw), and one person's preference is invisible and unwritable to
-- everybody else.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

SELECT extensions.ok(
  to_regclass('public.user_plugin_display_preferences') IS NOT NULL,
  'the plugin display preference table exists'
);

SELECT extensions.ok(
  (
    SELECT class.relrowsecurity
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'user_plugin_display_preferences'
  ),
  'the preference table enforces row level security'
);

-- ---------------------------------------------------------------------------
-- Default-on: the column default, not application code, is what makes plugin
-- content opt-out.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_plugin_display_preferences'
      AND column_name = 'show_plugin_content'
  ),
  'true',
  'plugin content defaults to shown'
);

SELECT extensions.is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_plugin_display_preferences'
      AND column_name = 'hidden_plugin_keys'
  ),
  '''{}''::text[]',
  'no plugin is hidden until the user hides one'
);

-- ---------------------------------------------------------------------------
-- Privilege boundary
-- ---------------------------------------------------------------------------

WITH table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'public.user_plugin_display_preferences',
    privilege_name
  ),
  format('anon cannot %s plugin display preferences', privilege_name)
)
FROM table_privileges;

SELECT extensions.ok(
  has_table_privilege(
    'authenticated',
    'public.user_plugin_display_preferences',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'signed-in users manage their own preference row directly'
);

-- ---------------------------------------------------------------------------
-- Ownership boundary
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'ee000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'prefs.owner@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'ee000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'prefs.other@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.user_plugin_display_preferences (user_id)
VALUES ('ee000000-0000-4000-8000-000000000001');

SELECT extensions.ok(
  (
    SELECT show_plugin_content
    FROM public.user_plugin_display_preferences
    WHERE user_id = 'ee000000-0000-4000-8000-000000000001'
  ),
  'a freshly created row shows plugin content'
);

SELECT extensions.is(
  (
    SELECT cardinality(hidden_plugin_keys)
    FROM public.user_plugin_display_preferences
    WHERE user_id = 'ee000000-0000-4000-8000-000000000001'
  ),
  0,
  'a freshly created row hides no individual plugin'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.user_plugin_display_preferences (user_id, hidden_plugin_keys)
    VALUES ('ee000000-0000-4000-8000-000000000002', ARRAY['']::text[])
  $$,
  '23514',
  NULL,
  'a blank plugin key is rejected'
);

SET LOCAL request.jwt.claims =
  '{"sub":"ee000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.user_plugin_display_preferences
    WHERE user_id = 'ee000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'another signed-in user cannot read someone else''s preference row'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.user_plugin_display_preferences (user_id, show_plugin_content)
    VALUES ('ee000000-0000-4000-8000-000000000001', false)
  $$,
  '42501',
  NULL,
  'another signed-in user cannot create a preference row for someone else'
);

-- The UPDATE is filtered rather than raised: RLS hides the row, so the
-- statement matches nothing. Assert the stored value afterwards.
UPDATE public.user_plugin_display_preferences
SET show_plugin_content = false
WHERE user_id = 'ee000000-0000-4000-8000-000000000001';

DELETE FROM public.user_plugin_display_preferences
WHERE user_id = 'ee000000-0000-4000-8000-000000000001';

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT show_plugin_content
    FROM public.user_plugin_display_preferences
    WHERE user_id = 'ee000000-0000-4000-8000-000000000001'
  ),
  'another user''s update and delete leave the owner''s preference untouched'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.user_plugin_display_preferences
    WHERE user_id = 'ee000000-0000-4000-8000-000000000001'
  ),
  'the owner''s preference row survives another user''s delete attempt'
);

SELECT * FROM extensions.finish();

ROLLBACK;
