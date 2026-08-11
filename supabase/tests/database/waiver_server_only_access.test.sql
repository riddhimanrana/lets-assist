BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(32);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), waiver_tables(table_name) AS (
  VALUES ('waiver_signatures'), ('waiver_definitions')
), table_privileges(privilege_name) AS (
  VALUES
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
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
CROSS JOIN waiver_tables
CROSS JOIN table_privileges;

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'public.check_email_exists(text)',
    'EXECUTE'
  ),
  format('%s cannot execute public.check_email_exists(text)', role_name)
)
FROM client_roles;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'waiver_signatures'
  ),
  0::bigint,
  'waiver_signatures has no client-facing RLS policies'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'waiver_definitions'
  ),
  0::bigint,
  'waiver_definitions has no client-facing RLS policies'
);

SELECT * FROM extensions.finish();

ROLLBACK;
