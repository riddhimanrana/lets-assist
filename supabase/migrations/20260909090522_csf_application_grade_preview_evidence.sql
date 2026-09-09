-- Retain mapped numeric grade evidence without changing identity or approval rules.
DO $migration$
DECLARE
  definition text := pg_get_functiondef(
    'plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)'::regprocedure
  );
  envelope text := '''rejected'', ''record'', ''annotations'', ''sourceEvidence''';
  marker text := '      -- Presentation evidence: cell fills and notes captured at acquisition.';
  replay_marker text := '    -- Replay, decided by coordinate rather than by hoping the caller retries cleanly.';
BEGIN
  IF position(envelope IN definition) = 0 OR position(marker IN definition) = 0
    OR position(replay_marker IN definition) = 0 THEN
    RAISE EXCEPTION 'The reviewed CSF preview envelope changed; review this migration before applying it.';
  END IF;
  definition := replace(definition, envelope,
    envelope || ', ''applicationGradeEvidence''');
  definition := replace(definition, marker, $validation$
      IF v_normalized ? 'applicationGradeEvidence' THEN
        IF v_job.source_type <> 'application_responses'
          OR jsonb_typeof(v_normalized -> 'applicationGradeEvidence') IS DISTINCT FROM 'object'
        THEN
          RAISE EXCEPTION 'Mapped grade evidence belongs only to application response rows.'
            USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_normalized -> 'applicationGradeEvidence') AS field
          WHERE field NOT IN ('basis', 'columnNumber', 'display', 'value')
        )
          OR v_normalized #>> '{applicationGradeEvidence,basis}' IS DISTINCT FROM 'date_formatted_numeric_grade'
          OR jsonb_typeof(v_normalized #> '{applicationGradeEvidence,columnNumber}') IS DISTINCT FROM 'number'
          OR coalesce(v_normalized #>> '{applicationGradeEvidence,columnNumber}', '') !~ '^[1-9][0-9]{0,2}$'
          OR jsonb_typeof(v_normalized #> '{applicationGradeEvidence,display}') IS DISTINCT FROM 'string'
          OR length(btrim(coalesce(v_normalized #>> '{applicationGradeEvidence,display}', ''))) NOT BETWEEN 1 AND 160
          OR jsonb_typeof(v_normalized #> '{applicationGradeEvidence,value}') IS DISTINCT FROM 'number'
          OR coalesce(v_normalized #>> '{applicationGradeEvidence,value}', '') !~ '^(9|10|11|12)$'
          OR v_normalized #> '{applicationGradeEvidence,value}' IS DISTINCT FROM v_normalized #> '{record,cohort,gradeLevel}'
        THEN
          RAISE EXCEPTION 'Mapped grade evidence must contain a bounded column, provider display, and the recorded grade from 9 to 12.'
            USING ERRCODE = '23514';
        END IF;
      END IF;
$validation$ || marker);
  definition := replace(definition, replay_marker, $retry$
    -- An unproven application retry needs identity review before it can commit.
    IF v_requested_superseded AND v_status='pending'
      AND v_job.source_type='application_responses' THEN
      v_status := 'ambiguous';
    END IF;

$retry$ || replay_marker);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)
  TO service_role;
