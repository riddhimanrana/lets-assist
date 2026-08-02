BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the strict class-history importer'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the strict class-history importer'
);

-- 20260730001004 revoked direct service access to the strict importer as well:
-- reaching it requires the fenced wrapper
-- plugin_data.csf_commit_import_row_for_attempt, which derives every authoritative
-- argument from the immutable preview row. The strict-validation behavior
-- assertions below still call it directly because pgTAP runs as the migration
-- owner. The unsafe legacy importer stays revoked for everyone, as asserted next.
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the fenced wrapper to call the strict class-history importer directly'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_class_history_row_v2_legacy_unsafe_points_default(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the revoked unsafe legacy importer'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_class_history_row_v2_legacy_unsafe_points_default(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass strict validation through the unsafe legacy importer'
);

CREATE FUNCTION pg_temp.call_class_history_import(p_activities jsonb)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT plugin_data.csf_import_class_history_row_v2(
    '00000000-0000-4000-8000-000000000001',
    NULL,
    'Strict',
    'Points',
    'strict.points@students.local.test',
    NULL,
    'strict',
    'points',
    'strict.points@students.local.test',
    NULL,
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    'strict-points-test',
    p_activities,
    '[]'::jsonb,
    NULL,
    '00000000-0000-4000-8000-000000000006'
  );
$$;

SELECT extensions.throws_ok(
  $$SELECT pg_temp.call_class_history_import('[{"slot":"activity_1","value":"Food Drive"}]'::jsonb)$$,
  'P0001',
  'Imported activity points are required and must be numeric.',
  'an activity with no points field is rejected instead of defaulting to one'
);

SELECT extensions.throws_ok(
  $$SELECT pg_temp.call_class_history_import('[{"slot":"activity_1","value":"Food Drive","points":null}]'::jsonb)$$,
  'P0001',
  'Imported activity points are required and must be numeric.',
  'an activity with null points is rejected instead of defaulting to one'
);

SELECT extensions.throws_ok(
  $$SELECT pg_temp.call_class_history_import('[{"slot":"activity_1","value":"Food Drive","points":"   "}]'::jsonb)$$,
  'P0001',
  'Imported activity points are required and must be numeric.',
  'an activity with blank points is rejected instead of defaulting to one'
);

SELECT extensions.throws_ok(
  $$SELECT pg_temp.call_class_history_import('[{"slot":"activity_1","value":"Food Drive","points":"one"}]'::jsonb)$$,
  'P0001',
  'Imported activity points are required and must be numeric.',
  'an activity with nonnumeric points is rejected instead of defaulting to one'
);

SELECT * FROM extensions.finish();

ROLLBACK;
