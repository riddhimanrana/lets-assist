BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

CREATE TEMP TABLE expected_partner_function_acl (
  function_oid regprocedure PRIMARY KEY,
  service_role_execute boolean NOT NULL
);

INSERT INTO expected_partner_function_acl (function_oid, service_role_execute)
VALUES
  ('plugin_data.csf_assert_point_submission_eligibility(uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean)'::regprocedure, false),
  ('plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid)'::regprocedure, false),
  ('plugin_data.csf_point_submission_receipt_state(uuid,uuid)'::regprocedure, false),
  ('plugin_data.csf_profile_merge_reference_plan(uuid,uuid)'::regprocedure, false),
  ('plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure, false),
  ('plugin_data.csf_merge_profiles_account_order_base(uuid,uuid,uuid,text,uuid)'::regprocedure, false),
  ('plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid)'::regprocedure, false),
  ('plugin_data.csf_purge_recovery_foundations(uuid)'::regprocedure, true),
  ('plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure, false),
  ('plugin_data.csf_reject_recipient_snapshot_mutation()'::regprocedure, true),
  ('plugin_data.csf_lock_contextual_commit_population(uuid,uuid,uuid)'::regprocedure, false),
  ('plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid,uuid,uuid,jsonb)'::regprocedure, false);

SELECT is(
  (
    SELECT bool_and(pg_get_userbyid(proc.proowner) = 'postgres')
    FROM expected_partner_function_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'all replaced partner simplification functions are owned by postgres'
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
    FROM expected_partner_function_acl AS expected
    JOIN pg_proc AS proc ON proc.oid = expected.function_oid::oid
  ),
  true,
  'every replaced partner function has an explicit postgres execute grant'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', function_oid, 'EXECUTE')) FROM expected_partner_function_acl),
  true,
  'anon cannot execute any replaced partner simplification function'
);

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')) FROM expected_partner_function_acl),
  true,
  'authenticated cannot execute any replaced partner simplification function'
);

SELECT is(
  (
    SELECT bool_and(
      has_function_privilege('service_role', function_oid, 'EXECUTE') = service_role_execute
    )
    FROM expected_partner_function_acl
  ),
  true,
  'service_role keeps only the two reviewed recovery and trigger boundaries'
);

SELECT * FROM finish();

ROLLBACK;
