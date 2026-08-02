BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(30);

SELECT has_schema('app_private', 'privileged helper schema exists');

SELECT ok(
  coalesce(current_setting('pgrst.db_schemas', true), '') NOT LIKE '%app_private%',
  'app_private is not part of PostgREST db_schemas'
);

SELECT results_eq(
  $$
    SELECT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_public_attendees'
      AND pg_get_function_identity_arguments(p.oid) = 'p_project_id uuid'
  $$,
  ARRAY[false],
  'public attendee RPC is SECURITY INVOKER'
);

SELECT results_eq(
  $$
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'can_insert_project',
        'can_keep_or_set_public_visibility',
        'get_public_attendees',
        'is_project_organizer',
        'is_trusted_member'
      )
      AND p.prosecdef
  $$,
  ARRAY[0::bigint],
  'no client-facing helper remains SECURITY DEFINER'
);

SELECT results_eq(
  $$
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN (
        'can_insert_project',
        'can_keep_or_set_public_visibility',
        'get_public_attendees',
        'handle_new_user',
        'is_project_organizer',
        'is_trusted_member'
      )
      AND p.prosecdef
  $$,
  ARRAY[7::bigint],
  'all seven privileged implementations remain SECURITY DEFINER'
);

SELECT results_eq(
  $$
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN (
        'can_insert_project',
        'can_keep_or_set_public_visibility',
        'get_public_attendees',
        'handle_new_user',
        'is_project_organizer',
        'is_trusted_member'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS config(value)
        WHERE config.value LIKE 'search_path=%'
      )
  $$,
  ARRAY[0::bigint],
  'every privileged implementation keeps an explicit search_path'
);

SELECT function_privs_are(
  'app_private', 'handle_new_user', ARRAY[]::text[], 'service_role',
  ARRAY['EXECUTE'],
  'service role alone may invoke the auth trigger implementation directly'
);

SELECT function_privs_are(
  'app_private', 'handle_new_user', ARRAY[]::text[], 'anon',
  ARRAY[]::text[],
  'anon cannot invoke the auth trigger implementation'
);

SELECT function_privs_are(
  'app_private', 'handle_new_user', ARRAY[]::text[], 'authenticated',
  ARRAY[]::text[],
  'authenticated cannot invoke the auth trigger implementation'
);

SELECT function_privs_are(
  'public', 'get_public_attendees', ARRAY['uuid'], 'anon',
  ARRAY['EXECUTE'],
  'anon keeps only the public attendee invoker boundary'
);

SELECT function_privs_are(
  'public', 'get_public_attendees', ARRAY['uuid'], 'authenticated',
  ARRAY['EXECUTE'],
  'authenticated keeps only the public attendee invoker boundary'
);

SELECT function_privs_are(
  'public', 'is_trusted_member', ARRAY['uuid'], 'anon',
  ARRAY[]::text[],
  'anon cannot probe trusted-member status'
);

SELECT function_privs_are(
  'public', 'is_trusted_member', ARRAY['uuid'], 'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can invoke the self-bound trusted-member wrapper'
);

SELECT function_privs_are(
  'public', 'is_project_organizer', ARRAY['uuid', 'uuid'], 'anon',
  ARRAY[]::text[],
  'anon cannot probe organizer status'
);

SELECT function_privs_are(
  'public', 'is_project_organizer', ARRAY['uuid', 'uuid'], 'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can invoke the self-bound organizer wrapper'
);

SELECT function_privs_are(
  'public', 'can_insert_project', ARRAY['uuid'], 'anon',
  ARRAY[]::text[],
  'anon cannot probe project insertion eligibility'
);

SELECT function_privs_are(
  'public', 'can_insert_project', ARRAY['uuid'], 'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can invoke the self-bound insertion wrapper'
);

SELECT function_privs_are(
  'public', 'can_insert_project', ARRAY['uuid', 'text', 'uuid'], 'anon',
  ARRAY[]::text[],
  'anon cannot probe scoped project insertion eligibility'
);

SELECT function_privs_are(
  'public', 'can_insert_project', ARRAY['uuid', 'text', 'uuid'], 'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can invoke the scoped self-bound insertion wrapper'
);

SELECT function_privs_are(
  'public', 'can_keep_or_set_public_visibility', ARRAY['uuid', 'uuid'], 'anon',
  ARRAY[]::text[],
  'anon cannot probe public-visibility eligibility'
);

SELECT function_privs_are(
  'public', 'can_keep_or_set_public_visibility', ARRAY['uuid', 'uuid'], 'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can invoke the self-bound visibility wrapper'
);

SELECT ok(
  has_schema_privilege('anon', 'app_private', 'USAGE'),
  'anon may resolve only explicitly granted private attendee implementation calls'
);

SELECT ok(
  has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated may resolve policy-bound private helper calls'
);

SELECT ok(
  NOT has_function_privilege('anon', 'app_private.is_trusted_member(uuid)', 'EXECUTE'),
  'anon has no direct trusted-member implementation execution grant'
);

SELECT ok(
  has_function_privilege('authenticated', 'app_private.is_trusted_member(uuid)', 'EXECUTE'),
  'authenticated policies retain the trusted-member implementation grant'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.handle_new_user()', 'EXECUTE'),
  'authenticated has no direct trigger implementation grant'
);

SELECT results_eq(
  $$
    SELECT n.nspname
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE t.tgname = 'on_auth_user_created'
      AND NOT t.tgisinternal
  $$,
  ARRAY['app_private'::name],
  'auth user trigger follows the implementation into app_private'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

SELECT is(
  public.is_trusted_member('00000000-0000-0000-0000-000000000002'::uuid),
  false,
  'trusted-member wrapper refuses a user ID other than auth.uid()'
);

SELECT is(
  public.is_project_organizer(
    '00000000-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ),
  false,
  'organizer wrapper refuses a user ID other than auth.uid()'
);

SELECT is(
  public.can_insert_project('00000000-0000-0000-0000-000000000002'::uuid),
  false,
  'project insertion wrapper refuses a user ID other than auth.uid()'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
