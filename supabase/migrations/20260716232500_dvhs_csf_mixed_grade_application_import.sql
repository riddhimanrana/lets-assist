BEGIN;

-- The original application-import RPC predates grade-derived targets and
-- required every source to carry one cohort. Preserve the atomic operation,
-- but make its source boundary understand the two explicit target strategies.
DO $migration$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'plugin_data.csf_import_application_response_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure
  )
  INTO v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$    AND source.cohort_id = p_cohort_id
    AND coalesce(source.settings->>'sourceKind', '') = 'application_responses';$old$,
    $new$    AND source.source_type = 'application_responses'
    AND coalesce(source.settings->>'sourceKind', source.source_type) = source.source_type
    AND (
      (source.target_strategy = 'fixed' AND source.cohort_id = p_cohort_id)
      OR (source.target_strategy = 'derive_from_grade' AND source.cohort_id IS NULL)
    );$new$
  );

  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not locate the CSF application source-target guard to upgrade';
  END IF;

  EXECUTE v_updated_definition;
END;
$migration$;

COMMENT ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid, text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, uuid
) IS
  'Atomically commits one reviewed application preview row. Fixed sources must match their configured cohort; grade-derived sources use the immutable row target and configured cohort-term relationship.';

COMMIT;
