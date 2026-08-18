BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

CREATE TEMP TABLE expected_final_owner_internal_function_acl (
  function_oid regprocedure PRIMARY KEY
);

INSERT INTO expected_final_owner_internal_function_acl (function_oid)
VALUES
  ('plugin_data.csf_consume_sheet_source_evidence(uuid,uuid,uuid,uuid,uuid)'::regprocedure),
  ('plugin_data.csf_lock_identity_mutation(uuid)'::regprocedure),
  ('plugin_data.csf_profile_merge_import_row_disposition(timestamptz,uuid,uuid,uuid,integer,text,text,text)'::regprocedure),
  ('plugin_data.csf_profile_merge_import_target_conflicts(uuid,uuid)'::regprocedure),
  ('plugin_data.csf_lock_active_import_profiles(uuid,uuid[])'::regprocedure),
  ('plugin_data.csf_enforce_import_row_attempt_lineage()'::regprocedure),
  ('plugin_data.csf_assert_import_actor(uuid,uuid,text)'::regprocedure);

SELECT is(
  (
    SELECT bool_and(pg_get_userbyid(proc.proowner) = 'postgres')
    FROM expected_final_owner_internal_function_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'final owner-internal helpers are owned by postgres'
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
    FROM expected_final_owner_internal_function_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'every final owner-internal helper has an explicit postgres execute grant'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', function_oid, 'EXECUTE')) FROM expected_final_owner_internal_function_acl),
  true,
  'anon cannot execute final owner-internal helpers'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')) FROM expected_final_owner_internal_function_acl),
  true,
  'authenticated cannot execute final owner-internal helpers'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('service_role', function_oid, 'EXECUTE')) FROM expected_final_owner_internal_function_acl),
  true,
  'service_role must use request-aware import and profile entrypoints'
);

SELECT * FROM finish();

ROLLBACK;
