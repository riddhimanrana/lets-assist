BEGIN;

SELECT plan(5);

SELECT ok(
  has_function_privilege('postgres', 'app_private.project_feedback_guard_update()', 'EXECUTE'),
  'postgres retains the reviewed trigger-function execution grant'
);

SELECT ok(
  NOT has_function_privilege('anon', 'app_private.project_feedback_guard_update()', 'EXECUTE'),
  'anonymous clients cannot execute the feedback trigger function'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.project_feedback_guard_update()', 'EXECUTE'),
  'authenticated clients cannot execute the feedback trigger function'
);

SELECT ok(
  NOT has_function_privilege('service_role', 'app_private.project_feedback_guard_update()', 'EXECUTE'),
  'service role cannot invoke the trigger function directly'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
    ) AS acl
    WHERE procedure.oid = 'app_private.project_feedback_guard_update()'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no feedback trigger-function execution grant'
);

SELECT * FROM finish();

ROLLBACK;
