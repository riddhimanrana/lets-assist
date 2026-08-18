BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

CREATE TEMP TABLE expected_private_trigger_helper_acl (
  function_oid regprocedure PRIMARY KEY
);

INSERT INTO expected_private_trigger_helper_acl (function_oid)
VALUES
  ('private.enqueue_paper_signup_notification()'::regprocedure),
  ('private.protect_paper_signup_notification_identity()'::regprocedure),
  ('private.enforce_plugin_release_immutability()'::regprocedure),
  ('private.enforce_catalog_published_plugin_release()'::regprocedure),
  ('private.enforce_plugin_install_release()'::regprocedure),
  ('private.enforce_plugin_entitlement_release()'::regprocedure),
  ('private.project_hours_publish_key(text,jsonb,text)'::regprocedure);

SELECT is(
  (
    SELECT bool_and(pg_get_userbyid(proc.proowner) = 'postgres')
    FROM expected_private_trigger_helper_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'private trigger and publication helpers are owned by postgres'
);

SELECT is(
  (
    SELECT bool_and(
      EXISTS (
        SELECT 1
        FROM aclexplode(proc.proacl) AS acl
        WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
          AND acl.privilege_type = 'EXECUTE'
      )
    )
    FROM expected_private_trigger_helper_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'every private trigger and publication helper has an explicit postgres execute grant'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', function_oid, 'EXECUTE')) FROM expected_private_trigger_helper_acl),
  true,
  'anon cannot execute private trigger and publication helpers'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')) FROM expected_private_trigger_helper_acl),
  true,
  'authenticated cannot execute private trigger and publication helpers'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('service_role', function_oid, 'EXECUTE')) FROM expected_private_trigger_helper_acl),
  true,
  'service_role cannot execute owner-only trigger and publication helpers'
);

SELECT * FROM finish();

ROLLBACK;
