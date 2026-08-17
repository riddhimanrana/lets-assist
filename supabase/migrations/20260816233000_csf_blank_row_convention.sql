-- Let silence settle a class-history row as not met.
--
-- The chapter's roster convention (confirmed by the officers): completions are
-- marked -- an X in All Reqs Met, a green fill, or a note. A member row with
-- none of those is not missing evidence; the absence is the answer. The
-- settlement RPC's evidence gate said otherwise and stranded every blank row
-- as "outcome unknown" at commit.
--
-- The gate is widened for exactly one outcome: not_met with no annotations and
-- no payload boolean. met and exception_met keep requiring positive evidence,
-- so silence can never promote anybody.

CREATE OR REPLACE FUNCTION plugin_data.csf_apply_import_annotation_interpretation(p_organization_id uuid, p_row_id uuid, p_outcome text, p_reason text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row plugin_data.csf_sheet_import_rows;
  v_blocking_error text;
  v_has_evidence boolean;
  v_met boolean;
BEGIN
  IF p_outcome NOT IN ('met', 'exception_met', 'not_met') THEN
    RAISE EXCEPTION 'Annotation settlement outcome must be met, exception_met, or not_met.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'A settlement reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A settlement actor is required.';
  END IF;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows
  WHERE id = p_row_id
    AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  IF v_row.resolution_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_settled',
      'rowNumber', v_row.row_number
    );
  END IF;
  IF v_row.import_status NOT IN ('pending', 'error')
    OR v_row.commit_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'This row is no longer settleable.';
  END IF;

  -- Any error that is not the activity-points reconciliation message is a real
  -- blocker this settlement has no authority over.
  SELECT err INTO v_blocking_error
  FROM unnest(COALESCE(v_row.errors, ARRAY[]::text[])) AS err
  WHERE err NOT LIKE 'Activity values without explicit numeric points%'
  LIMIT 1;
  IF v_blocking_error IS NOT NULL THEN
    RAISE EXCEPTION 'Row % keeps a non-annotation blocker: %',
      v_row.row_number, v_blocking_error;
  END IF;

  v_has_evidence := coalesce(
    (
      jsonb_typeof(v_row.normalized_data -> 'annotations') = 'object'
        AND v_row.normalized_data -> 'annotations' <> '{}'::jsonb
    ),
    false
  ) OR coalesce(
    jsonb_typeof(
      v_row.normalized_data -> 'commitPayload' -> 'allRequirementsMet'
    ) = 'boolean',
    false
  );
  IF NOT v_has_evidence THEN
    -- The blank-roster-row convention, confirmed by the chapter: officers mark
    -- completions (X, fill, or note), so a member row carrying none of those
    -- IS the sheet's answer -- requirements not met. Only that one outcome may
    -- settle from absence; met and exception_met still require positive
    -- evidence, so silence can never promote anybody.
    IF p_outcome <> 'not_met' THEN
      RAISE EXCEPTION 'Row % carries no presentation evidence to settle from.',
        v_row.row_number;
    END IF;
  END IF;

  v_met := p_outcome IN ('met', 'exception_met');

  -- normalized_data is immutable evidence (csf_preserve_import_row_snapshot),
  -- so the outcome rides the mutable resolution columns; the commit path reads
  -- the annotation_* reason codes as the completion override.
  UPDATE plugin_data.csf_sheet_import_rows
  SET
    errors = ARRAY[]::text[],
    import_status = 'pending',
    resolution_status = 'resolved',
    resolution_reason_code = CASE p_outcome
      WHEN 'met' THEN 'annotation_met'
      WHEN 'exception_met' THEN 'annotation_exception_met'
      ELSE 'annotation_not_met'
    END,
    resolution_notes = btrim(p_reason),
    resolved_by = p_actor_user_id,
    resolved_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'status', 'settled',
    'rowNumber', v_row.row_number,
    'outcome', p_outcome,
    'allRequirementsMet', v_met
  );
END;
$function$

;
