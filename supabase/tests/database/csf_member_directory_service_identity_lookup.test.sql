BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(11);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'auth.users', 'SELECT'),
  'service_role does not receive direct Auth directory access'
);
SELECT extensions.is(
  pg_get_userbyid(proowner),
  'postgres',
  'the narrow identity helper has the reviewed owner'
)
FROM pg_proc
WHERE oid = 'app_private.csf_verified_profile_login_identity(uuid,uuid)'::regprocedure;
SELECT extensions.ok(
  prosecdef,
  'the narrow identity helper runs with its reviewed owner privileges'
)
FROM pg_proc
WHERE oid = 'app_private.csf_verified_profile_login_identity(uuid,uuid)'::regprocedure;
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'app_private.csf_verified_profile_login_identity(uuid,uuid)',
    'EXECUTE'
  ),
  'service_role can use the narrow identity helper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'app_private.csf_verified_profile_login_identity(uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the identity helper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.csf_verified_profile_login_identity(uuid,uuid)',
    'EXECUTE'
  ),
  'browser clients cannot call the identity helper'
);
SELECT extensions.ok(
  NOT prosecdef,
  'the public directory RPC remains a security invoker'
)
FROM pg_proc
WHERE oid = 'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)'::regprocedure;

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES (
  'df100000-0000-4000-8000-000000000001',
  'verified-directory-login@local.test',
  now()
);

UPDATE public.profiles
SET full_name = 'Verified Directory Login', username = 'verified-directory'
WHERE id = 'df100000-0000-4000-8000-000000000001';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('df200000-0000-4000-8000-000000000001', 'Directory Service A', 'directory-service-a', 'school', '983101'),
  ('df200000-0000-4000-8000-000000000002', 'Directory Service B', 'directory-service-b', 'school', '983102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'df200000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'df300000-0000-4000-8000-000000000001',
  'df200000-0000-4000-8000-000000000001',
  'Fictional',
  'Member',
  'fictional',
  'member'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'df200000-0000-4000-8000-000000000001',
  'df300000-0000-4000-8000-000000000001',
  'df100000-0000-4000-8000-000000000001',
  'verified',
  true
);

SET LOCAL ROLE service_role;

SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'df200000-0000-4000-8000-000000000001',
    p_search => 'verified-directory-login@local.test'
  )),
  1::bigint,
  'service_role can search confirmed identity after the staff server gate'
);
SELECT extensions.is(
  (SELECT count(profile_id) FROM plugin_data.csf_list_profiles_page(
    'df200000-0000-4000-8000-000000000002',
    p_search => 'verified-directory-login@local.test'
  )),
  0::bigint,
  'service_role search cannot cross the requested organization'
);
SELECT extensions.is(
  (SELECT login_email FROM app_private.csf_verified_profile_login_identity(
    'df200000-0000-4000-8000-000000000001',
    'df300000-0000-4000-8000-000000000001'
  )),
  'verified-directory-login@local.test',
  'the helper returns the confirmed identity for the exact verified link'
);
SELECT extensions.is(
  (SELECT count(*) FROM app_private.csf_verified_profile_login_identity(
    'df200000-0000-4000-8000-000000000002',
    'df300000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'the helper returns no identity for an unauthorized tenant coordinate'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
