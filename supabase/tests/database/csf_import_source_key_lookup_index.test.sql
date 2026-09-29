BEGIN;

SELECT plan(4);

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

-- Prove the index is usable for this predicate, not that it wins a cost race.
-- The table has many indexes led by organization_id or cohort_id, and on sparse
-- fixture data their estimated costs tie, so the planner's pick varied with
-- statistics and image versions. Drop every other non-constraint index inside
-- this rolled-back transaction so only applicability decides the plan.
DO $$
DECLARE
  v_index regclass;
BEGIN
  FOR v_index IN
    SELECT i.indexrelid::regclass
    FROM pg_index AS i
    WHERE i.indrelid = 'plugin_data.csf_sheet_import_rows'::regclass
      AND i.indexrelid
        <> 'plugin_data.csf_import_rows_committed_source_key_idx'::regclass
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint AS c WHERE c.conindid = i.indexrelid
      )
  LOOP
    EXECUTE format('DROP INDEX %s', v_index);
  END LOOP;
END;
$$;

CREATE TEMP TABLE source_key_lookup_plan (plan jsonb);
SET LOCAL enable_seqscan = off;
DO $$
DECLARE
  v_plan jsonb;
BEGIN
  EXECUTE $query$
    EXPLAIN (FORMAT JSON)
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
  'the lineage equality predicate can use the scoped expression index'
);

SELECT diag(plan::text)
FROM source_key_lookup_plan
WHERE plan::text NOT LIKE '%csf_import_rows_committed_source_key_idx%';

SELECT * FROM finish();
ROLLBACK;
