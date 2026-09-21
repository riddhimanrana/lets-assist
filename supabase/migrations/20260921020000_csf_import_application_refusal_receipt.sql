BEGIN;

-- Keep the application overwrite refusal in the durable batch receipt.
-- Other constraints retain their generic code; database details stay private.
CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_request_id uuid,
  p_import_row_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_import_row_batches%ROWTYPE;
  v_row_id uuid;
  v_result jsonb;
  v_outcome text;
  v_failure_receipt jsonb;
  v_failure_reason text;
  v_failure_detail text;
  v_succeeded integer := 0;
  v_failed integer := 0;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A row batch request ID is required.';
  END IF;
  IF coalesce(cardinality(p_import_row_ids), 0) < 1
    OR cardinality(p_import_row_ids) > 50
  THEN
    RAISE EXCEPTION 'A row batch must contain between one and 50 rows.';
  END IF;
  IF cardinality(p_import_row_ids) <> (
    SELECT count(DISTINCT row_id) FROM unnest(p_import_row_ids) AS row_id
  ) THEN
    RAISE EXCEPTION 'Each import row may appear only once per batch.';
  END IF;

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_row_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id;
  IF FOUND THEN
    IF v_batch.attempt_id IS DISTINCT FROM p_attempt_id
      OR v_batch.row_ids IS DISTINCT FROM p_import_row_ids
    THEN
      RAISE EXCEPTION 'This row batch request ID belongs to different work.';
    END IF;
    RETURN plugin_data.csf_import_row_batch_receipt(
      p_organization_id,
      p_request_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
    WHERE attempt.organization_id = p_organization_id
      AND attempt.id = p_attempt_id
      AND attempt.status = 'running'
      AND attempt.lease_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'The import commit attempt is not active.';
  END IF;

  INSERT INTO plugin_data.csf_import_row_batches (
    organization_id, attempt_id, request_id, row_ids
  ) VALUES (
    p_organization_id, p_attempt_id, p_request_id, p_import_row_ids
  ) RETURNING * INTO v_batch;

  FOREACH v_row_id IN ARRAY p_import_row_ids LOOP
    BEGIN
      PERFORM plugin_data.csf_begin_import_row_for_attempt(
        p_organization_id,
        p_attempt_id,
        v_row_id
      );
      v_result := plugin_data.csf_commit_import_row_for_attempt(
        p_organization_id,
        p_attempt_id,
        v_row_id
      );
      v_outcome := CASE
        WHEN coalesce((v_result ->> 'replayed')::boolean, false) THEN 'recovered'
        WHEN v_result ->> 'importStatus' = 'created' THEN 'created'
        ELSE 'updated'
      END;
      INSERT INTO plugin_data.csf_import_row_batch_outcomes (
        organization_id, batch_id, import_row_id, outcome, result
      ) VALUES (
        p_organization_id,
        v_batch.id,
        v_row_id,
        v_outcome,
        jsonb_build_object(
          'profileId', v_result ->> 'profileId',
          'applicationId', v_result ->> 'applicationId'
        )
      );
      v_succeeded := v_succeeded + 1;
    EXCEPTION
      WHEN SQLSTATE '23505' OR SQLSTATE '23514' THEN
        GET STACKED DIAGNOSTICS v_failure_detail = PG_EXCEPTION_DETAIL;
        v_failure_reason := CASE
          WHEN SQLSTATE = '23505' THEN 'duplicate_refused'
          WHEN SQLSTATE = '23514'
            AND v_failure_detail = 'CSF_IMPORT_REFUSAL=officer_managed_application'
            THEN 'officer_managed_application'
          ELSE 'constraint_refused'
        END;
        v_failure_receipt :=
          plugin_data.csf_record_deterministic_import_row_failure(
            p_organization_id,
            p_attempt_id,
            v_row_id,
            v_failure_reason
          );
        IF coalesce((v_failure_receipt ->> 'recorded')::boolean, false)
          IS DISTINCT FROM true
        THEN
          -- The caught database error did not prove a new terminal row state.
          -- Preserve the unresolved state and leave no batch receipt behind.
          RAISE;
        END IF;
        INSERT INTO plugin_data.csf_import_row_batch_outcomes (
          organization_id, batch_id, import_row_id, outcome, reason_code
        ) VALUES (
          p_organization_id,
          v_batch.id,
          v_row_id,
          'failed',
          v_failure_reason
        );
        v_failed := v_failed + 1;
    END;
  END LOOP;

  UPDATE plugin_data.csf_import_row_batches
  SET status = 'completed',
      succeeded_count = v_succeeded,
      failed_count = v_failed,
      completed_at = now()
  WHERE id = v_batch.id;
  RETURN plugin_data.csf_import_row_batch_receipt(
    p_organization_id,
    p_request_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) IS
  'Commits one bounded row batch, records only closed deterministic refusals, and re-raises retryable or unknown database failures.';

REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_batch_unserialized(
  uuid, uuid, uuid, uuid[]
) TO postgres;

COMMIT;
