BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(92);

-- Organization bearer capabilities must never be readable through the Data API.
WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), secret_columns(column_name) AS (
  VALUES
    ('join_code'),
    ('created_by'),
    ('staff_join_token'),
    ('staff_join_token_created_at'),
    ('staff_join_token_expires_at'),
    ('staff_join_token_issued_by'),
    ('auto_join_domain')
)
SELECT extensions.ok(
  NOT has_column_privilege(
    role_name,
    'public.organizations',
    column_name,
    'SELECT'
  ),
  format('%s cannot read organizations.%s', role_name, column_name)
)
FROM client_roles
CROSS JOIN secret_columns;

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  has_column_privilege(
    role_name,
    'public.organizations',
    'id',
    'SELECT'
  ),
  format('%s retains access to public-safe organization columns', role_name)
)
FROM client_roles;

-- Membership creation/removal is mediated by transactional service RPCs.
WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), blocked_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.organization_members',
    privilege_name
  ),
  format('%s cannot %s organization members directly', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN blocked_privileges;

-- Every plugin access-decision table is read-only to app clients. Mutations
-- must pass through the leased server-side lifecycle control plane.
WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), control_plane_tables(table_name) AS (
  VALUES
    ('organization_plugin_installs'),
    ('organization_plugin_entitlements'),
    ('organization_plugin_feature_flags')
), blocked_privileges(privilege_name) AS (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    format('public.%I', table_name),
    privilege_name
  ),
  format('%s cannot %s public.%s', role_name, privilege_name, table_name)
)
FROM client_roles
CROSS JOIN control_plane_tables
CROSS JOIN blocked_privileges;

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.join_organization_with_code(uuid,text)',
    'EXECUTE'
  ),
  'anon cannot call the join-code RPC'
);

SELECT extensions.ok(
  CASE
    WHEN to_regprocedure('private.protect_staff_join_token_issuer()') IS NULL
      THEN false
    ELSE
      has_function_privilege(
        'postgres',
        'private.protect_staff_join_token_issuer()',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        'private.protect_staff_join_token_issuer()',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'private.protect_staff_join_token_issuer()',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'anon',
        'private.protect_staff_join_token_issuer()',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'public',
        'private.protect_staff_join_token_issuer()',
        'EXECUTE'
      )
  END,
  'the issuer trigger function exists with postgres-only execution'
);

SELECT extensions.ok(
  NOT has_column_privilege(
    'authenticated',
    'public.organizations',
    'staff_join_token_issued_by',
    'SELECT'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.organizations',
    'staff_join_token_issued_by',
    'INSERT'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.organizations',
    'staff_join_token_issued_by',
    'UPDATE'
  ),
  'authenticated receives no direct issuer-column browser grant'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.join_organization_with_code(uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot call the service-only join-code RPC directly'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.join_organization_with_code(uuid,text)',
    'EXECUTE'
  ),
  'service_role can execute the join-code transition'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'organizations'
      AND indexname = 'organizations_join_code_unique_idx'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ),
  'organization join codes have a unique index'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_join_code_format_check'
      AND contype = 'c'
      AND convalidated
  ),
  'organization join codes have a validated six-digit format constraint'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'fd000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'org-boundary-admin@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  ),
  (
    'fd000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'org-boundary-member@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  ),
  (
    'fd000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'org-boundary-member-two@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  );

INSERT INTO public.organizations (
  id, name, username, type, join_code, created_by
)
VALUES
  (
    'fd100000-0000-4000-8000-000000000001',
    'Organization Boundary One',
    'organization-boundary-one',
    'school',
    '701001',
    'fd000000-0000-4000-8000-000000000001'
  ),
  (
    'fd100000-0000-4000-8000-000000000002',
    'Organization Boundary Two',
    'organization-boundary-two',
    'nonprofit',
    '701002',
    'fd000000-0000-4000-8000-000000000002'
  );

INSERT INTO public.organization_members (
  id, organization_id, user_id, role
)
VALUES
  (
    'fd200000-0000-4000-8000-000000000001',
    'fd100000-0000-4000-8000-000000000001',
    'fd000000-0000-4000-8000-000000000001',
    'admin'
  ),
  (
    'fd200000-0000-4000-8000-000000000002',
    'fd100000-0000-4000-8000-000000000001',
    'fd000000-0000-4000-8000-000000000003',
    'member'
  );

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description,
  event_type, verification_method, schedule, require_login
)
VALUES (
  'fd300000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001',
  'Organization Boundary Project',
  'Local',
  'Project ownership boundary fixture',
  'single',
  'manual',
  '{}'::jsonb,
  true
);

INSERT INTO public.plugins (key, name, visibility, is_active, latest_version)
VALUES ('org-boundary-test', 'Organization Boundary Test', 'private', false, '1.0.0');

INSERT INTO public.plugin_versions (
  plugin_key, version, status, commit_sha, manifest_hash,
  compatibility_contract, published_at, source_tree, content_digest,
  release_inputs, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
)
VALUES (
  'org-boundary-test',
  '1.0.0',
  'published',
  '1111111111111111111111111111111111111111',
  '1111111111111111111111111111111111111111111111111111111111111111',
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
  now(), repeat('2', 40), repeat('2', 64),
  '["plugins/org-boundary-test"]'::jsonb,
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  1, '20260820100000',
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  'embedded'
);

UPDATE public.plugins
SET is_active = true
WHERE key = 'org-boundary-test';

INSERT INTO public.organization_plugin_entitlements (
  id, organization_id, plugin_key, status, created_by
)
VALUES (
  'fd400000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001',
  'org-boundary-test',
  'active',
  'fd000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_plugin_installs (
  id, organization_id, plugin_key, installed_by
)
VALUES (
  'fd500000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001',
  'org-boundary-test',
  'fd000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_plugin_feature_flags (
  id, organization_id, plugin_key, flag_key, enabled, updated_by
)
VALUES (
  'fd600000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001',
  'org-boundary-test',
  'boundary-flag',
  false,
  'fd000000-0000-4000-8000-000000000001'
);

-- Model the historical hosted table-level write grant explicitly. These grants
-- are transaction-local test setup and roll back; the trigger must remain the
-- defense even when relation ACL drift exposes a newly added capability column.
GRANT INSERT (staff_join_token_issued_by),
      UPDATE (staff_join_token_issued_by)
  ON public.organizations
  TO authenticated;

SET LOCAL request.jwt.claims =
  '{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (
      'fd100000-0000-4000-8000-000000000001',
      'fd000000-0000-4000-8000-000000000002',
      'member'
    )
  $$,
  '42501',
  'permission denied for table organization_members',
  'an authenticated admin cannot bypass the join transition with a direct insert'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.organization_members
    WHERE id = 'fd200000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_members',
  'an authenticated admin cannot bypass the removal transition with a direct delete'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_members
    SET organization_id = 'fd100000-0000-4000-8000-000000000002'
    WHERE id = 'fd200000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'organization membership identity is immutable',
  'authenticated admins cannot move a membership to another organization'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_members
    SET user_id = 'fd000000-0000-4000-8000-000000000002'
    WHERE id = 'fd200000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'organization membership identity is immutable',
  'authenticated admins cannot reassign a membership to another user'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_members
    SET role = 'member'
    WHERE id = 'fd200000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'cannot demote the final organization admin',
  'the database prevents demoting the final organization admin'
);

SELECT extensions.lives_ok(
  $$
    UPDATE public.organization_members
    SET role = 'staff'
    WHERE id = 'fd200000-0000-4000-8000-000000000002'
  $$,
  'authenticated admins retain ordinary member role management'
);

SELECT extensions.is(
  (
    SELECT role::text
    FROM public.organization_members
    WHERE id = 'fd200000-0000-4000-8000-000000000002'
  ),
  'staff'::text,
  'an authorized member role update is persisted'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_plugin_installs (
      organization_id, plugin_key, installed_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000001',
      'org-boundary-test',
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'permission denied for table organization_plugin_installs',
  'authenticated cannot insert plugin installs directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_plugin_installs
    SET enabled = false
    WHERE id = 'fd500000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_plugin_installs',
  'authenticated cannot update plugin installs directly'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.organization_plugin_installs
    WHERE id = 'fd500000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_plugin_installs',
  'authenticated cannot delete plugin installs directly'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_plugin_entitlements (
      organization_id, plugin_key, status, created_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000001',
      'org-boundary-test',
      'active',
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'permission denied for table organization_plugin_entitlements',
  'authenticated cannot insert plugin entitlements directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_plugin_entitlements
    SET status = 'inactive'
    WHERE id = 'fd400000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_plugin_entitlements',
  'authenticated cannot update plugin entitlements directly'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.organization_plugin_entitlements
    WHERE id = 'fd400000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_plugin_entitlements',
  'authenticated cannot delete plugin entitlements directly'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_plugin_feature_flags (
      organization_id, plugin_key, flag_key, enabled, updated_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000001',
      'org-boundary-test',
      'second-boundary-flag',
      true,
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'permission denied for table organization_plugin_feature_flags',
  'authenticated cannot insert plugin feature flags directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organization_plugin_feature_flags
    SET enabled = true
    WHERE id = 'fd600000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_plugin_feature_flags',
  'authenticated cannot update plugin feature flags directly'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.organization_plugin_feature_flags
    WHERE id = 'fd600000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table organization_plugin_feature_flags',
  'authenticated cannot delete plugin feature flags directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET verified = true
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot self-verify organizations'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET auto_join_domain = 'boundary.local'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot claim automatic-membership domains directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET created_by = 'fd000000-0000-4000-8000-000000000002'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot rewrite organization attribution'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET join_code = '701003'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot rotate join capabilities directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET staff_join_token = 'fd700000-0000-4000-8000-000000000001'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot mint staff capabilities directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET staff_join_token_created_at = now()
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot rewrite staff capability creation time'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET staff_join_token_expires_at = now() + interval '1 day'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'organization capability fields require a server-authorized operation',
  'authenticated admins cannot rewrite staff capability expiry'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET staff_join_token_issued_by = 'fd000000-0000-4000-8000-000000000002'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'staff invite token issuer requires a server-authorized operation',
  'authenticated admins cannot rebind staff-token issuer authority'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by,
      staff_join_token_issued_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000007',
      'Issuer Injection Boundary Organization',
      'issuer-injection-boundary-org',
      'school',
      '701007',
      'fd000000-0000-4000-8000-000000000001',
      'fd000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'staff invite token issuer requires a server-authorized operation',
  'authenticated creators cannot bind an issuer during organization insert'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, verified, created_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000005',
      'Self-Verified Boundary Organization',
      'self-verified-boundary-org',
      'school',
      '701005',
      true,
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'organization trust fields require a server-authorized operation',
  'authenticated creators cannot insert a pre-verified organization'
);

SELECT extensions.lives_ok(
  $$
    UPDATE public.organizations
    SET description = 'Safe description update'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  'authenticated admins retain ordinary organization editing'
);

SELECT extensions.is(
  (
    SELECT description
    FROM public.organizations
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  ),
  'Safe description update'::text,
  'the safe organization update is persisted'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET organization_id = 'fd100000-0000-4000-8000-000000000002'
    WHERE id = 'fd300000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'project ownership and organization association are immutable',
  'project creators cannot move a project to another organization directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET creator_id = 'fd000000-0000-4000-8000-000000000002'
    WHERE id = 'fd300000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'project ownership and organization association are immutable',
  'project creators cannot transfer project ownership directly'
);

SELECT extensions.lives_ok(
  $$
    UPDATE public.projects
    SET title = 'Safe Project Update'
    WHERE id = 'fd300000-0000-4000-8000-000000000001'
  $$,
  'project creators retain ordinary project editing'
);

SELECT extensions.is(
  (
    SELECT creator_id
    FROM public.projects
    WHERE id = 'fd300000-0000-4000-8000-000000000001'
  ),
  'fd000000-0000-4000-8000-000000000001'::uuid,
  'rejected updates preserve project creator attribution'
);

SELECT extensions.is(
  (
    SELECT organization_id
    FROM public.projects
    WHERE id = 'fd300000-0000-4000-8000-000000000001'
  ),
  'fd100000-0000-4000-8000-000000000001'::uuid,
  'rejected updates preserve the project organization association'
);

SELECT extensions.is(
  (
    SELECT title
    FROM public.projects
    WHERE id = 'fd300000-0000-4000-8000-000000000001'
  ),
  'Safe Project Update'::text,
  'the safe project update is persisted'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT extensions.lives_ok(
  $$
    UPDATE public.organizations
    SET staff_join_token = 'fd700000-0000-4000-8000-000000000001',
        staff_join_token_created_at = now(),
        staff_join_token_expires_at = now() + interval '30 days',
        staff_join_token_issued_by = 'fd000000-0000-4000-8000-000000000001'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  'service-role staff-token generation can bind the active issuer'
);

SELECT extensions.is(
  (
    SELECT staff_join_token_issued_by
    FROM public.organizations
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  ),
  'fd000000-0000-4000-8000-000000000001'::uuid,
  'service-role issuer binding is persisted'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
  AND user_id = 'fd000000-0000-4000-8000-000000000001';

RESET ROLE;
SET LOCAL request.jwt.claims =
  '{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET staff_join_token_issued_by = 'fd000000-0000-4000-8000-000000000002'
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'staff invite token issuer requires a server-authorized operation',
  'an inactive admin retaining organization update access cannot rebind the issuer'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT extensions.is(
  (
    SELECT staff_join_token_issued_by
    FROM public.organizations
    WHERE id = 'fd100000-0000-4000-8000-000000000001'
  ),
  'fd000000-0000-4000-8000-000000000001'::uuid,
  'rejected inactive-admin rebinding preserves the service-issued authority'
);

SELECT extensions.results_eq(
  $$
    SELECT organization_id, organization_username, join_status
    FROM public.join_organization_with_code(
      'fd000000-0000-4000-8000-000000000002',
      '701001'
    )
  $$,
  $$
    VALUES (
      'fd100000-0000-4000-8000-000000000001'::uuid,
      'organization-boundary-one'::text,
      'joined'::text
    )
  $$,
  'the service join transition resolves exactly one organization'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
      AND user_id = 'fd000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'the service join transition creates one membership'
);

SELECT extensions.is(
  (
    SELECT join_status
    FROM public.join_organization_with_code(
      'fd000000-0000-4000-8000-000000000002',
      '701001'
    )
  ),
  'already_member'::text,
  'replaying the service join transition is idempotent'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
      AND user_id = 'fd000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'replaying the service join transition does not duplicate membership'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.join_organization_with_code(
      'fd000000-0000-4000-8000-000000000002',
      'invalid'
    )
  ),
  0::bigint,
  'invalid join-code formats return no organization'
);

RESET ROLE;

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000003',
      'Duplicate Join Code Organization',
      'duplicate-join-code-organization',
      'school',
      '701001',
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "organizations_join_code_unique_idx"',
  'duplicate organization join codes are rejected'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organizations
    WHERE join_code = '701001'
  ),
  1::bigint,
  'a rejected duplicate leaves one unambiguous join-code target'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000004',
      'Invalid Join Code Organization',
      'invalid-join-code-organization',
      'school',
      'ABC123',
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_join_code_format_check"',
  'organization join codes must be six digits'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fd100000-0000-4000-8000-000000000006',
      'Government Boundary Organization',
      'government-boundary-organization',
      'government',
      '701006',
      'fd000000-0000-4000-8000-000000000001'
    )
  $$,
  'government remains a valid organization type'
);

SELECT * FROM extensions.finish();

ROLLBACK;
