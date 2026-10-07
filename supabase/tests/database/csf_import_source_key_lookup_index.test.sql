BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(6);

SELECT has_index(
  'plugin_data', 'csf_sheet_import_rows',
  'csf_import_rows_committed_source_key_idx',
  'committed import lineage has a source-key lookup index'
);

SELECT ok(
  pg_get_indexdef('plugin_data.csf_import_rows_committed_source_key_idx'::regclass)
    LIKE '%(organization_id, cohort_id, plugin_data.csf_class_history_source_key_value(normalized_data))%',
  'the index scopes the exact source-key expression by organization and class'
);

SELECT ok(
  (SELECT pg_get_expr(indpred, indrelid)
   FROM pg_index
   WHERE indexrelid = 'plugin_data.csf_import_rows_committed_source_key_idx'::regclass)
    = '(import_status = ANY (ARRAY[''created''::text, ''updated''::text]))',
  'only committed lineage enters the lookup index'
);

-- Give the planner selective source keys within populated tenant/class scopes.
-- Other scopes and an uncommitted duplicate must not enter the result.
INSERT INTO public.organizations (id, name, username, type, join_code) VALUES
  ('7f39bb32-ab12-44ac-b304-797685c12801', 'Lineage index fixture A', 'lineage-index-fixture-a', 'school', '839151'),
  ('7f39bb32-ab12-44ac-b304-797685c12811', 'Lineage index fixture B', 'lineage-index-fixture-b', 'school', '839152');
CREATE TEMP TABLE lineage_scopes (scope integer, organization_id uuid, cohort_id uuid, job_id uuid);
INSERT INTO lineage_scopes VALUES
  (1, '7f39bb32-ab12-44ac-b304-797685c12801', '7f39bb32-ab12-44ac-b304-797685c12802', '7f39bb32-ab12-44ac-b304-797685c12803'),
  (2, '7f39bb32-ab12-44ac-b304-797685c12801', '7f39bb32-ab12-44ac-b304-797685c12804', '7f39bb32-ab12-44ac-b304-797685c12803'),
  (3, '7f39bb32-ab12-44ac-b304-797685c12811', '7f39bb32-ab12-44ac-b304-797685c12812', '7f39bb32-ab12-44ac-b304-797685c12813');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
SELECT cohort_id, organization_id, 2030 + scope, 'Synthetic lineage class ' || scope
FROM lineage_scopes;
INSERT INTO plugin_data.csf_sheet_import_jobs (id, organization_id, mode, status, source_type)
SELECT DISTINCT job_id, organization_id, 'preview', 'completed', 'class_history'
FROM lineage_scopes;
INSERT INTO plugin_data.csf_sheet_import_rows (
  organization_id, cohort_id, job_id, sheet_tab_name, row_number,
  import_status, normalized_data
)
SELECT organization_id, cohort_id, job_id, 'Lineage ' || scope, n,
  CASE WHEN n = 2050 THEN 'pending' WHEN n = 2049 THEN 'updated' ELSE 'created' END,
  jsonb_build_object('identity', jsonb_build_object(
    'normalizedFirstName', 'fictional',
    'normalizedLastName', CASE WHEN n IN (1, 2049, 2050) THEN 'student' ELSE 'student' || n END,
    'sourceStudentKey', CASE WHEN n IN (1, 2049, 2050) THEN 'fictionalstudent' ELSE 'fictionalstudent' || n END
  ))
FROM lineage_scopes CROSS JOIN generate_series(1, 2050) AS n;
ANALYZE plugin_data.csf_sheet_import_rows;

CREATE TEMP TABLE source_key_lookup_plan (plan jsonb);
DO $$
DECLARE
  v_plan jsonb;
BEGIN
  EXECUTE $query$
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT organization_id, cohort_id,
      plugin_data.csf_class_history_source_key_value(normalized_data) AS source_key
    FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id = '7f39bb32-ab12-44ac-b304-797685c12801'::uuid
      AND cohort_id = '7f39bb32-ab12-44ac-b304-797685c12802'::uuid
      AND import_status IN ('created', 'updated')
      AND plugin_data.csf_class_history_source_key_value(normalized_data)
        = 'fictionalstudent'
  $query$ INTO v_plan;
  INSERT INTO source_key_lookup_plan VALUES (v_plan);
END;
$$;

SELECT ok(
  (SELECT plan::text LIKE '%csf_import_rows_committed_source_key_idx%'
   FROM source_key_lookup_plan),
  'the selective lineage query uses the scoped expression index with the default planner'
);

SELECT is(
  (SELECT (plan #>> '{0,Plan,Actual Rows}')::integer FROM source_key_lookup_plan),
  2,
  'the query returns only the created and updated matches in its tenant and class'
);
SELECT ok(
  (SELECT jsonb_path_exists(plan,
    '$.** ? (@."Index Name" == "csf_import_rows_committed_source_key_idx" && @."Index Cond" like_regex "organization_id.*cohort_id.*csf_class_history_source_key_value")')
   FROM source_key_lookup_plan),
  'all three equality predicates constrain the index scan'
);
SELECT diag(plan::text) FROM source_key_lookup_plan;

SELECT * FROM finish();
ROLLBACK;
