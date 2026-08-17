BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(11);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'plugin_data.csf_class_join_codes', 'SELECT'),
  'anonymous clients cannot read permanent class codes'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_class_join_codes', 'SELECT'),
  'authenticated clients cannot read permanent class codes'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_rotate_class_join_code(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot rotate class codes directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_revoke_class_join_code(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot revoke class codes directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_rotate_class_join_code(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can rotate class codes'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_revoke_class_join_code(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the server role can revoke class codes'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'cf100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'class-code-admin@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf200000-0000-4000-8000-000000000001', 'Class Code Test',
  'class-code-test', 'school', '984001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001', 2032, 'Class of 2032'
);

SELECT extensions.matches(
  plugin_data.csf_rotate_class_join_code(
    'cf200000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001'
  ) ->> 'code',
  '^[A-F0-9]{8}$',
  'creating a class code returns the controlled eight-character format'
);

SELECT plugin_data.csf_rotate_class_join_code(
  'cf200000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_join_codes
    WHERE organization_id = 'cf200000-0000-4000-8000-000000000001'
      AND cohort_id = 'cf300000-0000-4000-8000-000000000001'
      AND status = 'active'
  ),
  1,
  'rotation leaves exactly one active code for the class'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_join_codes
    WHERE organization_id = 'cf200000-0000-4000-8000-000000000001'
      AND cohort_id = 'cf300000-0000-4000-8000-000000000001'
      AND status = 'rotated'
  ),
  1,
  'rotation immediately marks the previous code inactive'
);

SELECT plugin_data.csf_revoke_class_join_code(
  'cf200000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'Test disable'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_join_codes
    WHERE organization_id = 'cf200000-0000-4000-8000-000000000001'
      AND cohort_id = 'cf300000-0000-4000-8000-000000000001'
      AND status = 'active'
  ),
  0,
  'disabling a class code invalidates it immediately'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_class_join_codes
    WHERE organization_id = 'cf200000-0000-4000-8000-000000000001'
      AND status = 'revoked'
  ),
  1,
  'disabled class codes retain an auditable revoked record'
);

SELECT * FROM extensions.finish();
ROLLBACK;
