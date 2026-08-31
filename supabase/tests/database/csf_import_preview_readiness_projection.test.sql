BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'aa510000-0000-4000-8000-000000000001',
  'CSF Readiness Projection',
  'csf-readiness-projection',
  'school',
  '511025'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_sheet_tab,
  mapping_version
) VALUES (
  'aa520000-0000-4000-8000-000000000001',
  'aa510000-0000-4000-8000-000000000001',
  'preview',
  'needs_resolution',
  'class_history',
  'S26',
  1
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES
  (
    'aa530000-0000-4000-8000-000000000001',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001',
    'S26', 2, 'pending'
  ),
  (
    'aa530000-0000-4000-8000-000000000002',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001',
    'S26', 3, 'conflict'
  );

SELECT extensions.has_function(
  'plugin_data',
  'csf_import_preview_readiness',
  ARRAY['uuid', 'uuid'],
  'the exact readiness projection exists'
);

SELECT extensions.ok(
  NOT (
    SELECT proc.prosecdef
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = 'plugin_data.csf_import_preview_readiness(uuid,uuid)'::regprocedure
  ),
  'the service-only projection runs as SECURITY INVOKER'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_import_preview_readiness(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_preview_readiness(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_preview_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'only service_role can execute the readiness projection'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_class_history_source_key_value(jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'plugin_data.csf_class_history_has_stable_source_key(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_class_history_source_key_value(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_class_history_has_stable_source_key(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_class_history_source_key_value(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_class_history_has_stable_source_key(jsonb)',
    'EXECUTE'
  ),
  'the readiness projection helpers are executable only by the server role'
);

SET LOCAL ROLE service_role;

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'pendingMissingSourceKey')::integer,
  1,
  'service_role can execute class-history readiness through both helpers'
);

RESET ROLE;

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'total')::integer,
  2,
  'the projection counts the complete preview'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'pending')::integer,
  1,
  'pending rows are counted exactly'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'conflict')::integer,
  1,
  'conflict rows are counted exactly'
);

SELECT extensions.is(
  plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'commitState',
  'none',
  'a preview without a commit job reports no commit state'
);

SELECT * FROM extensions.finish();

ROLLBACK;
