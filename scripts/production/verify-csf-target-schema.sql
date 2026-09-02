-- Fail closed unless the deployed CSF workbook and import queue schema matches
-- the application release. This single statement reads catalog metadata only.

WITH
expected_tables(
  relation_name,
  service_select,
  service_insert,
  service_update,
  service_delete
) AS (
  VALUES
    ('csf_class_workbooks', true, true, true, true),
    ('csf_class_workbook_refresh_jobs', true, true, true, true),
    ('csf_import_approval_batches', true, true, true, false),
    ('csf_import_commit_queue', true, true, true, false),
    ('csf_import_approval_batch_items', true, true, true, false),
    ('csf_import_row_batches', true, true, true, false),
    ('csf_import_row_batch_outcomes', true, true, false, false)
),
actual_tables AS (
  SELECT
    expected.*,
    relation_record.oid,
    relation_record.relrowsecurity
  FROM expected_tables AS expected
  JOIN pg_catalog.pg_namespace AS namespace_record
    ON namespace_record.nspname = 'plugin_data'
  JOIN pg_catalog.pg_class AS relation_record
    ON relation_record.relnamespace = namespace_record.oid
   AND relation_record.relname = expected.relation_name
   AND relation_record.relkind IN ('r', 'p')
),
table_posture AS (
  SELECT
    count(*) = (SELECT count(*) FROM expected_tables)
      AND coalesce(bool_and(
        actual.relrowsecurity
        AND has_table_privilege(
          'service_role', actual.oid, 'SELECT'
        ) = actual.service_select
        AND has_table_privilege(
          'service_role', actual.oid, 'INSERT'
        ) = actual.service_insert
        AND has_table_privilege(
          'service_role', actual.oid, 'UPDATE'
        ) = actual.service_update
        AND has_table_privilege(
          'service_role', actual.oid, 'DELETE'
        ) = actual.service_delete
        AND NOT has_table_privilege('service_role', actual.oid, 'TRUNCATE')
        AND NOT has_table_privilege('service_role', actual.oid, 'REFERENCES')
        AND NOT has_table_privilege('service_role', actual.oid, 'TRIGGER')
        AND NOT has_table_privilege('anon', actual.oid, 'SELECT')
        AND NOT has_table_privilege('anon', actual.oid, 'INSERT')
        AND NOT has_table_privilege('anon', actual.oid, 'UPDATE')
        AND NOT has_table_privilege('anon', actual.oid, 'DELETE')
        AND NOT has_table_privilege('anon', actual.oid, 'TRUNCATE')
        AND NOT has_table_privilege('anon', actual.oid, 'REFERENCES')
        AND NOT has_table_privilege('anon', actual.oid, 'TRIGGER')
        AND NOT has_table_privilege('authenticated', actual.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', actual.oid, 'INSERT')
        AND NOT has_table_privilege('authenticated', actual.oid, 'UPDATE')
        AND NOT has_table_privilege('authenticated', actual.oid, 'DELETE')
        AND NOT has_table_privilege(
          'authenticated', actual.oid, 'TRUNCATE'
        )
        AND NOT has_table_privilege(
          'authenticated', actual.oid, 'REFERENCES'
        )
        AND NOT has_table_privilege(
          'authenticated', actual.oid, 'TRIGGER'
        )
      ), false) AS valid
  FROM actual_tables AS actual
),
schema_posture AS (
  SELECT
    count(*) = 1
      AND coalesce(bool_and(
        has_schema_privilege('service_role', namespace_record.oid, 'USAGE')
        AND NOT has_schema_privilege('anon', namespace_record.oid, 'USAGE')
        AND NOT has_schema_privilege(
          'authenticated', namespace_record.oid, 'USAGE'
        )
      ), false) AS valid
  FROM pg_catalog.pg_namespace AS namespace_record
  WHERE namespace_record.nspname = 'plugin_data'
),
expected_functions(signature, service_execute) AS (
  VALUES
    (
      'plugin_data.csf_claim_class_workbook_check(uuid,uuid,uuid,integer)',
      true
    ),
    (
      'plugin_data.csf_complete_class_workbook_check(uuid,uuid,uuid,uuid,text,text)',
      true
    ),
    (
      'plugin_data.csf_fail_class_workbook_check(uuid,uuid,uuid,uuid,text,text)',
      true
    ),
    (
      'plugin_data.csf_queue_class_workbook_preparation(uuid,uuid,text,uuid,text,text,jsonb)',
      true
    ),
    (
      'plugin_data.csf_claim_class_workbook_refresh_job(integer)',
      true
    ),
    (
      'plugin_data.csf_finish_class_workbook_refresh_job(uuid,uuid,text,jsonb,integer,integer,integer,text)',
      true
    ),
    (
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
      true
    ),
    (
      'plugin_data.csf_claim_import_commit_queue(integer)',
      true
    ),
    (
      'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
      true
    ),
    (
      'plugin_data.csf_block_import_commit_queue(uuid,text)',
      false
    ),
    (
      'plugin_data.csf_import_row_batch_receipt(uuid,uuid)',
      true
    ),
    (
      'plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])',
      true
    ),
    (
      'plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)',
      false
    ),
    (
      'plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])',
      false
    ),
    ('plugin_data.csf_audit_import_approval_batch()', false),
    ('plugin_data.csf_normalize_import_approval_batch_status()', false)
),
actual_functions AS (
  SELECT
    expected.*,
    function_record.oid,
    function_record.prosecdef,
    function_record.proconfig
  FROM expected_functions AS expected
  JOIN pg_catalog.pg_proc AS function_record
    ON function_record.oid = pg_catalog.to_regprocedure(expected.signature)
),
function_posture AS (
  SELECT
    count(*) = (SELECT count(*) FROM expected_functions)
      AND coalesce(bool_and(
        actual.prosecdef
        AND actual.proconfig @> ARRAY['search_path=""']
        AND has_function_privilege(
          'service_role', actual.oid, 'EXECUTE'
        ) = actual.service_execute
        AND NOT has_function_privilege('anon', actual.oid, 'EXECUTE')
        AND NOT has_function_privilege(
          'authenticated', actual.oid, 'EXECUTE'
        )
      ), false) AS valid
  FROM actual_functions AS actual
),
obsolete_function_posture AS (
  SELECT bool_and(pg_catalog.to_regprocedure(signature) IS NULL) AS valid
  FROM (
    VALUES
      (
        'plugin_data.csf_register_class_workbook(uuid,uuid,text,uuid,text,text,jsonb)'
      ),
      (
        'plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)'
      ),
      (
        'plugin_data.csf_join_class_by_code_pre_identity_guard(uuid,text,uuid,text,text,text,text,uuid,uuid)'
      )
  ) AS obsolete(signature)
),
expected_foreign_keys(
  constraint_name,
  child_relation,
  parent_relation,
  child_columns,
  parent_columns,
  delete_action
) AS (
  VALUES
    (
      'csf_class_workbooks_cohort_organization_fk',
      'plugin_data.csf_class_workbooks',
      'plugin_data.csf_cohorts',
      ARRAY['cohort_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      'csf_class_workbook_refresh_jobs_workbook_organization_fk',
      'plugin_data.csf_class_workbook_refresh_jobs',
      'plugin_data.csf_class_workbooks',
      ARRAY['workbook_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      NULL,
      'plugin_data.csf_import_commit_queue',
      'plugin_data.csf_sheet_import_jobs',
      ARRAY['preview_job_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      NULL,
      'plugin_data.csf_import_approval_batch_items',
      'plugin_data.csf_sheet_import_jobs',
      ARRAY['preview_job_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      NULL,
      'plugin_data.csf_import_row_batches',
      'plugin_data.csf_sheet_import_commit_attempts',
      ARRAY['attempt_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      NULL,
      'plugin_data.csf_import_row_batch_outcomes',
      'plugin_data.csf_sheet_import_rows',
      ARRAY['import_row_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      'csf_sheet_sources_cohort_organization_fkey',
      'plugin_data.csf_sheet_sources',
      'plugin_data.csf_cohorts',
      ARRAY['cohort_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'n'
    ),
    (
      'csf_import_approval_items_batch_organization_fkey',
      'plugin_data.csf_import_approval_batch_items',
      'plugin_data.csf_import_approval_batches',
      ARRAY['batch_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    ),
    (
      'csf_import_approval_items_queue_organization_fkey',
      'plugin_data.csf_import_approval_batch_items',
      'plugin_data.csf_import_commit_queue',
      ARRAY['queue_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'n'
    ),
    (
      'csf_import_row_outcomes_batch_organization_fkey',
      'plugin_data.csf_import_row_batch_outcomes',
      'plugin_data.csf_import_row_batches',
      ARRAY['batch_id', 'organization_id']::text[],
      ARRAY['id', 'organization_id']::text[],
      'c'
    )
),
actual_foreign_keys AS (
  SELECT
    constraint_record.conname,
    constraint_record.conrelid,
    constraint_record.confrelid,
    constraint_record.confdeltype::text AS delete_action,
    constraint_record.convalidated,
    ARRAY(
      SELECT attribute_record.attname::text
      FROM unnest(constraint_record.conkey)
        WITH ORDINALITY AS key_column(attnum, position)
      JOIN pg_catalog.pg_attribute AS attribute_record
        ON attribute_record.attrelid = constraint_record.conrelid
       AND attribute_record.attnum = key_column.attnum
      ORDER BY key_column.position
    ) AS child_columns,
    ARRAY(
      SELECT attribute_record.attname::text
      FROM unnest(constraint_record.confkey)
        WITH ORDINALITY AS key_column(attnum, position)
      JOIN pg_catalog.pg_attribute AS attribute_record
        ON attribute_record.attrelid = constraint_record.confrelid
       AND attribute_record.attnum = key_column.attnum
      ORDER BY key_column.position
    ) AS parent_columns
  FROM pg_catalog.pg_constraint AS constraint_record
  WHERE constraint_record.contype = 'f'
),
foreign_key_posture AS (
  SELECT bool_and(EXISTS (
    SELECT 1
    FROM actual_foreign_keys AS actual
    WHERE actual.conrelid = pg_catalog.to_regclass(expected.child_relation)
      AND (
        expected.constraint_name IS NULL
        OR actual.conname = expected.constraint_name
      )
      AND actual.confrelid = pg_catalog.to_regclass(expected.parent_relation)
      AND actual.child_columns = expected.child_columns
      AND actual.parent_columns = expected.parent_columns
      AND actual.delete_action = expected.delete_action
      AND actual.convalidated
  )) AS valid
  FROM expected_foreign_keys AS expected
),
expected_indexes(relation_name, index_name, must_be_unique) AS (
  VALUES
    (
      'plugin_data.csf_class_workbook_refresh_jobs',
      'csf_class_workbook_refresh_jobs_claim_idx',
      false
    ),
    (
      'plugin_data.csf_class_workbook_refresh_jobs',
      'csf_class_workbook_refresh_jobs_running_lease_idx',
      false
    ),
    (
      'plugin_data.csf_class_workbook_refresh_jobs',
      'csf_workbook_refresh_jobs_tenant_state_idx',
      false
    ),
    (
      'plugin_data.csf_class_workbook_refresh_jobs',
      'csf_class_workbook_refresh_jobs_source_version_key',
      true
    ),
    (
      'plugin_data.csf_import_commit_queue',
      'csf_import_commit_queue_claim_idx',
      false
    ),
    (
      'plugin_data.csf_import_commit_queue',
      'csf_import_commit_queue_running_lease_idx',
      false
    ),
    (
      'plugin_data.csf_import_approval_batch_items',
      'csf_import_approval_items_tenant_batch_idx',
      false
    ),
    (
      'plugin_data.csf_import_approval_batch_items',
      'csf_import_approval_items_org_queue_idx',
      false
    ),
    (
      'plugin_data.csf_import_row_batch_outcomes',
      'csf_import_row_outcomes_tenant_batch_idx',
      false
    )
),
index_posture AS (
  SELECT bool_and(EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_record
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_record.oid
    WHERE index_record.relname = expected.index_name
      AND index_state.indrelid = pg_catalog.to_regclass(
        expected.relation_name
      )
      AND index_state.indisvalid
      AND index_state.indisready
      AND (
        NOT expected.must_be_unique
        OR index_state.indisunique
      )
  )) AS valid
  FROM expected_indexes AS expected
),
queue_lookup_index_posture AS (
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_record
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_record.oid
    WHERE index_record.relname = 'csf_import_approval_items_org_queue_idx'
      AND index_state.indrelid = pg_catalog.to_regclass(
        'plugin_data.csf_import_approval_batch_items'
      )
      AND index_state.indisvalid
      AND index_state.indisready
      AND ARRAY(
        SELECT attribute_record.attname::text
        FROM unnest(index_state.indkey)
          WITH ORDINALITY AS index_column(attnum, position)
        JOIN pg_catalog.pg_attribute AS attribute_record
          ON attribute_record.attrelid = index_state.indrelid
         AND attribute_record.attnum = index_column.attnum
        ORDER BY index_column.position
      ) = ARRAY['organization_id', 'queue_id']::text[]
      AND pg_catalog.pg_get_expr(
        index_state.indpred,
        index_state.indrelid
      ) = '(queue_id IS NOT NULL)'
  ) AS valid
),
expected_triggers(
  relation_name,
  trigger_name,
  function_signature,
  trigger_type
) AS (
  VALUES
    (
      'plugin_data.csf_import_approval_batches',
      'csf_import_approval_batches_normalize_status',
      'plugin_data.csf_normalize_import_approval_batch_status()',
      19
    ),
    (
      'plugin_data.csf_import_approval_batches',
      'csf_import_approval_batches_audit',
      'plugin_data.csf_audit_import_approval_batch()',
      17
    )
),
trigger_posture AS (
  SELECT bool_and(EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = pg_catalog.to_regclass(
        expected.relation_name
      )
      AND trigger_record.tgname = expected.trigger_name
      AND trigger_record.tgfoid = pg_catalog.to_regprocedure(
        expected.function_signature
      )
      AND NOT trigger_record.tgisinternal
      AND trigger_record.tgenabled <> 'D'
      AND trigger_record.tgtype = expected.trigger_type
  )) AS valid
  FROM expected_triggers AS expected
)
SELECT 1 / CASE
  WHEN (SELECT valid FROM table_posture)
    AND (SELECT valid FROM schema_posture)
    AND (SELECT valid FROM function_posture)
    AND (SELECT valid FROM obsolete_function_posture)
    AND (SELECT valid FROM foreign_key_posture)
    AND (SELECT valid FROM index_posture)
    AND (SELECT valid FROM queue_lookup_index_posture)
    AND (SELECT valid FROM trigger_posture)
  THEN 1
  ELSE 0
END AS csf_target_schema_verified;
