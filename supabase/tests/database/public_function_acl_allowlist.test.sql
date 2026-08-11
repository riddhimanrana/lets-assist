-- AUD-003: the effective anon/authenticated EXECUTE catalog must contain only
-- reviewed public RPC and RLS-helper signatures. Effective privilege checks
-- include grants inherited through PUBLIC, so an accidental default grant also
-- fails this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(2);

SELECT extensions.results_eq(
  $$
    SELECT
      format(
        'public.%I(%s)',
        proc.proname,
        replace(pg_catalog.oidvectortypes(proc.proargtypes), ', ', ',')
      )::text COLLATE "C",
      client.role_name::text COLLATE "C"
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS client(role_name)
    WHERE namespace.nspname = 'public'
      AND has_function_privilege(client.role_name, proc.oid, 'EXECUTE')
    ORDER BY 1, 2
  $$,
  $$
    SELECT signature::text COLLATE "C", role_name::text COLLATE "C"
    FROM (
      VALUES
        ('public.can_insert_project(uuid)', 'authenticated'),
        ('public.can_insert_project(uuid,text,uuid)', 'authenticated'),
        ('public.can_keep_or_set_public_visibility(uuid,uuid)', 'authenticated'),
        ('public.get_public_attendees(uuid)', 'anon'),
        ('public.get_public_attendees(uuid)', 'authenticated'),
        ('public.is_project_organizer(uuid,uuid)', 'authenticated'),
        ('public.is_super_admin()', 'authenticated'),
        ('public.is_trusted_member(uuid)', 'authenticated'),
        ('public.publish_volunteer_hours_transactional(uuid,text,jsonb,text)', 'authenticated')
    ) AS expected(signature, role_name)
    ORDER BY 1, 2
  $$,
  'only the reviewed public function signatures are executable by client roles'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS client(role_name)
    WHERE namespace.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'checkin_signups',
        'checkout_signups',
        'clear_trusted_member_on_delete',
        'delete_old_anonymous_signups',
        'delete_unconfirmed_users',
        'gen_unique_username',
        'get_auth_avatar_url',
        'prevent_trusted_member_edit',
        'process_projects',
        'profiles_block_update',
        'profiles_set_defaults',
        'profiles_set_username',
        'set_system_banners_updated_at',
        'sync_profiles_trusted_from_tm',
        'sync_tm_from_profiles_trusted',
        'sync_trusted_member_to_profile',
        'update_updated_at_column',
        'update_user_profile_picture'
      ])
      AND has_function_privilege(client.role_name, proc.oid, 'EXECUTE')
  ),
  'trigger and maintenance functions are not directly client-executable'
);

SELECT * FROM extensions.finish();

ROLLBACK;
