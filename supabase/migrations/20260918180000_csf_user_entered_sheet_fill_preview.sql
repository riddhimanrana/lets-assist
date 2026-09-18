-- Align the immutable preview envelope with explicit Google Sheets fills.
-- Keep the later application-grade and retry guards in the current function.
DO $migration$
DECLARE
  definition text := pg_get_functiondef(
    'plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)'::regprocedure
  );
  allowed_fields text := 'WHERE field NOT IN (''background'', ''note'')';
  old_message text := 'A CSF preview row annotation may carry only "background" and "note".';
  note_marker text := '          IF v_normalized -> ''annotations'' -> v_key ? ''note''';
BEGIN
  IF position(allowed_fields IN definition) = 0
    OR position(old_message IN definition) = 0
    OR position(note_marker IN definition) = 0
    OR position('applicationGradeEvidence' IN definition) = 0
  THEN
    RAISE EXCEPTION 'The reviewed CSF preview envelope changed; review this migration before applying it.';
  END IF;

  definition := replace(
    definition,
    allowed_fields,
    'WHERE field NOT IN (''background'', ''userEnteredBackground'', ''note'')'
  );
  definition := replace(
    definition,
    old_message,
    'A CSF preview row annotation may carry only "background", "userEnteredBackground", and "note".'
  );
  definition := replace(definition, note_marker, $validation$
          IF v_normalized -> 'annotations' -> v_key ? 'userEnteredBackground'
            AND coalesce(v_normalized -> 'annotations' -> v_key ->> 'userEnteredBackground', '')
              !~ '^#[0-9a-f]{6}$'
          THEN
            RAISE EXCEPTION
              'A CSF preview row annotation user-entered background must be a lowercase #rrggbb color.'
              USING ERRCODE = '23514';
          END IF;
$validation$ || note_marker);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)
  TO service_role;
