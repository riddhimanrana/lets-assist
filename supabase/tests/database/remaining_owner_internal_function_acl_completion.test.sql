BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

CREATE TEMP TABLE expected_owner_internal_function_acl (
  function_oid regprocedure PRIMARY KEY
);

INSERT INTO expected_owner_internal_function_acl (function_oid)
VALUES
  ('plugin_data.csf_decide_term_application_policy_base(uuid,uuid,text,text,uuid)'::regprocedure),
  ('plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid)'::regprocedure),
  ('plugin_data.csf_queue_application_sheet_writeback(uuid,uuid,text,text)'::regprocedure),
  ('plugin_data.csf_assert_meeting_permission_under_lock(uuid,uuid,text)'::regprocedure),
  ('plugin_data.csf_validate_application_check()'::regprocedure),
  ('plugin_data.csf_assert_meeting_source_permissions_under_lock(uuid,uuid,uuid,text,uuid)'::regprocedure),
  ('plugin_data.csf_sanitize_profile_merge_audit()'::regprocedure),
  ('plugin_data.csf_merge_profiles_identity_base(uuid,uuid,uuid,text,uuid)'::regprocedure),
  ('plugin_data.csf_commit_import_row_for_attempt_identity_base(uuid,uuid,uuid)'::regprocedure),
  ('plugin_data.csf_import_compatibility_permissions(text)'::regprocedure),
  ('private.end_recurring_project_series_transactional()'::regprocedure);

SELECT is(
  (
    SELECT bool_and(pg_get_userbyid(proc.proowner) = 'postgres')
    FROM expected_owner_internal_function_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'remaining owner-internal helpers are owned by postgres'
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
    FROM expected_owner_internal_function_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'every remaining owner-internal helper has an explicit postgres execute grant'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', function_oid, 'EXECUTE')) FROM expected_owner_internal_function_acl),
  true,
  'anon cannot execute remaining owner-internal helpers'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')) FROM expected_owner_internal_function_acl),
  true,
  'authenticated cannot execute remaining owner-internal helpers'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('service_role', function_oid, 'EXECUTE')) FROM expected_owner_internal_function_acl),
  true,
  'service_role must use request-aware entrypoints'
);

SELECT * FROM finish();

ROLLBACK;
