BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(22);

SELECT extensions.has_column(
  'public',
  'user_google_oauth_connection_bindings',
  'identity_email',
  'Google OAuth bindings retain the verified provider identity'
);

SELECT extensions.has_column(
  'public',
  'user_google_oauth_connection_bindings',
  'identity_verified_at',
  'Google OAuth bindings retain when provider identity was verified'
);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.user_google_oauth_connection_bindings',
    'SELECT'
  ),
  format('%s cannot read Google identity evidence', role_name)
)
FROM client_roles;

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'public.save_google_oauth_connection_for_binding(uuid,text,text,text,timestamptz,text,text,text,text,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  format('%s cannot save a verified Google binding', role_name)
)
FROM client_roles;

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.save_google_oauth_connection_for_binding(uuid,text,text,text,timestamptz,text,text,text,text,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role can save a verified Google binding'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.save_google_oauth_connection_for_binding(uuid,text,text,text,timestamptz,text,text,text,text,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot call the rolling-deployment compatibility signature'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.save_google_oauth_connection_for_binding(uuid,text,text,text,timestamptz,text,text,text,text,uuid,text,text)',
    'EXECUTE'
  ),
  'service_role can keep non-CSF callbacks working during a rolling deployment'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ac000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'google-identity-owner@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'Google Identity Test Organization',
  'google-identity-test-organization',
  'school',
  '982951'
);

SELECT extensions.ok(
  public.save_google_oauth_connection_for_binding(
    'ac000000-0000-4000-8000-000000000001',
    'google',
    'compatibility-access',
    'compatibility-refresh',
    now() + interval '1 hour',
    'google-identity-owner@local.test',
    'https://www.googleapis.com/auth/calendar',
    'calendar',
    'personal_calendar',
    NULL,
    NULL,
    NULL
  ) IS NOT NULL,
  'the compatibility signature preserves a non-CSF callback'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_google_oauth_connection_for_binding(
      'ac000000-0000-4000-8000-000000000001',
      'google',
      'legacy-csf-access',
      'legacy-csf-refresh',
      now() + interval '1 hour',
      'dvhighcsf@gmail.com',
      'https://www.googleapis.com/auth/drive.file',
      'sheets',
      'csf_import',
      'ac100000-0000-4000-8000-000000000001',
      'dvhs-csf',
      'import_members'
    )
  $$,
  'P0001',
  'CSF Google OAuth connections require the verified chapter identity',
  'the compatibility signature cannot mint an unverified CSF binding'
);

-- A legacy bound row may remain at rest, but it carries no verified evidence
-- and therefore cannot be refreshed through the new save surface.
INSERT INTO public.user_calendar_connections (
  id, user_id, provider, access_token, refresh_token, token_expires_at,
  calendar_email, is_active, preferences, granted_scopes, connection_type
)
VALUES (
  'ac200000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'google',
  'legacy-access',
  'legacy-refresh',
  now() + interval '1 hour',
  'dvhighcsf@gmail.com',
  true,
  '{}'::jsonb,
  'https://www.googleapis.com/auth/drive.file',
  'sheets'
);

INSERT INTO public.user_google_oauth_connection_bindings (
  connection_id, user_id, provider, purpose, organization_id, plugin_key,
  requested_capability
)
VALUES (
  'ac200000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'google',
  'csf_import',
  'ac100000-0000-4000-8000-000000000001',
  'dvhs-csf',
  'import_members'
);

SELECT extensions.ok(
  (
    SELECT identity_email IS NULL AND identity_verified_at IS NULL
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ac200000-0000-4000-8000-000000000001'
  ),
  'legacy CSF bindings are not backfilled from calendar_email'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_google_oauth_connection_for_binding(
      'ac000000-0000-4000-8000-000000000001',
      'google',
      'legacy-access-updated',
      'legacy-refresh-updated',
      now() + interval '2 hours',
      'dvhighcsf@gmail.com',
      'https://www.googleapis.com/auth/drive.file',
      'sheets',
      'csf_import',
      'ac100000-0000-4000-8000-000000000001',
      'dvhs-csf',
      'import_members',
      NULL,
      NULL
    )
  $$,
  'P0001',
  'CSF Google OAuth connections require the verified chapter identity',
  'a legacy null identity cannot be reused as a CSF callback'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_google_oauth_connection_for_binding(
      'ac000000-0000-4000-8000-000000000001',
      'google',
      'wrong-access',
      'wrong-refresh',
      now() + interval '2 hours',
      'officer@gmail.com',
      'https://www.googleapis.com/auth/drive.file',
      'sheets',
      'csf_import',
      'ac100000-0000-4000-8000-000000000001',
      'dvhs-csf',
      'import_members',
      'officer@gmail.com',
      now()
    )
  $$,
  'P0001',
  'CSF Google OAuth connections require the verified chapter identity',
  'a verified but wrong Google identity is rejected'
);

SELECT extensions.is(
  (
    SELECT access_token
    FROM public.user_calendar_connections
    WHERE id = 'ac200000-0000-4000-8000-000000000001'
  ),
  'legacy-access'::text,
  'a rejected wrong identity does not update the credential'
);

SELECT extensions.is(
  (
    SELECT identity_email
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ac200000-0000-4000-8000-000000000001'
  ),
  NULL::text,
  'a rejected wrong identity does not persist binding evidence'
);

CREATE TEMP TABLE google_identity_results (
  purpose text PRIMARY KEY,
  connection_id uuid NOT NULL
);

INSERT INTO google_identity_results (purpose, connection_id)
VALUES (
  'csf_import',
  public.save_google_oauth_connection_for_binding(
    'ac000000-0000-4000-8000-000000000001',
    'google',
    'chapter-access',
    'chapter-refresh',
    now() + interval '2 hours',
    'DVHighCSF@Gmail.com',
    'https://www.googleapis.com/auth/drive.file',
    'sheets',
    'csf_import',
    'ac100000-0000-4000-8000-000000000001',
    'dvhs-csf',
    'import_members',
    'dvhighcsf@gmail.com',
    now()
  )
);

SELECT extensions.is(
  (SELECT connection_id FROM google_identity_results WHERE purpose = 'csf_import'),
  'ac200000-0000-4000-8000-000000000001'::uuid,
  'an exact verified reconnect reuses the exact CSF binding'
);

SELECT extensions.is(
  (
    SELECT identity_email
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ac200000-0000-4000-8000-000000000001'
  ),
  'dvhighcsf@gmail.com'::text,
  'the exact verified chapter identity is stored canonically'
);

SELECT extensions.ok(
  (
    SELECT identity_verified_at IS NOT NULL
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = 'ac200000-0000-4000-8000-000000000001'
  ),
  'the exact verified chapter identity carries verification time'
);

INSERT INTO google_identity_results (purpose, connection_id)
VALUES (
  'personal_calendar',
  public.save_google_oauth_connection_for_binding(
    'ac000000-0000-4000-8000-000000000001',
    'google',
    'personal-access',
    'personal-refresh',
    now() + interval '2 hours',
    'person@gmail.com',
    'https://www.googleapis.com/auth/calendar',
    'calendar',
    'personal_calendar',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
);

SELECT extensions.ok(
  (SELECT connection_id IS NOT NULL FROM google_identity_results WHERE purpose = 'personal_calendar'),
  'an unrelated personal Google purpose is unchanged'
);

SELECT extensions.ok(
  (
    SELECT identity_email IS NULL AND identity_verified_at IS NULL
    FROM public.user_google_oauth_connection_bindings
    WHERE connection_id = (
      SELECT connection_id
      FROM google_identity_results
      WHERE purpose = 'personal_calendar'
    )
  ),
  'an unrelated personal Google purpose stores no CSF identity evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_google_oauth_connection_for_binding(
      'ac000000-0000-4000-8000-000000000001',
      'google',
      'bad-personal-access',
      'bad-personal-refresh',
      now() + interval '2 hours',
      'person@gmail.com',
      'https://www.googleapis.com/auth/calendar',
      'calendar',
      'personal_calendar',
      NULL,
      NULL,
      NULL,
      'dvhighcsf@gmail.com',
      now()
    )
  $$,
  'P0001',
  'Verified CSF identity evidence cannot be attached to another Google purpose',
  'CSF identity evidence cannot be attached to another Google purpose'
);

SELECT * FROM extensions.finish();

ROLLBACK;
