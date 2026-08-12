BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(34);

SELECT extensions.ok(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.user_google_oauth_connection_bindings'::regclass
  ),
  'Google OAuth bindings enforce RLS even for table owners'
);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), blocked_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.user_google_oauth_connection_bindings',
    privilege_name
  ),
  format('%s cannot %s server-managed Google OAuth bindings', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN blocked_privileges;

SELECT extensions.ok(
  has_table_privilege(
    'service_role',
    'public.user_google_oauth_connection_bindings',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service_role can manage Google OAuth bindings'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.save_google_oauth_connection_for_binding(uuid,text,text,text,timestamptz,text,text,text,text,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated cannot call the bound-connection save RPC'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.save_google_oauth_connection_for_binding(uuid,text,text,text,timestamptz,text,text,text,text,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role can call the bound-connection save RPC'
);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
)
SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'public.backfill_unambiguous_google_oauth_organization_bindings()',
    'EXECUTE'
  ),
  format('%s cannot invoke the migration-only Google OAuth backfill', role_name)
)
FROM client_roles;

SELECT extensions.ok(
  to_regclass('public.idx_user_calendar_unique_active') IS NULL,
  'the legacy single-active index no longer blocks purpose-bound credentials'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ab000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'google-binding-owner@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ab100000-0000-4000-8000-000000000001',
  'Google Binding Test Organization',
  'google-binding-test-organization',
  'school',
  '982901'
);

CREATE TEMP TABLE google_binding_results (
  purpose text PRIMARY KEY,
  connection_id uuid NOT NULL
);

INSERT INTO google_binding_results (purpose, connection_id)
VALUES (
  'personal_calendar',
  public.save_google_oauth_connection_for_binding(
    'ab000000-0000-4000-8000-000000000001',
    'google',
    'personal-access',
    'personal-refresh',
    now() + interval '1 hour',
    'personal-google@local.test',
    'https://www.googleapis.com/auth/calendar',
    'calendar',
    'personal_calendar',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
), (
  'organization_sheets',
  public.save_google_oauth_connection_for_binding(
    'ab000000-0000-4000-8000-000000000001',
    'google',
    'organization-access',
    'organization-refresh',
    now() + interval '1 hour',
    'organization-google@local.test',
    'https://www.googleapis.com/auth/drive.file',
    'sheets',
    'organization_sheets',
    'ab100000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    NULL,
    NULL
  )
);

SELECT extensions.is(
  (SELECT count(*) FROM public.user_calendar_connections WHERE user_id = 'ab000000-0000-4000-8000-000000000001' AND is_active),
  2::bigint,
  'one user can hold active credentials for two different bound purposes'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.user_google_oauth_connection_bindings WHERE user_id = 'ab000000-0000-4000-8000-000000000001'),
  2::bigint,
  'each purpose-specific connection has a server-managed binding'
);

SELECT extensions.isnt(
  (SELECT connection_id FROM google_binding_results WHERE purpose = 'personal_calendar'),
  (SELECT connection_id FROM google_binding_results WHERE purpose = 'organization_sheets'),
  'different purposes never share the same credential row'
);

SELECT extensions.is(
  public.save_google_oauth_connection_for_binding(
    'ab000000-0000-4000-8000-000000000001',
    'google',
    'organization-access-updated',
    'organization-refresh-updated',
    now() + interval '2 hours',
    'organization-google@local.test',
    'https://www.googleapis.com/auth/drive.file',
    'sheets',
    'organization_sheets',
    'ab100000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    NULL,
    NULL
  ),
  (SELECT connection_id FROM google_binding_results WHERE purpose = 'organization_sheets'),
  'reconnecting the exact binding reuses its credential row'
);

SELECT extensions.is(
  (
    SELECT access_token
    FROM public.user_calendar_connections
    WHERE id = (
      SELECT connection_id
      FROM google_binding_results
      WHERE purpose = 'organization_sheets'
    )
  ),
  'organization-access-updated'::text,
  'exact-binding reconnect updates only that credential'
);

INSERT INTO google_binding_results (purpose, connection_id)
VALUES (
  'csf_import',
  public.save_google_oauth_connection_for_binding(
    'ab000000-0000-4000-8000-000000000001',
    'google',
    'csf-access',
    'csf-refresh',
    now() + interval '1 hour',
    'dvhighcsf@gmail.com',
    'https://www.googleapis.com/auth/drive.file',
    'sheets',
    'csf_import',
    'ab100000-0000-4000-8000-000000000001',
    'dvhs-csf',
    'import_members',
    'dvhighcsf@gmail.com',
    now()
  )
);

SELECT extensions.is(
  public.save_google_oauth_connection_for_binding(
    'ab000000-0000-4000-8000-000000000001',
    'google',
    'csf-access-updated',
    'csf-refresh-updated',
    now() + interval '2 hours',
    'dvhighcsf@gmail.com',
    'https://www.googleapis.com/auth/drive.file',
    'sheets',
    'csf_import',
    'ab100000-0000-4000-8000-000000000001',
    'dvhs-csf',
    'import_meetings',
    'dvhighcsf@gmail.com',
    now()
  ),
  (SELECT connection_id FROM google_binding_results WHERE purpose = 'csf_import'),
  'CSF capabilities reuse one purpose and tenant-bound credential'
);

SELECT extensions.is(
  (
    SELECT requested_capability
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = (
      SELECT connection_id
      FROM google_binding_results
      WHERE purpose = 'csf_import'
    )
  ),
  'import_meetings'::text,
  'the last CSF capability is retained as audit metadata, not binding identity'
);

INSERT INTO public.user_calendar_connections (
  id, user_id, provider, access_token, refresh_token, token_expires_at,
  calendar_email, is_active, preferences, connection_type
)
VALUES (
  'ab200000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'google',
  'legacy-access',
  'legacy-refresh',
  now() + interval '1 hour',
  'legacy-google@local.test',
  true,
  '{"google_oauth_binding":{"purpose":"organization_sheets","organization_id":"ab100000-0000-4000-8000-000000000001"}}'::jsonb,
  'sheets'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ab200000-0000-4000-8000-000000000001'
  ),
  'spoofed legacy preferences do not create an authoritative binding'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.user_calendar_connections (
      id, user_id, provider, access_token, refresh_token, token_expires_at,
      calendar_email, is_active, preferences, connection_type
    ) VALUES (
      'ab200000-0000-4000-8000-000000000002',
      'ab000000-0000-4000-8000-000000000001',
      'google',
      'legacy-access-two',
      'legacy-refresh-two',
      now() + interval '1 hour',
      'legacy-google-two@local.test',
      true,
      '{}'::jsonb,
      'calendar'
    )
  $$,
  '23505',
  'Only one unbound active Google connection is allowed per user',
  'legacy rows retain single-active uniqueness without blocking bound rows'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ab000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'google-unambiguous-backfill@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"google-unambiguous-backfill"}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ab100000-0000-4000-8000-000000000002',
  'Google Unambiguous Backfill Organization',
  'google-backfill-unambiguous',
  'school',
  '982902'
);

INSERT INTO public.organization_members (
  organization_id,
  user_id,
  role,
  status
)
VALUES (
  'ab100000-0000-4000-8000-000000000002',
  'ab000000-0000-4000-8000-000000000002',
  'admin',
  'active'
);

INSERT INTO public.organization_sheet_syncs (
  organization_id,
  created_by,
  sheet_id,
  sheet_url
)
VALUES (
  'ab100000-0000-4000-8000-000000000002',
  'ab000000-0000-4000-8000-000000000002',
  'unambiguous-sheet-id',
  'https://docs.google.com/spreadsheets/d/unambiguous-sheet-id'
);

INSERT INTO public.user_calendar_connections (
  id,
  user_id,
  provider,
  access_token,
  refresh_token,
  token_expires_at,
  calendar_email,
  is_active,
  preferences,
  granted_scopes,
  granted_scopes_updated_at,
  connection_type
)
VALUES (
  'ab200000-0000-4000-8000-000000000010',
  'ab000000-0000-4000-8000-000000000002',
  'google',
  'unambiguous-access',
  'unambiguous-refresh',
  now() + interval '1 hour',
  'unambiguous-google@local.test',
  true,
  '{}'::jsonb,
  'https://www.googleapis.com/auth/drive.file',
  now(),
  'sheets'
);

SELECT extensions.is(
  public.backfill_unambiguous_google_oauth_organization_bindings(),
  1,
  'the migration backfill binds one unambiguous active-admin Sheets credential'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ab200000-0000-4000-8000-000000000010'
      AND user_id = 'ab000000-0000-4000-8000-000000000002'
      AND purpose = 'organization_sheets'
      AND organization_id = 'ab100000-0000-4000-8000-000000000002'
  ),
  'the safe backfill records the exact trusted organization and purpose'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ab000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'google-ambiguous-backfill@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"google-ambiguous-backfill"}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ab100000-0000-4000-8000-000000000003',
    'Google Ambiguous Backfill Organization One',
    'google-backfill-ambiguous-one',
    'school',
    '982903'
  ),
  (
    'ab100000-0000-4000-8000-000000000004',
    'Google Ambiguous Backfill Organization Two',
    'google-backfill-ambiguous-two',
    'school',
    '982904'
  );

INSERT INTO public.organization_members (
  organization_id,
  user_id,
  role,
  status
)
VALUES
  (
    'ab100000-0000-4000-8000-000000000003',
    'ab000000-0000-4000-8000-000000000003',
    'admin',
    'active'
  ),
  (
    'ab100000-0000-4000-8000-000000000004',
    'ab000000-0000-4000-8000-000000000003',
    'admin',
    'active'
  );

INSERT INTO public.organization_sheet_syncs (
  organization_id,
  created_by,
  sheet_id,
  sheet_url
)
VALUES
  (
    'ab100000-0000-4000-8000-000000000003',
    'ab000000-0000-4000-8000-000000000003',
    'ambiguous-sheet-id-one',
    'https://docs.google.com/spreadsheets/d/ambiguous-sheet-id-one'
  ),
  (
    'ab100000-0000-4000-8000-000000000004',
    'ab000000-0000-4000-8000-000000000003',
    'ambiguous-sheet-id-two',
    'https://docs.google.com/spreadsheets/d/ambiguous-sheet-id-two'
  );

INSERT INTO public.user_calendar_connections (
  id,
  user_id,
  provider,
  access_token,
  refresh_token,
  token_expires_at,
  calendar_email,
  is_active,
  preferences,
  granted_scopes,
  granted_scopes_updated_at,
  connection_type
)
VALUES (
  'ab200000-0000-4000-8000-000000000011',
  'ab000000-0000-4000-8000-000000000003',
  'google',
  'ambiguous-access',
  'ambiguous-refresh',
  now() + interval '1 hour',
  'ambiguous-google@local.test',
  true,
  '{}'::jsonb,
  'https://www.googleapis.com/auth/drive.file',
  now(),
  'sheets'
);

SELECT extensions.is(
  public.backfill_unambiguous_google_oauth_organization_bindings(),
  0,
  'the migration backfill refuses a credential with multiple trusted targets'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ab200000-0000-4000-8000-000000000011'
  ),
  'an ambiguous legacy credential remains unbound and requires reconnect'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_google_oauth_connection_for_binding(
      'ab000000-0000-4000-8000-000000000001',
      'google',
      'bad-access',
      'bad-refresh',
      now() + interval '1 hour',
      'bad-google@local.test',
      'https://www.googleapis.com/auth/drive.file',
      'sheets',
      'organization_sheets',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
    )
  $$,
  'P0001',
  'Organization Google OAuth connections require exactly one organization binding',
  'the save RPC rejects malformed organization bindings explicitly'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_google_oauth_connection_for_binding(
      'ab000000-0000-4000-8000-000000000001',
      'google',
      'bad-csf-access',
      'bad-csf-refresh',
      now() + interval '1 hour',
      'bad-csf-google@local.test',
      'https://www.googleapis.com/auth/drive.file',
      'sheets',
      'csf_import',
      'ab100000-0000-4000-8000-000000000001',
      'dvhs-csf',
      'export_sensitive_reports',
      'dvhighcsf@gmail.com',
      now()
    )
  $$,
  'P0001',
  'CSF Google OAuth connections require a valid organization, plugin, and capability',
  'the save RPC rejects report-download permissions as Google capability bindings'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.user_google_oauth_connection_bindings (
      connection_id, user_id, provider, purpose
    ) VALUES (
      'ab200000-0000-4000-8000-000000000001',
      'ab000000-0000-4000-8000-000000000001',
      'google',
      'personal_sheets'
    )
  $$,
  '42501',
  NULL,
  'authenticated users cannot forge a purpose binding'
);

RESET ROLE;

DELETE FROM public.organizations
WHERE id = 'ab100000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.user_calendar_connections
    WHERE id IN (
      SELECT connection_id
      FROM google_binding_results
      WHERE purpose IN ('organization_sheets', 'csf_import')
    )
  ),
  0::bigint,
  'deleting an organization destroys every credential row bound to that organization'
);

SELECT extensions.is(
  (
    SELECT refresh_token
    FROM public.user_calendar_connections
    WHERE id = (
      SELECT connection_id
      FROM google_binding_results
      WHERE purpose = 'personal_calendar'
    )
  ),
  'personal-refresh'::text,
  'deleting an organization preserves the user personal Google credential'
);

SELECT * FROM extensions.finish();

ROLLBACK;
